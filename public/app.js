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
  { id: 'review', label: 'To review', query: { status: 'SCORED', priority: 'true' } },
  { id: 'all', label: 'All leads', query: {}, filters: true },
  { id: 'approved', label: 'Approved', query: { status: 'APPROVED' } },
  { id: 'contacted', label: 'Contacted', query: { status: 'CONTACTED' } },
  { id: 'attention', label: 'Needs attention', query: { needsAttention: 'true' } },
  { id: 'add', label: 'Add leads' },
];
const STATUSES = ['NEW', 'SCORED', 'APPROVED', 'REJECTED', 'CONTACTED', 'REPLIED', 'DO_NOT_CONTACT'];
const PLATFORMS = ['YOUTUBE', 'X', 'TIKTOK', 'INSTAGRAM', 'REDDIT', 'TELEGRAM', 'WEBSITE'];
const FLAG_TEXT = {
  AUDIENCE_INCLUDES_MINORS: 'Audience may include under-18s', FIXED_MATCH_SCAM: 'Sells "fixed matches" / sure tips', ILLEGAL_OR_HATEFUL: 'Illegal or hateful content',
  GUARANTEED_WINS_CLAIMS: 'Promises guaranteed wins', FAKE_ENGAGEMENT: 'Signs of fake engagement', SPAM_OR_LOW_QUALITY: 'Spam / low quality', ADULT_CONTENT: 'Adult content',
  OUTSIDE_TARGET_MARKETS: 'Outside target markets',
};
const HARD = new Set(['AUDIENCE_INCLUDES_MINORS', 'FIXED_MATCH_SCAM', 'ILLEGAL_OR_HATEFUL', 'OUTSIDE_TARGET_MARKETS']);

const state = { tab: 'review', filters: {}, selected: null, offset: 0 };

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
    const by = s.byStatus || {};
    $('stats').replaceChildren(
      h('span', {}, h('b', {}, s.awaitingReviewPriority), ' priority leads waiting'),
      h('span', {}, h('b', {}, by.SCORED || 0), ' scored'), h('span', {}, h('b', {}, by.NEW || 0), ' unscored'),
      h('span', {}, h('b', {}, by.APPROVED || 0), ' approved'), h('span', {}, h('b', {}, by.CONTACTED || 0), ' contacted'),
      h('span', {}, h('b', {}, by.REPLIED || 0), ' replied'),
      s.needsAttention ? h('span', { class: 'pill warn' }, s.needsAttention + ' need attention') : null,
    );
  } catch { /* stats are a nicety */ }
}

function renderTabs() {
  $('tabs').replaceChildren(...TABS.map((t) => h('button', { class: state.tab === t.id ? 'on' : '', onclick: () => { state.tab = t.id; state.selected = null; state.offset = 0; closeDetail(); renderTabs(); renderTab(); } }, t.label)));
}

function closeDetail() { $('detail-pane').hidden = true; document.querySelector('.layout').classList.remove('has-detail'); state.selected = null; }

async function renderTab() {
  const tab = TABS.find((t) => t.id === state.tab);
  const pane = $('list-pane');
  if (tab.id === 'add') return renderAdd(pane);
  pane.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const q = new URLSearchParams({ ...tab.query, ...(tab.filters ? state.filters : {}), limit: '25', offset: String(state.offset) });
  try {
    const { items, total } = await api('/leads?' + q);
    const parts = [];
    if (tab.filters) parts.push(filterBar());
    if (tab.id === 'review') parts.push(h('div', { class: 'row' }, h('button', { onclick: runScoring }, 'Score new leads')));
    if (!items.length) parts.push(h('p', { class: 'muted' }, tab.id === 'review' ? 'Nothing waiting. Add leads, then press "Score new leads".' : 'No leads here.'));
    parts.push(...items.map(leadCard));
    parts.push(h('div', { class: 'row' },
      h('button', { class: 'ghost', disabled: state.offset === 0, onclick: () => { state.offset = Math.max(0, state.offset - 25); renderTab(); } }, 'Previous'),
      h('span', { class: 'muted' }, total ? (state.offset + 1) + '–' + Math.min(state.offset + 25, total) + ' of ' + total : ''),
      h('button', { class: 'ghost', disabled: state.offset + 25 >= total, onclick: () => { state.offset += 25; renderTab(); } }, 'Next')));
    pane.replaceChildren(...parts);
  } catch (err) { pane.replaceChildren(h('p', { class: 'error' }, err.message)); }
}

function filterBar() {
  const sel = (key, label, options) => h('select', { 'aria-label': label, onchange: (e) => { if (e.target.value) state.filters[key] = e.target.value; else delete state.filters[key]; state.offset = 0; renderTab(); } },
    h('option', { value: '' }, label), options.map((o) => h('option', { value: o, selected: state.filters[key] === o }, o)));
  const search = h('input', { type: 'search', placeholder: 'Search name, handle, bio', value: state.filters.q || '', onchange: (e) => { if (e.target.value.trim()) state.filters.q = e.target.value.trim(); else delete state.filters.q; state.offset = 0; renderTab(); } });
  return h('div', { class: 'filters' }, search, sel('status', 'Any status', STATUSES), sel('platform', 'Any platform', PLATFORMS),
    sel('minScore', 'Any score', ['50', '60', '70', '80']));
}

function scoreBadge(score) {
  const cls = score == null ? '' : score >= 70 ? 'hi' : score >= 45 ? 'mid' : 'lo';
  return h('div', { class: 'score ' + cls }, score == null ? '—' : score);
}

function flagPills(flags) { return (flags || []).map((f) => h('span', { class: 'pill ' + (HARD.has(f) ? 'bad' : 'warn') }, FLAG_TEXT[f] || f)); }

function leadCard(l) {
  return h('div', { class: 'card lead' + (state.selected === l.id ? ' sel' : ''), onclick: () => openLead(l.id) },
    scoreBadge(l.score),
    h('div', {},
      h('div', { class: 'name' }, l.displayName),
      h('div', { class: 'meta' }, [l.platform, num(l.followers) + ' followers', l.country, l.category && l.category.replaceAll('_', ' ').toLowerCase()].filter(Boolean).join(' · ')),
      l.summary ? h('div', { class: 'meta' }, l.summary) : l.scoreError ? h('div', { class: 'meta' }, '⚠ ' + l.scoreError) : null,
      h('div', {}, flagPills(l.redFlags))),
    h('span', { class: 'pill' + (l.isPriority ? ' good' : '') }, l.isPriority ? 'PRIORITY' : l.status));
}

async function runScoring() {
  try { toast('Scoring…'); const r = await api('/classification/run', { method: 'POST', body: {} });
    toast(r.alreadyRunning ? 'A scoring run is already in progress.' : 'Scored ' + r.scored + (r.failed ? ', ' + r.failed + ' need attention' : '') + '.'); loadStats(); renderTab(); }
  catch (e) { toast(e.message, true); }
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

function bar(label, v, w) { return h('div', { class: 'bar' }, h('span', { style: 'background:none' }, label + (w != null ? ' ×' + w : '')), h('span', {}, h('i', { style: 'width:' + Math.max(0, Math.min(100, v)) + '%' })), h('b', {}, v)); }

function detail(l) {
  const b = l.breakdown;
  const link = safeUrl(l.url);
  const email = h('input', { type: 'email', value: l.contactEmail || '', placeholder: 'name@example.com', id: 'f-email' });
  const country = h('input', { value: l.country || '', maxlength: 2, size: 3, placeholder: 'KE', id: 'f-country' });
  const bio = h('textarea', { id: 'f-bio' }); bio.value = l.bio || '';
  const canDecide = ['NEW', 'SCORED', 'APPROVED', 'REJECTED'].includes(l.status);
  const blocked = (l.redFlags || []).some((f) => HARD.has(f));
  const final = ['DO_NOT_CONTACT'].includes(l.status);

  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: closeDetail }, 'Close')),
    h('div', { class: 'lead', style: 'cursor:default;padding:0;margin:0;border:0' }, scoreBadge(l.score),
      h('div', {}, h('h2', {}, l.displayName), h('div', { class: 'meta' }, l.platform + ' · ' + num(l.followers) + ' followers · ' + (l.country || 'country unknown') + ' · ' + l.status)), h('span', {})),
    link ? h('p', {}, h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, link)) : null,
    l.summary ? h('p', {}, l.summary) : l.scoreError ? h('div', { class: 'banner' }, l.scoreError) : null,
    h('div', {}, flagPills(l.redFlags)),
    blocked ? h('div', { class: 'banner' }, 'This lead has a disqualifying flag and cannot be approved.') : null,
    b ? h('div', {}, h('h3', {}, 'Score breakdown (weight)'),
      bar('Audience fit', b.sub.audienceRelevance, b.weights.audienceRelevance), bar('Content fit', b.sub.contentFit, b.weights.contentFit),
      bar('Credibility', b.sub.credibility, b.weights.credibility), bar('Promo experience', b.sub.promoExperience, b.weights.promoExperience),
      bar('Reach', b.sub.reach, b.weights.reach), b.capReason ? h('div', { class: 'banner' }, 'Score capped at ' + b.cap + ': ' + b.capReason) : null) : null,
    l.strengths.length ? h('div', {}, h('h3', {}, 'Strengths'), h('ul', { class: 'plain' }, l.strengths.map((s) => h('li', {}, s)))) : null,
    l.concerns.length ? h('div', {}, h('h3', {}, 'Concerns'), h('ul', { class: 'plain' }, l.concerns.map((s) => h('li', {}, s)))) : null,
    l.reviewedBy ? h('p', { class: 'meta' }, 'Last decision by ' + l.reviewedBy + (l.reviewNote ? ': ' + l.reviewNote : '')) : null,

    h('h3', {}, 'Decision'),
    h('div', { class: 'row' },
      canDecide && l.status !== 'APPROVED' ? h('button', { class: 'good', disabled: !l.scoredAt || blocked, onclick: () => act(() => api('/leads/' + l.id + '/approve', { method: 'POST', body: { note: noteVal() } }), 'Approved') }, 'Approve') : null,
      canDecide && l.status !== 'REJECTED' ? h('button', { class: 'ghost', onclick: () => act(() => api('/leads/' + l.id + '/reject', { method: 'POST', body: { note: noteVal() } }), 'Rejected') }, 'Reject') : null,
      l.status === 'CONTACTED' ? h('button', { onclick: () => act(() => api('/leads/' + l.id + '/replied', { method: 'POST', body: {} }), 'Marked as replied') }, 'They replied') : null,
      !final ? h('button', { class: 'bad', onclick: () => { if (confirm('Mark as do-not-contact? This is permanent and blocks their email.')) act(() => api('/leads/' + l.id + '/do-not-contact', { method: 'POST', body: { note: noteVal() } }), 'Marked do-not-contact'); } }, 'Do not contact') : null,
      !final ? h('button', { class: 'ghost', onclick: () => act(() => api('/leads/' + l.id + '/rescore', { method: 'POST' }), 'Re-scored') }, 'Re-score') : null),
    h('div', { class: 'field' }, h('label', { for: 'f-note' }, 'Note (optional)'), h('input', { id: 'f-note', maxlength: 400, placeholder: 'Why?' })),

    h('h3', {}, 'Contact details'),
    h('div', { class: 'field' }, h('label', { for: 'f-email' }, 'Email (only use one they publish themselves)'), email),
    h('div', { class: 'field' }, h('label', { for: 'f-country' }, 'Country (2-letter code)'), country),
    h('div', { class: 'field' }, h('label', { for: 'f-bio' }, 'Bio / description'), bio),
    h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: () => act(() => api('/leads/' + l.id, { method: 'PATCH', body: { contactEmail: email.value.trim() || null, country: country.value.trim() || null, bio: bio.value } }), 'Saved') }, 'Save details')),

    l.status === 'APPROVED' || l.outreach.length ? outreachSection(l) : null);
}
const noteVal = () => ($('f-note') ? $('f-note').value.trim() || undefined : undefined);

function outreachSection(l) {
  const open = l.outreach.find((o) => o.status === 'DRAFT' || o.status === 'APPROVED');
  return h('div', {}, h('h3', {}, 'Outreach'),
    l.status === 'APPROVED' && !open ? h('div', { class: 'row' }, h('button', { disabled: !l.contactEmail, onclick: () => act(() => api('/leads/' + l.id + '/outreach/draft', { method: 'POST' }), 'Draft written — review it below'), title: l.contactEmail ? '' : 'Add an email first' }, 'Write draft with AI'), l.contactEmail ? null : h('span', { class: 'muted' }, 'Add a contact email first.')) : null,
    open ? draftEditor(open) : null,
    l.outreach.filter((o) => o !== open).map((o) => h('p', { class: 'meta' }, o.status + ' · ' + new Date(o.createdAt).toLocaleDateString() + ' · ' + o.subject + (o.error ? ' — ' + o.error : ''))));
}

function draftEditor(o) {
  const subject = h('input', { value: o.subject, maxlength: 150, style: 'width:100%' });
  const body = h('textarea', {}); body.value = o.body;
  const edited = () => subject.value !== o.subject || body.value !== o.body;
  return h('div', {},
    o.status === 'APPROVED' ? h('div', { class: 'banner' }, 'Approved. Editing it will cancel the approval.') : null,
    h('div', { class: 'field' }, h('label', {}, 'Subject'), subject), h('div', { class: 'field' }, h('label', {}, 'Message (the unsubscribe link, address and 18+ notice are added automatically)'), body),
    ...(o.warnings || []).map((w) => h('div', { class: 'banner' }, '⚠ ' + w)),
    h('div', { class: 'row' },
      h('button', { class: 'ghost', onclick: () => act(() => api('/outreach/' + o.id, { method: 'PATCH', body: { subject: subject.value, body: body.value } }), 'Draft saved') }, 'Save draft'),
      o.status === 'DRAFT' ? h('button', { class: 'good', onclick: async () => { if (edited()) { try { await api('/outreach/' + o.id, { method: 'PATCH', body: { subject: subject.value, body: body.value } }); } catch (e) { return toast(e.message, true); } } act(() => api('/outreach/' + o.id + '/approve', { method: 'POST' }), 'Message approved'); } }, 'Approve this exact message') : null,
      o.status === 'APPROVED' ? h('button', { onclick: sendIt(o) }, 'Send') : null),
    h('details', {}, h('summary', {}, 'Preview exactly what they will receive'), h('pre', {}, 'To: ' + o.toEmail + '\nSubject: ' + o.subject + '\n\n' + o.fullText)));
}

function sendIt(o) {
  return async () => {
    if (!confirm('Send this email to ' + o.toEmail + '? This cannot be undone.')) return;
    try {
      const r = await api('/outreach/' + o.id + '/send', { method: 'POST' });
      if (r.dryRun) { alert('DRY RUN — nothing was sent.\n\n' + r.note + '\n\nTo: ' + r.to + '\nSubject: ' + r.subject + '\n\n' + r.text); }
      else toast('Sent to ' + r.to);
      loadStats(); renderTab(); openLead(state.selected);
    } catch (e) { toast(e.message, true); }
  };
}

const AI_DEFAULTS = ['FOOTBALL_CHANNELS', 'PREDICTION_CREATORS', 'TELEGRAM_CHANNELS', 'YOUTUBE_CHANNELS'];
function aiCard() {
  const box = h('div', { class: 'card' }, h('h2', {}, 'Find partners with AI'),
    h('p', { class: 'muted' }, 'Claude searches the public web for candidates in the categories you pick. Public pages only. Every result is checked against the real search results before it is saved, and nothing is contacted.'));
  const out = h('div', { class: 'meta', style: 'margin-top:8px' });
  const checks = [];
  const country = h('input', { placeholder: 'Target country e.g. KE', maxlength: 2, size: 20 });
  const language = h('input', { placeholder: 'Language e.g. Swahili', maxlength: 40 });
  const focus = h('input', { placeholder: 'Extra focus (optional)', maxlength: 200, style: 'flex:1;min-width:220px' });
  const limit = h('select', { 'aria-label': 'How many' }, [10, 15, 25].map((n) => h('option', { value: n, selected: n === 15 }, 'Up to ' + n)));
  const go = h('button', { disabled: true }, 'Search the web');
  const grid = h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Loading categories…'));
  box.append(grid, h('div', { class: 'row' }, country, language, focus, limit, go), out);

  api('/discovery/ai/segments').then((segs) => {
    grid.replaceChildren(...Object.entries(segs).map(([key, label]) => {
      const cb = h('input', { type: 'checkbox', value: key, id: 'seg-' + key }); cb.checked = AI_DEFAULTS.includes(key); checks.push(cb);
      return h('label', { class: 'pill', for: 'seg-' + key, style: 'cursor:pointer' }, cb, ' ' + label);
    }));
    go.disabled = false;
  }).catch((e) => { grid.textContent = e.message; });

  go.addEventListener('click', async () => {
    const segments = checks.filter((c) => c.checked).map((c) => c.value);
    if (!segments.length) return toast('Pick at least one category.', true);
    go.disabled = true; out.textContent = 'Starting…';
    try {
      const { jobId } = await api('/discovery/ai', { method: 'POST', body: { segments, country: country.value.trim() || undefined, language: language.value.trim() || undefined, focus: focus.value.trim() || undefined, limit: Number(limit.value) } });
      const began = Date.now();
      out.textContent = 'Searching the web… (this usually takes 1–3 minutes)';
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000));
        const job = await api('/discovery/ai/' + jobId);
        if (job.status === 'running') { out.textContent = 'Searching the web… ' + Math.round((Date.now() - began) / 1000) + 's (this usually takes 1–3 minutes)'; if (Date.now() - began > 12 * 60 * 1000) throw new Error('Taking too long — check back later.'); continue; }
        if (job.status === 'failed') throw new Error(job.error || 'The search failed.');
        const r = job.result;
        out.replaceChildren(h('div', {}, 'Done: ' + r.created + ' new leads, ' + r.updated + ' already known. ' + r.verifiedFromSource + ' checked directly at the source. ' + r.rejected.length + ' suggestions rejected.'),
          h('div', {}, 'Open "To review" after pressing "Score new leads" to see how they rate.'),
          r.rejected.length ? h('details', {}, h('summary', {}, 'Why were some rejected?'), h('ul', { class: 'plain' }, r.rejected.map((x) => h('li', {}, x.url + ' — ' + x.reason)))) : null);
        loadStats(); break;
      }
    } catch (e) { out.textContent = e.message; toast(e.message, true); }
    go.disabled = false;
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
    aiCard(),
    h('div', { class: 'card', style: 'margin-top:12px' }, h('h2', {}, 'Search YouTube'), h('p', { class: 'muted' }, 'Finds channels by keyword (needs YOUTUBE_API_KEY on the server).'),
      h('div', { class: 'row' }, yq, yr, h('button', { onclick: () => guard(() => api('/discovery/youtube', { method: 'POST', body: { query: yq.value.trim(), limit: 20, regionCode: yr.value.trim() || undefined } }), (r) => ['Found ' + r.found + ' channels: ' + r.created + ' new, ' + r.updated + ' already known.']) }, 'Search'))),
    h('div', { class: 'card', style: 'margin-top:12px' }, h('h2', {}, 'Paste links'), urls,
      h('div', { class: 'row' }, h('button', { onclick: () => guard(() => api('/discovery/urls', { method: 'POST', body: { urls: urls.value.split(/\s*\n\s*/).map((s) => s.trim()).filter(Boolean) } }), (r) => r.results.map((x) => (x.status === 'saved' ? '✓ ' : '✗ ') + x.url + (x.note ? ' — ' + x.note : ''))) }, 'Add links'))),
    h('div', { class: 'card', style: 'margin-top:12px' }, h('h2', {}, 'Import a spreadsheet (CSV)'), h('p', { class: 'muted' }, 'Use this for TikTok, Instagram and X, which cannot be read automatically. Columns: platform, handle, name, followers, country, email, bio, url.'),
      file, csv, h('div', { class: 'row' }, h('button', { onclick: () => guard(() => api('/discovery/import', { method: 'POST', body: { format: 'csv', data: csv.value } }), (r) => ['Imported: ' + r.created + ' new, ' + r.updated + ' updated.', ...r.errors.map((e) => 'Row ' + e.row + ': ' + e.message)]) }, 'Import'))),
    h('div', { class: 'card', style: 'margin-top:12px' }, out));
}

start();
