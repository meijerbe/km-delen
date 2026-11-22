import {
  HOUSEHOLDS, trackStep, computeRides, counterBefore, totals, excelText, parseNum, newId,
  costInsights, categoryOf, toRD, fromRD, PARK_ID, parkingOf,
} from './core.js';
import { car, duo, logo } from './art.js';
import { startLine, stopLine, tankLine, compareLine, honk, jingle } from './fun.js';

// ================= opslag op het toestel =================
const KEY = {
  entries: 'kmdelen.v3.entries', outbox: 'kmdelen.v3.outbox', code: 'kmdelen.v3.code',
  settings: 'kmdelen.v3.settings', active: 'kmdelen.v3.active', costs: 'kmdelen.v3.sheetcosts', payments: 'kmdelen.v3.sheetpayments',
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
let settings = { lastHH: 'Klein', mode: 'km', ...local.get(KEY.settings, {}) };
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
let popTimer;
/** Reactie van de poppetjes: duo + emoji + tekst, verdwijnt vanzelf. */
function pop(hh, emo, title, sub = '', kind = 'wave') {
  const el = $('pop');
  $('popFaces').innerHTML = duo(hh, 56); $('popEmo').textContent = emo;
  $('popTitle').textContent = title; $('popSub').textContent = sub;
  el.className = `pop on ${kind}`;
  clearTimeout(popTimer); popTimer = setTimeout(() => { el.className = 'pop'; }, 2800);
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
    const b = document.createElement('button'); b.type = 'button';
    b.innerHTML = `${duo(h, 40)}<span>${h}</span>`;
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

const GAP_MS = 60000;   // langer dan een minuut geen bruikbare meting = gat in de rit
function onPos(pos) {
  if (!active) return;
  const c = pos.coords;
  lastFix = { acc: c.accuracy, t: Date.now() };
  if (c.accuracy <= 40) {
    const now = Date.now(), prev = active.lastGood || active.start;
    if (now - prev > GAP_MS) active.gapMs = (active.gapMs || 0) + (now - prev);
    active.lastGood = now; active.fixes = (active.fixes || 0) + 1;
  }
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
  toast(startLine(pickHH));
}
/** Hoe betrouwbaar was de GPS-meting? Geeft een waarschuwing of '' terug. */
function gpsWarning(a, now = Date.now()) {
  const dur = now - a.start, km = a.m / 1000;
  const tail = now - (a.lastGood || a.start);
  const gap = (a.gapMs || 0) + (tail > GAP_MS ? tail : 0);
  if (!a.fixes) return '⚠️ Geen GPS-signaal ontvangen. Vul de km of de kilometerstand in.';
  if (km < 0.5 && dur > 5 * 60000) return '⚠️ GPS heeft bijna niets gemeten. Klopt dat, of vul je de km zelf in?';
  if (gap > Math.max(2 * 60000, dur * 0.2)) return `⚠️ ${fmtDur(gap)} zonder GPS-signaal: de km kunnen te laag zijn. Controleer ze even, of gebruik de kilometerstand.`;
  return '';
}

function stopRide() {
  if (!active) return;
  stopWatch();
  const km = active.m / 1000, warn = gpsWarning(active);
  openSheet({
    mode: 'new', type: 'rit', id: active.id, hh: active.hh, date: isoDate(active.start), t: active.start,
    km: active.fixes ? Math.round(km) : null, bij: lastBij(active.hh), src: 'gps', dur: Date.now() - active.start, rideMode: 'km',
    sub: `Gemeten: ${nf1.format(km)} km in ${fmtDur(Date.now() - active.start)}. Je kunt het aantal km hieronder aanpassen.`,
    warn,
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
  $('shWarn').textContent = o.warn || ''; $('shWarn').style.display = o.warn ? 'block' : 'none';
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
  $('shAll').checked = !o.vast;
  drawSheetPick(); drawMode();
  $('sheetBg').classList.add('on');
  if (o.mode === 'new' && o.warn) setTimeout(() => { $('shKm').focus(); $('shKm').select(); }, 50);
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
  // Km zelf invullen: zonder stand, bij de eerste stand ooit, of als niet alle km van deze rit zijn.
  $('shAllBox').style.display = stand && counter != null ? 'flex' : 'none';
  $('shKmBox').style.display = !stand || counter == null || !$('shAll').checked ? 'block' : 'none';
  if (stand) updStandHint(counter);
}
function updStandHint(counter = sheetCounter()) {
  const h = $('shStandHint'), s = parseNum($('shStand').value, true);
  h.classList.remove('err');
  if (counter == null) { h.textContent = 'Eerste kilometerstand: vul hieronder ook het aantal km van deze rit in.'; return; }
  if (!(s > 0)) { h.textContent = `Vorige stand ≈ ${nf0.format(counter)}`; return; }
  const d = Math.round(s - counter);
  h.textContent = `${nf0.format(counter)} → ${nf0.format(s)} = ${nf0.format(d)} km sinds de vorige stand`;
  if (!$('shAll').checked && d >= 0) {
    const own = parseNum($('shKm').value);
    if (own >= 0 && own <= d) h.textContent += ` · ${nf0.format(d - own)} km telt niet mee (samen of vol-naar-vol)`;
  }
  if (d < 0 || d > 2000) h.classList.add('err');
}
$('shMode').querySelectorAll('button').forEach((b) => b.onclick = () => {
  sheet.rideMode = b.dataset.m; settings.mode = b.dataset.m; saveSettings(); drawMode();
  if (b.dataset.m === 'stand') $('shStand').focus();
});
$('shStand').oninput = () => updStandHint();
$('shAll').onchange = () => drawMode();
$('shKm').addEventListener('input', () => { if (sheet?.rideMode === 'stand') updStandHint(); });
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
      if (counter != null && stand < counter) return toast(`Stand is lager dan de vorige (${nf0.format(counter)})`);
      if (counter != null && $('shAll').checked) km = stand - counter;
      else if (counter != null && km > stand - counter) return toast(`Meer km dan sinds de vorige stand (${nf0.format(stand - counter)})`);
    }
    if (!(km >= 0)) return toast('Vul het aantal kilometers in');
    // Niet alle km sinds de vorige stand: km staan vast, de stand zet alleen de teller.
    const vast = sheet.rideMode === 'stand' && !$('shAll').checked;
    e = { ...base, id: sheet.id || newId(), type: 'rit', date, t, hh: sheet.hh, km: Math.round(km),
      src: sheet.src || base.src || 'handmatig', ...(sheet.dur ? { dur: sheet.dur } : {}) };
    if (stand != null) e.stand = stand; else delete e.stand;
    if (vast || (stand == null && base.vast)) e.vast = true; else delete e.vast;
    if (bij) e.bij = bij; else delete e.bij;
  } else {
    const cost = parseNum($('shCost').value), lp = parseNum($('shLp').value);
    if (!(cost > 0)) return toast('Vul het bedrag in');
    e = { ...base, type: 'tank', date, t, hh: sheet.hh, cost: Math.round(cost * 100) / 100 };
    if (lp > 0) e.lp = lp; else delete e.lp;
  }
  const wasNew = sheet.mode === 'new', wasManual = sheet.mode === 'manual';
  const lastFixPos = wasNew && active?.last ? active.last : null;
  closeSheet();
  if (wasNew) { active = null; saveActive(); }
  putEntry(e);
  // Na een GPS-rit: laatste goede positie = parkeerplek
  if (lastFixPos) putEntry({ id: PARK_ID, type: 'park', date: today(), t: Date.now(), hh: e.hh, lat: lastFixPos.lat, lon: lastFixPos.lon, src: 'gps' });
  if (wasNew) { const l = stopLine(e.km, e.hh); pop(e.hh, '👋', l.title, l.sub); }
  toast(wasNew ? `${e.km} km opgeslagen voor ${e.hh}` : wasManual ? `Bijgeschreven: ${e.km} km voor ${e.hh} ✍️` : 'Opgeslagen');
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
  const l = tankLine(cost, lp > 0 ? lp : null);
  pop(tankHH, l.emo, l.title, l.sub, l.kind);
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
    ${duo(e.hh, 28)}
    <div class="info"><div>${ride ? '' : '⛽ '}${dayLabel(e.date)} <span class="muted small">· ${e.hh}</span></div>${parts.length ? `<div class="muted small">${parts.join(' · ')}</div>` : ''}</div>
    <span class="val">${ride ? `${k?.warn ? '⚠︎ ' : ''}${k?.km ?? e.km} km` : eur.format(e.cost)}</span></div>`;
}
function bindItems(el) { el.querySelectorAll('.item').forEach((r) => { r.onclick = () => editEntry(r.dataset.id); }); }
function totalsHTML(t) {
  const sum = t.Klein + t.Groot, pK = sum ? (t.Klein / sum) * 100 : 50;
  return `<div class="bar"><i style="width:${pK}%;background:var(--k)"></i><i style="width:${100 - pK}%;background:var(--g)"></i></div>
    <div class="tot">${HOUSEHOLDS.map((h) => `<div>${duo(h, 30)}<div><b>${nf0.format(t[h])} km</b>
      <div class="muted small">${h} · ${sum ? nf0.format((t[h] / sum) * 100) : 0}%</div>
      ${t.tank[h] ? `<div class="muted small">⛽ ${eur.format(t.tank[h])}</div>` : ''}</div></div>`).join('')}</div>`;
}
const sortDesc = (list) => [...list].sort((a, b) => (a.date === b.date ? (b.t || 0) - (a.t || 0) : a.date < b.date ? 1 : -1));

const shownCar = {};
function showCar(el, hh) {
  if (shownCar[el] === hh) return;
  shownCar[el] = hh; $(el).innerHTML = car(hh);
}
function renderIdle() {
  renderPick($('pickStart'), pickHH, (h) => { pickHH = h; renderIdle(); });
  showCar('heroCar', pickHH);
  const list = all(), key = today().slice(0, 7), t = totals(list, key), { counter } = computeRides(list);
  $('counterHint').textContent = counter != null ? `Kilometerteller nu ≈ ${nf0.format(counter)}` : '';
  const fun = compareLine(t.Klein + t.Groot);
  $('monthCard').innerHTML = `<div class="between"><b style="text-transform:capitalize">${monthLabel(key)}</b>
    <span class="muted small">${t.ritten} ${t.ritten === 1 ? 'rit' : 'ritten'}</span></div>${totalsHTML(t)}${fun ? `<div class="fun">${fun}</div>` : ''}`;
}
function renderActive() {
  if (!active) return;
  const pill = $('actHH'); pill.textContent = active.hh; pill.className = `pill ${active.hh}`;
  showCar('driveCar', active.hh);
  $('actKm').textContent = nf1.format(active.m / 1000);
  const ms = Date.now() - active.start;
  $('actTime').textContent = fmtDur(ms);
  $('actSpeed').textContent = curSpeed != null ? nf0.format(curSpeed) : '–';
  $('actAvg').textContent = ms > 60000 && active.m > 100 ? nf0.format((active.m / ms) * 3600) : '–';
  const kmNow = active.m / 1000;
  $('driveCar').classList.toggle('sleepy', ms > 90 * 60000 || kmNow > 150);
  const hundreds = Math.floor(kmNow / 100);
  if (hundreds > (active.stations || 0)) {
    active.stations = hundreds; saveActive();
    const el = $('driveCar'); el.classList.remove('station'); void el.offsetWidth; el.classList.add('station');
    setTimeout(() => el.classList.remove('station'), 6500);
    toast(`${hundreds * 100} km! Tijd voor een tankstation? ⛽`);
  }
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
  const el = $('overview'), list = all().filter((e) => e.type === 'rit' || e.type === 'tank');
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
  renderTank(); renderOverview(); renderCosts(); setSync(syncState, syncError);
  if (diorama && $('v-polo').classList.contains('on')) showParking();
}

// ================= kosten =================
let sheetCosts = local.get(KEY.costs, []), sheetPayments = local.get(KEY.payments, []), costsSync = false, costsError = '', costsLoadedAt = 0;
async function loadCosts(force = false) {
  if (!code || (!force && Date.now() - costsLoadedAt < 60000)) return;
  try {
    const res = await fetch('/api/costs', { headers: { 'x-groep': code }, cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    costsSync = !!data.costsSync;
    if (!res.ok) throw new Error(data.error || `Fout (${res.status})`);
    sheetCosts = data.costs || []; local.set(KEY.costs, sheetCosts);
    sheetPayments = data.payments || []; local.set(KEY.payments, sheetPayments);
    costsError = ''; costsLoadedAt = Date.now();
  } catch (err) { costsError = err instanceof TypeError ? 'Offline: laatst bekende kosten' : err.message; }
  renderCosts();
}
/**
 * De sheet is de bron. Regels uit de app die (nog) niet in de sheet staan, tellen mee als "nog niet in de sheet".
 * Staat een app-regel wel in de sheet (zelfde App-id), dan geldt de sheet — behalve direct na een eigen wijziging
 * die nog onderweg is.
 */
function fromSheet(sheetList, type) {
  const appRows = all().filter((e) => e.type === type), byId = new Map(appRows.map((e) => [e.id, e]));
  const inSheet = new Set(sheetList.map((r) => r.id));
  const merged = sheetList.map((r) => {
    const mine = byId.get(r.id);
    return mine && mine.upd > costsLoadedAt ? { ...mine, pending: true } : { ...r, editable: !!mine };
  });
  for (const e of appRows) if (!inSheet.has(e.id)) merged.push({ ...e, pending: true, editable: true });
  return merged;
}
const allCosts = () => fromSheet(sheetCosts, 'kost');
const allPayments = () => fromSheet(sheetPayments, 'betaling');
const eur0 = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const shortMonth = (k) => new Date(`${k}-01T12:00`).toLocaleDateString('nl-NL', { month: 'short' }).replace('.', '');

function renderCosts() {
  const el = $('costsView');
  if (!el) return;
  const costs = allCosts(), payments = allPayments(), ins = costInsights(all(), costs, new Date(), payments);
  const { settle, debtor, creditor, amount } = ins;
  const payList = [...payments].sort((a, b) => b.date.localeCompare(a.date) || (b.t || 0) - (a.t || 0));
  const sign = (v) => `${v >= 0 ? '+' : '−'} ${eur.format(Math.abs(v))}`;
  const maxMonth = Math.max(1, ...ins.months.map(([, v]) => v));
  const shareText = `🚗 Disco Polo afrekening\n${debtor} → ${creditor}: ${eur.format(amount)}\n(brandstof naar km, vaste kosten 50/50)\nkm-delen.vercel.app`;
  const list = [...costs].sort((a, b) => b.date.localeCompare(a.date));
  el.innerHTML = `
    ${costsError ? `<div class="card warn small">${esc(costsError)}</div>` : ''}
    <div class="card">
      <div class="between"><b>Afrekening</b><span class="muted small">sinds de start</span></div>
      ${amount >= 0.5 ? `
      <div class="settle">${duo(debtor, 44)}<span class="arrow">→</span>${duo(creditor, 44)}</div>
      <div class="amount">${eur.format(amount)}</div>
      <div class="muted small" style="text-align:center;font-weight:700">${debtor} betaalt ${creditor}</div>`
      : `<div class="amount" style="margin:14px 0 4px">Quitte! 🤝</div>`}
      ${ins.paidTotal ? `<div class="muted small" style="text-align:center;margin-top:4px">al verrekend: ${eur.format(ins.paidTotal)}</div>` : ''}
      <button class="primary full" style="margin-top:12px" id="btnPay">💸 Betaling invullen</button>
      <div class="row" style="margin-top:8px">
        <button class="ghost small" id="btnBreakdown">Hoe komt dit?</button>
        ${amount >= 0.5 ? '<button class="ghost small" id="btnShareSettle">Deel via WhatsApp</button>' : ''}
      </div>
      <div class="breakdown" id="breakdown"><table>
        ${HOUSEHOLDS.map((h) => `
          <tr><td colspan="2" style="padding-top:8px;color:var(--ink);font-weight:800">${h}</td></tr>
          <tr><td>⛽ brandstof getankt − aandeel naar km</td><td>${sign(settle[h].fuelPart)}</td></tr>
          <tr><td>🧾 vaste kosten betaald − helft</td><td>${sign(settle[h].fixedPart)}</td></tr>
          ${settle[h].paidPart ? `<tr><td>💸 ${settle[h].paidPart > 0 ? 'al betaald aan' : 'al ontvangen van'} ${h === 'Klein' ? 'Groot' : 'Klein'}</td><td>${sign(settle[h].paidPart)}</td></tr>` : ''}
          <tr><td style="font-weight:800;color:var(--ink)">= saldo</td><td style="font-weight:800;color:var(--ink)">${sign(settle[h].net)}</td></tr>`).join('')}
      </table><p style="margin:8px 0 0">Brandstof: ${eur.format(ins.fuel)} verdeeld naar ${nf0.format(ins.km)} km. Vaste kosten: ${eur.format(ins.fixed)} gedeeld door twee. Ritten en tankbeurten die jullie niet invullen (samen op pad, vol-naar-vol) tellen niet mee.</p></div>
    </div>

    ${payList.length ? `<h2>Betalingen</h2><div class="card">${payList.map((p) => `
      <div class="item" data-pay="${esc(p.id)}">
        ${duo(p.hh, 26)}<span class="muted" style="font-weight:900">→</span>${duo(p.hh === 'Klein' ? 'Groot' : 'Klein', 26)}
        <div class="info"><div>${dayLabel(p.date)}${p.note ? ` · ${esc(p.note)}` : ''}</div>
          <div class="muted small">${p.ok ? '✅ ontvangen' : `<a href="#" data-ok="${esc(p.id)}" style="color:var(--accent);font-weight:800">Ontvangen? Bevestig ✓</a>`}${p.pending ? ' · nog niet in de sheet' : ''}</div></div>
        <span class="val">${eur.format(p.amount)}</span></div>`).join('')}</div>` : ''}

    <div class="card">
      <b>Wat kost een kilometer?</b>
      <div class="kpis" style="margin-top:10px">
        <div><b>${ins.perKmFuel != null ? eur.format(ins.perKmFuel) : '–'}</b><span>⛽ alleen brandstof</span></div>
        <div><b>${ins.perKmAll != null ? eur.format(ins.perKmAll) : '–'}</b><span>🚗 alles meegerekend</span></div>
      </div>
    </div>

    <div class="card">
      <div class="between"><b>Waar gaat het geld heen?</b><span class="muted small">${eur0.format(ins.total)}</span></div>
      <div class="bar" style="height:16px">${ins.cats.map((c) => `<i style="width:${(c.total / ins.total) * 100}%;background:${c.color}"></i>`).join('')}</div>
      <div class="legend">${ins.cats.map((c) => `<div><i style="background:${c.color}"></i>${c.emo} ${c.key}
        <span class="muted small">${nf0.format((c.total / ins.total) * 100)}%</span><span class="amt">${eur0.format(c.total)}</span></div>`).join('')}</div>
    </div>

    ${ins.months.length ? `<div class="card"><b>Per maand</b>
      <div class="monthbars">${ins.months.slice(-8).map(([k, v]) => `<div title="${eur.format(v)}"><span>${eur0.format(v).replace('€', '').trim()}</span><i style="height:${Math.max(3, (v / maxMonth) * 80)}px"></i><span>${shortMonth(k)}</span></div>`).join('')}</div></div>` : ''}

    ${ins.facts.length ? `<div class="card"><b>Polo-weetjes</b><div class="facts" style="margin-top:10px">${ins.facts.map((f) => `<div><span class="e">${f.emo}</span><span>${esc(f.text)}</span></div>`).join('')}</div></div>` : ''}

    <h2 class="between"><span>Vaste kosten</span><button class="ghost small" style="padding:6px 12px" id="btnAddCost">＋ Toevoegen</button></h2>
    ${!costsSync && (costs.some((c) => c.pending) || payments.some((p) => p.pending)) ? '<p class="hint" style="margin:-4px 4px 8px">Kosten en betalingen uit de app komen in de spreadsheet zodra het script is bijgewerkt.</p>' : ''}
    <div class="card">${list.length ? list.map((c) => `
      <div class="item" data-cost="${esc(c.id)}">
        <span style="font-size:22px">${categoryOf(c.desc).emo}</span>
        <div class="info"><div>${esc(c.desc || categoryOf(c.desc).key)}</div><div class="muted small">${dayLabel(c.date)} · ${c.hh}${c.pending ? ' · nog niet in de sheet' : ''}</div></div>
        <span class="val">${eur.format(c.cost)}</span></div>`).join('') : '<span class="muted">Nog geen vaste kosten.</span>'}
    </div>`;
  $('btnBreakdown').onclick = () => $('breakdown').classList.toggle('on');
  if ($('btnShareSettle')) $('btnShareSettle').onclick = async () => {
    if (navigator.share) { try { await navigator.share({ text: shareText }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  };
  $('btnAddCost').onclick = () => openCost({ mode: 'new', hh: settings.lastHH, date: today() });
  $('btnPay').onclick = () => openPay({ mode: 'new', hh: amount >= 0.5 ? debtor : settings.lastHH, amount: amount >= 0.5 ? amount : null, date: today() });
  el.querySelectorAll('[data-cost]').forEach((r) => {
    r.onclick = () => {
      const c = costs.find((x) => x.id === r.dataset.cost);
      if (c?.editable) openCost({ ...c, mode: 'edit' });
      else toast('Deze kostenpost pas je aan in de spreadsheet');
    };
  });
  el.querySelectorAll('[data-pay]').forEach((r) => {
    r.onclick = (ev) => {
      if (ev.target.closest('[data-ok]')) return;
      const p = payments.find((x) => x.id === r.dataset.pay);
      if (p?.editable) openPay({ ...p, mode: 'edit' });
      else toast('Deze betaling pas je aan in de spreadsheet (tabblad Verrekeningen)');
    };
  });
  el.querySelectorAll('[data-ok]').forEach((a) => {
    a.onclick = async (ev) => {
      ev.preventDefault();
      const p = payments.find((x) => x.id === a.dataset.ok);
      if (!p) return;
      if (!p.editable) return toast('Vink deze af in de spreadsheet (kolom Bevestigd)');
      const to = p.hh === 'Klein' ? 'Groot' : 'Klein';
      if (!await confirmBox('Ontvangen?', `Heeft ${to} ${eur.format(p.amount)} van ${p.hh} ontvangen?`, 'Ja, ontvangen', 'Nog niet')) return;
      const { pending, editable, src, app, ...clean } = p;
      putEntry({ ...(entries.get(p.id) || clean), ...clean, ok: true });
      pop(to, '✅', 'Ontvangst bevestigd', `${eur.format(p.amount)} van ${p.hh}`);
    };
  });
}

let costSheet = null;
function openCost(o) {
  costSheet = { ...o };
  $('ctTitle').textContent = o.mode === 'edit' ? 'Kosten bewerken' : 'Kosten toevoegen';
  $('ctCost').value = toInput(o.cost); $('ctDesc').value = o.desc || ''; $('ctDate').value = o.date || today();
  $('ctDelete').style.display = o.mode === 'edit' ? 'block' : 'none';
  $('ctList').innerHTML = [...new Set(allCosts().map((c) => c.desc).filter(Boolean))].slice(0, 30).map((d) => `<option value="${esc(d)}">`).join('');
  const draw = () => renderPick($('ctHH'), costSheet.hh, (h) => { costSheet.hh = h; draw(); }); draw();
  updCat(); $('costBg').classList.add('on');
}
function updCat() { const c = categoryOf($('ctDesc').value); $('ctCat').textContent = $('ctDesc').value ? `${c.emo} ${c.key}` : ''; }
$('ctDesc').oninput = updCat;
$('ctCancel').onclick = () => { $('costBg').classList.remove('on'); costSheet = null; };
$('ctSave').onclick = () => {
  const cost = parseNum($('ctCost').value), desc = $('ctDesc').value.trim(), date = $('ctDate').value || today();
  if (!(cost > 0)) return toast('Vul het bedrag in');
  if (!desc) return toast('Vul een omschrijving in');
  const base = costSheet.mode === 'edit' ? entries.get(costSheet.id) || {} : {};
  putEntry({ ...base, id: base.id || newId(), type: 'kost', date, t: base.t || tFor(date), hh: costSheet.hh, cost: Math.round(cost * 100) / 100, desc });
  const hh = costSheet.hh;
  $('costBg').classList.remove('on'); costSheet = null;
  pop(hh, categoryOf(desc).emo, `${eur.format(cost)} genoteerd`, `${desc} · betaald door ${hh}`);
};
$('ctDelete').onclick = async () => {
  if (!await confirmBox('Verwijderen?', 'Deze kostenpost wordt ook bij de anderen verwijderd.', 'Verwijderen', 'Terug')) return;
  const id = costSheet.id; $('costBg').classList.remove('on'); costSheet = null; deleteEntry(id);
};

// ================= betalingen =================
let paySheet = null;
function openPay(o) {
  paySheet = { ...o };
  $('pyTitle').textContent = o.mode === 'edit' ? 'Betaling bewerken' : 'Betaling invullen';
  $('pyAmount').value = o.amount != null ? o.amount.toFixed(2).replace('.', ',') : ''; $('pyDate').value = o.date || today(); $('pyNote').value = o.note || '';
  $('pyDelete').style.display = o.mode === 'edit' ? 'block' : 'none';
  const draw = () => {
    renderPick($('pyHH'), paySheet.hh, (h) => { paySheet.hh = h; draw(); });
    $('pyTo').textContent = `aan ${paySheet.hh === 'Klein' ? 'Groot' : 'Klein'}`;
  };
  draw(); $('payBg').classList.add('on');
}
$('pyCancel').onclick = () => { $('payBg').classList.remove('on'); paySheet = null; };
$('pySave').onclick = () => {
  const amt = parseNum($('pyAmount').value), date = $('pyDate').value || today(), note = $('pyNote').value.trim();
  if (!(amt > 0)) return toast('Vul het bedrag in');
  if (date > today()) return toast('Datum ligt in de toekomst');
  const base = paySheet.mode === 'edit' ? entries.get(paySheet.id) || {} : {};
  const e = { ...base, id: base.id || paySheet.id || newId(), type: 'betaling', date, t: base.t || tFor(date), hh: paySheet.hh, amount: Math.round(amt * 100) / 100 };
  if (note) e.note = note; else delete e.note;
  if (paySheet.mode === 'edit' && paySheet.ok) e.ok = true;
  const hh = paySheet.hh, to = hh === 'Klein' ? 'Groot' : 'Klein';
  $('payBg').classList.remove('on'); paySheet = null;
  putEntry(e);
  const left = costInsights(all(), allCosts(), new Date(), allPayments()).amount;
  if (left < 0.5) pop(hh, '🤝', 'Schuld ingelost!', `${hh} en ${to} staan quitte`);
  else pop(hh, '💸', `${eur.format(amt)} betaald aan ${to}`, `Nog open: ${eur.format(left)}`);
};
$('pyDelete').onclick = async () => {
  if (!await confirmBox('Betaling verwijderen?', 'Deze betaling wordt ook bij de anderen verwijderd.', 'Verwijderen', 'Terug')) return;
  const id = paySheet.id; $('payBg').classList.remove('on'); paySheet = null; deleteEntry(id);
};

// ================= knoppen & navigatie =================
for (const id of ['heroCar', 'driveCar', 'gateCar']) {
  $(id).addEventListener('click', () => {
    honk();
    const el = $(id); el.classList.remove('honk'); void el.offsetWidth; el.classList.add('honk');
    setTimeout(() => el.classList.remove('honk'), 1000);
  });
}
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
    const msg = data.added ? `${data.added} regel(s) uit de spreadsheet toegevoegd` : 'Niets nieuws in de spreadsheet';
    toast(data.unknownUsers?.length ? `${msg}. Overgeslagen (onbekende gebruiker): ${data.unknownUsers.join(', ')}` : msg);
  } catch (err) {
    toast(err instanceof TypeError ? 'Geen verbinding' : err.message);
  } finally { b.disabled = false; b.textContent = 'Formulier-invoer ophalen'; }
};
// ================= Polo-diorama & parkeerplek =================
let diorama = null, dioramaLoading = null;
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return 'zojuist';
  if (m < 60) return `${m} min geleden`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} uur geleden`;
  const d = Math.round(h / 24);
  return d === 1 ? 'gisteren' : `${d} dagen geleden`;
};
const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
const mapsLink = (lat, lon) => (isApple
  ? `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w`
  : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`);

/** Polo in het diorama zetten (of melden dat hij buiten de buurt staat) */
function showParking() {
  if (!diorama || $('diorama').classList.contains('picking')) return;
  const p = parkingOf(all()), note = $('poloNote');
  note.classList.remove('on');
  if (!p) {
    diorama.setCar(null);
    note.innerHTML = 'Nog geen parkeerplek bekend. Tik op <b>📍 Geparkeerd</b>.'; note.classList.add('on');
    clearTimeout(showParking.t); showParking.t = setTimeout(() => { if (!$('diorama').classList.contains('picking')) note.classList.remove('on'); }, 4000);
    return;
  }
  const [x, y] = toRD(p.lat, p.lon), [cx, cy] = diorama.data.rd;
  const lx = x - cx, ly = y - cy, H = diorama.data.half;
  $('poloFaces').innerHTML = duo(p.hh, 30);
  $('poloText').innerHTML = `${p.hh} parkeerde hier<small>${ago(p.t)} · <a href="${mapsLink(p.lat, p.lon)}" target="_blank" rel="noopener" style="pointer-events:auto;color:var(--accent)">route</a></small>`;
  if (Math.abs(lx) <= H && Math.abs(ly) <= H) {
    diorama.setCar([lx, ly]);
  } else {
    diorama.setCar(null);
    const km = Math.hypot(lx, ly) / 1000;
    const dir = ['oost', 'noordoost', 'noord', 'noordwest', 'west', 'zuidwest', 'zuid', 'zuidoost'][Math.round(((Math.atan2(ly, lx) * 180) / Math.PI + 360) % 360 / 45) % 8];
    note.innerHTML = `${duo(p.hh, 22)} ${p.hh} parkeerde ${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km ${dir}waarts, buiten de buurt · ${ago(p.t)}<br><a href="${mapsLink(p.lat, p.lon)}" target="_blank" rel="noopener">Open in Kaarten →</a>`;
    note.classList.add('on');
  }
}

async function openDiorama() {
  if (diorama) { diorama.resume(); showParking(); return; }
  if (dioramaLoading) return;
  dioramaLoading = import('./buurt.js')
    .then((m) => m.createDiorama($('diorama'), {
      onHonk: () => honk(),
      onBread: () => { jingle(); toast(['🥖 Vers brood! Wie wil er een croissantje?', '🎶 Tingelingeling, de broodkar is er!', '🥐 Bakker Ids komt eraan!'][Math.floor(Math.random() * 3)]); },
    }))
    .then((d) => {
      diorama = d; window.__diorama = d; $('dioramaMsg').style.display = 'none';
      fetch('/api/places', { headers: { 'x-groep': code } }).then((r) => (r.ok ? r.json() : { places: [] }))
        .then((r) => d.setPlaces(r.places || [])).catch(() => {});
      $('dioramaAttr').textContent = d.data.attribution;
      showParking();
      if ($('v-polo').classList.contains('on')) d.resume(); else d.pause();
    })
    .catch((err) => { console.error(err); $('dioramaMsg').textContent = 'De buurt kon niet laden 😕'; dioramaLoading = null; });
}

function saveParking(lat, lon, hh, src) {
  putEntry({ id: PARK_ID, type: 'park', date: today(), t: Date.now(), hh, lat, lon, src });
  showParking();
}

let parkHH = settings.lastHH;
$('btnPark').onclick = () => {
  const draw = () => renderPick($('pkHH'), parkHH, (h) => { parkHH = h; draw(); }); draw();
  $('parkBg').classList.add('on');
};
$('pkCancel').onclick = () => $('parkBg').classList.remove('on');
$('pkHere').onclick = () => {
  if (!('geolocation' in navigator)) return toast('Deze browser ondersteunt geen GPS');
  const b = $('pkHere'); b.disabled = true; b.textContent = 'Locatie zoeken…';
  navigator.geolocation.getCurrentPosition((pos) => {
    b.disabled = false; b.textContent = '📍 Hier, op mijn huidige plek';
    $('parkBg').classList.remove('on');
    saveParking(pos.coords.latitude, pos.coords.longitude, parkHH, 'hier');
    pop(parkHH, '🅿️', 'Parkeerplek opgeslagen', pos.coords.accuracy > 50 ? `Let op: ± ${Math.round(pos.coords.accuracy)} m nauwkeurig` : 'Iedereen ziet nu waar de Polo staat');
    diorama?.flyToCar();
  }, (err) => {
    b.disabled = false; b.textContent = '📍 Hier, op mijn huidige plek';
    toast(err.code === 1 ? 'Geen toestemming voor locatie' : 'Locatie niet gevonden, wijs hem aan op de kaart');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
};
$('pkPick').onclick = async () => {
  $('parkBg').classList.remove('on');
  if (!diorama) return toast('De kaart is nog niet geladen');
  const note = $('poloNote');
  note.innerHTML = '👆 Tik op de plek waar de Polo staat · <a href="#" id="pkStop">annuleren</a>'; note.classList.add('on');
  $('diorama').classList.add('picking');
  $('pkStop').onclick = (e) => { e.preventDefault(); diorama.cancelPick(); $('diorama').classList.remove('picking'); showParking(); };
  diorama.flyOverview();
  const [x, y] = await diorama.pick();
  $('diorama').classList.remove('picking');
  const [lat, lon] = fromRD(diorama.data.rd[0] + x, diorama.data.rd[1] + y);
  saveParking(lat, lon, parkHH, 'kaart');
  pop(parkHH, '🅿️', 'Parkeerplek opgeslagen', 'Iedereen ziet nu waar de Polo staat');
  diorama.flyToCar();
};
$('btnToPolo').onclick = () => (parkingOf(all()) ? diorama?.flyToCar() : toast('Nog geen parkeerplek bekend'));
$('btnOverview').onclick = () => diorama?.flyOverview();

function showView(v) {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x.dataset.v === v));
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('on', el.id === `v-${v}`));
  if (v === 'polo') openDiorama(); else diorama?.pause();
  if (v === 'kosten') loadCosts();
  render(); window.scrollTo(0, 0);
}
$('btnGear').onclick = () => showView('inst');

document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => showView(b.dataset.v);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (active) startWatch();
  sync();
});
window.addEventListener('online', () => sync());
setInterval(() => { if (document.visibilityState === 'visible' && !sheet) sync(); }, 30000);

// ================= start =================
$('gateCar').innerHTML = logo();
render();
if (active) { startWatch(); toast('Rit loopt nog — meting gaat verder'); }
if (code) sync(); else showGate();
