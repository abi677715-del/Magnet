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

it('needs the key and valid input', async () => {
  expect((await c.api('/discovery/ai', { method: 'POST', body: { segments: ['X_ACCOUNTS'] }, key: null })).status).toBe(401);
  expect((await start({ segments: [] })).status).toBe(400);
  expect((await start({ segments: ['PRIVATE_GROUPS'] })).status).toBe(400);
  expect((await start({ segments: ['X_ACCOUNTS'], limit: 500 })).status).toBe(400);
  expect((await start({ segments: ['X_ACCOUNTS'], country: 'KENYA' })).status).toBe(400);
  expect((await c.api('/discovery/ai/not-a-job')).status).toBe(404);
  expect(Object.keys((await c.api('/discovery/ai/segments')).json)).toHaveLength(11);
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
  expect(tip).toMatchObject({ platform: 'X', source: 'ai-search', displayName: 'Real Tipster', followers: null, contactEmail: null, status: 'NEW' });
  expect(tip.bio).toMatch(/^\[Unverified AI web-search note\] Daily picks/); // second-hand, and labelled so
  expect(c.discoverer.requests[0]).toMatchObject({ country: 'KE', focus: 'Swahili speakers', limit: 15 });
});

it('the scorer gets the unverified label, and the model cannot inject followers or emails', async () => {
  c.discoverer.result = {
    searches: 1, seenUrls: ['https://x.com/sneaky'],
    candidates: [{ url: 'https://x.com/sneaky', name: 'Sneaky', note: 'Has 9,000,000 followers, email boss@sneaky.com', followers: 9000000, email: 'boss@sneaky.com' } as any],
  };
  const job = await finish((await start()).json.jobId);
  expect(job.status).toBe('done');
  const l = await c.db.lead.findFirstOrThrow({ where: { handle: 'sneaky' } });
  expect(l.followers).toBeNull();
  expect(l.contactEmail).toBeNull();
  await c.api('/classification/run', { method: 'POST', body: {} });
  expect(c.llm.calls).toContain('sneaky'); // it has a note, so it is scored — but the prompt marks the note as unverified (unit-tested)
});

it('re-finding a lead updates it without touching a manager decision', async () => {
  c.discoverer.result = { searches: 1, seenUrls: ['https://x.com/again'], candidates: [cand('https://x.com/again')] };
  await finish((await start()).json.jobId);
  const l = await c.db.lead.findFirstOrThrow({ where: { handle: 'again' } });
  await c.db.lead.update({ where: { id: l.id }, data: { status: 'REJECTED', reviewNote: 'no thanks' } });
  const job = await finish((await start()).json.jobId);
  expect(job.result).toMatchObject({ created: 0, updated: 1 });
  expect(await c.db.lead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ status: 'REJECTED', reviewNote: 'no thanks' });
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
