'use strict';
/*
 * Everything that came from a creator's public profile is untrusted. This file
 * only ever puts it on the page with textContent / setAttribute-after-checking,
 * never innerHTML, so a hostile bio cannot run code in a manager's browser.
 */
const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };
const num = (n) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));

let toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 2800);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + store.get('key') },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') { signOut(); throw new Error('Please sign in again.'); }
  if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join('; ') : data.message || 'Request failed (' + res.status + ')');
  return data;
}

const STAGES = [['FOUND', 'Found'], ['CONTACTED', 'Contacted'], ['IN_PROGRESS', 'In progress'], ['REGISTERED', 'Registered'], ['DECLINED', 'Declined']];
// Every country and a broad set of languages, named by the browser from their ISO codes, so filters list them all.
const COUNTRY_CODES = 'AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW'.split(' ');
const LANGUAGE_CODES = 'af sq am ar hy az eu be bn bs bg my ca zh hr cs da nl en et fil fi fr gl ka de el gu ha he hi hu is ig id ga it ja kn kk km rw ko ku ky lo lv lt lb mk mg ms ml mt mi mr mn ne no or ps fa pl pt pa ro ru sm sr sn sd si sk sl so es sw sv tg ta te th ti tr tk uk ur uz vi cy xh yo zu'.split(' ');
const names = (type, codes) => { let dn = null; try { dn = new Intl.DisplayNames(['en'], { type }); } catch { /* old browser */ }
  return codes.map((c) => { let n = c; try { n = (dn && dn.of(c)) || c; } catch { /* keep the code */ } return [c, n]; }).sort((a, b) => a[1].localeCompare(b[1])); };
const COUNTRIES = names('region', COUNTRY_CODES);
const LANGUAGES = names('language', LANGUAGE_CODES);
const ROW_STAGES = [['FOUND', 'Status'], ['CONTACTED', 'Contacted'], ['IN_PROGRESS', 'In progress'], ['REGISTERED', 'Registered']];
const STAGE_LABEL = Object.fromEntries(STAGES);
const STAGE_CLASS = { FOUND: '', CONTACTED: 'warn', IN_PROGRESS: 'warn', REGISTERED: 'good', DECLINED: 'bad' };
const PLATFORMS = ['YOUTUBE', 'X', 'TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'REDDIT', 'TELEGRAM', 'WEBSITE'];

// Built once so a running search keeps showing its progress when the list below refreshes.
const cards = {};
const state = { filters: {}, selected: null, offset: 0, since: '', view: 'partners', me: null };

function signOut(message) {
  for (const k of Object.keys(cards)) delete cards[k];
  store.del('key'); state.me = null; state.view = 'partners';
  for (const id of ['app', 'foot', 'nav', 'logout', 'nav-admin']) $(id).hidden = true;
  $('login').hidden = false; $('whoami').textContent = ''; $('stats').replaceChildren(); closeDetail();
  if (typeof message === 'string') $('login-error').textContent = message;
}

async function logout() { try { await api('/auth/logout', { method: 'POST' }); } catch { /* already signed out */ } signOut(); }

function showAuthTab(which) {
  const signin = which === 'signin';
  $('login-form').hidden = !signin; $('register-form').hidden = signin;
  $('tab-signin').classList.toggle('on', signin); $('tab-register').classList.toggle('on', !signin);
  $('login-error').textContent = ''; $('login-info').textContent = '';
}

async function openWith(token) {
  store.set('key', token);
  try { state.me = await api('/auth/me'); } catch (err) { store.del('key'); throw err; }
  showApp();
}

async function start() {
  $('logout').addEventListener('click', logout);
  $('tab-signin').addEventListener('click', () => showAuthTab('signin'));
  $('tab-register').addEventListener('click', () => showAuthTab('register'));
  $('nav-partners').addEventListener('click', () => setView('partners'));
  $('nav-admin').addEventListener('click', () => setView('admin'));

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); $('login-error').textContent = ''; $('login-info').textContent = '';
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email: $('login-email').value, password: $('login-password').value } });
      $('login-password').value = '';
      await openWith(r.token);
    } catch (err) { $('login-error').textContent = err.message; }
  });
  $('key-signin').addEventListener('click', async () => {
    $('login-error').textContent = '';
    try { await openWith($('key').value); $('key').value = ''; } catch (err) { $('login-error').textContent = 'That admin key was not accepted.'; }
  });
  $('register-form').addEventListener('submit', async (e) => {
    e.preventDefault(); $('login-error').textContent = ''; $('login-info').textContent = '';
    if ($('reg-password').value !== $('reg-password2').value) { $('login-error').textContent = 'The two passwords are not the same.'; return; }
    try {
      const r = await api('/auth/register', { method: 'POST', body: { name: $('reg-name').value.trim(), email: $('reg-email').value.trim(), password: $('reg-password').value } });
      $('register-form').reset();
      showAuthTab('signin');
      $('login-info').textContent = r.message;
    } catch (err) { $('login-error').textContent = err.message; }
  });

  if (store.get('key')) { try { state.me = await api('/auth/me'); return showApp(); } catch { /* fall through to sign in */ } }
  signOut();
}

function showApp() {
  const isAdmin = state.me && state.me.role === 'ADMIN';
  $('login').hidden = true; $('app').hidden = false; $('foot').hidden = false; $('logout').hidden = false; $('nav').hidden = false;
  $('nav-admin').hidden = !isAdmin;
  $('whoami').textContent = state.me ? state.me.name + (isAdmin ? ' · admin' : '') : '';
  setView('partners');
  loadStats(); if (isAdmin) refreshPending();
}

function setView(view) {
  state.view = view;
  $('view-partners').hidden = view !== 'partners'; $('view-admin').hidden = view !== 'admin';
  $('nav-partners').classList.toggle('on', view === 'partners'); $('nav-admin').classList.toggle('on', view === 'admin');
  $('foot').hidden = view !== 'partners';
  if (view === 'admin') renderAdmin(); else renderTab();
}

async function refreshPending() {
  try {
    const pending = await api('/admin/users?status=PENDING');
    $('pending-badge').textContent = pending.length; $('pending-badge').hidden = !pending.length;
  } catch { /* badge is a nicety */ }
}

const STATUS_PILL = { PENDING: ['Waiting', 'warn'], APPROVED: ['Approved', 'good'], REJECTED: ['Declined', 'bad'], DISABLED: ['Switched off', 'bad'] };
const dateOnly = (d) => (d ? String(d).slice(0, 10) : '—');

/** Admin page: confirm registrations and manage the team. */
async function renderAdmin() {
  const pane = $('view-admin');
  pane.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    const users = await api('/admin/users');
    const run = (fn, ok) => async () => { try { await fn(); toast(ok); renderAdmin(); refreshPending(); } catch (e) { toast(e.message, true); } };
    const post = (u, action, body) => api('/admin/users/' + u.id + '/' + action, { method: 'POST', body });
    const row = (u) => {
      const [label, cls] = STATUS_PILL[u.status] || [u.status, ''];
      const mine = state.me && state.me.email && state.me.email === u.email;
      const acts = [];
      if (u.status === 'PENDING') acts.push(h('button', { class: 'good', onclick: run(() => post(u, 'approve'), u.name + ' approved') }, 'Approve'), h('button', { class: 'ghost', onclick: run(() => post(u, 'reject'), u.name + ' declined') }, 'Reject'));
      if (u.status === 'REJECTED' || u.status === 'DISABLED') acts.push(h('button', { class: 'good', onclick: run(() => post(u, 'approve'), u.name + ' approved') }, 'Approve again'));
      if (u.status === 'APPROVED' && !mine) {
        acts.push(u.role === 'ADMIN'
          ? h('button', { class: 'ghost', onclick: run(() => post(u, 'remove-admin'), 'Admin rights removed') }, 'Remove admin')
          : h('button', { class: 'ghost', onclick: run(() => post(u, 'make-admin'), u.name + ' is now an admin') }, 'Make admin'));
        acts.push(h('button', { class: 'ghost', onclick: () => { const pw = prompt('New password for ' + u.name + ' (at least 8 characters). They will be signed out.'); if (pw) run(() => post(u, 'reset-password', { password: pw }), 'Password changed')(); } }, 'Reset password'),
          h('button', { class: 'ghost', onclick: () => { if (confirm('Switch off ' + u.name + '? They are signed out right away.')) run(() => post(u, 'disable'), u.name + ' switched off')(); } }, 'Switch off'));
      }
      return h('div', { class: 'card user' },
        h('div', {}, h('div', { class: 'name' }, u.name, ' ', h('span', { class: 'pill ' + cls }, label), u.role === 'ADMIN' ? h('span', { class: 'pill good' }, 'Admin') : null, mine ? h('span', { class: 'pill' }, 'You') : null),
          h('div', { class: 'meta' }, u.email + ' · registered ' + dateOnly(u.createdAt) + (u.decidedBy ? ' · decided by ' + u.decidedBy + ' on ' + dateOnly(u.decidedAt) : '') + (u.lastLoginAt ? ' · last sign-in ' + dateOnly(u.lastLoginAt) : ''))),
        h('div', { class: 'actions' }, acts));
    };
    const group = (title, list, empty) => [h('h2', {}, title + ' (' + list.length + ')'), ...(list.length ? list.map(row) : [h('p', { class: 'muted' }, empty)])];
    pane.replaceChildren(
      ...group('Waiting for approval', users.filter((u) => u.status === 'PENDING'), 'No one is waiting.'),
      ...group('Team', users.filter((u) => u.status === 'APPROVED'), 'No approved members yet.'),
      ...group('Declined or switched off', users.filter((u) => u.status === 'REJECTED' || u.status === 'DISABLED'), 'None.'));
  } catch (err) { pane.replaceChildren(h('p', { class: 'error' }, err.message)); }
}

async function loadStats() {
  try {
    const s = await api('/leads/stats');
    $('stats').replaceChildren(h('span', {}, h('b', {}, s.total), ' partners found'), h('span', {}, h('b', {}, s.last24h), ' in the last 24h'),
      ...STAGES.slice(1).map(([k, label]) => h('span', {}, h('b', {}, (s.byStage || {})[k] || 0), ' ' + label.toLowerCase())));
  } catch { /* stats are a nicety */ }
}

function closeDetail() { $('detail-pane').hidden = true; document.querySelector('.layout').classList.remove('has-detail'); state.selected = null; }

async function renderTab() {
  const pane = $('list-pane');
  pane.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const q = new URLSearchParams({ ...state.filters, ...(state.since ? { since: state.since } : {}), limit: '25', offset: String(state.offset) });
  try {
    const { items, total } = await api('/leads?' + q);
    cards.find ||= findCard();
    const parts = [filterBar()];
    if (state.since) parts.push(h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: () => { state.since = ''; state.offset = 0; renderTab(); } }, 'Show all partners')));
    if (!items.length) parts.push(h('p', { class: 'muted' }, 'Nothing here yet. Press "Find partners" to start.'));
    parts.push(...items.map(leadCard));
    parts.push(h('div', { class: 'row' },
      h('button', { class: 'ghost', disabled: state.offset === 0, onclick: () => { state.offset = Math.max(0, state.offset - 25); renderTab(); } }, 'Previous'),
      h('span', { class: 'muted' }, total ? (state.offset + 1) + '–' + Math.min(state.offset + 25, total) + ' of ' + total : ''),
      h('button', { class: 'ghost', disabled: state.offset + 25 >= total, onclick: () => { state.offset += 25; renderTab(); } }, 'Next')));
    parts.push(cards.find);
    pane.replaceChildren(...parts);
  } catch (err) { pane.replaceChildren(h('p', { class: 'error' }, err.message)); }
}

function filterBar() {
  const platform = h('select', { 'aria-label': 'Platform', onchange: (e) => { if (e.target.value) state.filters.platform = e.target.value; else delete state.filters.platform; state.offset = 0; renderTab(); } },
    h('option', { value: '' }, 'Any platform'), PLATFORMS.map((o) => h('option', { value: o, selected: state.filters.platform === o }, o)));
  const search = h('input', { type: 'search', placeholder: 'Search name, handle, bio', value: state.filters.q || '', onchange: (e) => { if (e.target.value.trim()) state.filters.q = e.target.value.trim(); else delete state.filters.q; state.offset = 0; renderTab(); } });
  const pick = (key, label, options) => h('select', { 'aria-label': label, onchange: (e) => { if (e.target.value) state.filters[key] = e.target.value; else delete state.filters[key]; state.offset = 0; renderTab(); } },
    h('option', { value: '' }, label), options.map(([v, n]) => h('option', { value: v, selected: state.filters[key] === v }, n)));
  return h('div', { class: 'filters' }, search, platform, pick('country', 'Any country', COUNTRIES), pick('language', 'Any language', LANGUAGES));
}

function leadCard(l) {
  const link = safeUrl(l.url);
  return h('div', { class: 'card lead' + (state.selected === l.id ? ' sel' : ''), onclick: () => openLead(l.id) },
    h('div', { class: 'score' }, l.platform.slice(0, 2)),
    h('div', {},
      h('div', { class: 'name' }, l.displayName),
      h('div', { class: 'meta' }, [l.platform, l.followers != null ? num(l.followers) + ' followers' : null, l.country, l.contactEmail].filter(Boolean).join(' · ')),
      l.bio ? h('div', { class: 'meta' }, l.bio.slice(0, 160)) : null),
    h('div', { class: 'row', onclick: (e) => e.stopPropagation() },
      h('select', { 'aria-label': 'Status', class: 'stage ' + (STAGE_CLASS[l.stage] || ''), onchange: (e) => act(() => api('/leads/' + l.id + '/stage', { method: 'POST', body: { stage: e.target.value } }), 'Saved') },
        ROW_STAGES.map(([k, label]) => h('option', { value: k, selected: l.stage === k }, label))),
      link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', class: 'pill' }, 'Open') : null));
}

async function openLead(id) {
  state.selected = id;
  document.querySelectorAll('.lead').forEach((n) => n.classList.remove('sel'));
  const pane = $('detail-pane'); pane.hidden = false; document.querySelector('.layout').classList.add('has-detail');
  pane.replaceChildren(h('div', { class: 'card' }, 'Loading…'));
  try { pane.replaceChildren(detail(await api('/leads/' + id))); pane.scrollTop = 0; } catch (e) { pane.replaceChildren(h('div', { class: 'card error' }, e.message)); }
}

async function act(fn, okMsg) {
  try { await fn(); toast(okMsg); loadStats(); renderTab(); if (state.selected) openLead(state.selected); } catch (e) { toast(e.message, true); }
}

function detail(l) {
  const link = safeUrl(l.url);
  const email = h('input', { type: 'email', value: l.contactEmail || '', placeholder: 'name@example.com', id: 'f-email' });
  const country = h('select', { id: 'f-country' }, h('option', { value: '' }, 'Unknown'), COUNTRIES.map(([v, n]) => h('option', { value: v, selected: (l.country || '').toUpperCase() === v }, n)));
  const bio = h('textarea', { id: 'f-bio' }); bio.value = l.bio || '';
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: closeDetail }, 'Close')),
    h('h2', {}, l.displayName),
    h('div', { class: 'meta' }, l.platform + ' · ' + num(l.followers) + ' followers · ' + (l.country ? (COUNTRIES.find(([c]) => c === l.country.toUpperCase()) || [0, l.country])[1] : 'country unknown') + ' · found via ' + l.source),
    link ? h('p', {}, h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, link)) : null,
    h('h3', {}, 'Details'),
    h('div', { class: 'field' }, h('label', { for: 'f-email' }, 'Public contact email (only one they publish themselves)'), email),
    h('div', { class: 'field' }, h('label', { for: 'f-country' }, 'Country'), country),
    h('div', { class: 'field' }, h('label', { for: 'f-bio' }, 'About'), bio),
    h('div', { class: 'row' },
      h('button', { onclick: () => act(() => api('/leads/' + l.id, { method: 'PATCH', body: { contactEmail: email.value.trim() || null, country: country.value.trim() || null, bio: bio.value } }), 'Saved') }, 'Save details'),
      h('button', { class: 'ghost', onclick: () => { if (confirm('Delete this partner from the list?')) { act(() => api('/leads/' + l.id, { method: 'DELETE' }), 'Deleted').then(closeDetail); } } }, 'Delete')));
}

/** The main button: one click searches the public web with sensible defaults; "Options" lets you steer it. */
function findCard() {
  const box = h('div', { class: 'card' });
  const out = h('div', { class: 'meta', style: 'margin-top:8px' });
  const country = h('select', { 'aria-label': 'Target country' }, h('option', { value: '' }, 'Any country'), COUNTRIES.map(([v, n]) => h('option', { value: v }, n)));
  const language = h('select', { 'aria-label': 'Language' }, h('option', { value: '' }, 'Any language'), LANGUAGES.map(([v, n]) => h('option', { value: n }, n)));
  const focus = h('input', { placeholder: 'Extra focus (optional)', maxlength: 200, style: 'flex:1;min-width:220px' });
  const limit = h('select', { 'aria-label': 'How many' }, [10, 15, 25].map((n) => h('option', { value: n, selected: n === 15 }, 'Up to ' + n)));
  const go = h('button', { id: 'find-btn', style: 'font-size:18px;padding:14px 28px' }, 'Find partners');
  box.append(
    h('div', { class: 'row' }, go, h('span', { class: 'muted' }, 'Searches everywhere that is public: YouTube, Telegram, TikTok, Instagram, Facebook, X, Reddit and websites. Takes about 1–3 minutes.')),
    h('details', {}, h('summary', {}, 'Narrow the search (optional)'), h('div', { class: 'row' }, country, language, focus, limit)),
    h('p', { class: 'meta' }, 'Only public pages are used. Private groups, closed channels and anything behind a login cannot be searched.'),
    out);

  go.addEventListener('click', async () => {
    go.disabled = true; out.textContent = 'Starting…';
    const startedAt = new Date().toISOString();
    try {
      const { jobId } = await api('/discovery/ai', { method: 'POST', body: { country: country.value.trim() || undefined, language: language.value.trim() || undefined, focus: focus.value.trim() || undefined, limit: Number(limit.value) } });
      const began = Date.now();
      for (;;) {
        out.textContent = 'Searching the web… ' + Math.round((Date.now() - began) / 1000) + 's (this usually takes 1–3 minutes)';
        await new Promise((r) => setTimeout(r, 3000));
        const job = await api('/discovery/ai/' + jobId);
        if (job.status === 'running') { if (Date.now() - began > 12 * 60 * 1000) throw new Error('Taking too long — check back later.'); continue; }
        if (job.status === 'failed') throw new Error(job.error || 'The search failed.');
        const r = job.result;
        toast('Found ' + r.created + ' new partners.');
        out.textContent = ''; go.disabled = false;
        state.since = r.created ? startedAt : ''; state.offset = 0; state.filters = {};
        loadStats(); await renderTab();
        cards.find.before(h('div', { class: 'card find-result' },
          h('div', {}, 'Done: ' + r.created + ' new partners, ' + r.updated + ' already known. ' + r.verifiedFromSource + ' checked directly at the source. ' + r.rejected.length + ' suggestions rejected.'),
          r.rejected.length ? h('details', {}, h('summary', {}, 'Why were some rejected?'), h('ul', { class: 'plain' }, r.rejected.map((x) => h('li', {}, x.url + ' — ' + x.reason)))) : null));
        return;
      }
    } catch (e) { out.textContent = e.message; toast(e.message, true); go.disabled = false; }
  });
  return box;
}

start();
