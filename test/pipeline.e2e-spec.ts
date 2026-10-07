process.env.ADMIN_API_KEY = 'e2e-admin-key-0123456789abcdef';
process.env.ALLOWED_COUNTRIES = 'KE,NG,ET';
process.env.PRIORITY_THRESHOLD = '70';
import { boot, importLeads } from './helpers';

type Ctx = Awaited<ReturnType<typeof boot>>;
let c: Ctx;
beforeAll(async () => { c = await boot(); });
afterAll(async () => { await c.close(); });
beforeEach(async () => { await c.reset(); });

const bio = 'Weekly football betting previews and match analysis for East African fans.';
const row = (handle: string, extra: Record<string, unknown> = {}) => ({ platform: 'youtube', handle, name: handle, followers: 150000, country: 'KE', bio, email: `${handle}@example.com`, ...extra });

async function scoreAll() {
  const r = await c.api('/classification/run', { method: 'POST', body: {} });
  expect(r.status).toBe(201);
  return r.json;
}
const lead = async (handle: string) => (await c.db.lead.findFirstOrThrow({ where: { handle } }));

describe('auth', () => {
  it('refuses missing and wrong keys on every protected route', async () => {
    for (const [method, path] of [['GET', '/leads'], ['GET', '/leads/stats'], ['POST', '/discovery/import'], ['POST', '/classification/run'], ['GET', '/leads/export'], ['POST', '/discovery/ai']]) {
      expect((await c.api(path, { method, key: null })).status).toBe(401);
      expect((await c.api(path, { method, key: 'wrong-key-wrong-key-wrong' })).status).toBe(401);
    }
  });
  it('keeps only the health check public, and has no email-sending endpoints at all', async () => {
    expect((await c.api('/health', { key: null })).status).toBe(200);
    for (const path of ['/unsubscribe/x', '/outreach/x', '/leads/00000000-0000-4000-8000-000000000000/outreach/draft']) {
      expect([404, 401]).toContain((await c.api(path, { key: null })).status);
      expect((await c.api(path, { method: 'POST' })).status).toBe(404);
    }
  });
  it('fails closed when the server key is too short', async () => {
    const saved = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'short';
    try { expect((await c.api('/leads', { key: 'short' })).status).toBe(401); } finally { process.env.ADMIN_API_KEY = saved; }
  });
});

describe('rate limits', () => {
  it('cap the expensive endpoints (checked with limits switched back on)', async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) codes.push((await c.api('/classification/run', { method: 'POST', body: {} })).status);
      expect(codes.slice(0, 5).every((s) => s === 201)).toBe(true);
      expect(codes.slice(5)).toEqual([429, 429]);
    } finally { process.env.NODE_ENV = saved; }
  });
});

describe('import & dedupe', () => {
  it('creates leads, then updates (never duplicates) on re-import, and keeps a manager decision', async () => {
    expect((await importLeads(c.api, [row('alpha'), row('beta')])).json).toMatchObject({ created: 2, updated: 0, errors: [] });
    await scoreAll();
    const a = await lead('alpha');
    await c.api(`/leads/${a.id}/approve`, { method: 'POST', body: { note: 'good' }, actor: 'dana' });
    const again = await importLeads(c.api, [row('alpha', { followers: 999999 }), row('beta')]);
    expect(again.json).toMatchObject({ created: 0, updated: 2 });
    expect(await c.db.lead.count()).toBe(2);
    const after = await lead('alpha');
    expect(after.status).toBe('APPROVED');
    expect(after.followers).toBe(999999);
    expect(after.reviewedBy).toBe('dana');
  });
  it('treats handles case-insensitively', async () => {
    await importLeads(c.api, [row('MixedCase')]); await importLeads(c.api, [row('mixedcase')]);
    expect(await c.db.lead.count()).toBe(1);
  });
  it('reports bad rows and rejects a malformed request', async () => {
    const r = await c.api('/discovery/import', { method: 'POST', body: { format: 'csv', data: 'platform,handle,followers\nyoutube,ok,10\nyoutube,bad,abc\n' } });
    expect(r.json.created).toBe(1);
    expect(r.json.errors[0].row).toBe(3);
    expect((await c.api('/discovery/import', { method: 'POST', body: { format: 'json', data: 'nope' } })).status).toBe(400);
    expect((await c.api('/discovery/import', { method: 'POST', body: { format: 'xml', data: 'x' } })).status).toBe(400);
  });
  it('refuses private and non-http URLs instead of fetching them', async () => {
    const r = await c.api('/discovery/urls', { method: 'POST', body: { urls: ['http://169.254.169.254/latest/meta-data/', 'http://localhost:4100/', 'http://10.0.0.5/', 'file:///etc/passwd'] } });
    expect(r.status).toBe(201);
    expect(r.json.results.every((x: any) => x.status === 'skipped')).toBe(true);
    expect(await c.db.lead.count()).toBe(0);
  });
  it('saves links for platforms that cannot be read, without scoring them blind', async () => {
    const r = await c.api('/discovery/urls', { method: 'POST', body: { urls: ['https://www.tiktok.com/@tipsfc'] } });
    expect(r.json.results[0]).toMatchObject({ status: 'saved' });
    await scoreAll();
    expect(c.llm.calls).toEqual([]); // no information -> no LLM call, no invented score
    const l = await lead('tipsfc');
    expect(l.status).toBe('NEW');
    expect(l.scoreError).toMatch(/Not enough public information/);
  });
});

describe('scoring', () => {
  it('scores leads, ranks them, and marks only strong, clean ones as priority', async () => {
    await importLeads(c.api, [row('great'), row('weak', { followers: 300 }), row('kidstips'), row('liar'), row('uk', { country: 'GB' })]);
    c.llm.byHandle = {
      weak: { audience_relevance: 20, content_fit: 20, credibility: 30, promo_experience: 0 },
      kidstips: { red_flags: ['AUDIENCE_INCLUDES_MINORS'] },
      liar: { red_flags: ['GUARANTEED_WINS_CLAIMS'] },
    };
    expect(await scoreAll()).toMatchObject({ attempted: 5, scored: 5, failed: 0 });
    const by = Object.fromEntries((await c.db.lead.findMany()).map((l) => [l.handle, l]));
    expect(by.great).toMatchObject({ status: 'SCORED', isPriority: true });
    expect(by.great.score).toBeGreaterThanOrEqual(80);
    expect(by.weak.isPriority).toBe(false);
    expect(by.kidstips).toMatchObject({ isPriority: false });
    expect(by.kidstips.score).toBeLessThanOrEqual(15);
    expect(by.liar).toMatchObject({ isPriority: false });
    expect(by.liar.score).toBeLessThanOrEqual(45);
    expect(by.uk.redFlags).toContain('OUTSIDE_TARGET_MARKETS');
    expect(by.uk.isPriority).toBe(false);
    const list = await c.api('/leads?priority=true');
    expect(list.json.items.map((l: any) => l.handle)).toEqual(['great']);
    const ordered = (await c.api('/leads')).json.items.map((l: any) => l.score);
    expect(ordered).toEqual([...ordered].sort((a, b) => b - a));
  });
  it('records a failure on the lead, keeps it retryable, and keeps going with the others', async () => {
    await importLeads(c.api, [row('boom'), row('fine')]);
    c.llm.byHandle = { boom: 'throw' };
    expect(await scoreAll()).toMatchObject({ scored: 1, failed: 1 });
    const boom = await lead('boom');
    expect(boom).toMatchObject({ status: 'NEW', score: null });
    expect(boom.scoreError).toMatch(/upstream exploded/);
    expect((await c.api('/leads/stats')).json.needsAttention).toBe(1);
    expect((await c.api('/leads?needsAttention=true')).json.total).toBe(1);
    c.llm.byHandle = {};
    expect((await c.api(`/leads/${boom.id}/rescore`, { method: 'POST' })).json).toMatchObject({ status: 'SCORED', scoreError: null });
  });
  it('does not run two scoring batches at once', async () => {
    await importLeads(c.api, Array.from({ length: 6 }, (_, i) => row(`p${i}`)));
    const [a, b] = await Promise.all([c.api('/classification/run', { method: 'POST', body: {} }), c.api('/classification/run', { method: 'POST', body: {} })]);
    const runs = [a.json, b.json];
    expect(runs.filter((r) => r.alreadyRunning).length).toBeGreaterThanOrEqual(0);
    expect(c.llm.calls.length).toBe(6); // each lead scored exactly once, never twice
  });
  it('rescoring never undoes a manager decision', async () => {
    await importLeads(c.api, [row('keep')]); await scoreAll();
    const l = await lead('keep');
    await c.api(`/leads/${l.id}/approve`, { method: 'POST', body: {} });
    await c.api(`/leads/${l.id}/rescore`, { method: 'POST' });
    expect((await lead('keep')).status).toBe('APPROVED');
  });
});

describe('manager review', () => {
  it('cannot approve before scoring, nor a disqualified lead; can approve a clean one; audits it', async () => {
    await importLeads(c.api, [row('good'), row('kidstips'), row('unscored')]);
    c.llm.byHandle = { kidstips: { red_flags: ['AUDIENCE_INCLUDES_MINORS'] } };
    await c.api('/classification/run', { method: 'POST', body: { limit: 2 } });
    const unscored = await c.db.lead.findFirstOrThrow({ where: { status: 'NEW' } });
    expect((await c.api(`/leads/${unscored.id}/approve`, { method: 'POST', body: {} })).status).toBe(400);
    const kids = await lead('kidstips');
    const blocked = await c.api(`/leads/${kids.id}/approve`, { method: 'POST', body: {} });
    expect(blocked.status).toBe(400);
    expect(blocked.json.message).toMatch(/disqualifying/);
    const good = await lead('good');
    const ok = await c.api(`/leads/${good.id}/approve`, { method: 'POST', body: { note: 'looks right' }, actor: 'dana' });
    expect(ok.json).toMatchObject({ status: 'APPROVED', reviewedBy: 'dana', reviewNote: 'looks right' });
    expect(await c.db.auditLog.count({ where: { action: 'LEAD_APPROVED', leadId: good.id, actor: 'dana' } })).toBe(1);
  });
  it('lets only one of many simultaneous approvals win', async () => {
    await importLeads(c.api, [row('race')]); await scoreAll();
    const l = await lead('race');
    const rs = await Promise.all(Array.from({ length: 6 }, () => c.api(`/leads/${l.id}/approve`, { method: 'POST', body: {} })));
    expect(rs.filter((r) => r.status === 201).length).toBe(1);
    expect(await c.db.auditLog.count({ where: { action: 'LEAD_APPROVED' } })).toBe(1);
  });
  it('supports reject, change of mind, and validates ids', async () => {
    await importLeads(c.api, [row('mind')]); await scoreAll();
    const l = await lead('mind');
    expect((await c.api(`/leads/${l.id}/reject`, { method: 'POST', body: {} })).json.status).toBe('REJECTED');
    expect((await c.api(`/leads/${l.id}/approve`, { method: 'POST', body: {} })).json.status).toBe('APPROVED');
    expect((await c.api('/leads/not-a-uuid')).status).toBe(400);
    expect((await c.api('/leads/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
  it('enriching a lead validates input and re-opens a lead that had too little information', async () => {
    await importLeads(c.api, [{ platform: 'tiktok', handle: 'bare' }]); await scoreAll();
    const l = await lead('bare');
    expect(l.scoreError).toBeTruthy();
    expect((await c.api(`/leads/${l.id}`, { method: 'PATCH', body: { contactEmail: 'nope' } })).status).toBe(400);
    expect((await c.api(`/leads/${l.id}`, { method: 'PATCH', body: { country: 'KENYA' } })).status).toBe(400);
    expect((await c.api(`/leads/${l.id}`, { method: 'PATCH', body: { isPriority: true, score: 100, status: 'APPROVED' } })).json.status).toBe('NEW'); // unknown fields ignored
    const r = await c.api(`/leads/${l.id}`, { method: 'PATCH', body: { bio, contactEmail: 'Bare@Example.com', country: 'ke' } });
    expect(r.json).toMatchObject({ scoreError: null, contactEmail: 'bare@example.com', country: 'KE', score: null, isPriority: false });
    await scoreAll();
    expect((await lead('bare')).status).toBe('SCORED');
  });
  it('filters, searches and paginates', async () => {
    await importLeads(c.api, [row('one', { platform: 'telegram' }), row('two'), row('three')]); await scoreAll();
    expect((await c.api('/leads?platform=TELEGRAM')).json.total).toBe(1);
    expect((await c.api('/leads?q=THREE')).json.total).toBe(1);
    expect((await c.api('/leads?limit=2&offset=2')).json.items).toHaveLength(1);
    expect((await c.api('/leads?minScore=101')).json.total).toBe(0);
    expect((await c.api('/leads?status=bogus')).json.total).toBe(3); // unknown filter values are ignored, not an error
    const stats = (await c.api('/leads/stats')).json;
    expect(stats.byStatus.SCORED).toBe(3);
    expect(stats.averageScore).toBeGreaterThan(0);
  });
});

describe('export', () => {
  it('downloads the filtered leads as a spreadsheet, best score first', async () => {
    await importLeads(c.api, [row('great'), row('weak', { followers: 300 }), row('kidstips')]);
    c.llm.byHandle = { weak: { audience_relevance: 20, content_fit: 20, credibility: 30, promo_experience: 0 }, kidstips: { red_flags: ['AUDIENCE_INCLUDES_MINORS'] } };
    await scoreAll();
    const all = await c.api('/leads/export');
    expect(all.status).toBe(200);
    const lines = all.text.trim().split('\r\n');
    expect(lines[0]).toMatch(/^Name,Platform,Handle,Link,Followers,Country/);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^great,YOUTUBE,great/); // highest score first
    expect(lines[3]).toMatch(/AUDIENCE_INCLUDES_MINORS/);
    const priorityOnly = (await c.api('/leads/export?priority=true')).text.trim().split('\r\n');
    expect(priorityOnly).toHaveLength(2);
    expect((await c.api('/leads/export?q=weak')).text.trim().split('\r\n')).toHaveLength(2);
    expect((await c.api('/leads/export?status=APPROVED')).text.trim().split('\r\n')).toHaveLength(1); // header only
  });

  it('cannot be used to attack whoever opens the spreadsheet (formula injection) and quotes awkward text', async () => {
    await importLeads(c.api, [row('evil', { name: '=HYPERLINK("http://evil.example","click")', bio: '+cmd|calc, "quoted"\nnewline ' + bio })]);
    await scoreAll();
    c.llm.byHandle = {};
    const text = (await c.api('/leads/export')).text;
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`); // prefixed with an apostrophe, quotes doubled
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    const cells = text.split('\r\n')[1];
    expect(cells.startsWith('"\'=HYPERLINK')).toBe(true);
  });
});
