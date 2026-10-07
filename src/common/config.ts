/**
 * Everything the manager might want to tune lives here, read from the
 * environment, so changing the program's focus never means changing code.
 */
function list(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  productName: process.env.PRODUCT_NAME ?? 'Melbet',
  productDescription:
    process.env.PRODUCT_DESCRIPTION ??
    'Melbet is an online sports betting and casino brand. We run an affiliate (partner) programme that pays partners for the players they refer.',
  idealAffiliateProfile:
    process.env.IDEAL_AFFILIATE_PROFILE ??
    'Sports, football and betting content creators, tipster channels (honest, with a visible track record), streamers, comparison and review websites, and sports communities whose audience is adult and already interested in betting.',

  // Markets the programme can actively recruit in. Empty = no country filter.
  allowedCountries: list('ALLOWED_COUNTRIES', '').map((c) => c.toUpperCase()),

  priorityThreshold: num('PRIORITY_THRESHOLD', 70),

  // How much each part of the score counts. Normalised in code, so they don't have to add to 100.
  weights: {
    audienceRelevance: num('WEIGHT_AUDIENCE', 30),
    contentFit: num('WEIGHT_CONTENT', 20),
    credibility: num('WEIGHT_CREDIBILITY', 20),
    promoExperience: num('WEIGHT_PROMO', 10),
    reach: num('WEIGHT_REACH', 20),
  },

  // Models. Both default to the most capable Claude model; set cheaper ones here if volume grows.
  classifierModel: process.env.CLASSIFIER_MODEL ?? 'claude-opus-5-5',
  discoveryModel: process.env.DISCOVERY_MODEL ?? 'claude-opus-5-5',
  aiDiscoveryDailyLimit: num('AI_DISCOVERY_DAILY_LIMIT', 20),
  aiDiscoveryMaxSearches: num('AI_DISCOVERY_MAX_SEARCHES', 10),
  classifierConcurrency: num('CLASSIFIER_CONCURRENCY', 3),
};
