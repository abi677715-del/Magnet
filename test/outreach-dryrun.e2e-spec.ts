process.env.ADMIN_API_KEY = 'e2e-admin-key-0123456789abcdef';
process.env.UNSUBSCRIBE_SECRET = 'e2e-unsubscribe-secret-0123456789';
delete process.env.OUTREACH_DRY_RUN; // the default must be dry-run
import { boot, importLeads } from './helpers';

let c: Awaited<ReturnType<typeof boot>>;
beforeAll(async () => { c = await boot(); });
afterAll(async () => { await c.close(); });
beforeEach(async () => { await c.reset(); });

it('by default nothing is emailed: sending only previews, and changes no state', async () => {
  await importLeads(c.api, [{ platform: 'youtube', handle: 'dry', name: 'Dry', followers: 100000, bio: 'Football betting previews for fans every week.', email: 'dry@example.com' }]);
  await c.api('/classification/run', { method: 'POST', body: {} });
  const l = await c.db.lead.findFirstOrThrow({ where: { handle: 'dry' } });
  await c.api(`/leads/${l.id}/approve`, { method: 'POST', body: {} });
  const d = (await c.api(`/leads/${l.id}/outreach/draft`, { method: 'POST' })).json;
  await c.api(`/outreach/${d.id}/approve`, { method: 'POST' });
  const r = await c.api(`/outreach/${d.id}/send`, { method: 'POST' });
  expect(r.json).toMatchObject({ dryRun: true, to: 'dry@example.com' });
  expect(r.json.text).toMatch(/unsubscribe/);
  expect(c.mailer.sent).toHaveLength(0);
  expect((await c.db.outreach.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('APPROVED');
  expect((await c.db.lead.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('APPROVED');
});
