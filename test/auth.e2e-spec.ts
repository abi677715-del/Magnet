process.env.ADMIN_API_KEY = 'e2e-admin-key-0123456789abcdef';
import { boot } from './helpers';

let c: Awaited<ReturnType<typeof boot>>;
beforeAll(async () => { c = await boot(); });
afterAll(async () => { await c.close(); });
beforeEach(async () => { await c.reset(); });

const person = (email = 'dana@example.com', name = 'Dana') => ({ name, email, password: 'a-long-password' });
const register = (body: Record<string, unknown> = person()) => c.api('/auth/register', { method: 'POST', body, key: null });
const login = (email = 'dana@example.com', password = 'a-long-password') => c.api('/auth/login', { method: 'POST', body: { email, password }, key: null });
const userId = async (email = 'dana@example.com') => (await c.db.user.findUniqueOrThrow({ where: { email } })).id;
const approve = async (email = 'dana@example.com') => c.api(`/admin/users/${await userId(email)}/approve`, { method: 'POST' });

describe('registration', () => {
  it('creates a PENDING account, stores only a hash, and does not let it in', async () => {
    const r = await register();
    expect(r.status).toBe(201);
    const u = await c.db.user.findUniqueOrThrow({ where: { email: 'dana@example.com' } });
    expect(u).toMatchObject({ status: 'PENDING', role: 'USER', name: 'Dana' });
    expect(u.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(u)).not.toContain('a-long-password');
    const l = await login();
    expect(l.status).toBe(403);
    expect(l.json.message).toMatch(/waiting for an admin/);
  });
  it('validates input and refuses a duplicate email (any case)', async () => {
    expect((await register({ ...person(), password: 'short' })).status).toBe(400);
    expect((await register({ ...person(), email: 'nope' })).status).toBe(400);
    expect((await register({ ...person(), name: '' })).status).toBe(400);
    expect((await register()).status).toBe(201);
    expect((await register(person('DANA@Example.com'))).status).toBe(409);
  });
  it('cannot pick its own role or status when registering', async () => {
    await register({ ...person(), role: 'ADMIN', status: 'APPROVED' });
    expect(await c.db.user.findUniqueOrThrow({ where: { email: 'dana@example.com' } })).toMatchObject({ role: 'USER', status: 'PENDING' });
  });
});

describe('sign in', () => {
  it('works after an admin approves, and the session can use the app', async () => {
    await register();
    expect((await approve()).json).toMatchObject({ status: 'APPROVED', decidedBy: 'admin' });
    const l = await login();
    expect(l.status).toBe(201);
    expect(l.json.user).toMatchObject({ email: 'dana@example.com', role: 'USER' });
    expect(l.json.user.passwordHash).toBeUndefined();
    const t = l.json.token;
    expect((await c.api('/auth/me', { key: t })).json).toMatchObject({ name: 'Dana', role: 'USER', viaKey: false });
    expect((await c.api('/leads', { key: t })).status).toBe(200);
    expect((await c.api('/leads/stats', { key: t })).status).toBe(200);
  });
  it('gives the same answer for a wrong password and an unknown email', async () => {
    await register(); await approve();
    const wrong = await login('dana@example.com', 'not-the-password');
    const unknown = await login('nobody@example.com', 'whatever-password');
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.json.message).toBe(unknown.json.message);
  });
  it('does not reveal the account state without the right password', async () => {
    await register();
    expect((await login('dana@example.com', 'not-the-password')).status).toBe(401);
  });
  it('only stores a hash of the session token', async () => {
    await register(); await approve();
    const { token } = (await login()).json;
    const rows = await c.db.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toContain(token);
  });
  it('signing out kills the token', async () => {
    await register(); await approve();
    const { token } = (await login()).json;
    expect((await c.api('/auth/logout', { method: 'POST', key: token })).status).toBe(201);
    expect((await c.api('/leads', { key: token })).status).toBe(401);
  });
  it('expired sessions are refused', async () => {
    await register(); await approve();
    const { token } = (await login()).json;
    await c.db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await c.api('/leads', { key: token })).status).toBe(401);
  });
  it('brute-forcing the login is rate limited (checked with limits switched back on)', async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await login('dana@example.com', `guess-${i}-guess`)).status);
      expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    } finally { process.env.NODE_ENV = saved; }
  });
});

describe('admin page', () => {
  it('only admins can see or change registrations', async () => {
    await register(); await approve();
    const { token } = (await login()).json;
    expect((await c.api('/admin/users', { key: token })).status).toBe(403);
    expect((await c.api(`/admin/users/${await userId()}/reject`, { method: 'POST', key: token })).status).toBe(403);
    expect((await c.api('/admin/users', { key: null })).status).toBe(401);
    expect((await c.api('/admin/users')).status).toBe(200); // the shared admin key
  });
  it('lists pending registrations and filters by status', async () => {
    await register(person('a@example.com', 'Ann')); await register(person('b@example.com', 'Bob')); await approve('a@example.com');
    const pending = (await c.api('/admin/users?status=PENDING')).json;
    expect(pending.map((u: any) => u.email)).toEqual(['b@example.com']);
    expect(pending[0].passwordHash).toBeUndefined();
    expect((await c.api('/admin/users')).json).toHaveLength(2);
    expect((await c.api('/admin/users?status=bogus')).json).toHaveLength(2); // unknown filter ignored
  });
  it('rejecting blocks sign-in; disabling signs the person out immediately', async () => {
    await register(person('r@example.com', 'Rae')); await register(person('d@example.com', 'Dee'));
    await c.api(`/admin/users/${await userId('r@example.com')}/reject`, { method: 'POST' });
    expect((await login('r@example.com')).json.message).toMatch(/declined/);
    await approve('d@example.com');
    const { token } = (await login('d@example.com')).json;
    expect((await c.api('/leads', { key: token })).status).toBe(200);
    await c.api(`/admin/users/${await userId('d@example.com')}/disable`, { method: 'POST' });
    expect((await c.api('/leads', { key: token })).status).toBe(401);
    expect((await login('d@example.com')).json.message).toMatch(/switched off/);
  });
  it('an admin user can approve others but cannot switch off or demote themselves; only approved users can be made admin', async () => {
    await register(person('boss@example.com', 'Boss')); await register(person('new@example.com', 'New'));
    await approve('boss@example.com');
    expect((await c.api(`/admin/users/${await userId('new@example.com')}/make-admin`, { method: 'POST' })).status).toBe(400); // still pending
    expect((await c.api(`/admin/users/${await userId('boss@example.com')}/make-admin`, { method: 'POST' })).json.role).toBe('ADMIN');
    const { token } = (await login('boss@example.com')).json;
    const ok = await c.api(`/admin/users/${await userId('new@example.com')}/approve`, { method: 'POST', key: token });
    expect(ok.json).toMatchObject({ status: 'APPROVED', decidedBy: 'Boss' });
    const me = await userId('boss@example.com');
    expect((await c.api(`/admin/users/${me}/disable`, { method: 'POST', key: token })).status).toBe(400);
    expect((await c.api(`/admin/users/${me}/remove-admin`, { method: 'POST', key: token })).status).toBe(400);
    expect((await c.api(`/admin/users/${me}/reject`, { method: 'POST', key: token })).status).toBe(400);
  });
  it('resetting a password signs the person out and the new password works', async () => {
    await register(); await approve();
    const { token } = (await login()).json;
    const id = await userId();
    expect((await c.api(`/admin/users/${id}/reset-password`, { method: 'POST', body: { password: 'short' } })).status).toBe(400);
    expect((await c.api(`/admin/users/${id}/reset-password`, { method: 'POST', body: { password: 'brand-new-password' } })).status).toBe(201);
    expect((await c.api('/leads', { key: token })).status).toBe(401);
    expect((await login('dana@example.com', 'a-long-password')).status).toBe(401);
    expect((await login('dana@example.com', 'brand-new-password')).status).toBe(201);
  });
  it('writes who decided what to the audit log', async () => {
    await register(); await approve();
    expect(await c.db.auditLog.count({ where: { action: 'USER_REGISTERED' } })).toBe(1);
    expect(await c.db.auditLog.count({ where: { action: 'USER_APPROVED', actor: 'admin' } })).toBe(1);
  });
});

describe('the shared key still works', () => {
  it('is an admin and shows up as such', async () => {
    expect((await c.api('/auth/me')).json).toMatchObject({ role: 'ADMIN', viaKey: true });
    expect((await c.api('/leads')).status).toBe(200);
  });
  it('lets a person stage change be attributed to the signed-in user, not a header they control', async () => {
    await register(); await approve();
    const { token } = (await login()).json;
    await c.db.lead.create({ data: { platform: 'TELEGRAM', handle: 'x', url: 'https://t.me/x', displayName: 'X', source: 'test' } });
    const lead = await c.db.lead.findFirstOrThrow();
    const r = await c.api(`/leads/${lead.id}/stage`, { method: 'POST', body: { stage: 'CONTACTED' }, key: token, actor: 'someone-else' });
    expect(r.json.stageBy).toBe('Dana');
  });
});
