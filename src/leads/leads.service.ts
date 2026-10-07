import { Injectable, NotFoundException } from '@nestjs/common';
import { PartnerStage, Platform, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';

export interface LeadQuery {
  platform?: Platform;
  stage?: PartnerStage;
  q?: string;
  /** Only leads found at or after this time (used for "found today" / "last search"). */
  since?: Date;
  limit?: number;
  offset?: number;
}

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private where(q: LeadQuery): Prisma.LeadWhereInput {
    return {
      ...(q.platform ? { platform: q.platform } : {}),
      ...(q.stage ? { stage: q.stage } : {}),
      ...(q.since ? { discoveredAt: { gte: q.since } } : {}),
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
        orderBy: [{ discoveredAt: 'desc' }, { displayName: 'asc' }],
        take,
        skip: Math.max(q.offset ?? 0, 0),
        // The list doesn't need the long recent-content payload.
        select: { id: true, platform: true, handle: true, url: true, displayName: true, bio: true, followers: true, country: true, language: true, contactEmail: true, source: true, discoveredAt: true, stage: true, stageNote: true, stageBy: true, stageAt: true },
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

  async stats() {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const [total, last24h, byPlatform, byStage] = await Promise.all([
      this.prisma.lead.count(),
      this.prisma.lead.count({ where: { discoveredAt: { gte: dayAgo } } }),
      this.prisma.lead.groupBy({ by: ['platform'], _count: true }),
      this.prisma.lead.groupBy({ by: ['stage'], _count: true }),
    ]);
    return { total, last24h, byPlatform: Object.fromEntries(byPlatform.map((r) => [r.platform, r._count])), byStage: Object.fromEntries(byStage.map((r) => [r.stage, r._count])) };
  }

  /** Lets a person fill in what automation couldn't find (an email, a bio, a country). */
  async enrich(actor: string, id: string, patch: { contactEmail?: string | null; country?: string | null; bio?: string; displayName?: string }) {
    await this.get(id);
    const data: Prisma.LeadUpdateInput = {};
    if (patch.contactEmail !== undefined) data.contactEmail = patch.contactEmail ? patch.contactEmail.toLowerCase() : null;
    if (patch.country !== undefined) data.country = patch.country ? patch.country.toUpperCase() : null;
    if (patch.displayName) data.displayName = patch.displayName;
    if (patch.bio !== undefined) data.bio = patch.bio;
    await this.prisma.lead.update({ where: { id }, data });
    await this.audit.log(actor, 'LEAD_EDITED', id, { fields: Object.keys(patch) });
    return this.get(id);
  }

  /** Records where the team's own outreach stands. Nothing is sent from here. */
  async setStage(actor: string, id: string, stage: PartnerStage, note?: string) {
    await this.get(id);
    await this.prisma.lead.update({ where: { id }, data: { stage, stageNote: note ?? null, stageBy: actor, stageAt: new Date() } });
    await this.audit.log(actor, 'LEAD_STAGE', id, { stage, note: note ?? null });
    return this.get(id);
  }

  async remove(actor: string, id: string) {
    await this.get(id);
    await this.prisma.lead.delete({ where: { id } });
    await this.audit.log(actor, 'LEAD_DELETED', id);
    return { deleted: true };
  }
}
