describe('target-market filter', () => {
  const load = (countries: string) => {
    process.env.ALLOWED_COUNTRIES = countries;
    let mod!: typeof import('./scoring');
    jest.isolateModules(() => { mod = require('./scoring'); });
    return mod;
  };
  const strong = { audienceRelevance: 90, contentFit: 90, credibility: 90, promoExperience: 80 };
  afterAll(() => { delete process.env.ALLOWED_COUNTRIES; });

  it('blocks leads based outside the allowed countries', () => {
    const { computeScore } = load('KE,NG');
    const r = computeScore({ sub: strong, followers: 500_000, country: 'gb', modelFlags: [] });
    expect(r.blocked).toBe(true);
    expect(r.score).toBeLessThanOrEqual(25);
    expect(r.redFlags).toContain('OUTSIDE_TARGET_MARKETS');
  });
  it('allows leads inside, and leads with an unknown country', () => {
    const { computeScore } = load('KE,NG');
    expect(computeScore({ sub: strong, followers: 500_000, country: 'ng', modelFlags: [] }).blocked).toBe(false);
    expect(computeScore({ sub: strong, followers: 500_000, country: null, modelFlags: [] }).blocked).toBe(false);
  });
  it('does no country filtering when no list is configured', () => {
    const { computeScore } = load('');
    expect(computeScore({ sub: strong, followers: 500_000, country: 'gb', modelFlags: [] }).blocked).toBe(false);
  });
});
