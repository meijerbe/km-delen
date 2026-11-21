// Leest het tabblad "Overige kosten" uit de (openbaar gedeelde) Google Sheet via de gviz-uitvoer.
// Werkt zonder Apps Script; regels die de app zelf schreef (kolom App-id) worden overgeslagen.

import { createHash } from 'node:crypto';

export const COSTS_TAB = 'Overige kosten';

const pad = (n) => String(n).padStart(2, '0');

/** "€2,583.02", "€ 13,10", 13.1 → getal */
export function parseMoney(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[€\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/** gviz "Date(2026,3,17)" (maand 0-based), "2026-04-17", "17-4-2026" of Amerikaans "04-17-26" → "2026-04-17" */
export function parseDate(v, f) {
  const s = String(v ?? '').trim();
  let m = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2] + 1)}-${pad(m[3])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = String(f ?? s).trim();
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    // De sheet gebruikt Amerikaanse notatie (MM-DD-JJ); alleen als dat niet kan, DD-MM.
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

const hhOf = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'klein' ? 'Klein' : s === 'groot' ? 'Groot' : null;
};

/** Haalt het JSON-object uit "google.visualization.Query.setResponse({...});" */
export function unwrapGviz(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Onverwacht antwoord van Google Sheets');
  return JSON.parse(text.slice(start, end + 1));
}

/** gviz-tabel → kostenregels */
export function parseCostsTable(table) {
  const labels = (table.cols || []).map((c) => String(c.label || '').trim());
  let rows = (table.rows || []).map((r) => (r.c || []).map((c) => (c ? { v: c.v, f: c.f } : { v: null })));
  // Zonder herkende kopregel: eerste rij als koppen gebruiken
  let header = labels;
  if (!header.some((h) => /^kosten$/i.test(h)) && rows.length) {
    header = rows[0].map((c) => String(c.v ?? '').trim());
    rows = rows.slice(1);
  }
  const col = (re) => header.findIndex((h) => re.test(h));
  const c = { cost: col(/^(kosten|bedrag)/i), desc: col(/^(beschrijving|omschrijving)/i), date: col(/^datum/i), hh: col(/betaald\s*door/i), id: col(/^app-id$/i) };
  if (c.cost < 0 || c.date < 0) throw new Error('Kolommen Kosten/Datum niet gevonden in Overige kosten');

  const seen = new Map(), out = [];
  for (const r of rows) {
    if (c.id >= 0 && String(r[c.id]?.v ?? '').trim()) continue;            // komt uit de app
    const cost = parseMoney(r[c.cost]?.v ?? r[c.cost]?.f);
    const date = parseDate(r[c.date]?.v, r[c.date]?.f);
    const desc = c.desc >= 0 ? String(r[c.desc]?.v ?? '').trim().slice(0, 80) : '';
    const hh = c.hh >= 0 ? hhOf(r[c.hh]?.v) : null;
    if (!(cost > 0) || !date || !hh) continue;
    const key = [date, Math.round(cost * 100), desc, hh].join('|');
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    out.push({ id: `k${createHash('sha1').update(key).digest('hex').slice(0, 12)}${n > 1 ? `-${n}` : ''}`, type: 'kost', date, cost: Math.round(cost * 100) / 100, desc, hh, src: 'sheet' });
  }
  return out;
}

let cache = { at: 0, data: null, key: '' };
/** Leest de kosten (met 60 s cache per functie-instantie). */
export async function fetchSheetCosts(sheetId, { fetchFn = fetch, maxAgeMs = 60_000 } = {}) {
  if (!sheetId) throw new Error('SPREADSHEET_ID is niet ingesteld');
  if (cache.data && cache.key === sheetId && Date.now() - cache.at < maxAgeMs) return cache.data;
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(COSTS_TAB)}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Google Sheets gaf ${res.status}`);
  const json = unwrapGviz(await res.text());
  if (json.status === 'error') throw new Error(`Google Sheets: ${json.errors?.[0]?.detailed_message || json.errors?.[0]?.message || 'fout'}`);
  const data = parseCostsTable(json.table || {});
  cache = { at: Date.now(), data, key: sheetId };
  return data;
}

export const _resetCostsCache = () => { cache = { at: 0, data: null, key: '' }; };
