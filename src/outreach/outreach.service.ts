import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LeadStatus, OutreachStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { config } from '../common/config';
import { Drafter } from './drafter';
import { buildFooter, lintOutreach, unsubscribeUrl } from './compliance';
import { Mailer, MAILER } from './mailer';

export const DRAFTER = Symbol('DRAFTER');

const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

@Injectable()
export class OutreachService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    @Inject(DRAFTER) private drafter: Drafter,
    @Inject(MAILER) private mailer: Mailer,
  ) {}

  private async assertNotSuppressed(email: string) {
    const hit = await this.prisma.suppression.findUnique({ where: { email: email.toLowerCase() } });
    if (hit) throw new BadRequestException('This address has opted out or been marked do-not-contact.');
  }

  /** Only approved leads with a published email get a draft, and only one open draft at a time. */
  async createDraft(actor: string, leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.status !== LeadStatus.APPROVED) throw new BadRequestException('Approve this lead before drafting a message.');
    if (!lead.contactEmail) throw new BadRequestException('Add a contact email for this lead first.');
    await this.assertNotSuppressed(lead.contactEmail);

    const open = await this.prisma.outreach.findFirst({ where: { leadId, status: { in: [OutreachStatus.DRAFT, OutreachStatus.APPROVED] } } });
    if (open) throw new BadRequestException('There is already an open draft for this lead — edit or send that one.');

    const recent = Array.isArray(lead.recentContent) ? (lead.recentContent as { title?: string }[]) : [];
    const draft = await this.drafter.write({
      displayName: lead.displayName,
      platform: lead.platform,
      url: lead.url,
      category: lead.category,
      summary: lead.summary,
      strengths: lead.strengths,
      language: lead.language,
      recentTitles: recent.map((r) => r.title ?? '').filter(Boolean),
    });

    const created = await this.prisma.outreach.create({
      data: { leadId, toEmail: lead.contactEmail.toLowerCase(), subject: draft.subject.trim(), body: draft.body.trim() },
    });
    await this.audit.log(actor, 'OUTREACH_DRAFTED', leadId, { outreachId: created.id, model: this.drafter.modelName });
    return this.view(created.id);
  }

  async view(id: string) {
    const o = await this.prisma.outreach.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Draft not found');
    return {
      ...o,
      warnings: lintOutreach(o.subject, o.body),
      // Exactly what the recipient will receive, footer included.
      fullText: `${o.body}\n${buildFooter(o.toEmail)}`,
    };
  }

  /** Any edit cancels an earlier approval — approval is for one exact piece of text. */
  async edit(actor: string, id: string, subject: string, body: string) {
    const changed = await this.prisma.outreach.updateMany({
      where: { id, status: { in: [OutreachStatus.DRAFT, OutreachStatus.APPROVED] } },
      data: { subject: subject.trim(), body: body.trim(), status: OutreachStatus.DRAFT, approvedBy: null, approvedAt: null },
    });
    if (changed.count === 0) throw new BadRequestException('This message can no longer be edited.');
    await this.audit.log(actor, 'OUTREACH_EDITED', undefined, { outreachId: id });
    return this.view(id);
  }

  async approve(actor: string, id: string) {
    const o = await this.prisma.outreach.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Draft not found');
    const problems = lintOutreach(o.subject, o.body);
    if (problems.length) throw new BadRequestException(`Fix these before approving: ${problems.join('; ')}`);
    const claimed = await this.prisma.outreach.updateMany({
      where: { id, status: OutreachStatus.DRAFT },
      data: { status: OutreachStatus.APPROVED, approvedBy: actor, approvedAt: new Date() },
    });
    if (claimed.count === 0) throw new BadRequestException('Only an open draft can be approved.');
    await this.audit.log(actor, 'OUTREACH_APPROVED', o.leadId, { outreachId: id });
    return this.view(id);
  }

  async send(actor: string, id: string) {
    const o = await this.prisma.outreach.findUnique({ where: { id }, include: { lead: true } });
    if (!o) throw new NotFoundException('Draft not found');
    if (o.status !== OutreachStatus.APPROVED) throw new BadRequestException('Approve the message before sending it.');
    if (o.lead.status !== LeadStatus.APPROVED) throw new BadRequestException(`The lead is ${o.lead.status}, so this can't be sent.`);
    if (!o.lead.contactEmail || o.lead.contactEmail.toLowerCase() !== o.toEmail) {
      throw new BadRequestException("The lead's email changed after this draft was written — create a new draft.");
    }
    await this.assertNotSuppressed(o.toEmail);
    const problems = lintOutreach(o.subject, o.body);
    if (problems.length) throw new BadRequestException(`Can't send: ${problems.join('; ')}`);

    const text = `${o.body}\n${buildFooter(o.toEmail)}`;

    if (config.outreachDryRun) {
      // Nothing is sent and nothing changes — the manager sees exactly what would go out.
      return { dryRun: true as const, to: o.toEmail, subject: o.subject, text, note: 'DRY RUN: set OUTREACH_DRY_RUN=false to really send.' };
    }
    if (!process.env.RESEND_API_KEY || !config.outreachFrom || !config.senderCompanyAddress) {
      throw new BadRequestException('Sending needs RESEND_API_KEY, OUTREACH_FROM and SENDER_COMPANY_ADDRESS (a postal address is required by anti-spam law).');
    }

    // Claim first: only one request can ever send this message.
    const claimed = await this.prisma.outreach.updateMany({ where: { id, status: OutreachStatus.APPROVED, sentAt: null }, data: { sentAt: new Date() } });
    if (claimed.count === 0) throw new BadRequestException('This message is already being sent.');

    const sentToday = await this.prisma.outreach.count({ where: { sentAt: { gte: startOfUtcDay() } } });
    if (sentToday > config.outreachDailyLimit) {
      await this.prisma.outreach.update({ where: { id }, data: { sentAt: null } });
      throw new BadRequestException(`Daily sending limit reached (${config.outreachDailyLimit}). Try again tomorrow.`);
    }

    try {
      const { id: providerId } = await this.mailer.send({ to: o.toEmail, subject: o.subject, text, unsubscribeUrl: unsubscribeUrl(o.toEmail) });
      await this.prisma.outreach.update({ where: { id }, data: { status: OutreachStatus.SENT, providerId } });
      await this.prisma.lead.updateMany({ where: { id: o.leadId, status: LeadStatus.APPROVED }, data: { status: LeadStatus.CONTACTED } });
      await this.audit.log(actor, 'OUTREACH_SENT', o.leadId, { outreachId: id, providerId });
      return { dryRun: false as const, to: o.toEmail, providerId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Send failed';
      await this.prisma.outreach.update({ where: { id }, data: { status: OutreachStatus.FAILED, sentAt: null, error: message.slice(0, 300) } });
      throw new BadRequestException(message);
    }
  }

  /** Opt-out: suppress the address forever and stop anything pending for it. Works from the public unsubscribe link. */
  async unsubscribe(email: string) {
    const address = email.toLowerCase();
    await this.prisma.suppression.upsert({ where: { email: address }, create: { email: address, reason: 'Unsubscribed via link' }, update: {} });
    const leads = await this.prisma.lead.findMany({ where: { contactEmail: { equals: address, mode: 'insensitive' } }, select: { id: true } });
    await this.prisma.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: { status: LeadStatus.DO_NOT_CONTACT } });
    await this.prisma.outreach.updateMany({
      where: { toEmail: address, status: { in: [OutreachStatus.DRAFT, OutreachStatus.APPROVED] } },
      data: { status: OutreachStatus.FAILED, error: 'Recipient opted out' },
    });
    await this.audit.log('recipient', 'UNSUBSCRIBED', leads[0]?.id, { leads: leads.length });
  }
}
