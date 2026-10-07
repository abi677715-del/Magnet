import { extractCandidates, validateCandidates } from './ai-validate';

const c = (url: string, name = 'N', note = 'n') => ({ url, name, note });

describe('extractCandidates', () => {
  it('reads a fenced json block, ignoring chatter around it', () => {
    const text = 'I searched.\n```json\n{"candidates":[{"url":"https://t.me/foo","name":"Foo","note":"tips"}]}\n```\nDone.';
    expect(extractCandidates(text)).toEqual([{ url: 'https://t.me/foo', name: 'Foo', note: 'tips' }]);
  });
  it('reads bare JSON, and fills missing name/note', () => {
    expect(extractCandidates('{"candidates":[{"url":"https://t.me/foo"}]}')).toEqual([{ url: 'https://t.me/foo', name: '', note: '' }]);
  });
  it('prefers the last fenced block (the final answer)', () => {
    const text = '```json\n{"candidates":[{"url":"https://t.me/draft"}]}\n```\nfinal:\n```json\n{"candidates":[{"url":"https://t.me/final"}]}\n```';
    expect(extractCandidates(text)[0].url).toBe('https://t.me/final');
  });
  it('throws a readable error on garbage', () => {
    expect(() => extractCandidates('sorry, no list')).toThrow(/readable list/);
    expect(() => extractCandidates('```json\n{"nope":1}\n```')).toThrow(/readable list/);
  });
});

describe('validateCandidates', () => {
  const seen = ['https://t.me/s/realchannel', 'https://www.tiktok.com/@realtok/video/1', 'https://www.footballblog.com/best-tips', 'https://www.reddit.com/r/SoccerBetting/top'];

  it('accepts only what appeared in the real search results', () => {
    const { accepted, rejected } = validateCandidates(
      [c('https://t.me/realchannel'), c('https://t.me/inventedchannel'), c('https://www.tiktok.com/@realtok'), c('https://x.com/madeup'), c('https://footballblog.com/'), c('https://r.com'), c('https://www.reddit.com/r/soccerbetting')],
      seen, 10,
    );
    expect(accepted.map((a) => `${a.parsed.platform}:${a.parsed.handle}`)).toEqual(['TELEGRAM:realchannel', 'TIKTOK:realtok', 'WEBSITE:footballblog.com', 'REDDIT:r/soccerbetting']);
    expect(rejected.map((r) => r.url)).toEqual(['https://t.me/inventedchannel', 'https://x.com/madeup', 'https://r.com']);
    expect(rejected.every((r) => /search results/.test(r.reason))).toBe(true);
  });

  it('matches handles case-insensitively and across link styles (t.me/s/x vs t.me/x)', () => {
    expect(validateCandidates([c('https://t.me/RealChannel')], seen, 5).accepted).toHaveLength(1);
  });

  it('rejects links that are not profiles, generic big sites, and duplicates', () => {
    const s = ['https://www.facebook.com/page', 'https://t.me/dup', 'https://www.youtube.com/watch?v=abc'];
    const { accepted, rejected } = validateCandidates([c('https://www.facebook.com/page'), c('https://www.youtube.com/watch?v=abc'), c('https://t.me/dup'), c('https://t.me/dup'), c('javascript:alert(1)')], s, 5);
    expect(accepted).toHaveLength(1);
    expect(rejected.map((r) => r.reason)).toEqual(['Generic site, not a partner', 'Not a profile, channel or site link', 'Duplicate', 'Not a profile, channel or site link']);
  });

  it('respects the limit and trims overlong text', () => {
    const urls = Array.from({ length: 8 }, (_, i) => `https://t.me/chan${i}`);
    const { accepted, rejected } = validateCandidates(urls.map((u) => c(u, 'x'.repeat(500), 'y'.repeat(900))), urls, 3);
    expect(accepted).toHaveLength(3);
    expect(accepted[0].name).toHaveLength(120);
    expect(accepted[0].note).toHaveLength(400);
    expect(rejected).toHaveLength(5);
  });

  it('does not accept a lookalike host for a seen website', () => {
    const { accepted } = validateCandidates([c('https://footballblog.com.evil.io/')], ['https://footballblog.com/x'], 5);
    expect(accepted).toHaveLength(0);
  });
});
