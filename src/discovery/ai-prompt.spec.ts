import { countryName, PLATFORM_SEGMENTS, SEGMENTS } from './ai-discovery';

describe('search request helpers', () => {
  it('names countries for the prompt', () => expect(countryName('fr')).toBe('France'));
  it('maps every platform to real categories', () => {
    for (const segs of Object.values(PLATFORM_SEGMENTS)) for (const s of segs) expect(SEGMENTS).toHaveProperty(s);
  });
});
