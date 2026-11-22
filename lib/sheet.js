// Naar de Google Sheet schrijven en form_data lezen.
// - Ritten en tankbeurten: via het Google-formulier (lib/form.js), want form_data is beveiligd.
// - Kosten en betalingen: via het Apps Script in google-apps-script/Code.gs (Overige kosten, Verrekeningen).

import { pushRides, isRide } from './form.js';

export const sheetConfig = (env = process.env) =>
  (env.SHEET_WEBHOOK_URL && env.SHEET_TOKEN) || env.FORM_ID
    ? { url: env.SHEET_WEBHOOK_URL || null, token: env.SHEET_TOKEN || null, formId: env.FORM_ID || null, sheetId: env.SPREADSHEET_ID }
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

/** Stuurt wat nog niet in de sheet staat. Zonder formulier wachten ritten; zonder script wachten kosten en betalingen. */
export async function pushToSheet(store, cfg, { limit = 20, timeoutMs = 25000 } = {}) {
  if (!cfg) return 0;
  const rows = await store.unsynced(limit);
  if (!rows.length) return 0;
  let done = 0;
  const rides = rows.filter(isRide), rest = rows.filter((r) => !isRide(r));
  if (rides.length && cfg.formId) done += await pushRides(store, cfg, rides);
  if (!rest.length || !cfg.url) return done;
  const ops = rest.map((r) => (r.deleted ? { op: 'delete', id: r.id } : { op: 'upsert', entry: { ...r.data, id: r.id } }));
  const data = await call(cfg, { url: cfg.url, method: 'POST', body: JSON.stringify({ token: cfg.token, ops }) }, timeoutMs);
  const ok = new Set((data.results || []).filter((x) => x.ok).map((x) => x.id));
  for (const x of data.results || []) if (!x.ok) console.error('sheet-regel', x.id, x.error || 'geweigerd');
  for (const r of rest) if (ok.has(r.id)) { await store.markSynced(r.id, r.upd); done++; }
  return done;
}
