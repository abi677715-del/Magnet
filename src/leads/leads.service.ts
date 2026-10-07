import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadStatus, Platform, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { HARD_FLAGS, OUTSIDE_TARGET_MARKETS } from '../classification/scoring';

export interface LeadQuery {
  status?: LeadStatus;
  platform?: Platform;
  minScore?: number;
  priority?: boolean;
  needsAttention?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

/**
 * Quotes a CSV cell. Text that starts with = + - @ would be run as a formula by Excel/Sheets, and these
 * values come from strangers' public profiles, so such cells are prefixed with an apostrophe.
 */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const BLOCKING = new Set<string>([...HARD_FLAGS, OUTSIDE_TARGET_MARKETS]);

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private where(q: LeadQuery): Prisma.LeadWhereInput {
    return {
      ...(q.status ? { status: q.status } : {}),
      ...(q.platform ? { platform: q.platform } : {}),
      ...(q.minScore !== undefined ? { score: { gte: q.minScore } } : {}),
      ...(q.priority ? { isPriority: true } : {}),
      ...(q.needsAttention ? { scoreError: { not: null } } : {}),
      ...(q.q
        ? { OR: [{ displayName: { contains: q.q, mode: 'insensitive' } }, { handle: { contains: q.q, mode: 'insensitive' } }, { bio: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
  }

  async list(q: LeadQuery) {
    const where = this.where(q);
    const take = Math.min(Math.max(q.limit ?? 25, 1), 100);
    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { discoveredAt: 'desc' }],
        take,
        skip: Math.max(q.offset ?? 0, 0),
        // The list doesn't need the long recent-content payload.
        select: {
          id: true, platform: true, handle: true, url: true, displayName: true, bio: true, followers: true,
          country: true, language: true, contactEmail: true, source: true, discoveredAt: true, status: true,
          score: true, category: true, summary: true, strengths: true, concerns: true, redFlags: true,
          isPriority: true, scoredAt: true, scoreError: true, reviewedBy: true, reviewedAt: true, reviewNote: true,
        },
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { items, total };
  }

  async get(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  /** Everything matching the filter as CSV (up to 5,000 rows), best score first, for the team to work from outside the app. */
  async exportCsv(q: LeadQuery): Promise<string> {
    const leads = await this.prisma.lead.findMany({
      where: this.where(q),
      orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { discoveredAt: 'desc' }],
      take: 5000,
    });
    const header = ['Name', 'Platform', 'Handle', 'Link', 'Followers', 'Country', 'Language', 'Category', 'Score', 'Priority', 'Status', 'Red flags', 'Summary', 'Strengths', 'Concerns', 'Public contact email', 'Decision by', 'Decision note', 'Found on'];
    const rows = leads.map((l) => [
      l.displayName, l.platform, l.handle, l.url, l.followers, l.country, l.language, l.category, l.score, l.isPriority ? 'yes' : '', l.status,
      l.redFlags.join('; '), l.summary, l.strengths.join('; '), l.concerns.join('; '), l.contactEmail, l.reviewedBy, l.reviewNote, l.discoveredAt.toISOString().slice(0, 10),
    ]);
    return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  async stats() {
    const [byStatus, priority, needsAttention, avg] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['status'], _count: true }),
      this.prisma.lead.count({ where: { isPriority: true, status: LeadStatus.SCORED } }),
      this.prisma.lead.count({ where: { scoreError: { not: null }, status: LeadStatus.NEW } }),
      this.prisma.lead.aggregate({ _avg: { score: true } }),
    ]);
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      awaitingReviewPriority: priority,
      needsAttention,
      averageScore: avg._avg.score === null ? null : Math.round(avg._avg.score),
    };
  }

  /** Every status change is a single conditional UPDATE, so two managers clicking at once can't both "win". */
  private async move(
    actor: string,
    id: string,
    from: LeadStatus[],
    to: LeadStatus,
    note: string | undefined,
    action: string,
    extraWhere: Prisma.LeadWhereInput = {},
  ) {
    const claimed = await this.prisma.lead.updateMany({
      where: { id, status: { in: from }, ...extraWhere },
      data: { status: to, reviewedBy: actor, reviewedAt: new Date(), reviewNote: note ?? null },
    });
    if (claimed.count === 0) {
      const lead = await this.prisma.lead.findUnique({ where: { id }, select: { status: true } });
      if (!lead) throw new NotFoundException('Lead not found');
      throw new BadRequestException(`This lead is ${lead.status} and can't be moved to ${to} from there.`);
    }
    await this.audit.log(actor, action, id, { note: note ?? null });
    return this.get(id);
  }

  async approve(actor: string, id: string, note?: string) {
    const lead = await this.get(id);
    if (!lead.scoredAt) throw new BadRequestException('Score this lead before approving it.');
    const blocking = lead.redFlags.filter((f) => BLOCKING.has(f));
    if (blocking.length) {
      // Compliance rule, not a preference: managers can't override it from the dashboard.
      throw new BadRequestException(`Can't approve a lead with a disqualifying flag (${blocking.join(', ')}).`);
    }
    return this.move(actor, id, [LeadStatus.SCORED, LeadStatus.REJECTED], LeadStatus.APPROVED, note, 'LEAD_APPROVED');
  }

  reject(actor: string, id: string, note?: string) {
    return this.move(actor, id, [LeadStatus.NEW, LeadStatus.SCORED, LeadStatus.APPROVED], LeadStatus.REJECTED, note, 'LEAD_REJECTED');
  }

  /** Lets a manager fill in what automation couldn't find (an email, a bio, a country). */
  async enrich(actor: string, id: string, patch: { contactEmail?: string | null; country?: string | null; bio?: string; displayName?: string }) {
    const lead = await this.get(id);
    const data: Prisma.LeadUpdateInput = {};
    if (patch.contactEmail !== undefined) data.contactEmail = patch.contactEmail ? patch.contactEmail.toLowerCase() : null;
    if (patch.country !== undefined) data.country = patch.country ? patch.country.toUpperCase() : null;
    if (patch.displayName) data.displayName = patch.displayName;
    if (patch.bio !== undefined) {
      data.bio = patch.bio;
      if (lead.status === LeadStatus.NEW) data.scoreError = null; // new information: worth another try
    }
    await this.prisma.lead.update({ where: { id }, data });
    await this.audit.log(actor, 'LEAD_EDITED', id, { fields: Object.keys(patch) });
    return this.get(id);
  }
}
