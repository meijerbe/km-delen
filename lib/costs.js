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

export const PAYMENTS_TAB = 'Verrekeningen';

/** gviz-tabel → koppen + rijen; zonder herkende kopregel wordt de eerste rij als kop gebruikt */
function tableRows(table, isHeader) {
  const labels = (table.cols || []).map((c) => String(c.label || '').trim());
  let rows = (table.rows || []).map((r) => (r.c || []).map((c) => (c ? { v: c.v, f: c.f } : { v: null })));
  let header = labels;
  if (!header.some(isHeader) && rows.length) {
    header = rows[0].map((c) => String(c.v ?? '').trim());
    rows = rows.slice(1);
  }
  return { header, rows, col: (re) => header.findIndex((h) => re.test(h)) };
}
const hashId = (prefix, key) => `${prefix}${createHash('sha1').update(key).digest('hex').slice(0, 12)}`;
const cell = (r, i) => (i >= 0 ? r[i]?.v : undefined);

/**
 * gviz-tabel → kostenregels. De sheet is de bron: een regel met App-id krijgt die id,
 * zodat de app zijn eigen (nog niet bijgewerkte) kopie kan vervangen door wat er in de sheet staat.
 */
export function parseCostsTable(table) {
  const { rows, col } = tableRows(table, (h) => /^kosten$/i.test(h));
  const c = { cost: col(/^(kosten|bedrag)/i), desc: col(/^(beschrijving|omschrijving)/i), date: col(/^datum/i), hh: col(/betaald\s*door/i), id: col(/^app-id$/i) };
  if (c.cost < 0 || c.date < 0) throw new Error('Kolommen Kosten/Datum niet gevonden in Overige kosten');

  const seen = new Map(), out = [];
  for (const r of rows) {
    const cost = parseMoney(r[c.cost]?.v ?? r[c.cost]?.f);
    const date = parseDate(r[c.date]?.v, r[c.date]?.f);
    const desc = c.desc >= 0 ? String(cell(r, c.desc) ?? '').trim().slice(0, 80) : '';
    const hh = c.hh >= 0 ? hhOf(cell(r, c.hh)) : null;
    if (!(cost > 0) || !date || !hh) continue;
    const appId = String(cell(r, c.id) ?? '').trim();
    const key = [date, Math.round(cost * 100), desc, hh].join('|');
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    out.push({ id: appId || `${hashId('k', key)}${n > 1 ? `-${n}` : ''}`, type: 'kost', date, cost: Math.round(cost * 100) / 100, desc, hh, src: 'sheet', ...(appId ? { app: true } : {}) });
  }
  return out;
}

const yes = (v) => v === true || (typeof v === 'string' && v.trim() !== '' && !/^(nee|no|false|0|-)$/i.test(v.trim())) || (typeof v === 'number' && v !== 0);

/** gviz-tabel → betalingen tussen de stellen (tabblad Verrekeningen). Ontbreekt het tabblad, dan []. */
export function parsePaymentsTable(table) {
  const { rows, col } = tableRows(table, (h) => /^van$/i.test(h));
  const c = { date: col(/^datum/i), from: col(/^van$/i), amount: col(/^bedrag/i), note: col(/^notitie|omschrijving/i), ok: col(/^bevestigd/i), id: col(/^app-id$/i) };
  if (c.from < 0 || c.amount < 0 || c.date < 0) return [];          // geen Verrekeningen-tabblad
  const seen = new Map(), out = [];
  for (const r of rows) {
    const amount = parseMoney(r[c.amount]?.v ?? r[c.amount]?.f);
    const date = parseDate(r[c.date]?.v, r[c.date]?.f);
    const hh = hhOf(cell(r, c.from));
    if (!(amount > 0) || !date || !hh) continue;
    const note = c.note >= 0 ? String(cell(r, c.note) ?? '').trim().slice(0, 80) : '';
    const appId = String(cell(r, c.id) ?? '').trim();
    const key = [date, Math.round(amount * 100), hh, note].join('|');
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    out.push({
      id: appId || `${hashId('v', key)}${n > 1 ? `-${n}` : ''}`, type: 'betaling', date, hh, amount: Math.round(amount * 100) / 100,
      ...(note ? { note } : {}), ...(c.ok >= 0 && yes(cell(r, c.ok)) ? { ok: true } : {}), src: 'sheet', ...(appId ? { app: true } : {}),
    });
  }
  return out;
}

const caches = new Map();
async function fetchTab(sheetId, tab, parse, { fetchFn = fetch, maxAgeMs = 60_000 } = {}) {
  if (!sheetId) throw new Error('SPREADSHEET_ID is niet ingesteld');
  const key = `${sheetId}|${tab}`, hit = caches.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data;
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(tab)}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Google Sheets gaf ${res.status}`);
  const json = unwrapGviz(await res.text());
  if (json.status === 'error') throw new Error(`Google Sheets: ${json.errors?.[0]?.detailed_message || json.errors?.[0]?.message || 'fout'}`);
  const data = parse(json.table || {});
  caches.set(key, { at: Date.now(), data });
  return data;
}

/** Leest de kosten (met 60 s cache per functie-instantie). */
export const fetchSheetCosts = (sheetId, opts) => fetchTab(sheetId, COSTS_TAB, parseCostsTable, opts);
/** Leest de betalingen; een ontbrekend tabblad geeft een lege lijst. */
export async function fetchSheetPayments(sheetId, opts) {
  try { return await fetchTab(sheetId, PAYMENTS_TAB, parsePaymentsTable, opts); }
  catch (err) { if (/niet gevonden|Invalid sheet|Unable to parse/i.test(err.message)) return []; throw err; }
}

/** Voor de health-check: welke kolomkoppen ziet Google op het tabblad Verrekeningen (geen inhoud). */
export async function paymentsTabHeaders(sheetId, fetchFn = fetch, tab = PAYMENTS_TAB) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(tab)}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  const json = unwrapGviz(await res.text());
  if (json.status === 'error') return { fout: String(json.errors?.[0]?.message || 'fout').slice(0, 80) };
  return { kolommen: (json.table?.cols || []).map((c) => String(c.label || '').slice(0, 30)) };
}

export const _resetCostsCache = () => caches.clear();
