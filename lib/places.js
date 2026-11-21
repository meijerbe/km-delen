// Bijzondere plekken op de buurtkaart (jullie huizen, de bakker).
// De adressen staan alleen in de geheime instelling PLACES (Vercel), nooit in de openbare kaartdata.
// De server zoekt ze op bij PDOK Locatieserver en geeft alleen RD-coördinaten terug aan wie de groepscode heeft.

const PDOK = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
const KINDS = ['kasteel', 'bakker', 'plek'];

/** PLACES = JSON-lijst van { key, label, kind, hh?, adres } */
export function parsePlaces(raw) {
  if (!raw) return [];
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p.adres === 'string' && p.adres.trim() && typeof p.key === 'string')
    .map((p) => ({
      key: p.key.slice(0, 40), label: String(p.label || p.key).slice(0, 40),
      kind: KINDS.includes(p.kind) ? p.kind : 'plek', hh: ['Klein', 'Groot'].includes(p.hh) ? p.hh : null, adres: p.adres.trim(),
    }));
}

const cache = new Map();
/** Adres → [x, y] in Rijksdriehoek, of null */
export async function geocode(adres, fetchFn = fetch) {
  if (cache.has(adres)) return cache.get(adres);
  const url = `${PDOK}?q=${encodeURIComponent(adres)}&fq=type:adres&rows=1&fl=weergavenaam,centroide_rd`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`PDOK gaf ${res.status}`);
  const doc = (await res.json())?.response?.docs?.[0];
  const m = doc?.centroide_rd?.match(/POINT\(([\d.]+)\s+([\d.]+)\)/);
  const rd = m ? [Math.round(+m[1] * 10) / 10, Math.round(+m[2] * 10) / 10] : null;
  cache.set(adres, rd);
  return rd;
}

export async function resolvePlaces(raw, fetchFn) {
  const out = [];
  for (const p of parsePlaces(raw)) {
    try {
      const rd = await geocode(p.adres, fetchFn);
      if (rd) out.push({ key: p.key, label: p.label, kind: p.kind, hh: p.hh, rd });
      else console.warn('plek niet gevonden', p.key);
    } catch (err) { console.error('geocode', p.key, err.message); }
  }
  return out;
}

export const _clearPlaceCache = () => cache.clear();
