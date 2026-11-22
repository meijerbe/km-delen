// Ritten en tankbeurten via het Google-formulier in form_data zetten.
// form_data is beveiligd (geen script mag erin schrijven), het formulier wel: zo komt een app-rit erin als gewone formulierregel.
// Aanpassen of verwijderen van wat er eenmaal in staat, gaat via de spreadsheet.

import { fetchSheetRides } from './costs.js';
import { rideSig } from '../public/core.js';

/** Vragen van het formulier "Disco Polo" (entry-nummers). Het formulier-ID staat in FORM_ID. */
export const FORM_FIELDS = { date: 77585565, hh: 2518882, km: 1326077704, getankt: 1884246097, cost: 628239698, lp: 269946942 };

export function formBody(e, F = FORM_FIELDS) {
  const [y, m, d] = e.date.split('-').map(Number);
  const p = new URLSearchParams();
  p.set(`entry.${F.date}_year`, String(y));
  p.set(`entry.${F.date}_month`, String(m));
  p.set(`entry.${F.date}_day`, String(d));
  p.set(`entry.${F.hh}`, e.hh);
  p.set(`entry.${F.km}`, String(e.type === 'rit' ? e.km : 0));          // verplicht; tankbeurt zonder rit = 0 km
  p.set(`entry.${F.getankt}`, e.type === 'tank' ? 'Yes' : 'No');
  if (e.type === 'tank') {
    p.set(`entry.${F.cost}`, String(e.cost));
    if (e.lp) p.set(`entry.${F.lp}`, String(e.lp));
  }
  p.set('fvv', '1');
  p.set('pageHistory', '0,1,2');                                      // formulier heeft drie secties
  return p;
}

export async function submitForm(formId, e, fetchFn = fetch) {
  const res = await fetchFn(`https://docs.google.com/forms/d/e/${encodeURIComponent(formId)}/formResponse`, {
    method: 'POST', body: formBody(e).toString(), redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  if (res.status !== 200) throw new Error(`Formulier gaf ${res.status}${res.status >= 300 && res.status < 400 ? ' (inloggen vereist?)' : ''}`);
  const t = await res.text();
  // Bevestigingspagina; bij een fout toont Google het formulier opnieuw
  if (!/form_confirm|freebirdFormviewerViewResponseConfirmationMessage|vHW8K/.test(t)) throw new Error('Formulier gaf geen bevestiging');
}

const isRide = (r) => ['rit', 'tank'].includes(r.data?.type);

/**
 * Verstuurt nieuwe ritten/tankbeurten via het formulier. Eerst kijken of ze er al staan (eerdere poging zonder
 * bevestiging, of dezelfde invoer met de hand via het formulier): dan niet nog eens.
 */
export async function pushRidesViaForm(store, cfg, rows) {
  if (!rows.length) return 0;
  const sheet = await fetchSheetRides(cfg.sheetId, { maxAgeMs: 0, ...(cfg.fetch ? { fetchFn: cfg.fetch } : {}) });
  const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const inSheet = new Map(), known = new Map();
  for (const e of sheet) inc(inSheet, rideSig(e));
  for (const r of await store.list()) if (!r.deleted && r.synced && isRide(r)) inc(known, rideSig(r.data));
  let done = 0;
  for (const r of rows) {
    const s = rideSig(r.data);
    try {
      if ((inSheet.get(s) || 0) <= (known.get(s) || 0)) { await submitForm(cfg.formId, r.data, cfg.fetch); inc(inSheet, s); }
      await store.markSynced(r.id, r.upd); inc(known, s); done++;
    } catch (err) { console.error('formulier', r.id, err.message); }
  }
  return done;
}

/** Ritten/tankbeurten uit de wachtrij: nieuwe via het formulier, verwijderde zijn klaar (de sheet pas je zelf aan). */
export async function pushRides(store, cfg, rows) {
  let done = 0;
  for (const r of rows.filter((x) => x.deleted)) { await store.markSynced(r.id, r.upd); done++; }
  return done + await pushRidesViaForm(store, cfg, rows.filter((x) => !x.deleted));
}
export { isRide };
