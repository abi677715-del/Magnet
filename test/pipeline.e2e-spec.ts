process.env.ADMIN_API_KEY = 'e2e-admin-key-0123456789abcdef';
import { boot, importLeads } from './helpers';

type Ctx = Awaited<ReturnType<typeof boot>>;
let c: Ctx;
beforeAll(async () => { c = await boot(); });
afterAll(async () => { await c.close(); });
beforeEach(async () => { await c.reset(); });

const bio = 'Weekly football betting previews and match analysis for East African fans.';
const row = (handle: string, extra: Record<string, unknown> = {}) => ({ platform: 'youtube', handle, name: handle, followers: 150000, country: 'KE', bio, email: `${handle}@example.com`, ...extra });
const lead = async (handle: string) => c.db.lead.findFirstOrThrow({ where: { handle } });

describe('auth', () => {
  it('refuses missing and wrong keys on every protected route', async () => {
    for (const [method, path] of [['GET', '/leads'], ['GET', '/leads/stats'], ['POST', '/discovery/ai']]) {
      expect((await c.api(path, { method, key: null })).status).toBe(401);
      expect((await c.api(path, { method, key: 'wrong-key-wrong-key-wrong' })).status).toBe(401);
    }
  });
  it('keeps only the health check public, and has no scoring, review, CSV, YouTube-search, add-by-link or email-sending endpoints at all', async () => {
    expect((await c.api('/health', { key: null })).status).toBe(200);
    expect((await c.api('/leads/export')).status).toBe(400); // no longer an export route: it is treated as a lead id
    for (const path of ['/unsubscribe/x', '/outreach/x', '/classification/run', '/leads/00000000-0000-4000-8000-000000000000/approve', '/leads/00000000-0000-4000-8000-000000000000/rescore', '/discovery/import', '/discovery/youtube', '/discovery/urls']) {
      expect((await c.api(path, { method: 'POST' })).status).toBe(404);
    }
  });
  it('fails closed when the server key is too short', async () => {
    const saved = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = 'short';
    try { expect((await c.api('/leads', { key: 'short' })).status).toBe(401); } finally { process.env.ADMIN_API_KEY = saved; }
  });
});

describe('import & dedupe', () => {
  it('creates leads, then updates (never duplicates) on re-import, and keeps the stage', async () => {
    expect((await importLeads(c, [row('alpha'), row('beta')]))).toMatchObject({ created: 2, updated: 0 });
    const a = await lead('alpha');
    await c.api(`/leads/${a.id}/stage`, { method: 'POST', body: { stage: 'CONTACTED', note: 'emailed' }, actor: 'dana' });
    const again = await importLeads(c, [row('alpha', { followers: 999999 }), row('beta')]);
    expect(again).toMatchObject({ created: 0, updated: 2 });
    expect(await c.db.lead.count()).toBe(2);
    expect(await lead('alpha')).toMatchObject({ stage: 'CONTACTED', followers: 999999, stageBy: 'dana' });
  });
  it('treats handles case-insensitively', async () => {
    await importLeads(c, [row('MixedCase')]); await importLeads(c, [row('mixedcase')]);
    expect(await c.db.lead.count()).toBe(1);
  });
});

describe('partner stage', () => {
  it('starts as FOUND, moves through contacted / in progress / registered, and is audited', async () => {
    await importLeads(c, [row('p1')]);
    const l = await lead('p1');
    expect(l.stage).toBe('FOUND');
    for (const stage of ['CONTACTED', 'IN_PROGRESS', 'REGISTERED']) {
      const r = await c.api(`/leads/${l.id}/stage`, { method: 'POST', body: { stage, note: `now ${stage}` }, actor: 'dana' });
      expect(r.status).toBe(201);
      expect(r.json).toMatchObject({ stage, stageNote: `now ${stage}`, stageBy: 'dana' });
      expect(r.json.stageAt).toBeTruthy();
    }
    expect(await c.db.auditLog.count({ where: { action: 'LEAD_STAGE', leadId: l.id, actor: 'dana' } })).toBe(3);
  });
  it('rejects unknown stages and unknown leads', async () => {
    await importLeads(c, [row('p2')]);
    const l = await lead('p2');
    expect((await c.api(`/leads/${l.id}/stage`, { method: 'POST', body: { stage: 'SENT' } })).status).toBe(400);
    expect((await c.api('/leads/00000000-0000-4000-8000-000000000000/stage', { method: 'POST', body: { stage: 'CONTACTED' } })).status).toBe(404);
    expect((await c.api('/leads/not-a-uuid/stage', { method: 'POST', body: { stage: 'CONTACTED' } })).status).toBe(400);
  });
  it('filters by stage and counts them in the stats', async () => {
    await importLeads(c, [row('a1'), row('a2'), row('a3')]);
    await c.api(`/leads/${(await lead('a1')).id}/stage`, { method: 'POST', body: { stage: 'REGISTERED' } });
    await c.api(`/leads/${(await lead('a2')).id}/stage`, { method: 'POST', body: { stage: 'CONTACTED' } });
    expect((await c.api('/leads?stage=REGISTERED')).json.items.map((l: any) => l.handle)).toEqual(['a1']);
    expect((await c.api('/leads?stage=bogus')).json.total).toBe(3); // unknown filter values are ignored, not an error
    expect((await c.api('/leads/stats')).json.byStage).toEqual({ REGISTERED: 1, CONTACTED: 1, FOUND: 1 });
  });
});

describe('leads', () => {
  it('filters by country and by language (code or name)', async () => {
    await importLeads(c, [row('ke1', { country: 'KE' }), row('ng1', { country: 'NG' }), row('none', { country: undefined })]);
    await c.db.lead.updateMany({ where: { handle: 'ke1' }, data: { language: 'Swahili' } });
    await c.db.lead.updateMany({ where: { handle: 'ng1' }, data: { language: 'en-GB' } });
    expect((await c.api('/leads?country=ke')).json.items.map((l: any) => l.handle)).toEqual(['ke1']);
    expect((await c.api('/leads?language=sw')).json.items.map((l: any) => l.handle)).toEqual(['ke1']); // matched by the language's name
    expect((await c.api('/leads?language=en')).json.items.map((l: any) => l.handle)).toEqual(['ng1']); // matched by code prefix
    expect((await c.api('/leads?country=KENYA')).json.total).toBe(3); // invalid values are ignored
  });

  it('enriching validates input and ignores unknown fields', async () => {
    await importLeads(c, [{ platform: 'tiktok', handle: 'bare' }]);
    const l = await lead('bare');
    expect((await c.api(`/leads/${l.id}`, { method: 'PATCH', body: { contactEmail: 'nope' } })).status).toBe(400);
    expect((await c.api(`/leads/${l.id}`, { method: 'PATCH', body: { country: 'KENYA' } })).status).toBe(400);
    expect((await c.api(`/leads/${l.id}`, { method: 'PATCH', body: { stage: 'REGISTERED' } })).json.stage).toBe('FOUND'); // stage only changes through its own endpoint
    const r = await c.api(`/leads/${l.id}`, { method: 'PATCH', body: { bio, contactEmail: 'Bare@Example.com', country: 'ke' } });
    expect(r.json).toMatchObject({ contactEmail: 'bare@example.com', country: 'KE', bio });
  });
  it('deletes a lead', async () => {
    await importLeads(c, [row('gone')]);
    const l = await lead('gone');
    expect((await c.api(`/leads/${l.id}`, { method: 'DELETE' })).json).toEqual({ deleted: true });
    expect(await c.db.lead.count()).toBe(0);
    expect((await c.api(`/leads/${l.id}`)).status).toBe(404);
  });
  it('filters, searches and paginates, newest first', async () => {
    await importLeads(c, [row('one', { platform: 'telegram' }), row('two'), row('three')]);
    expect((await c.api('/leads?platform=TELEGRAM')).json.total).toBe(1);
    expect((await c.api('/leads?q=THREE')).json.total).toBe(1);
    expect((await c.api('/leads?limit=2&offset=2')).json.items).toHaveLength(1);
    expect((await c.api('/leads?since=2999-01-01T00:00:00Z')).json.total).toBe(0);
    expect((await c.api('/leads?since=2000-01-01T00:00:00Z')).json.total).toBe(3);
    expect((await c.api('/leads/not-a-uuid')).status).toBe(400);
    expect((await c.api('/leads/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await c.api('/leads/stats')).json).toMatchObject({ total: 3, last24h: 3 });
  });
});
