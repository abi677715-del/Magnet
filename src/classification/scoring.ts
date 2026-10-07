import { config } from '../common/config';

/** Flags the model can raise. HARD ones mean "never recruit", whatever else is good about the lead. */
export const HARD_FLAGS = [
  'AUDIENCE_INCLUDES_MINORS', // kids' content, school-age audience, youth-targeted
  'FIXED_MATCH_SCAM', // sells "fixed matches" / "sure wins"
  'ILLEGAL_OR_HATEFUL', // illegal activity, hate, harassment
] as const;

/** SOFT flags cap the score low but a manager may still look. */
export const SOFT_FLAGS = [
  'GUARANTEED_WINS_CLAIMS', // promises profit / "can't lose"
  'FAKE_ENGAGEMENT', // bought followers, bot comments
  'SPAM_OR_LOW_QUALITY',
  'ADULT_CONTENT',
] as const;

export const ALL_FLAGS = [...HARD_FLAGS, ...SOFT_FLAGS] as const;
export type RedFlag = (typeof ALL_FLAGS)[number];

/** Added by code, never by the model. */
export const OUTSIDE_TARGET_MARKETS = 'OUTSIDE_TARGET_MARKETS';

export interface SubScores {
  audienceRelevance: number;
  contentFit: number;
  credibility: number;
  promoExperience: number;
}

export const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));

/**
 * Reach is worked out from the real follower count, not guessed by the model.
 * Log scale: ~300 followers = 0, 1M+ = 100. Unknown follower count scores low
 * but not zero, so a lead isn't buried just because a field was missing.
 */
export function reachScore(followers: number | null | undefined): number {
  if (followers == null || followers <= 0) return 25;
  const score = ((Math.log10(followers) - 2.5) / (6 - 2.5)) * 100;
  return clamp100(score);
}

export interface ScoreInput {
  sub: SubScores;
  followers: number | null | undefined;
  country: string | null | undefined;
  modelFlags: string[];
}

export interface ScoreResult {
  score: number;
  isPriority: boolean;
  blocked: boolean;
  redFlags: string[];
  breakdown: {
    weighted: number;
    cap: number | null;
    capReason: string | null;
    sub: SubScores & { reach: number };
    weights: typeof config.weights;
  };
}

export function computeScore(input: ScoreInput, weights = config.weights, threshold = config.priorityThreshold): ScoreResult {
  const sub = {
    audienceRelevance: clamp100(input.sub.audienceRelevance),
    contentFit: clamp100(input.sub.contentFit),
    credibility: clamp100(input.sub.credibility),
    promoExperience: clamp100(input.sub.promoExperience),
  };
  const reach = reachScore(input.followers);

  const parts: [number, number][] = [
    [sub.audienceRelevance, weights.audienceRelevance],
    [sub.contentFit, weights.contentFit],
    [sub.credibility, weights.credibility],
    [sub.promoExperience, weights.promoExperience],
    [reach, weights.reach],
  ];
  const totalWeight = parts.reduce((s, [, w]) => s + Math.max(0, w), 0) || 1;
  const weighted = clamp100(parts.reduce((s, [v, w]) => s + v * Math.max(0, w), 0) / totalWeight);

  // Unknown flags from the model are ignored — only the ones we defined can affect a score.
  const flags = [...new Set(input.modelFlags.filter((f): f is RedFlag => (ALL_FLAGS as readonly string[]).includes(f)))];

  let cap: number | null = null;
  let capReason: string | null = null;
  const applyCap = (value: number, reason: string) => {
    if (cap === null || value < cap) {
      cap = value;
      capReason = reason;
    }
  };

  const hard = flags.filter((f) => (HARD_FLAGS as readonly string[]).includes(f));
  const soft = flags.filter((f) => (SOFT_FLAGS as readonly string[]).includes(f));
  if (hard.length) applyCap(15, `Disqualifying: ${hard.join(', ')}`);
  if (soft.length) applyCap(45, `Compliance/quality concern: ${soft.join(', ')}`);

  const redFlags: string[] = [...flags];
  const country = input.country?.toUpperCase();
  if (config.allowedCountries.length && country && !config.allowedCountries.includes(country)) {
    applyCap(25, `Based in ${country}, outside the programme's target markets`);
    redFlags.push(OUTSIDE_TARGET_MARKETS);
  }

  const score = cap === null ? weighted : Math.min(weighted, cap);
  const blocked = hard.length > 0 || redFlags.includes(OUTSIDE_TARGET_MARKETS);
  return {
    score,
    blocked,
    isPriority: !blocked && soft.length === 0 && score >= threshold,
    redFlags,
    breakdown: { weighted, cap, capReason, sub: { ...sub, reach }, weights },
  };
}
