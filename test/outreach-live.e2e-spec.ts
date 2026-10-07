process.env.ADMIN_API_KEY = 'e2e-admin-key-0123456789abcdef';
process.env.UNSUBSCRIBE_SECRET = 'e2e-unsubscribe-secret-0123456789';
process.env.OUTREACH_DRY_RUN = 'false';
process.env.RESEND_API_KEY = 're_test';
process.env.OUTREACH_FROM = 'Affiliates <partners@example.com>';
process.env.SENDER_COMPANY_ADDRESS = '1 Example Street, Nicosia, Cyprus';
process.env.OUTREACH_DAILY_LIMIT = '2';
import { boot, importLeads } from './helpers';

type Ctx = Awaited<ReturnType<typeof boot>>;
let c: Ctx;
beforeAll(async () => { c = await boot(); });
afterAll(async () => { await c.close(); });
beforeEach(async () => { await c.reset(); });

const bio = 'Weekly football betting previews and match analysis for East African fans.';
const row = (handle: string, extra: Record<string, unknown> = {}) => ({ platform: 'youtube', handle, name: handle, followers: 150000, country: 'KE', bio, email: `${handle}@example.com`, ...extra });
const lead = (handle: string) => c.db.lead.findFirstOrThrow({ where: { handle } });

/** Imports, scores and approves a lead, returning its id. */
async function approvedLead(handle: string, extra: Record<string, unknown> = {}) {
  await importLeads(c.api, [row(handle, extra)]);
  await c.api('/classification/run', { method: 'POST', body: {} });
  const l = await lead(handle);
  expect((await c.api(`/leads/${l.id}/approve`, { method: 'POST', body: {} })).status).toBe(201);
  return l.id;
}
async function approvedDraft(handle: string) {
  const id = await approvedLead(handle);
  const d = await c.api(`/leads/${id}/outreach/draft`, { method: 'POST' });
  expect(d.status).toBe(201);
  const a = await c.api(`/outreach/${d.json.id}/approve`, { method: 'POST' });
  expect(a.status).toBe(201);
  return { leadId: id, outreachId: d.json.id as string };
}

describe('drafting', () => {
  it('needs an approved lead with an email, and only one open draft', async () => {
    await importLeads(c.api, [row('notyet'), row('noemail', { email: '' })]);
    await c.api('/classification/run', { method: 'POST', body: {} });
    const l = await lead('notyet');
    expect((await c.api(`/leads/${l.id}/outreach/draft`, { method: 'POST' })).status).toBe(400); // not approved
    const id2 = await approvedLead('noemail2', { email: '' });
    expect((await c.api(`/leads/${id2}/outreach/draft`, { method: 'POST' })).json.message).toMatch(/contact email/);
    const id3 = await approvedLead('okay');
    const first = await c.api(`/leads/${id3}/outreach/draft`, { method: 'POST' });
    expect(first.status).toBe(201);
    expect(first.json.fullText).toMatch(/unsubscribe/i);
    expect(first.json.fullText).toMatch(/18\+/);
    expect(first.json.warnings).toEqual([]);
    expect((await c.api(`/leads/${id3}/outreach/draft`, { method: 'POST' })).status).toBe(400); // already open
  });

  it('will not approve a message with forbidden claims, and editing cancels an approval', async () => {
    const id = await approvedLead('edits');
    const d = (await c.api(`/leads/${id}/outreach/draft`, { method: 'POST' })).json;
    const bad = await c.api(`/outreach/${d.id}`, { method: 'PATCH', body: { subject: 'Easy money for you', body: `${d.body} You are guaranteed 5000 USD per month, it is risk-free.` } });
    expect(bad.json.warnings.length).toBeGreaterThanOrEqual(3);
    const refused = await c.api(`/outreach/${d.id}/approve`, { method: 'POST' });
    expect(refused.status).toBe(400);
    expect(refused.json.message).toMatch(/Fix these/);
    const fixed = await c.api(`/outreach/${d.id}`, { method: 'PATCH', body: { subject: 'A partnership idea', body: d.body } });
    expect(fixed.json.warnings).toEqual([]);
    expect((await c.api(`/outreach/${d.id}/approve`, { method: 'POST' })).json.status).toBe('APPROVED');
    const edited = await c.api(`/outreach/${d.id}`, { method: 'PATCH', body: { subject: 'A partnership idea v2', body: d.body } });
    expect(edited.json).toMatchObject({ status: 'DRAFT', approvedBy: null });
    expect((await c.api(`/outreach/${d.id}/send`, { method: 'POST' })).status).toBe(400); // approval was cancelled
    expect(c.mailer.sent).toHaveLength(0);
  });
});

describe('sending', () => {
  it('sends exactly once even under a burst of clicks, with footer and unsubscribe headers, and marks the lead contacted', async () => {
    const { leadId, outreachId } = await approvedDraft('burst');
    const rs = await Promise.all(Array.from({ length: 6 }, () => c.api(`/outreach/${outreachId}/send`, { method: 'POST' })));
    expect(rs.filter((r) => r.status === 200).length).toBe(1);
    expect(c.mailer.sent).toHaveLength(1);
    const mail = c.mailer.sent[0];
    expect(mail.to).toBe('burst@example.com');
    expect(mail.text).toContain('1 Example Street, Nicosia, Cyprus');
    expect(mail.text).toMatch(/\/unsubscribe\/.+\./);
    expect(mail.text).toMatch(/18\+/);
    expect(mail.unsubscribeUrl).toMatch(/^http.*\/unsubscribe\//);
    expect((await c.db.lead.findUniqueOrThrow({ where: { id: leadId } })).status).toBe('CONTACTED');
    expect((await c.db.outreach.findUniqueOrThrow({ where: { id: outreachId } })).status).toBe('SENT');
    expect((await c.api(`/outreach/${outreachId}/send`, { method: 'POST' })).status).toBe(400); // never a second email
    expect(c.mailer.sent).toHaveLength(1);
  });

  it('enforces the daily limit and releases the slot', async () => {
    const drafts = [];
    for (const h of ['d1', 'd2', 'd3']) drafts.push(await approvedDraft(h));
    expect((await c.api(`/outreach/${drafts[0].outreachId}/send`, { method: 'POST' })).status).toBe(200);
    expect((await c.api(`/outreach/${drafts[1].outreachId}/send`, { method: 'POST' })).status).toBe(200);
    const third = await c.api(`/outreach/${drafts[2].outreachId}/send`, { method: 'POST' });
    expect(third.status).toBe(400);
    expect(third.json.message).toMatch(/Daily sending limit/);
    expect(c.mailer.sent).toHaveLength(2);
    const o = await c.db.outreach.findUniqueOrThrow({ where: { id: drafts[2].outreachId } });
    expect(o).toMatchObject({ status: 'APPROVED', sentAt: null }); // still sendable tomorrow
  });

  it('marks a provider failure FAILED, does not mark the lead contacted, and allows a fresh draft', async () => {
    const { leadId, outreachId } = await approvedDraft('flaky');
    c.mailer.failNext = true;
    const r = await c.api(`/outreach/${outreachId}/send`, { method: 'POST' });
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/provider down/);
    expect(await c.db.outreach.findUniqueOrThrow({ where: { id: outreachId } })).toMatchObject({ status: 'FAILED', sentAt: null });
    expect((await c.db.lead.findUniqueOrThrow({ where: { id: leadId } })).status).toBe('APPROVED');
    expect((await c.api(`/leads/${leadId}/outreach/draft`, { method: 'POST' })).status).toBe(201);
  });

  it('refuses to send if the lead was rejected, or the email changed, after approval', async () => {
    const a = await approvedDraft('changed');
    await c.api(`/leads/${a.leadId}`, { method: 'PATCH', body: { contactEmail: 'someone.else@example.com' } });
    expect((await c.api(`/outreach/${a.outreachId}/send`, { method: 'POST' })).json.message).toMatch(/email changed/);
    const b = await approvedDraft('rejected');
    await c.api(`/leads/${b.leadId}/reject`, { method: 'POST', body: {} });
    expect((await c.api(`/outreach/${b.outreachId}/send`, { method: 'POST' })).status).toBe(400);
    expect(c.mailer.sent).toHaveLength(0);
  });
});

describe('opt-out', () => {
  it('a suppressed address is never emailed, whatever a manager clicks', async () => {
    const { outreachId } = await approvedDraft('suppressed');
    await c.db.suppression.create({ data: { email: 'suppressed@example.com', reason: 'test' } });
    const r = await c.api(`/outreach/${outreachId}/send`, { method: 'POST' });
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/opted out/);
    expect(c.mailer.sent).toHaveLength(0);
  });

  it('the unsubscribe link works without a login, suppresses the address, closes the lead and cancels open drafts', async () => {
    const { leadId, outreachId } = await approvedDraft('leaver');
    const token = (await c.api(`/outreach/${outreachId}`)).json.fullText.match(/unsubscribe\/([^\s]+)/)[1];
    const page = await c.api(`/unsubscribe/${token}`, { key: null });
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/unsubscribed/i);
    expect(await c.db.suppression.findUnique({ where: { email: 'leaver@example.com' } })).toBeTruthy();
    expect((await c.db.lead.findUniqueOrThrow({ where: { id: leadId } })).status).toBe('DO_NOT_CONTACT');
    expect((await c.db.outreach.findUniqueOrThrow({ where: { id: outreachId } })).status).toBe('FAILED');
    expect((await c.api(`/outreach/${outreachId}/send`, { method: 'POST' })).status).toBe(400);
    expect((await c.api(`/unsubscribe/${token}`, { method: 'POST', key: null })).json).toEqual({ ok: true }); // idempotent one-click
    expect(c.mailer.sent).toHaveLength(0);
  });

  it('forged or tampered unsubscribe links change nothing', async () => {
    await approvedLead('victim');
    const forged = `${Buffer.from('victim@example.com').toString('base64url')}.AAAAAAAAAAAAAAAAAAAAAAAA`;
    const r = await c.api(`/unsubscribe/${forged}`, { key: null });
    expect(r.text).toMatch(/not valid/i);
    expect(await c.db.suppression.count()).toBe(0);
    expect((await lead('victim')).status).toBe('APPROVED');
  });

  it('do-not-contact closes the lead for good: suppressed, drafts cancelled, cannot be re-approved', async () => {
    const { leadId, outreachId } = await approvedDraft('banned');
    expect((await c.api(`/leads/${leadId}/do-not-contact`, { method: 'POST', body: { note: 'asked us to stop' } })).json.status).toBe('DO_NOT_CONTACT');
    expect(await c.db.suppression.findUnique({ where: { email: 'banned@example.com' } })).toBeTruthy();
    expect((await c.db.outreach.findUniqueOrThrow({ where: { id: outreachId } })).status).toBe('FAILED');
    expect((await c.api(`/leads/${leadId}/approve`, { method: 'POST', body: {} })).status).toBe(400);
    expect((await c.api(`/leads/${leadId}/reject`, { method: 'POST', body: {} })).status).toBe(400);
    expect((await c.api(`/outreach/${outreachId}/send`, { method: 'POST' })).status).toBe(400);
    expect(c.mailer.sent).toHaveLength(0);
  });

  it('a lead marked as replied needs to have been contacted first', async () => {
    const { leadId, outreachId } = await approvedDraft('talker');
    expect((await c.api(`/leads/${leadId}/replied`, { method: 'POST', body: {} })).status).toBe(400);
    await c.api(`/outreach/${outreachId}/send`, { method: 'POST' });
    expect((await c.api(`/leads/${leadId}/replied`, { method: 'POST', body: {} })).json.status).toBe('REPLIED');
  });
});
