/**
 * Minimal robots.txt check for our crawler: honours "User-agent: *" and our
 * own name. If we can't read the file we assume allowed (the standard rule),
 * but if it clearly disallows the path we don't fetch.
 */
export function isAllowedByRobots(robotsTxt: string, path: string, agentName = 'affiliatemagnetbot'): boolean {
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'disallow' && value) current.disallow.push(value);
    if (key === 'allow' && value) current.allow.push(value);
  }
  const specific = groups.filter((g) => g.agents.includes(agentName));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  let verdict = true;
  let bestLen = -1;
  for (const g of applicable) {
    for (const rule of g.disallow) if (path.startsWith(rule) && rule.length > bestLen) { bestLen = rule.length; verdict = false; }
    for (const rule of g.allow) if (path.startsWith(rule) && rule.length >= bestLen) { bestLen = rule.length; verdict = true; }
  }
  return verdict;
}
