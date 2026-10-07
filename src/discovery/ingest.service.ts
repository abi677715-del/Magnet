import { Injectable } from '@nestjs/common';
import { Platform, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { RawLead } from './types';

@Injectable()
export class IngestService {
  constructor(private prisma: PrismaService) {}

  /**
   * Saves a discovered lead. The same creator found twice is one lead — we
   * refresh what we know about them.
   */
  async upsert(raw: RawLead): Promise<{ id: string; created: boolean }> {
    const handle = raw.handle.trim().toLowerCase();
    const where = { platform_handle: { platform: raw.platform as Platform, handle } };
    const existing = await this.prisma.lead.findUnique({ where });

    if (!existing) {
      const lead = await this.prisma.lead.create({
        data: {
          platform: raw.platform,
          handle,
          url: raw.url,
          displayName: raw.displayName,
          bio: raw.bio ?? '',
          followers: raw.followers ?? null,
          country: raw.country ?? null,
          language: raw.language ?? null,
          contactEmail: raw.contactEmail ?? null,
          recentContent: (raw.recentContent ?? []) as Prisma.InputJsonValue,
          source: raw.source,
        },
      });
      return { id: lead.id, created: true };
    }

    // Only fill gaps and refresh facts; a manual edit of a field is kept unless we now have better data.
    const hasNewContent = (raw.recentContent?.length ?? 0) > 0;
    await this.prisma.lead.update({
      where: { id: existing.id },
      data: {
        displayName: raw.displayName || existing.displayName,
        bio: (raw.bio ?? '').length > existing.bio.length ? raw.bio : undefined,
        followers: raw.followers ?? undefined,
        country: existing.country ?? raw.country ?? undefined,
        language: existing.language ?? raw.language ?? undefined,
        contactEmail: existing.contactEmail ?? raw.contactEmail ?? undefined,
        recentContent: hasNewContent ? (raw.recentContent as Prisma.InputJsonValue) : undefined,
      },
    });
    return { id: existing.id, created: false };
  }

  async upsertMany(raws: RawLead[]) {
    let created = 0;
    let updated = 0;
    const ids: string[] = [];
    for (const raw of raws) {
      const r = await this.upsert(raw);
      ids.push(r.id);
      r.created ? created++ : updated++;
    }
    return { created, updated, ids };
  }
}
