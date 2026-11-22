// form_data (formulier-invoer) omzetten naar app-regels: ritten en tankbeurten.
// Stabiele ids uit de inhoud, zodat dezelfde regel steeds dezelfde id krijgt.

import { createHash } from 'node:crypto';
import { cleanEntry } from './validate.js';

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
