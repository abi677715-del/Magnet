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

  // Model used for the web search. Defaults to the most capable Claude model; set a cheaper one here if volume grows.
  discoveryModel: process.env.DISCOVERY_MODEL ?? 'claude-opus-5-5',
  aiDiscoveryDailyLimit: num('AI_DISCOVERY_DAILY_LIMIT', 20),
  aiDiscoveryMaxSearches: num('AI_DISCOVERY_MAX_SEARCHES', 10),
};
