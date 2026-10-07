import { Inject, Injectable, Logger } from '@nestjs/common';
import { LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { hasEnoughInfoToScore } from '../discovery/ingest.service';
import { ClassifierLlm, LeadForScoring } from './llm';
import { computeScore } from './scoring';
import { config } from '../common/config';

export const CLASSIFIER_LLM = Symbol('CLASSIFIER_LLM');

const isCountryCode = (s: string | null | undefined): s is string => !!s && /^[A-Za-z]{2}$/.test(s);

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    @Inject(CLASSIFIER_LLM) private llm: ClassifierLlm,
  ) {}

  /** Scores one lead. Status only moves NEW -> SCORED; a manager's decision is never undone by re-scoring. */
  async scoreLead(id: string) {
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id } });

    if (!hasEnoughInfoToScore(lead)) {
      return this.prisma.lead.update({
        where: { id },
        data: { scoreError: 'Not enough public information to score — add a bio, or import details for this lead.' },
      });
    }

    const input: LeadForScoring = {
      platform: lead.platform,
      handle: lead.handle,
      url: lead.url,
      displayName: lead.displayName,
      bio: lead.bio,
      followers: lead.followers,
      country: lead.country,
      language: lead.language,
      recentContent: Array.isArray(lead.recentContent) ? (lead.recentContent as LeadForScoring['recentContent']) : [],
    };

    try {
      const a = await this.llm.assess(input);
      const country = lead.country ?? (isCountryCode(a.country_guess) ? a.country_guess.toUpperCase() : null);
      const result = computeScore({
        sub: {
          audienceRelevance: a.audience_relevance,
          contentFit: a.content_fit,
          credibility: a.credibility,
          promoExperience: a.promo_experience,
        },
        followers: lead.followers,
        country,
        modelFlags: a.red_flags,
      });

      return await this.prisma.lead.update({
        where: { id },
        data: {
          status: lead.status === LeadStatus.NEW ? LeadStatus.SCORED : undefined,
          score: result.score,
          isPriority: result.isPriority,
          category: a.category,
          summary: a.summary,
          strengths: a.strengths.slice(0, 4),
          concerns: a.concerns.slice(0, 4),
          redFlags: result.redFlags,
          breakdown: result.breakdown as unknown as Prisma.InputJsonValue,
          country: lead.country ?? country ?? undefined,
          language: lead.language ?? a.language ?? undefined,
          scoredAt: new Date(),
          scoreModel: this.llm.modelName,
          scoreError: null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scoring failed';
      this.logger.warn(`Scoring ${lead.platform}/${lead.handle} failed: ${message}`);
      return this.prisma.lead.update({ where: { id }, data: { scoreError: message.slice(0, 300) } });
    }
  }

  /** Scores leads that are still NEW, a few at a time. Only one run at once, so a double-click can't double the bill. */
  async scorePending(limit = 25): Promise<{ attempted: number; scored: number; failed: number; alreadyRunning?: boolean }> {
    if (this.running) return { attempted: 0, scored: 0, failed: 0, alreadyRunning: true };
    this.running = true;
    try {
      const pending = await this.prisma.lead.findMany({
        where: { status: LeadStatus.NEW, scoreError: null },
        orderBy: { discoveredAt: 'asc' },
        take: Math.min(Math.max(limit, 1), 100),
        select: { id: true },
      });
      let scored = 0;
      let failed = 0;
      const queue = [...pending];
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const lead = await this.scoreLead(next.id);
          lead.scoreError ? failed++ : scored++;
        }
      };
      await Promise.all(Array.from({ length: Math.min(config.classifierConcurrency, pending.length || 1) }, worker));
      return { attempted: pending.length, scored, failed };
    } finally {
      this.running = false;
    }
  }
}
