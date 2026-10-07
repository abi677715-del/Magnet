process.env.ADMIN_API_KEY = 'e2e-admin-key-0123456789abcdef';
process.env.AI_DISCOVERY_DAILY_LIMIT = '4';
import { boot } from './helpers';

let c: Awaited<ReturnType<typeof boot>>;
beforeAll(async () => { c = await boot(); });
afterAll(async () => { await c.close(); });
beforeEach(async () => { await c.reset(); });

const start = (body: Record<string, unknown> = { segments: ['TELEGRAM_CHANNELS', 'X_ACCOUNTS'] }) => c.api('/discovery/ai', { method: 'POST', body });
async function finish(jobId: string) {
  for (let i = 0; i < 100; i++) {
    const r = await c.api(`/discovery/ai/${jobId}`);
    if (r.json.status !== 'running') return r.json;
    await new Promise((r2) => setTimeout(r2, 50));
  }
  throw new Error('job did not finish');
}
const cand = (url: string, name = 'Name', note = 'Posts daily football tips') => ({ url, name, note });

it('searches every category when none are given, and rejects bad input', async () => {
  const all = await start({});
  expect(all.status).toBe(201);
  await finish(all.json.jobId);
  expect(c.discoverer.requests[0].segments).toHaveLength(13); // nothing picked = every category
  expect((await c.api('/discovery/ai', { method: 'POST', body: { segments: ['X_ACCOUNTS'] }, key: null })).status).toBe(401);
  expect((await start({ segments: ['PRIVATE_GROUPS'] })).status).toBe(400);
  expect((await start({ segments: ['X_ACCOUNTS'], limit: 500 })).status).toBe(400);
  expect((await start({ segments: ['X_ACCOUNTS'], country: 'KENYA' })).status).toBe(400);
  expect((await c.api('/discovery/ai/not-a-job')).status).toBe(404);
  expect(Object.keys((await c.api('/discovery/ai/segments')).json)).toHaveLength(13);
});

it('saves verified suggestions as leads and rejects invented ones', async () => {
  c.discoverer.result = {
    searches: 7,
    seenUrls: ['https://x.com/realtipster/status/1', 'https://www.tiktok.com/@realtok', 'https://www.reddit.com/r/SoccerBetting/', 'https://t.me/s/realchan'],
    candidates: [
      cand('https://x.com/RealTipster', 'Real Tipster', 'Daily picks'),
      cand('https://x.com/invented_account', 'Invented', 'Totally real, trust me'),
      cand('https://www.tiktok.com/@realtok', 'Real Tok'),
      cand('https://www.reddit.com/r/soccerbetting', 'SoccerBetting'),
      cand('https://x.com/RealTipster', 'Dup'),
    ],
  };
  const { json } = await start({ segments: ['X_ACCOUNTS', 'TIKTOK_CREATORS', 'REDDIT_COMMUNITIES'], country: 'ke', focus: 'Swahili speakers' });
  const job = await finish(json.jobId);
  expect(job.status).toBe('done');
  expect(job.result).toMatchObject({ searches: 7, suggested: 5, created: 3, updated: 0 });
  expect(job.result.rejected.map((r: any) => r.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/search results/), 'Duplicate']));
  expect(await c.db.lead.count()).toBe(3);
  expect(await c.db.lead.count({ where: { handle: 'invented_account' } })).toBe(0);

  const tip = await c.db.lead.findFirstOrThrow({ where: { handle: 'realtipster' } });
  expect(tip).toMatchObject({ platform: 'X', source: 'ai-search', displayName: 'Real Tipster', followers: null, contactEmail: null, stage: 'FOUND' });
  expect(tip.bio).toMatch(/^\[Unverified AI web-search note\] Daily picks/); // second-hand, and labelled so
  expect(c.discoverer.requests[0]).toMatchObject({ country: 'KE', focus: 'Swahili speakers', limit: 15 });
});

it('the note is labelled unverified, and the model cannot inject followers or emails', async () => {
  c.discoverer.result = {
    searches: 1, seenUrls: ['https://x.com/sneaky'],
    candidates: [{ url: 'https://x.com/sneaky', name: 'Sneaky', note: 'Has 9,000,000 followers, email boss@sneaky.com', followers: 9000000, email: 'boss@sneaky.com' } as any],
  };
  const job = await finish((await start()).json.jobId);
  expect(job.status).toBe('done');
  const l = await c.db.lead.findFirstOrThrow({ where: { handle: 'sneaky' } });
  expect(l.followers).toBeNull();
  expect(l.contactEmail).toBeNull();
  expect(l.bio).toMatch(/^\[Unverified AI web-search note\]/); // the note is kept, but labelled as second-hand
});

it('re-finding a lead updates it without touching the team stage', async () => {
  c.discoverer.result = { searches: 1, seenUrls: ['https://x.com/again'], candidates: [cand('https://x.com/again')] };
  await finish((await start()).json.jobId);
  const l = await c.db.lead.findFirstOrThrow({ where: { handle: 'again' } });
  await c.db.lead.update({ where: { id: l.id }, data: { stage: 'DECLINED', stageNote: 'no thanks' } });
  const job = await finish((await start()).json.jobId);
  expect(job.result).toMatchObject({ created: 0, updated: 1 });
  expect(await c.db.lead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ stage: 'DECLINED', stageNote: 'no thanks' });
});

it('only one search runs at a time', async () => {
  c.discoverer.delayMs = 400;
  const first = await start();
  expect(first.status).toBe(201);
  const second = await start();
  expect(second.status).toBe(400);
  expect(second.json.message).toMatch(/already running/);
  await finish(first.json.jobId);
  const again = await start();
  expect(again.status).toBe(201); // free again
  await finish(again.json.jobId);
});

it('reports a failed search clearly instead of crashing', async () => {
  c.discoverer.fail = 'The AI search did not return a readable list — try again.';
  const job = await finish((await start()).json.jobId);
  expect(job).toMatchObject({ status: 'failed', error: expect.stringMatching(/readable list/) });
  expect(await c.db.lead.count()).toBe(0);
});

it('enforces a daily limit on AI searches', async () => {
  for (let i = 0; i < 4; i++) await finish((await start()).json.jobId);
  const over = await start();
  expect(over.status).toBe(400);
  expect(over.json.message).toMatch(/Daily AI search limit/);
  expect(c.discoverer.requests).toHaveLength(4);
});

it('Telegram + France + French: searches only Telegram, drops other platforms, and records the country and language', async () => {
  c.discoverer.result = {
    searches: 2,
    seenUrls: ['https://t.me/s/footfr', 'https://x.com/footfrx'],
    candidates: [cand('https://t.me/footfr', 'Foot FR'), cand('https://x.com/footfrx', 'Foot FR X')],
  };
  const r = await start({ platform: 'TELEGRAM', country: 'FR', language: 'French' });
  expect(r.status).toBe(201);
  const job = await finish(r.json.jobId);
  expect(c.discoverer.requests[0]).toMatchObject({ platform: 'TELEGRAM', segments: ['TELEGRAM_CHANNELS'], country: 'FR', language: 'French' });
  expect(job.result).toMatchObject({ created: 1 });
  expect(job.result.rejected).toEqual([{ url: 'https://x.com/footfrx', reason: 'Not on TELEGRAM' }]);
  expect(await c.db.lead.findFirstOrThrow({ where: { handle: 'footfr' } })).toMatchObject({ platform: 'TELEGRAM', country: 'FR', language: 'French' });
  const found = await c.api('/leads?platform=TELEGRAM&country=fr&language=fr');
  expect(found.json.items.map((l: any) => l.handle)).toEqual(['footfr']);
});

it('rejects an unknown platform', async () => {
  expect((await start({ platform: 'MYSPACE' })).status).toBe(400);
});
