// Koppeling met de Google Sheet via het Apps Script in google-apps-script/Code.gs.
// - pushToSheet: stuurt regels die nog niet in de sheet staan (sheet_upd < upd) naar form_data.
// - parseSheet:  zet regels uit form_data (formulier-invoer) om naar app-regels.

import { createHash } from 'node:crypto';
import { cleanEntry } from './validate.js';

export const sheetConfig = (env = process.env) =>
  env.SHEET_WEBHOOK_URL && env.SHEET_TOKEN
    ? { url: env.SHEET_WEBHOOK_URL, token: env.SHEET_TOKEN, costs: env.SHEET_COSTS === '1' }
    : null;

async function call(cfg, init, timeoutMs) {
  const res = await (cfg.fetch || fetch)(init.url, {
    method: init.method, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
    headers: init.body ? { 'content-type': 'text/plain' } : undefined, body: init.body,
  });
  if (!res.ok) throw new Error(`Sheet gaf ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Sheet weigerde: ${data.error || 'onbekend'}`);
  return data;
}

/** Stuurt openstaande wijzigingen naar de sheet. Geeft het aantal verwerkte regels terug. */
export async function pushToSheet(store, cfg, { limit = 50, timeoutMs = 8000 } = {}) {
  if (!cfg) return 0;
  // Kosten en betalingen pas versturen als het script ze kan schrijven (SHEET_COSTS=1); tot die tijd wachten ze.
  const rows = await store.unsynced(limit, { costs: !!cfg.costs });
  if (!rows.length) return 0;
  const ops = rows.map((r) => (r.deleted ? { op: 'delete', id: r.id } : { op: 'upsert', entry: { ...r.data, id: r.id } }));
  const data = await call(cfg, { url: cfg.url, method: 'POST', body: JSON.stringify({ token: cfg.token, ops }) }, timeoutMs);
  const ok = new Set((data.results || []).filter((x) => x.ok).map((x) => x.id));
  let done = 0;
  for (const r of rows) if (ok.has(r.id)) { await store.markSynced(r.id, r.upd); done++; }
  return done;
}

// ---------- inlezen ----------
/** Kolommen in form_data (0-based, -1 = ontbreekt). Zelfde regels als in Code.gs. */
export function sheetColumns(header) {
  const f = (re) => findCol(header, re);
  const km = f(/^aantal\s+kilomet/i);
  return {
    date: f(/^(date|datum)\b/i), hh: f(/^(bestuurder|gebruiker)/i), bij: f(/bijrijder/i),
    km: km >= 0 ? km : f(/kilomet(?!erstand)/i), stand: f(/kilometerstand/i), getankt: f(/getankt/i),
    cost: f(/kosten/i), lp: f(/literprijs/i), id: f(/^app-id$/i),
  };
}

const findCol = (header, re) => header.findIndex((h) => re.test(String(h).trim()));
const num = (v) => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[\s€]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const toDate = (v) => {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);              // 19-4-2026 of 19/04/2026
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};
const hhOf = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'klein' ? 'Klein' : s === 'groot' ? 'Groot' : null;
};

/**
 * Zet de inhoud van form_data om naar app-regels. Regels die de app zelf schreef (App-id) worden
 * overgeslagen. Een regel met km én tankkosten wordt een rit plus een tankbeurt.
 * De id is afgeleid van de inhoud, zodat opnieuw inlezen geen dubbele regels geeft.
 * Geeft { entries, skipped } terug; skipped = regelnummers die niet te lezen waren.
 */
export function parseSheet(header, rows, now = Date.now()) {
  const c = sheetColumns(header);
  if (c.date < 0 || c.hh < 0) {
    const shown = header.filter((h) => String(h).trim()).slice(0, 12).map((h) => `"${String(h).trim()}"`).join(', ');
    throw new Error(`Kolommen Date/Gebruiker niet gevonden in form_data. Gevonden koppen: ${shown || '(eerste regel is leeg)'}`);
  }
  const seen = new Map(), entries = [], skipped = [], unknownUsers = new Set();
  rows.forEach((r, i) => {
    const rowNr = i + 2;
    if (c.id >= 0 && String(r[c.id] ?? '').trim()) return;           // komt uit de app
    if (r.every((v) => v === '' || v == null)) return;
    const date = toDate(r[c.date]), hh = hhOf(r[c.hh]);
    const km = c.km >= 0 ? num(r[c.km]) : NaN, cost = c.cost >= 0 ? num(r[c.cost]) : NaN, lp = c.lp >= 0 ? num(r[c.lp]) : NaN;
    const stand = c.stand >= 0 ? num(r[c.stand]) : NaN;
    const bij = c.bij >= 0 ? String(r[c.bij] ?? '').trim() : '';
    if (!hh && String(r[c.hh] ?? '').trim()) unknownUsers.add(String(r[c.hh]).trim());
    if (!date || !hh || !(km > 0 || cost > 0)) { skipped.push(rowNr); return; }
    const key = [date, hh, km || '', cost || '', lp || '', bij, stand || ''].join('|');
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    const base = `s${createHash('sha1').update(key).digest('hex').slice(0, 12)}${n > 1 ? `-${n}` : ''}`;
    const t = Date.parse(`${date}T12:00:00Z`) + i;                    // volgorde zoals in de sheet
    const common = { date, hh, t, upd: now };
    if (km > 0) {
      const e = cleanEntry({ ...common, id: `${base}r`, type: 'rit', km, src: 'handmatig', vast: true,
        ...(bij ? { bij } : {}), ...(stand > 0 ? { stand } : {}) });
      if (e) entries.push(e); else skipped.push(rowNr);
    }
    if (cost > 0) {
      const e = cleanEntry({ ...common, id: `${base}t`, type: 'tank', cost, ...(lp > 0 ? { lp } : {}) });
      if (e) entries.push(e); else skipped.push(rowNr);
    }
  });
  return { entries, skipped, unknownUsers: [...unknownUsers] };
}

/** Leest form_data in. Nieuwe regels worden als 'al in de sheet' gemarkeerd, dus niet teruggeschreven. */
export async function importFromSheet(store, cfg, { timeoutMs = 15000 } = {}) {
  if (!cfg) throw new Error('Spreadsheet-koppeling is niet ingesteld');
  const url = `${cfg.url}${cfg.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(cfg.token)}`;
  const data = await call(cfg, { url, method: 'GET' }, timeoutMs);
  const { entries, skipped, unknownUsers } = parseSheet(data.header || [], data.rows || []);
  const existing = new Set((await store.list()).map((r) => r.id));
  let added = 0;
  for (const e of entries) {
    if (existing.has(e.id)) continue;                                // ook verwijderde niet terugzetten
    const { upd, ...rest } = e;
    if (await store.upsert(e.id, rest, upd, false, { synced: true })) added++;
  }
  return { added, found: entries.length, skipped, unknownUsers };
}
