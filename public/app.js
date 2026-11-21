import {
  HOUSEHOLDS, trackStep, computeRides, counterBefore, totals, excelText, parseNum, newId,
} from './core.js';

// ================= opslag op het toestel =================
const KEY = {
  entries: 'kmdelen.v3.entries', outbox: 'kmdelen.v3.outbox', code: 'kmdelen.v3.code',
  settings: 'kmdelen.v3.settings', active: 'kmdelen.v3.active',
};
const mem = {};
const local = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return k in mem ? mem[k] : d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete mem[k]; } },
};

let entries = new Map(local.get(KEY.entries, []).map((e) => [e.id, e]));
let outbox = local.get(KEY.outbox, []);            // [{ kind:'put', id, e } | { kind:'del', id, upd }]
let code = local.get(KEY.code, '');
let settings = { factor: 1, lastHH: 'Klein', mode: 'km', ...local.get(KEY.settings, {}) };
let active = local.get(KEY.active, null);

const all = () => [...entries.values()];
const persist = () => { local.set(KEY.entries, all()); local.set(KEY.outbox, outbox); };
const saveSettings = () => local.set(KEY.settings, settings);
const saveActive = () => (active ? local.set(KEY.active, active) : local.del(KEY.active));

// ================= helpers =================
const $ = (id) => document.getElementById(id);
const nf0 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const today = () => isoDate(Date.now());
const toInput = (n) => (n == null || n === '' ? '' : String(n).replace('.', ','));
const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`; };
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' }); };
const dayLabel = (date) => new Date(`${date}T12:00`).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Tijdstempel voor de volgorde: vandaag = nu, een eerdere dag = middag van die dag. */
const tFor = (date) => (date === today() ? Date.now() : new Date(`${date}T12:00`).getTime());

let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}
function confirmBox(title, text, yes, no) {
  return new Promise((resolve) => {
    $('cfTitle').textContent = title; $('cfText').textContent = text; $('cfYes').textContent = yes; $('cfNo').textContent = no;
    $('confirmBg').classList.add('on');
    const done = (v) => { $('confirmBg').classList.remove('on'); resolve(v); };
    $('cfYes').onclick = () => done(true); $('cfNo').onclick = () => done(false);
  });
}
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return; } catch { /* fallback */ }
  const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* niets */ }
  ta.remove(); toast(ok ? okMsg : 'Kopiëren lukte niet');
}
function renderPick(el, sel, onPick) {
  el.innerHTML = '';
  for (const h of HOUSEHOLDS) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = h;
    if (h === sel) b.className = `sel-${h}`;
    b.onclick = () => onPick(h);
    el.appendChild(b);
  }
}

// ================= synchronisatie =================
class AuthError extends Error {}
async function api(method, body) {
  const res = await fetch('/api/entries', {
    method, cache: 'no-store',
    headers: { 'x-groep': code, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new AuthError('Onjuiste groepscode');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Serverfout (${res.status})`);
  return data;
}

let syncing = null, syncAgain = false, lastSync = 0, syncState = 'idle', syncError = '';
function setSync(state, error = '') {
  syncState = state; syncError = error;
  const dot = $('syncDot'), txt = $('syncTxt'), n = outbox.length;
  const wait = n ? `${n} wachtend` : '';
  if (state === 'busy') { dot.className = 'dot weak'; txt.textContent = 'Bezig…'; }
  else if (state === 'ok' && !n) { dot.className = 'dot ok'; txt.textContent = 'Gedeeld'; }
  else if (state === 'offline') { dot.className = 'dot bad'; txt.textContent = wait ? `Offline · ${wait}` : 'Offline'; }
  else if (state === 'error') { dot.className = 'dot bad'; txt.textContent = 'Fout'; }
  else { dot.className = 'dot weak'; txt.textContent = wait || 'Gedeeld'; }
  $('syncInfo').textContent = state === 'error' ? error
    : lastSync ? `${n ? wait + ' · ' : ''}laatst ${new Date(lastSync).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : '';
}

async function flush() {
  while (outbox.length) {
    const batch = outbox.slice(0, 200);
    const r = await api('POST', {
      puts: batch.filter((o) => o.kind === 'put').map((o) => o.e),
      dels: batch.filter((o) => o.kind === 'del').map((o) => ({ id: o.id, upd: o.upd })),
    });
    const sent = new Set(batch);
    outbox = outbox.filter((o) => !sent.has(o));
    persist();
    if (r.rejected?.length) toast(`${r.rejected.length} regel(s) geweigerd door de server`);
  }
}
async function pull() {
  const r = await api('GET');
  const next = new Map();
  for (const e of r.entries) if (!e.deleted) next.set(e.id, e);
  for (const o of outbox) { if (o.kind === 'put') next.set(o.id, o.e); else next.delete(o.id); }
  entries = next; persist();
}
function sync() {
  if (!code) return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  setSync('busy');
  syncing = (async () => {
    try {
      do { syncAgain = false; await flush(); await pull(); } while (syncAgain);
      lastSync = Date.now(); setSync('ok');
    } catch (err) {
      if (err instanceof AuthError) { code = ''; local.del(KEY.code); showGate('De groepscode klopt niet (meer).'); setSync('error', err.message); }
      else if (err instanceof TypeError) setSync('offline');           // netwerk weg
      else setSync('error', err.message);
    } finally { syncing = null; render(); }
  })();
  return syncing;
}

/** Lokaal wijzigen en in de wachtrij zetten; synchroniseert op de achtergrond. */
function putEntry(e) {
  const prev = entries.get(e.id);
  e.upd = Math.max(Date.now(), (prev?.upd || 0) + 1);
  entries.set(e.id, e);
  outbox = outbox.filter((o) => o.id !== e.id);
  outbox.push({ kind: 'put', id: e.id, e });
  persist(); render(); sync();
}
function deleteEntry(id) {
  const prev = entries.get(id);
  entries.delete(id);
  outbox = outbox.filter((o) => o.id !== id);
  outbox.push({ kind: 'del', id, upd: Math.max(Date.now(), (prev?.upd || 0) + 1) });
  persist(); render(); sync();
}

// ================= groepscode =================
function showGate(err = '') { $('gate').classList.add('on'); $('gateErr').textContent = err; setTimeout(() => $('gateCode').focus(), 50); }
$('gateForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const c = $('gateCode').value.trim();
  if (!c) return;
  code = c; $('gateErr').textContent = 'Controleren…';
  try {
    await api('GET');
    local.set(KEY.code, code); $('gate').classList.remove('on'); $('gateCode').value = '';
    await sync(); toast('Welkom! Ritten worden nu gedeeld.');
  } catch (err) {
    code = '';
    $('gateErr').textContent = err instanceof AuthError ? 'Deze code klopt niet.' : err instanceof TypeError ? 'Geen verbinding. Probeer het opnieuw.' : err.message;
  }
};

// ================= GPS-meting =================
let watchId = null, wakeLock = null, tick = null, lastFix = null, curSpeed = null;

function onPos(pos) {
  if (!active) return;
  const c = pos.coords;
  lastFix = { acc: c.accuracy, t: Date.now() };
  curSpeed = c.speed != null && c.speed >= 0 ? c.speed * 3.6 : null;
  const fix = { lat: c.latitude, lon: c.longitude, t: pos.timestamp || Date.now(), acc: c.accuracy };
  const r = trackStep(active.last, fix);
  if (r.last !== active.last || r.add) { active.last = r.last; active.m += r.add; saveActive(); }
  renderActive();
}
function onPosErr(err) {
  $('gpsDot').className = 'dot bad';
  $('gpsTxt').textContent = err.code === 1 ? 'Geen toestemming voor locatie' : err.code === 3 ? 'GPS-signaal traag…' : 'GPS niet beschikbaar';
  if (err.code === 1) toast('Sta locatietoegang toe voor deze site (Instellingen → Privacy → Locatie).');
}
function startWatch() {
  if (!('geolocation' in navigator)) { toast('Deze browser ondersteunt geen GPS'); return; }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  requestWake();
  clearInterval(tick); tick = setInterval(renderActive, 1000);
}
function stopWatch() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; clearInterval(tick); tick = null; lastFix = null; curSpeed = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
async function requestWake() {
  const w = $('wakeWarn');
  if (!('wakeLock' in navigator)) { w.style.display = 'block'; w.textContent = 'Zet de automatische schermvergrendeling tijdelijk uit of houd de app open.'; return; }
  try {
    wakeLock = await navigator.wakeLock.request('screen'); w.style.display = 'none';
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { w.style.display = 'block'; w.textContent = 'Scherm aan houden lukte niet (bijv. door batterijbesparing). Houd de app open tijdens de rit.'; }
}

let pickHH = settings.lastHH;
function startRide() {
  active = { id: newId(), start: Date.now(), hh: pickHH, m: 0, last: null };
  settings.lastHH = pickHH; saveSettings(); saveActive();
  render(); startWatch();
}
function stopRide() {
  if (!active) return;
  stopWatch();
  const km = (active.m / 1000) * (settings.factor || 1);
  openSheet({
    mode: 'new', type: 'rit', id: active.id, hh: active.hh, date: isoDate(active.start), t: active.start,
    km: Math.round(km), bij: lastBij(active.hh), src: 'gps', dur: Date.now() - active.start, rideMode: 'km',
    sub: `Gemeten: ${nf1.format(km)} km in ${fmtDur(Date.now() - active.start)}`,
  });
}
function lastBij(hh) {
  const r = all().filter((e) => e.type === 'rit' && e.hh === hh).sort((a, b) => b.upd - a.upd)[0];
  return r?.bij || '';
}

// ================= invoerscherm =================
let sheet = null;
function openSheet(o) {
  sheet = { ...o };
  const isRide = o.type === 'rit';
  $('shTitle').textContent = o.mode === 'edit' ? (isRide ? 'Rit bewerken' : 'Tankbeurt bewerken')
    : o.mode === 'manual' ? 'Rit achteraf invullen' : 'Rit opslaan';
  $('shSub').textContent = o.sub || '';
  $('shWhoLbl').textContent = isRide ? 'Bestuurder' : 'Getankt door';
  $('shRide').style.display = isRide ? 'block' : 'none';
  $('shTank').style.display = isRide ? 'none' : 'flex';
  $('shKm').value = o.km ?? '';
  $('shStand').value = o.stand ?? '';
  $('shBij').value = o.bij || '';
  $('shCost').value = toInput(o.cost); $('shLp').value = toInput(o.lp);
  $('shDate').value = o.date || today();
  $('shDelete').style.display = o.mode === 'edit' ? 'block' : 'none';
  $('shCancel').textContent = o.mode === 'new' ? 'Weggooien' : 'Annuleren';
  $('bijList').innerHTML = [...new Set(all().map((e) => e.bij).filter(Boolean))].map((b) => `<option value="${esc(b)}">`).join('');
  sheet.rideMode = o.rideMode || (o.stand != null ? 'stand' : settings.mode);
  drawSheetPick(); drawMode();
  $('sheetBg').classList.add('on');
}
function drawSheetPick() { renderPick($('shHH'), sheet.hh, (h) => { sheet.hh = h; drawSheetPick(); }); }
function sheetCounter() {
  const date = $('shDate').value || today();
  const t = sheet.mode === 'edit' && date === sheet.date ? sheet.t : sheet.mode === 'new' ? sheet.t : tFor(date);
  return counterBefore(all(), date, t, sheet.id);
}
function drawMode() {
  const stand = sheet.rideMode === 'stand';
  $('shMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === sheet.rideMode));
  $('shStandBox').style.display = stand ? 'block' : 'none';
  const counter = stand ? sheetCounter() : null;
  // Zonder bekende vorige stand moet het aantal km er ook bij (eerste stand ooit).
  $('shKmBox').style.display = !stand || counter == null ? 'block' : 'none';
  if (stand) updStandHint(counter);
}
function updStandHint(counter = sheetCounter()) {
  const h = $('shStandHint'), s = parseNum($('shStand').value, true);
  h.classList.remove('err');
  if (counter == null) { h.textContent = 'Eerste kilometerstand: vul hieronder ook het aantal km van deze rit in.'; return; }
  if (!(s > 0)) { h.textContent = `Vorige stand ≈ ${nf0.format(counter)}`; return; }
  const d = Math.round(s - counter);
  h.textContent = `${nf0.format(counter)} → ${nf0.format(s)} = ${nf0.format(d)} km`;
  if (d < 0 || d > 2000) h.classList.add('err');
}
$('shMode').querySelectorAll('button').forEach((b) => b.onclick = () => {
  sheet.rideMode = b.dataset.m; settings.mode = b.dataset.m; saveSettings(); drawMode();
  if (b.dataset.m === 'stand') $('shStand').focus();
});
$('shStand').oninput = () => updStandHint();
$('shDate').onchange = () => { if (sheet?.type === 'rit') drawMode(); };
function closeSheet() { $('sheetBg').classList.remove('on'); sheet = null; }

$('shSave').onclick = () => {
  const date = $('shDate').value || today();
  if (date > today()) return toast('Datum ligt in de toekomst');
  const base = entries.get(sheet.id) || {};
  const t = sheet.mode === 'new' ? sheet.t : date === base.date ? base.t : tFor(date);
  let e;
  if (sheet.type === 'rit') {
    const bij = $('shBij').value.trim();
    let km = parseNum($('shKm').value), stand = null;
    if (sheet.rideMode === 'stand') {
      stand = parseNum($('shStand').value, true);
      if (!(stand > 0)) return toast('Vul de kilometerstand in');
      stand = Math.round(stand);
      const counter = sheetCounter();
      if (counter != null) {
        km = stand - counter;
        if (km < 0) return toast(`Stand is lager dan de vorige (${nf0.format(counter)})`);
      }
    }
    if (!(km >= 0)) return toast('Vul het aantal kilometers in');
    e = { ...base, id: sheet.id || newId(), type: 'rit', date, t, hh: sheet.hh, km: Math.round(km),
      src: sheet.src || base.src || 'handmatig', ...(sheet.dur ? { dur: sheet.dur } : {}) };
    if (stand != null) e.stand = stand; else delete e.stand;
    if (bij) e.bij = bij; else delete e.bij;
  } else {
    const cost = parseNum($('shCost').value), lp = parseNum($('shLp').value);
    if (!(cost > 0)) return toast('Vul het bedrag in');
    e = { ...base, type: 'tank', date, t, hh: sheet.hh, cost: Math.round(cost * 100) / 100 };
    if (lp > 0) e.lp = lp; else delete e.lp;
  }
  const wasNew = sheet.mode === 'new';
  closeSheet();
  if (wasNew) { active = null; saveActive(); }
  putEntry(e);
  toast(e.type === 'rit' ? `${e.km} km opgeslagen voor ${e.hh}` : 'Opgeslagen');
};
$('shCancel').onclick = async () => {
  if (sheet?.mode === 'new') {
    if (!await confirmBox('Rit weggooien?', 'De gemeten kilometers worden niet opgeslagen.', 'Weggooien', 'Terug')) return;
    active = null; saveActive();
  }
  closeSheet(); render();
};
$('shDelete').onclick = async () => {
  if (!await confirmBox('Verwijderen?', 'Dit wordt ook bij de anderen verwijderd.', 'Verwijderen', 'Terug')) return;
  const id = sheet.id; closeSheet(); deleteEntry(id); toast('Verwijderd');
};
function editEntry(id) {
  const e = entries.get(id); if (!e) return;
  const sub = e.type !== 'rit' ? '' : e.src === 'gps' ? `Gemeten met GPS${e.dur ? `, ${fmtDur(e.dur)}` : ''}` : 'Handmatig ingevoerd';
  openSheet({ ...e, mode: 'edit', sub });
}

// ================= tanken =================
let tankHH = settings.lastHH;
function updLiters() {
  const c = parseNum($('tCost').value), lp = parseNum($('tLp').value);
  $('tLiters').textContent = c > 0 && lp > 0 ? `≈ ${nf1.format(c / lp)} liter` : '';
}
$('tCost').oninput = updLiters; $('tLp').oninput = updLiters;
$('btnTank').onclick = () => {
  const cost = parseNum($('tCost').value), lp = parseNum($('tLp').value), date = $('tDate').value || today();
  if (!(cost > 0)) return toast('Vul het bedrag in');
  if (lp && !(lp > 0 && lp < 10)) return toast('Literprijs klopt niet');
  if (date > today()) return toast('Datum ligt in de toekomst');
  putEntry({ id: newId(), type: 'tank', date, t: tFor(date), hh: tankHH, cost: Math.round(cost * 100) / 100, ...(lp > 0 ? { lp } : {}) });
  $('tCost').value = ''; $('tLp').value = ''; $('tDate').value = today(); updLiters();
  toast(`Tankbeurt van ${eur.format(cost)} opgeslagen`);
};

// ================= weergave =================
function itemHTML(e, kmInfo) {
  const ride = e.type === 'rit';
  const k = ride ? kmInfo.get(e.id) : null;
  const parts = [];
  if (ride && e.bij) parts.push(`met ${esc(e.bij)}`);
  if (ride && e.stand != null) parts.push(`stand ${nf0.format(e.stand)}`);
  if (ride && e.src === 'gps') parts.push('GPS');
  if (!ride && e.lp) parts.push(`${eur.format(e.lp)}/l · ${nf1.format(e.cost / e.lp)} l`);
  return `<div class="item" data-id="${esc(e.id)}">
    <span class="pill ${e.hh}">${e.hh}</span>
    <div class="info"><div>${ride ? '' : '⛽ '}${dayLabel(e.date)}</div>${parts.length ? `<div class="muted small">${parts.join(' · ')}</div>` : ''}</div>
    <span class="val">${ride ? `${k?.warn ? '⚠︎ ' : ''}${k?.km ?? e.km} km` : eur.format(e.cost)}</span></div>`;
}
function bindItems(el) { el.querySelectorAll('.item').forEach((r) => { r.onclick = () => editEntry(r.dataset.id); }); }
function totalsHTML(t) {
  const sum = t.Klein + t.Groot, pK = sum ? (t.Klein / sum) * 100 : 50;
  return `<div class="bar"><i style="width:${pK}%;background:var(--k)"></i><i style="width:${100 - pK}%;background:var(--g)"></i></div>
    <div class="tot">${HOUSEHOLDS.map((h) => `<div><span class="pill ${h}">${h}</span> <b>${nf0.format(t[h])} km</b>
      <span class="muted">${sum ? nf0.format((t[h] / sum) * 100) : 0}%</span>
      ${t.tank[h] ? `<div class="muted small" style="margin-top:4px">getankt ${eur.format(t.tank[h])}</div>` : ''}</div>`).join('')}</div>`;
}
const sortDesc = (list) => [...list].sort((a, b) => (a.date === b.date ? (b.t || 0) - (a.t || 0) : a.date < b.date ? 1 : -1));

function renderIdle() {
  renderPick($('pickStart'), pickHH, (h) => { pickHH = h; renderIdle(); });
  const list = all(), key = today().slice(0, 7), t = totals(list, key), { counter } = computeRides(list);
  $('counterHint').textContent = counter != null ? `Kilometerteller nu ≈ ${nf0.format(counter)}` : '';
  $('monthCard').innerHTML = `<div class="between"><b style="text-transform:capitalize">${monthLabel(key)}</b>
    <span class="muted small">${t.ritten} ${t.ritten === 1 ? 'rit' : 'ritten'}</span></div>${totalsHTML(t)}`;
}
function renderActive() {
  if (!active) return;
  const pill = $('actHH'); pill.textContent = active.hh; pill.className = `pill ${active.hh}`;
  $('actKm').textContent = nf1.format((active.m / 1000) * (settings.factor || 1));
  const ms = Date.now() - active.start;
  $('actTime').textContent = fmtDur(ms);
  $('actSpeed').textContent = curSpeed != null ? nf0.format(curSpeed) : '–';
  $('actAvg').textContent = ms > 60000 && active.m > 100 ? nf0.format((active.m / ms) * 3600) : '–';
  const dot = $('gpsDot'), txt = $('gpsTxt');
  if (!lastFix) { if (!dot.classList.contains('bad')) { dot.className = 'dot'; txt.textContent = 'GPS zoeken…'; } return; }
  const age = (Date.now() - lastFix.t) / 1000, a = nf0.format(lastFix.acc);
  if (age > 20) { dot.className = 'dot weak'; txt.textContent = 'Geen nieuw signaal'; }
  else if (lastFix.acc <= 15) { dot.className = 'dot ok'; txt.textContent = `GPS goed (±${a} m)`; }
  else if (lastFix.acc <= 40) { dot.className = 'dot weak'; txt.textContent = `GPS matig (±${a} m)`; }
  else { dot.className = 'dot bad'; txt.textContent = `GPS onnauwkeurig (±${a} m)`; }
}
function renderTank() {
  renderPick($('pickTank'), tankHH, (h) => { tankHH = h; renderTank(); });
  if (!$('tDate').value) $('tDate').value = today();
  const tanks = sortDesc(all().filter((e) => e.type === 'tank')).slice(0, 8);
  $('tankList').innerHTML = tanks.length ? tanks.map((e) => itemHTML(e)).join('') : '<span class="muted">Nog geen tankbeurten.</span>';
  bindItems($('tankList'));
}
function renderOverview() {
  const el = $('overview'), list = all();
  if (!list.length) { el.innerHTML = '<div class="card muted" style="margin-top:12px">Nog niets ingevoerd.</div>'; return; }
  const { km } = computeRides(list), groups = {};
  for (const e of sortDesc(list)) (groups[e.date.slice(0, 7)] ||= []).push(e);
  el.innerHTML = Object.keys(groups).sort().reverse().map((key) => `
    <h2 class="between"><span style="text-transform:capitalize">${monthLabel(key)}</span>
      <button class="ghost small" style="padding:6px 12px" data-copy="${key}">Kopieer</button></h2>
    <div class="card">${totalsHTML(totals(list, key))}</div>
    <div class="card">${groups[key].map((e) => itemHTML(e, km)).join('')}</div>`).join('');
  bindItems(el);
  el.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => copyText(excelText(all(), b.dataset.copy, false), `${monthLabel(b.dataset.copy)} gekopieerd`); });
}
function render() {
  $('idle').style.display = active ? 'none' : 'block';
  $('active').style.display = active ? 'block' : 'none';
  if (active) renderActive(); else renderIdle();
  renderTank(); renderOverview(); setSync(syncState, syncError);
}

// ================= knoppen & navigatie =================
$('btnStart').onclick = startRide;
$('btnStop').onclick = stopRide;
$('btnCancel').onclick = async () => {
  if (await confirmBox('Rit annuleren?', 'De gemeten kilometers worden niet opgeslagen.', 'Annuleren', 'Doorgaan')) {
    stopWatch(); active = null; saveActive(); render();
  }
};
$('btnSwitch').onclick = () => { if (!active) return; active.hh = active.hh === 'Klein' ? 'Groot' : 'Klein'; saveActive(); renderActive(); };
$('btnManual').onclick = () => openSheet({ mode: 'manual', type: 'rit', hh: pickHH, date: today(), bij: '' });
$('btnCopyAll').onclick = () => (entries.size ? copyText(excelText(all(), null, true), 'Gekopieerd — plak in cel A1 van een leeg blad') : toast('Nog niets ingevoerd'));
$('btnSyncNow').onclick = () => sync().then(() => syncState === 'ok' && toast('Bijgewerkt'));
$('btnLogout').onclick = () => showGate();
$('btnSheetImport').onclick = async () => {
  const b = $('btnSheetImport'); b.disabled = true; b.textContent = 'Bezig met ophalen…';
  try {
    const res = await fetch('/api/sheet-import', { method: 'POST', headers: { 'x-groep': code } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Fout (${res.status})`);
    await sync();
    toast(data.added ? `${data.added} regel(s) uit de spreadsheet toegevoegd` : 'Niets nieuws in de spreadsheet');
  } catch (err) {
    toast(err instanceof TypeError ? 'Geen verbinding' : err.message);
  } finally { b.disabled = false; b.textContent = 'Formulier-invoer ophalen'; }
};
$('btnSaveSet').onclick = () => {
  const f = parseNum($('factor').value || '1');
  if (!(f > 0.8 && f < 1.2)) return toast('Kies een factor tussen 0,80 en 1,20');
  settings.factor = f; saveSettings(); toast('Opgeslagen');
};
document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === `v-${b.dataset.v}`));
    if (b.dataset.v === 'inst') $('factor').value = toInput(settings.factor || 1);
    render(); window.scrollTo(0, 0);
  };
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (active) startWatch();
  sync();
});
window.addEventListener('online', () => sync());
setInterval(() => { if (document.visibilityState === 'visible' && !sheet) sync(); }, 30000);

// ================= start =================
render();
if (active) { startWatch(); toast('Rit loopt nog — meting gaat verder'); }
if (code) sync(); else showGate();
