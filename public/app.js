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

const TABS = [
  { id: 'partners', label: 'Partners' },
  { id: 'add', label: 'Add leads' },
];
const STAGES = [['FOUND', 'Found'], ['CONTACTED', 'Contacted'], ['IN_PROGRESS', 'In progress'], ['REGISTERED', 'Registered'], ['DECLINED', 'Declined']];
const STAGE_LABEL = Object.fromEntries(STAGES);
const STAGE_CLASS = { FOUND: '', CONTACTED: 'warn', IN_PROGRESS: 'warn', REGISTERED: 'good', DECLINED: 'bad' };
const PLATFORMS = ['YOUTUBE', 'X', 'TIKTOK', 'INSTAGRAM', 'REDDIT', 'TELEGRAM', 'WEBSITE'];

const state = { tab: 'partners', filters: {}, selected: null, offset: 0, since: '' };

function signOut() { store.del('key'); $('app').hidden = true; $('login').hidden = false; $('logout').hidden = true; $('stats').replaceChildren(); }

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
  renderTabs(); loadStats(); renderTab();
}

async function loadStats() {
  try {
    const s = await api('/leads/stats');
    $('stats').replaceChildren(h('span', {}, h('b', {}, s.total), ' partners found'), h('span', {}, h('b', {}, s.last24h), ' in the last 24h'),
      ...STAGES.slice(1).map(([k, label]) => h('span', {}, h('b', {}, (s.byStage || {})[k] || 0), ' ' + label.toLowerCase())));
  } catch { /* stats are a nicety */ }
}

function renderTabs() {
  $('tabs').replaceChildren(...TABS.map((t) => h('button', { class: state.tab === t.id ? 'on' : '', onclick: () => { state.tab = t.id; state.offset = 0; closeDetail(); renderTabs(); renderTab(); } }, t.label)));
}

function closeDetail() { $('detail-pane').hidden = true; document.querySelector('.layout').classList.remove('has-detail'); state.selected = null; }

async function renderTab() {
  const pane = $('list-pane');
  if (state.tab === 'add') return renderAdd(pane);
  pane.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const q = new URLSearchParams({ ...state.filters, ...(state.since ? { since: state.since } : {}), limit: '25', offset: String(state.offset) });
  try {
    const { items, total } = await api('/leads?' + q);
    const parts = [findCard(), filterBar()];
    parts.push(h('div', { class: 'row' }, h('button', { class: 'ghost', disabled: !total, onclick: () => exportCsv(q) }, 'Export to CSV (' + total + ')'),
      state.since ? h('button', { class: 'ghost', onclick: () => { state.since = ''; state.offset = 0; renderTab(); } }, 'Show all partners') : null));
    if (!items.length) parts.push(h('p', { class: 'muted' }, 'Nothing here yet. Press "Find partners" to start.'));
    parts.push(...items.map(leadCard));
    parts.push(h('div', { class: 'row' },
      h('button', { class: 'ghost', disabled: state.offset === 0, onclick: () => { state.offset = Math.max(0, state.offset - 25); renderTab(); } }, 'Previous'),
      h('span', { class: 'muted' }, total ? (state.offset + 1) + '–' + Math.min(state.offset + 25, total) + ' of ' + total : ''),
      h('button', { class: 'ghost', disabled: state.offset + 25 >= total, onclick: () => { state.offset += 25; renderTab(); } }, 'Next')));
    pane.replaceChildren(...parts);
  } catch (err) { pane.replaceChildren(h('p', { class: 'error' }, err.message)); }
}

async function exportCsv(q) {
  try {
    const params = new URLSearchParams(q); params.delete('limit'); params.delete('offset');
    const res = await fetch('/leads/export?' + params, { headers: { Authorization: 'Bearer ' + store.get('key') } });
    if (!res.ok) throw new Error('Export failed (' + res.status + ')');
    const url = URL.createObjectURL(await res.blob());
    const a = h('a', { href: url, download: 'partner-leads.csv' }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Downloaded partner-leads.csv');
  } catch (e) { toast(e.message, true); }
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

const AI_DEFAULTS = ['FOOTBALL_CHANNELS', 'PREDICTION_CREATORS', 'TELEGRAM_CHANNELS', 'YOUTUBE_CHANNELS'];

/** The main button: one click searches the public web with sensible defaults; "Options" lets you steer it. */
function findCard() {
  const box = h('div', { class: 'card' });
  const out = h('div', { class: 'meta', style: 'margin-top:8px' });
  const checks = [];
  const country = h('input', { placeholder: 'Target country e.g. KE', maxlength: 2, size: 20 });
  const language = h('input', { placeholder: 'Language e.g. Swahili', maxlength: 40 });
  const focus = h('input', { placeholder: 'Extra focus (optional)', maxlength: 200, style: 'flex:1;min-width:220px' });
  const limit = h('select', { 'aria-label': 'How many' }, [10, 15, 25].map((n) => h('option', { value: n, selected: n === 15 }, 'Up to ' + n)));
  const go = h('button', { id: 'find-btn', style: 'font-size:18px;padding:14px 28px' }, 'Find partners');
  const grid = h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Loading categories…'));
  box.append(
    h('div', { class: 'row' }, go, h('span', { class: 'muted' }, 'Searches the public web for football, tipster and betting partners. Takes about 1–3 minutes.')),
    h('details', {}, h('summary', {}, 'Options'), grid, h('div', { class: 'row' }, country, language, focus, limit)),
    out);

  api('/discovery/ai/segments').then((segs) => {
    grid.replaceChildren(...Object.entries(segs).map(([key, label]) => {
      const cb = h('input', { type: 'checkbox', value: key, id: 'seg-' + key }); cb.checked = AI_DEFAULTS.includes(key); checks.push(cb);
      return h('label', { class: 'pill', for: 'seg-' + key, style: 'cursor:pointer' }, cb, ' ' + label);
    }));
  }).catch((e) => { grid.textContent = e.message; });

  go.addEventListener('click', async () => {
    // Before the category list has loaded (or if nothing is ticked) fall back to the defaults.
    let segments = checks.filter((c) => c.checked).map((c) => c.value);
    if (!segments.length) segments = checks.length ? [] : AI_DEFAULTS;
    if (!segments.length) return toast('Pick at least one category under Options.', true);
    go.disabled = true; out.textContent = 'Starting…';
    const startedAt = new Date().toISOString();
    try {
      const { jobId } = await api('/discovery/ai', { method: 'POST', body: { segments, country: country.value.trim() || undefined, language: language.value.trim() || undefined, focus: focus.value.trim() || undefined, limit: Number(limit.value) } });
      const began = Date.now();
      for (;;) {
        out.textContent = 'Searching the web… ' + Math.round((Date.now() - began) / 1000) + 's (this usually takes 1–3 minutes)';
        await new Promise((r) => setTimeout(r, 3000));
        const job = await api('/discovery/ai/' + jobId);
        if (job.status === 'running') { if (Date.now() - began > 12 * 60 * 1000) throw new Error('Taking too long — check back later.'); continue; }
        if (job.status === 'failed') throw new Error(job.error || 'The search failed.');
        const r = job.result;
        toast('Found ' + r.created + ' new partners.');
        state.since = startedAt; state.offset = 0; state.filters = {};
        loadStats(); await renderTab();
        const note = $('list-pane').querySelector('.find-result');
        if (note) note.remove();
        $('list-pane').prepend(h('div', { class: 'card find-result' },
          h('div', {}, 'Done: ' + r.created + ' new partners, ' + r.updated + ' already known. ' + r.verifiedFromSource + ' checked directly at the source. ' + r.rejected.length + ' suggestions rejected.'),
          r.rejected.length ? h('details', {}, h('summary', {}, 'Why were some rejected?'), h('ul', { class: 'plain' }, r.rejected.map((x) => h('li', {}, x.url + ' — ' + x.reason)))) : null));
        return;
      }
    } catch (e) { out.textContent = e.message; toast(e.message, true); go.disabled = false; }
  });
  return box;
}

function renderAdd(pane) {
  closeDetail();
  const out = h('div', { class: 'meta' });
  const yq = h('input', { placeholder: 'e.g. football betting tips', maxlength: 120, style: 'flex:1;min-width:200px' });
  const yr = h('input', { placeholder: 'Region e.g. KE', maxlength: 2, size: 6 });
  const urls = h('textarea', { placeholder: 'Paste links, one per line: YouTube channels, Telegram channels, websites, or TikTok / Instagram / X profiles' });
  const csv = h('textarea', { placeholder: 'platform,handle,name,followers,country,email,bio\nyoutube,@footballtips,Football Tips,52000,KE,hello@example.com,"Weekly picks"' });
  const file = h('input', { type: 'file', accept: '.csv,text/csv', onchange: async (e) => { const f = e.target.files[0]; if (f) csv.value = await f.text(); } });
  const show = (lines) => out.replaceChildren(...lines.map((t) => h('div', {}, t)));
  const guard = async (p, f) => { out.textContent = 'Working…'; try { show(f(await p())); loadStats(); } catch (e) { out.textContent = e.message; toast(e.message, true); } };

  pane.replaceChildren(
    h('div', { class: 'card', style: 'margin-top:12px' }, h('h2', {}, 'Search YouTube'), h('p', { class: 'muted' }, 'Finds channels by keyword (needs YOUTUBE_API_KEY on the server).'),
      h('div', { class: 'row' }, yq, yr, h('button', { onclick: () => guard(() => api('/discovery/youtube', { method: 'POST', body: { query: yq.value.trim(), limit: 20, regionCode: yr.value.trim() || undefined } }), (r) => ['Found ' + r.found + ' channels: ' + r.created + ' new, ' + r.updated + ' already known.']) }, 'Search'))),
    h('div', { class: 'card', style: 'margin-top:12px' }, h('h2', {}, 'Paste links'), urls,
      h('div', { class: 'row' }, h('button', { onclick: () => guard(() => api('/discovery/urls', { method: 'POST', body: { urls: urls.value.split(/\s*\n\s*/).map((s) => s.trim()).filter(Boolean) } }), (r) => r.results.map((x) => (x.status === 'saved' ? '✓ ' : '✗ ') + x.url + (x.note ? ' — ' + x.note : ''))) }, 'Add links'))),
    h('div', { class: 'card', style: 'margin-top:12px' }, h('h2', {}, 'Import a spreadsheet (CSV)'), h('p', { class: 'muted' }, 'Use this for TikTok, Instagram and X, which cannot be read automatically. Columns: platform, handle, name, followers, country, email, bio, url.'),
      file, csv, h('div', { class: 'row' }, h('button', { onclick: () => guard(() => api('/discovery/import', { method: 'POST', body: { format: 'csv', data: csv.value } }), (r) => ['Imported: ' + r.created + ' new, ' + r.updated + ' updated.', ...r.errors.map((e) => 'Row ' + e.row + ': ' + e.message)]) }, 'Import'))),
    h('div', { class: 'card', style: 'margin-top:12px' }, out));
}

start();
