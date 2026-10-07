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
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + store.get('key'), 'x-actor': store.get('actor') || 'manager' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { signOut(); throw new Error('Signed out — check the access key.'); }
  if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join('; ') : data.message || 'Request failed (' + res.status + ')');
  return data;
}

const STAGES = [['FOUND', 'Found'], ['CONTACTED', 'Contacted'], ['IN_PROGRESS', 'In progress'], ['REGISTERED', 'Registered'], ['DECLINED', 'Declined']];
const STAGE_LABEL = Object.fromEntries(STAGES);
const STAGE_CLASS = { FOUND: '', CONTACTED: 'warn', IN_PROGRESS: 'warn', REGISTERED: 'good', DECLINED: 'bad' };
const PLATFORMS = ['YOUTUBE', 'X', 'TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'REDDIT', 'TELEGRAM', 'WEBSITE'];

// Built once so a running search keeps showing its progress when the list below refreshes.
const cards = {};
const state = { filters: {}, selected: null, offset: 0, since: '' };

function signOut() { for (const k of Object.keys(cards)) delete cards[k]; store.del('key'); $('app').hidden = true; $('login').hidden = false; $('logout').hidden = true; $('stats').replaceChildren(); }

async function start() {
  $('actor').value = store.get('actor');
  $('actor').addEventListener('change', () => store.set('actor', $('actor').value.trim()));
  $('logout').addEventListener('click', signOut);
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    store.set('key', $('key').value); $('key').value = '';
    try { await api('/leads/stats'); $('login-error').textContent = ''; showApp(); } catch (err) { $('login-error').textContent = err.message; signOut(); }
  });
  if (store.get('key')) { try { await api('/leads/stats'); return showApp(); } catch { /* fall through to login */ } }
  signOut();
}

function showApp() {
  $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false;
  loadStats(); renderTab();
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
    cards.find ||= findCard(); cards.links ||= linksCard();
    const parts = [cards.find, cards.links, filterBar()];
    if (state.since) parts.push(h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: () => { state.since = ''; state.offset = 0; renderTab(); } }, 'Show all partners')));
    if (!items.length) parts.push(h('p', { class: 'muted' }, 'Nothing here yet. Press "Find partners" to start.'));
    parts.push(...items.map(leadCard));
    parts.push(h('div', { class: 'row' },
      h('button', { class: 'ghost', disabled: state.offset === 0, onclick: () => { state.offset = Math.max(0, state.offset - 25); renderTab(); } }, 'Previous'),
      h('span', { class: 'muted' }, total ? (state.offset + 1) + '–' + Math.min(state.offset + 25, total) + ' of ' + total : ''),
      h('button', { class: 'ghost', disabled: state.offset + 25 >= total, onclick: () => { state.offset += 25; renderTab(); } }, 'Next')));
    pane.replaceChildren(...parts);
  } catch (err) { pane.replaceChildren(h('p', { class: 'error' }, err.message)); }
}

function filterBar() {
  const platform = h('select', { 'aria-label': 'Platform', onchange: (e) => { if (e.target.value) state.filters.platform = e.target.value; else delete state.filters.platform; state.offset = 0; renderTab(); } },
    h('option', { value: '' }, 'Any platform'), PLATFORMS.map((o) => h('option', { value: o, selected: state.filters.platform === o }, o)));
  const search = h('input', { type: 'search', placeholder: 'Search name, handle, bio', value: state.filters.q || '', onchange: (e) => { if (e.target.value.trim()) state.filters.q = e.target.value.trim(); else delete state.filters.q; state.offset = 0; renderTab(); } });
  const stage = h('select', { 'aria-label': 'Stage', onchange: (e) => { if (e.target.value) state.filters.stage = e.target.value; else delete state.filters.stage; state.offset = 0; renderTab(); } },
    h('option', { value: '' }, 'Any stage'), STAGES.map(([k, label]) => h('option', { value: k, selected: state.filters.stage === k }, label)));
  return h('div', { class: 'filters' }, search, platform, stage);
}

function leadCard(l) {
  const link = safeUrl(l.url);
  return h('div', { class: 'card lead' + (state.selected === l.id ? ' sel' : ''), onclick: () => openLead(l.id) },
    h('div', { class: 'score' }, l.platform.slice(0, 2)),
    h('div', {},
      h('div', { class: 'name' }, l.displayName),
      h('div', { class: 'meta' }, [l.platform, l.followers != null ? num(l.followers) + ' followers' : null, l.country, l.contactEmail].filter(Boolean).join(' · ')),
      l.bio ? h('div', { class: 'meta' }, l.bio.slice(0, 160)) : null),
    h('div', {}, h('span', { class: 'pill ' + (STAGE_CLASS[l.stage] || '') }, STAGE_LABEL[l.stage] || l.stage),
      link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', class: 'pill', onclick: (e) => e.stopPropagation() }, 'Open') : null));
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
  const country = h('input', { value: l.country || '', maxlength: 2, size: 3, placeholder: 'KE', id: 'f-country' });
  const bio = h('textarea', { id: 'f-bio' }); bio.value = l.bio || '';
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: closeDetail }, 'Close')),
    h('h2', {}, l.displayName),
    h('div', { class: 'meta' }, l.platform + ' · ' + num(l.followers) + ' followers · ' + (l.country || 'country unknown') + ' · found via ' + l.source),
    link ? h('p', {}, h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, link)) : null,
    h('h3', {}, 'Partner stage'),
    h('p', { class: 'meta' }, 'Update this as your team reaches out. The app never contacts anyone itself.'),
    h('div', { class: 'row' }, STAGES.map(([k, label]) => h('button', { class: l.stage === k ? 'good' : 'ghost', disabled: l.stage === k,
      onclick: () => act(() => api('/leads/' + l.id + '/stage', { method: 'POST', body: { stage: k, note: ($('f-note').value.trim() || undefined) } }), 'Marked as ' + label.toLowerCase()) }, label))),
    h('div', { class: 'field' }, h('label', { for: 'f-note' }, 'Note (optional)'), h('input', { id: 'f-note', maxlength: 400, placeholder: 'e.g. emailed on Monday, waiting for reply', value: l.stageNote || '' })),
    l.stageBy ? h('p', { class: 'meta' }, 'Last updated by ' + l.stageBy + (l.stageAt ? ' on ' + l.stageAt.slice(0, 10) : '')) : null,
    h('h3', {}, 'Details'),
    h('div', { class: 'field' }, h('label', { for: 'f-email' }, 'Public contact email (only one they publish themselves)'), email),
    h('div', { class: 'field' }, h('label', { for: 'f-country' }, 'Country (2-letter code)'), country),
    h('div', { class: 'field' }, h('label', { for: 'f-bio' }, 'About'), bio),
    h('div', { class: 'row' },
      h('button', { onclick: () => act(() => api('/leads/' + l.id, { method: 'PATCH', body: { contactEmail: email.value.trim() || null, country: country.value.trim() || null, bio: bio.value } }), 'Saved') }, 'Save details'),
      h('button', { class: 'ghost', onclick: () => { if (confirm('Delete this partner from the list?')) { act(() => api('/leads/' + l.id, { method: 'DELETE' }), 'Deleted').then(closeDetail); } } }, 'Delete')));
}

/** The main button: one click searches the public web with sensible defaults; "Options" lets you steer it. */
function findCard() {
  const box = h('div', { class: 'card' });
  const out = h('div', { class: 'meta', style: 'margin-top:8px' });
  const country = h('input', { placeholder: 'Target country e.g. KE', maxlength: 2, size: 20 });
  const language = h('input', { placeholder: 'Language e.g. Swahili', maxlength: 40 });
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
        $('list-pane').prepend(h('div', { class: 'card find-result' },
          h('div', {}, 'Done: ' + r.created + ' new partners, ' + r.updated + ' already known. ' + r.verifiedFromSource + ' checked directly at the source. ' + r.rejected.length + ' suggestions rejected.'),
          r.rejected.length ? h('details', {}, h('summary', {}, 'Why were some rejected?'), h('ul', { class: 'plain' }, r.rejected.map((x) => h('li', {}, x.url + ' — ' + x.reason)))) : null));
        return;
      }
    } catch (e) { out.textContent = e.message; toast(e.message, true); go.disabled = false; }
  });
  return box;
}

/** Adding a partner you found yourself: paste one or more links. */
function linksCard() {
  const out = h('div', { class: 'meta' });
  const urls = h('textarea', { placeholder: 'Paste links, one per line: YouTube, Telegram, TikTok, Instagram, Facebook, X, Reddit or a website' });
  const add = h('button', { class: 'ghost', onclick: async () => {
    out.textContent = 'Working…';
    try {
      const r = await api('/discovery/urls', { method: 'POST', body: { urls: urls.value.split(/\s*\n\s*/).map((x) => x.trim()).filter(Boolean) } });
      out.replaceChildren(...r.results.map((x) => h('div', {}, (x.status === 'saved' ? '✓ ' : '✗ ') + x.url + (x.note ? ' — ' + x.note : ''))));
      urls.value = ''; loadStats();
    } catch (e) { out.textContent = e.message; toast(e.message, true); }
  } }, 'Add links');
  return h('details', { class: 'card' }, h('summary', {}, 'Add partners by link'), urls, h('div', { class: 'row' }, add), out);
}

start();
