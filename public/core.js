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
    .filter((e) => !monthKey || e.date.slice(0, 7) === monthKey)
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
