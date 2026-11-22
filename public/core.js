// Pure rekenlogica, zonder DOM: GPS-afstand, kilometerstanden, totalen en Excel-export.

export const HOUSEHOLDS = ['Klein', 'Groot'];

// ---------- GPS ----------
export const GPS = { MAX_ACC: 40, MIN_STEP: 12, MAX_STEP_NOISE: 30, MAX_SPEED: 70, LONG_GAP_S: 30 };

export function haversine(a, b) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Verwerkt één GPS-fix. `last` is de laatst geaccepteerde fix ({lat, lon, t(ms), acc}).
 * Geeft { last, add } terug: de nieuwe referentie en het aantal meters dat erbij komt.
 * Negeert onnauwkeurige fixes, stilstand-ruis en onmogelijke sprongen; na een lange
 * onderbreking (scherm uit, tunnel) telt de rechte lijn wel mee.
 */
export function trackStep(last, fix) {
  if (!(fix.acc <= GPS.MAX_ACC)) return { last, add: 0 };
  if (!last) return { last: fix, add: 0 };
  const d = haversine(last, fix);
  const dt = Math.max(0.5, (fix.t - last.t) / 1000);
  const noise = Math.max(GPS.MIN_STEP, Math.min(GPS.MAX_STEP_NOISE, (last.acc + fix.acc) / 2));
  if (d < noise) return { last, add: 0 };
  if (d / dt > GPS.MAX_SPEED && dt < GPS.LONG_GAP_S) return { last, add: 0 };
  return { last: fix, add: d };
}

// ---------- ritten & kilometerstanden ----------
const rideKey = (e) => `${e.date}|${String(Math.round(e.t || 0)).padStart(15, '0')}|${e.id}`;
export const byTime = (a, b) => (rideKey(a) < rideKey(b) ? -1 : rideKey(a) > rideKey(b) ? 1 : 0);

/**
 * Berekent per rit de kilometers die meetellen.
 * - Rit zonder stand: de ingevoerde/gemeten km.
 * - Rit met stand: stand − (vorige stand + km van tussenliggende ritten zonder stand).
 *   Zo verschuift een vergeten rit die je achteraf invult automatisch km van de
 *   eerstvolgende stand-rit naar de juiste bestuurder.
 * - Eerste stand ooit: de ingevoerde km (er is nog geen vorige stand).
 * - `vast` (ingelezen uit de sheet): de km uit de sheet tellen, de stand zet alleen de teller.
 * Geeft Map id → { km, derived, warn } en `counter`: de verwachte stand nu (of null).
 */
export function computeRides(entries) {
  const rides = entries.filter((e) => e.type === 'rit').sort(byTime);
  const out = new Map();
  let counter = null;
  for (const r of rides) {
    if (r.stand != null && r.vast) {
      out.set(r.id, { km: r.km || 0, derived: false, warn: false });
      counter = r.stand;
    } else if (r.stand != null) {
      if (counter != null) {
        const diff = r.stand - counter;
        const warn = diff < 0 || diff > 2000;
        out.set(r.id, { km: Math.max(0, Math.round(diff)), derived: true, warn });
      } else {
        out.set(r.id, { km: r.km || 0, derived: false, warn: false });
      }
      counter = r.stand;
    } else {
      out.set(r.id, { km: r.km || 0, derived: false, warn: false });
      if (counter != null) counter += r.km || 0;
    }
  }
  return { km: out, counter };
}

/** Verwachte kilometerstand vlak vóór een rit op `date` (nieuw: t = nu), zonder `excludeId`. */
export function counterBefore(entries, date, t, excludeId) {
  const probe = { id: '￿', date, t };
  const before = entries.filter((e) => e.type === 'rit' && e.id !== excludeId && byTime(e, probe) < 0);
  return computeRides(before).counter;
}

// ---------- totalen ----------
export function totals(entries, monthKey) {
  const { km } = computeRides(entries);
  const t = { Klein: 0, Groot: 0, kosten: 0, ritten: 0, tank: { Klein: 0, Groot: 0 } };
  for (const e of entries) {
    if (monthKey && e.date.slice(0, 7) !== monthKey) continue;
    if (e.type === 'rit') { t[e.hh] += km.get(e.id)?.km ?? 0; t.ritten++; }
    else if (e.type === 'tank') { t.kosten += e.cost; t.tank[e.hh] += e.cost; }
  }
  return t;
}

// ---------- Excel ----------
export const EXCEL_HEADER = ['Date', 'Bestuurder', 'Bijrijders', 'Aantal kilometers', 'Kosten Tanken', 'Literprijs', 'Kilometerstand'];

/** Tab-gescheiden tekst die in Excel direct in kolommen valt (zelfde volgorde als de bestaande sheet). */
export function excelText(entries, monthKey, withHeader) {
  const { km } = computeRides(entries);
  const rows = entries
    .filter((e) => (e.type === 'rit' || e.type === 'tank') && (!monthKey || e.date.slice(0, 7) === monthKey))
    .sort(byTime)
    .map((e) => e.type === 'rit'
      ? [e.date, e.hh, e.bij || '', km.get(e.id)?.km ?? e.km, '', '', e.stand ?? '']
      : [e.date, e.hh, '', '', e.cost.toFixed(2), e.lp != null ? String(e.lp) : '', '']);
  if (withHeader) rows.unshift(EXCEL_HEADER);
  return rows.map((r) => r.join('\t')).join('\n');
}

// ---------- invoer ----------
/** Leest "78,46" of "78.46". Met `thousands` ook "45.678" als kilometerstand 45678. */
export function parseNum(s, thousands = false) {
  const t = String(s ?? '').replace(/[\s€]/g, '');
  const norm = thousands && /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.replace(',', '.');
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : NaN;
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- kosten ----------
export const CATEGORIES = [
  { key: 'Verzekering', emo: '🛡️', color: '#7C9CF0', re: /centraal\s*beheer|verzeker|pechhulp|anwb|allianz|interpolis|fbto|ohra/i },
  { key: 'Belasting', emo: '🏛️', color: '#B48CE0', re: /belasting|mrb/i },
  { key: 'Onderhoud', emo: '🔧', color: '#F2B33D', re: /apk|onderhoud|reparat|vervang|voorruit|ruit|band|olie|lamp|licht|accu|garage|wasstraat|poets/i },
  { key: 'Parkeren', emo: '🅿️', color: '#4FB6A8', re: /parkeer|parkeren|vergunning/i },
  { key: 'Reizen', emo: '🧳', color: '#EE8A6B', re: /vignet|tol|veer|péage|maut/i },
  { key: 'Overig', emo: '📎', color: '#B8AFA4', re: /.*/ },
];
export const FUEL = { key: 'Brandstof', emo: '⛽', color: '#2FA37A' };
export const categoryOf = (desc) => CATEGORIES.find((c) => c.re.test(desc || '')) || CATEGORIES.at(-1);

const DUTCH_MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

/**
 * Inzicht in alle kosten. `costs` = vaste kosten (uit de sheet en uit de app), `entries` = ritten/tankbeurten.
 * Afrekening: brandstof naar verhouding van de km, vaste kosten 50/50, min wat elk stel al betaalde.
 */
export function costInsights(entries, costs, now = new Date(), payments = []) {
  const t = totals(entries);
  const km = t.Klein + t.Groot;
  const fuel = t.kosten;
  const fixed = costs.reduce((s, c) => s + c.cost, 0);

  const cats = new Map([[FUEL.key, { ...FUEL, total: fuel }], ...CATEGORIES.map((c) => [c.key, { ...c, total: 0 }])]);
  for (const c of costs) cats.get(categoryOf(c.desc).key).total += c.cost;

  const months = new Map();
  const addMonth = (date, v) => { const k = date.slice(0, 7); months.set(k, (months.get(k) || 0) + v); };
  costs.forEach((c) => addMonth(c.date, c.cost));
  entries.filter((e) => e.type === 'tank').forEach((e) => addMonth(e.date, e.cost));

  // Afrekening
  const paidFixed = { Klein: 0, Groot: 0 };
  costs.forEach((c) => { paidFixed[c.hh] += c.cost; });
  // Betalingen tussen de stellen: wie betaalde, lost zijn schuld af
  const paidOut = { Klein: 0, Groot: 0 };
  for (const p of payments) paidOut[p.hh] += p.amount;
  const settle = {};
  for (const h of HOUSEHOLDS) {
    const other = h === 'Klein' ? 'Groot' : 'Klein';
    const fuelShare = km ? (t[h] / km) * fuel : fuel / 2;
    const fuelPart = t.tank[h] - fuelShare;
    const fixedPart = paidFixed[h] - fixed / 2;
    const paidPart = paidOut[h] - paidOut[other];
    settle[h] = { fuelPart, fixedPart, paidPart, net: fuelPart + fixedPart + paidPart };
  }
  const debtor = settle.Klein.net < settle.Groot.net ? 'Klein' : 'Groot';
  const creditor = debtor === 'Klein' ? 'Groot' : 'Klein';
  const amount = Math.round(((settle[creditor].net - settle[debtor].net) / 2) * 100) / 100;

  // Weetjes
  const facts = [];
  const byDate = [...costs].sort((a, b) => a.date.localeCompare(b.date));
  const ins = byDate.filter((c) => categoryOf(c.desc).key === 'Verzekering' && !/pech/i.test(c.desc)).at(-1);
  if (ins) facts.push({ emo: '🛡️', text: `De verzekering kost zo'n € ${(ins.cost * 12 / 365).toFixed(2).replace('.', ',')} per dag` });
  const repairs = costs.filter((c) => ['Onderhoud', 'Reizen', 'Overig'].includes(categoryOf(c.desc).key) && !/apk/i.test(c.desc));
  const top = repairs.sort((a, b) => b.cost - a.cost)[0];
  if (top) facts.push({ emo: '😬', text: `Duurste klus: ${top.desc.toLowerCase()} (€ ${Math.round(top.cost)})` });
  const tax = byDate.filter((c) => categoryOf(c.desc).key === 'Belasting').at(-1);
  const until = tax?.desc.match(/t\/?m\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
  if (until) {
    const mi = DUTCH_MONTHS.indexOf(until[2].toLowerCase());
    const end = mi >= 0 ? new Date(+until[3], mi, +until[1]) : null;
    if (end && end >= now) facts.push({ emo: '🗓️', text: `Wegenbelasting betaald t/m ${until[1]} ${until[2]}` });
    else if (end) facts.push({ emo: '⚠️', text: `Wegenbelasting liep tot ${until[1]} ${until[2]}: tijd voor de volgende` });
  }
  const apk = byDate.filter((c) => /apk/i.test(c.desc)).at(-1);
  if (apk) {
    const next = new Date(`${apk.date}T12:00`); next.setFullYear(next.getFullYear() + 1);
    const monthsLeft = Math.round((next - now) / (30.44 * 864e5));
    facts.push({ emo: '🔍', text: monthsLeft > 0 ? `Volgende APK over zo'n ${monthsLeft} maand${monthsLeft === 1 ? '' : 'en'}` : 'De APK is (bijna) weer aan de beurt!' });
  }
  const monthCount = months.size;
  if (monthCount >= 2) facts.push({ emo: '📅', text: `Gemiddeld € ${Math.round((fixed + fuel) / monthCount)} per maand voor de Polo` });
  if (km) facts.push({ emo: '🚗', text: `Per stel per maand ± € ${Math.round((fixed + fuel) / Math.max(1, monthCount) / 2)}: goedkoper dan een eigen auto 😉` });

  return {
    km, fuel, fixed, total: fuel + fixed,
    perKmFuel: km ? fuel / km : null, perKmAll: km ? (fuel + fixed) / km : null,
    cats: [...cats.values()].filter((c) => c.total > 0).sort((a, b) => b.total - a.total),
    months: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)),
    settle, debtor, creditor, amount, facts, paidTotal: paidOut.Klein + paidOut.Groot,
  };
}

// ---------- Rijksdriehoek (voor de buurt-kaart) ----------
/** WGS84 → RD (benadering, ± 1 m) */
export function toRD(lat, lon) {
  const dp = 0.36 * (lat - 52.15517440), dl = 0.36 * (lon - 5.38720621);
  const R = [[0, 1, 190094.945], [1, 1, -11832.228], [2, 1, -114.221], [0, 3, -32.391], [1, 0, -0.705], [3, 1, -2.340], [1, 3, -0.608], [0, 2, -0.008], [2, 3, 0.148]];
  const S = [[1, 0, 309056.544], [0, 2, 3638.893], [2, 0, 73.077], [1, 2, -157.984], [3, 0, 59.788], [0, 1, 0.433], [2, 2, -6.439], [1, 1, -0.032], [0, 4, 0.092], [1, 4, -0.054]];
  let x = 155000, y = 463000;
  for (const [p, q, r] of R) x += r * dp ** p * dl ** q;
  for (const [p, q, s] of S) y += s * dp ** p * dl ** q;
  return [x, y];
}
/** RD → WGS84 (benadering, ± 1 m) */
export function fromRD(x, y) {
  const dx = (x - 155000) * 1e-5, dy = (y - 463000) * 1e-5;
  const K = [[0, 1, 3235.65389], [2, 0, -32.58297], [0, 2, -0.24750], [2, 1, -0.84978], [0, 3, -0.06550], [2, 2, -0.01709], [1, 0, -0.00738], [4, 0, 0.00530], [2, 3, -0.00039], [4, 1, 0.00033], [1, 1, -0.00012]];
  const L = [[1, 0, 5260.52916], [1, 1, 105.94684], [1, 2, 2.45656], [3, 0, -0.81885], [1, 3, 0.05594], [3, 1, -0.05607], [0, 1, 0.01199], [3, 2, -0.00256], [1, 4, 0.00128], [0, 2, 0.00022], [2, 0, -0.00022], [5, 0, 0.00026]];
  let lat = 52.15517440, lon = 5.38720621;
  for (const [p, q, k] of K) lat += (k * dx ** p * dy ** q) / 3600;
  for (const [p, q, l] of L) lon += (l * dx ** p * dy ** q) / 3600;
  return [lat, lon];
}

/** Laatste parkeerplek (type 'park'; de nieuwste telt). */
export const PARK_ID = 'parkeerplek';
export const parkingOf = (entries) => entries.find((e) => e.id === PARK_ID && e.type === 'park') || null;
