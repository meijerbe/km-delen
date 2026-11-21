// Controle en opschoning van één invoerregel (rit of tankbeurt).
// Gedeeld tussen API en tests; de browser vertrouwt de server als bron.

export const HOUSEHOLDS = ['Klein', 'Groot'];

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const inRange = (v, lo, hi) => v >= lo && v <= hi;

/** Geeft een opgeschoonde regel terug, of null als de invoer ongeldig is. */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.id !== 'string' || !ID_RE.test(e.id)) return null;
  if (typeof e.date !== 'string' || !DATE_RE.test(e.date) || Number.isNaN(Date.parse(e.date))) return null;
  if (!HOUSEHOLDS.includes(e.hh)) return null;
  const upd = num(e.upd);
  const t = num(e.t);
  if (!(upd > 0) || !(t > 0)) return null;

  const base = { id: e.id, type: e.type, date: e.date, hh: e.hh, t, upd };

  if (e.type === 'rit') {
    const km = num(e.km);
    if (!inRange(km, 0, 5000)) return null;
    const out = { ...base, km: Math.round(km), src: e.src === 'gps' ? 'gps' : 'handmatig' };
    if (e.stand != null) {
      const stand = num(e.stand);
      if (!inRange(stand, 0, 3_000_000)) return null;
      out.stand = Math.round(stand);
    }
    if (e.bij != null && e.bij !== '') {
      if (typeof e.bij !== 'string') return null;
      out.bij = e.bij.trim().slice(0, 60);
    }
    if (e.dur != null) {
      const dur = num(e.dur);
      if (inRange(dur, 0, 7 * 24 * 3600 * 1000)) out.dur = Math.round(dur);
    }
    return out;
  }

  if (e.type === 'tank') {
    const cost = num(e.cost);
    if (!(cost > 0) || cost > 1000) return null;
    const out = { ...base, cost: Math.round(cost * 100) / 100 };
    if (e.lp != null) {
      const lp = num(e.lp);
      if (!(lp > 0) || lp > 10) return null;
      out.lp = Math.round(lp * 1000) / 1000;
    }
    return out;
  }

  return null;
}
