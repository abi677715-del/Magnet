import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';
import { AI_DISCOVERER, AiDiscoverer, AiSearchRequest } from './ai-discovery';
import { RawLead } from './types';
import { validateCandidates } from './ai-validate';
import { DiscoveryService } from './discovery.service';
import { IngestService } from './ingest.service';

export const UNVERIFIED_PREFIX = '[Unverified AI web-search note]';

export interface AiJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  result?: {
    searches: number;
    suggested: number;
    created: number;
    updated: number;
    verifiedFromSource: number;
    rejected: { url: string; reason: string }[];
  };
}

const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Runs Claude's web search in the background (it can take minutes), then
 * verifies every suggestion before it becomes a lead. Jobs live in memory, so
 * this assumes a single server instance — the result is also in the audit log.
 */
@Injectable()
export class AiDiscoveryService {
  private readonly logger = new Logger(AiDiscoveryService.name);
  private jobs = new Map<string, AiJob>();

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private discovery: DiscoveryService,
    private ingest: IngestService,
    @Inject(AI_DISCOVERER) private discoverer: AiDiscoverer,
  ) {}

  async start(actor: string, req: Omit<AiSearchRequest, 'maxSearches'>): Promise<{ jobId: string }> {
    if ([...this.jobs.values()].some((j) => j.status === 'running')) {
      throw new BadRequestException('An AI search is already running — wait for it to finish.');
    }
    const today = await this.prisma.auditLog.count({ where: { action: 'DISCOVERY_AI', createdAt: { gte: startOfUtcDay() } } });
    if (today >= config.aiDiscoveryDailyLimit) {
      throw new BadRequestException(`Daily AI search limit reached (${config.aiDiscoveryDailyLimit}). Try again tomorrow.`);
    }
    await this.audit.log(actor, 'DISCOVERY_AI', undefined, { segments: req.segments, country: req.country ?? null });

    const job: AiJob = { id: randomUUID(), status: 'running', startedAt: new Date().toISOString() };
    this.jobs.set(job.id, job);
    for (const old of [...this.jobs.keys()].slice(0, Math.max(0, this.jobs.size - 20))) this.jobs.delete(old);

    void this.run(job, actor, { ...req, maxSearches: config.aiDiscoveryMaxSearches });
    return { jobId: job.id };
  }

  get(id: string): AiJob {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException('Search not found (it may have expired or the server restarted).');
    return job;
  }

  private async run(job: AiJob, actor: string, req: AiSearchRequest) {
    try {
      const found = await this.discoverer.find(req);
      const { accepted, rejected } = validateCandidates(found.candidates, found.seenUrls, req.limit);

      let created = 0;
      let updated = 0;
      let verified = 0;
      for (const c of accepted) {
        try {
          const { raw, enriched } = await this.discovery.readLead(c.parsed, 'ai-search').catch((): { raw: RawLead; enriched: boolean } => ({
            raw: { platform: c.parsed.platform, handle: c.parsed.handle, url: c.parsed.url, displayName: c.parsed.handle, source: 'ai-search' },
            enriched: false,
          }));
          if (enriched) verified++;
          else {
            // Nothing on this lead came from the source itself. The model's note is kept, but labelled as
            // second-hand so the scorer treats it as weak evidence. Followers and emails are never taken from it.
            raw.displayName = c.name || raw.displayName;
            raw.bio = c.note ? `${UNVERIFIED_PREFIX} ${c.note}` : '';
          }
          const r = await this.ingest.upsert(raw);
          r.created ? created++ : updated++;
        } catch (err) {
          rejected.push({ url: c.parsed.url, reason: err instanceof Error ? err.message : 'Could not be saved' });
        }
      }

      job.result = { searches: found.searches, suggested: found.candidates.length, created, updated, verifiedFromSource: verified, rejected };
      job.status = 'done';
      await this.audit.log(actor, 'DISCOVERY_AI_RESULT', undefined, { jobId: job.id, created, updated, rejected: rejected.length });
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : 'The AI search failed';
      this.logger.warn(`AI discovery failed: ${job.error}`);
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  }
}
