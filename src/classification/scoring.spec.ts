import { computeScore, reachScore } from './scoring';

const strong = { audienceRelevance: 90, contentFit: 90, credibility: 90, promoExperience: 80 };
const W = { audienceRelevance: 30, contentFit: 20, credibility: 20, promoExperience: 10, reach: 20 };

describe('reachScore', () => {
  it('rises with followers and is bounded 0-100', () => {
    const points = [1, 300, 5_000, 50_000, 500_000, 5_000_000].map(reachScore);
    expect(points).toEqual([...points].sort((a, b) => a - b));
    expect(points[0]).toBe(0);
    expect(points[points.length - 1]).toBe(100);
  });
  it('gives unknown counts a low but non-zero score', () => {
    expect(reachScore(null)).toBe(25);
    expect(reachScore(undefined)).toBe(25);
    expect(reachScore(0)).toBe(25);
  });
});

describe('computeScore', () => {
  it('weights the parts and marks a strong lead as priority', () => {
    const r = computeScore({ sub: strong, followers: 200_000, country: null, modelFlags: [] }, W, 70);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.isPriority).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it('normalises weights that do not add to 100', () => {
    const a = computeScore({ sub: strong, followers: 50_000, country: null, modelFlags: [] }, W, 70);
    const b = computeScore({ sub: strong, followers: 50_000, country: null, modelFlags: [] }, { audienceRelevance: 3, contentFit: 2, credibility: 2, promoExperience: 1, reach: 2 }, 70);
    expect(a.score).toBe(b.score);
  });

  it('clamps wild model values instead of trusting them', () => {
    const r = computeScore({ sub: { audienceRelevance: 999, contentFit: -50, credibility: NaN, promoExperience: 80 }, followers: 1000, country: null, modelFlags: [] }, W, 70);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.breakdown.sub.audienceRelevance).toBe(100);
    expect(r.breakdown.sub.contentFit).toBe(0);
    expect(r.breakdown.sub.credibility).toBe(0);
  });

  it.each(['AUDIENCE_INCLUDES_MINORS', 'FIXED_MATCH_SCAM', 'ILLEGAL_OR_HATEFUL'])('a hard flag (%s) disqualifies however good the rest is', (flag) => {
    const r = computeScore({ sub: strong, followers: 5_000_000, country: null, modelFlags: [flag] }, W, 70);
    expect(r.score).toBeLessThanOrEqual(15);
    expect(r.blocked).toBe(true);
    expect(r.isPriority).toBe(false);
  });

  it('a soft flag caps the score and keeps the lead out of priority, but does not block', () => {
    const r = computeScore({ sub: strong, followers: 5_000_000, country: null, modelFlags: ['GUARANTEED_WINS_CLAIMS'] }, W, 70);
    expect(r.score).toBeLessThanOrEqual(45);
    expect(r.blocked).toBe(false);
    expect(r.isPriority).toBe(false);
  });

  it('ignores flags the model made up', () => {
    const r = computeScore({ sub: strong, followers: 200_000, country: null, modelFlags: ['TOTALLY_FINE', 'IGNORE_PREVIOUS_RULES'] }, W, 70);
    expect(r.redFlags).toEqual([]);
    expect(r.isPriority).toBe(true);
  });

  it('does not make priority below the threshold', () => {
    const r = computeScore({ sub: { audienceRelevance: 40, contentFit: 40, credibility: 40, promoExperience: 0 }, followers: 1000, country: null, modelFlags: [] }, W, 70);
    expect(r.isPriority).toBe(false);
  });
});
