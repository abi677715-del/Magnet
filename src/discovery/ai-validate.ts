import { Platform } from '@prisma/client';
import { z } from 'zod';
import { ParsedUrl, parseLeadUrl } from './url-parser';

export const CandidatesSchema = z.object({
  candidates: z.array(z.object({ url: z.string(), name: z.string().default(''), note: z.string().default('') })),
});
export type AiCandidate = z.infer<typeof CandidatesSchema>['candidates'][number];

/** Pulls the JSON answer out of the model's text (a ```json block, or the outermost braces). */
export function extractCandidates(text: string): AiCandidate[] {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const braces = text.indexOf('{') >= 0 && text.lastIndexOf('}') > text.indexOf('{') ? [text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)] : [];
  for (const raw of [...fenced.reverse(), ...braces]) {
    try {
      const parsed = CandidatesSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data.candidates;
    } catch {
      // try the next form
    }
  }
  throw new Error('The AI search did not return a readable list — try again.');
}

/** Generic sites that are never a partner. */
const NOT_A_PROSPECT = new Set([
  'google.com', 'facebook.com', 'wikipedia.org', 'amazon.com', 'linkedin.com', 'pinterest.com', 'bing.com', 'duckduckgo.com',
  'apple.com', 'microsoft.com', 'play.google.com', 'apps.apple.com', 'github.com', 'archive.org', 'whatsapp.com', 'discord.com',
]);

const keyOf = (p: ParsedUrl) => `${p.platform}|${p.handle}`;

export interface Accepted {
  parsed: ParsedUrl;
  name: string;
  note: string;
}
export interface Rejected {
  url: string;
  reason: string;
}

/**
 * The model can invent plausible-looking accounts. A candidate is accepted only
 * if its address really appeared in the search results Claude was given, is a
 * real profile/site link we understand, and isn't a duplicate.
 */
export function validateCandidates(candidates: AiCandidate[], seenUrls: string[], limit: number): { accepted: Accepted[]; rejected: Rejected[] } {
  const seen = new Set<string>();
  const seenHosts = new Set<string>();
  for (const u of seenUrls) {
    const p = parseLeadUrl(u);
    if (!p) continue;
    seen.add(keyOf(p));
    if (p.platform === Platform.WEBSITE) seenHosts.add(p.handle);
  }

  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  const done = new Set<string>();
  for (const c of candidates) {
    const parsed = parseLeadUrl(c.url);
    if (!parsed) { rejected.push({ url: c.url, reason: 'Not a profile, channel or site link' }); continue; }
    if (parsed.platform === Platform.WEBSITE && [...NOT_A_PROSPECT].some((d) => parsed.handle === d || parsed.handle.endsWith('.' + d))) {
      rejected.push({ url: c.url, reason: 'Generic site, not a partner' }); continue;
    }
    const k = keyOf(parsed);
    if (!(parsed.platform === Platform.WEBSITE ? seenHosts.has(parsed.handle) : seen.has(k))) {
      rejected.push({ url: c.url, reason: 'Not found in the actual search results (possibly invented)' }); continue;
    }
    if (done.has(k)) { rejected.push({ url: c.url, reason: 'Duplicate' }); continue; }
    if (accepted.length >= limit) { rejected.push({ url: c.url, reason: 'Over the limit for this run' }); continue; }
    done.add(k);
    accepted.push({ parsed, name: c.name.trim().slice(0, 120), note: c.note.trim().slice(0, 400) });
  }
  return { accepted, rejected };
}
