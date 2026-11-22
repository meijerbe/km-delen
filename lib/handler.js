// /api/entries
//   GET  → alle regels (incl. verwijderde, zodat andere telefoons die ook weghalen)
//   POST → { puts: [regel], dels: [{ id, upd }] }; nieuwste `upd` wint
// /api/costs   → wat in de spreadsheet staat: ritten/tankbeurten, kosten, betalingen
// /api/places  → plekken op de buurtkaart
// /api/health  → database wakker houden, wachtrij naar de sheet wegwerken
// Toegang (behalve health) met de groepscode in header `x-groep`.

import { createHash, timingSafeEqual } from 'node:crypto';
import { cleanEntry } from './validate.js';
import { pushToSheet } from './sheet.js';
import { fetchSheetCosts, fetchSheetPayments, fetchSheetRides } from './costs.js';
import { resolvePlaces } from './places.js';
import { computeRides } from '../public/core.js';

const MAX_BATCH = 500;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const digest = (s) => createHash('sha256').update(String(s)).digest();

export function codeMatches(given, expected) {
  if (!expected || !given) return false;
  return timingSafeEqual(digest(given.trim()), digest(expected.trim()));
}

/**
 * @param {Request} request
 * @param {{ store: () => import('./store.js').Store, code: string | undefined, sheet?: object | null }} ctx
 *   `store` is een functie zodat een ontbrekende database pas na de codecontrole een fout geeft.
 *   `sheet` is de spreadsheet-koppeling (of null als die niet is ingesteld).
 */
async function open(request, ctx) {
  if (!ctx.code) return { error: json(500, { error: 'GROUP_CODE is niet ingesteld op de server' }) };
  if (!codeMatches(request.headers.get('x-groep'), ctx.code)) return { error: json(401, { error: 'Onjuiste groepscode' }) };
  try {
    const store = ctx.store();
    await store.init();
    return { store };
  } catch (err) {
    console.error('database', err);
    return { error: json(503, { error: 'Database niet bereikbaar' }) };
  }
}

/** Ritten met kilometerstand: km opnieuw afleiden (een achteraf ingevulde rit verandert de volgende). */
async function refreshDerivedKm(store) {
  const rows = (await store.list()).filter((r) => !r.deleted);
  const { km } = computeRides(rows.map((r) => ({ ...r.data, id: r.id })));
  for (const r of rows) {
    const k = km.get(r.id);
    // Staat de rit al in de sheet, dan is die de bron: niet herberekenen en opnieuw versturen.
    if (r.synced) continue;
    if (r.data.type === 'rit' && r.data.stand != null && k?.derived && k.km !== r.data.km) {
      await store.upsert(r.id, { ...r.data, km: k.km }, r.upd + 1, false);
    }
  }
}

/** Naar de sheet sturen mag nooit het opslaan laten mislukken; wat blijft hangen gaat later mee. */
async function syncSheet(store, sheet) {
  if (!sheet) return null;
  try { return await pushToSheet(store, sheet); }
  catch (err) { console.error('sheet', err.message); return null; }
}

export async function handle(request, ctx) {
  const { store, error } = await open(request, ctx);
  if (error) return error;

  try {
    if (request.method === 'GET') {
      const rows = await store.list();
      return json(200, {
        entries: rows.map((r) => (r.deleted ? { id: r.id, upd: r.upd, deleted: true } : { ...r.data, upd: r.upd, ...(r.synced ? { synced: true } : {}) })),
      });
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json(400, { error: 'Ongeldige JSON' });
      }
      const puts = Array.isArray(body?.puts) ? body.puts : [];
      const dels = Array.isArray(body?.dels) ? body.dels : [];
      if (puts.length + dels.length > MAX_BATCH) return json(413, { error: 'Te veel regels in één keer' });

      const rejected = [];
      let applied = 0;
      // Ritten/tankbeurten die al in de sheet staan, pas je daar aan (via het formulier kunnen we ze niet wijzigen).
      const locked = puts.some((p) => p?.type === 'rit' || p?.type === 'tank')
        ? new Set((await store.list()).filter((r) => r.synced && !r.deleted && ['rit', 'tank'].includes(r.data?.type)).map((r) => r.id))
        : new Set();
      for (const raw of puts) {
        const e = cleanEntry(raw);
        if (!e || locked.has(e.id)) { rejected.push(raw?.id ?? null); continue; }
        const { upd, ...data } = e;
        if (await store.upsert(e.id, data, upd, false)) applied++;
      }
      // Van een verwijderde regel bewaren we het type: bepaalt of hij via het script (kosten/betalingen) moet.
      const prev = dels.length ? new Map((await store.list()).map((r) => [r.id, r.data || {}])) : new Map();
      for (const d of dels) {
        if (typeof d?.id !== 'string' || !(Number(d.upd) > 0)) { rejected.push(d?.id ?? null); continue; }
        const type = prev.get(d.id)?.type;
        if (await store.upsert(d.id, type ? { type } : {}, Number(d.upd), true)) applied++;
      }
      if (applied) {
        await refreshDerivedKm(store);
        await syncSheet(store, ctx.sheet);
      }
      return json(200, { ok: true, applied, rejected });
    }

    return json(405, { error: 'Methode niet toegestaan' });
  } catch (err) {
    console.error('handler', err);
    return json(500, { error: 'Serverfout' });
  }
}

/** GET /api/costs: kosten (Overige kosten) en betalingen (Verrekeningen) uit de sheet. De sheet is de bron. */
const sheetUrl = (id) => (id && /^[\w-]{20,}$/.test(id) ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null);

export async function handleCosts(request, ctx) {
  if (request.method !== 'GET') return json(405, { error: 'Methode niet toegestaan' });
  if (!ctx.code) return json(500, { error: 'GROUP_CODE is niet ingesteld op de server' });
  if (!codeMatches(request.headers.get('x-groep'), ctx.code)) return json(401, { error: 'Onjuiste groepscode' });
  const costsSync = !!ctx.sheet?.url;
  try {
    const [costs, payments, rides] = await Promise.all([
      ctx.sheetCosts ? ctx.sheetCosts() : fetchSheetCosts(ctx.sheetId),
      (ctx.sheetPayments ? ctx.sheetPayments() : fetchSheetPayments(ctx.sheetId)).catch((err) => { console.error('payments', err.message); return []; }),
      // null = sheet niet gelezen; de app toont dan de database
      (ctx.sheetRides ? ctx.sheetRides() : fetchSheetRides(ctx.sheetId)).catch((err) => { console.error('rides', err.message); return null; }),
    ]);
    return json(200, { costs, payments, rides, costsSync, sheetUrl: sheetUrl(ctx.sheetId) });
  } catch (err) {
    console.error('costs', err.message);
    return json(502, { error: `Kosten lezen mislukt: ${err.message}`, costs: [], payments: [], costsSync, sheetUrl: sheetUrl(ctx.sheetId) });
  }
}

/** GET /api/places: jullie plekken (huizen, bakker) als RD-coördinaten, alleen met de groepscode. */
export async function handlePlaces(request, ctx) {
  if (request.method !== 'GET') return json(405, { error: 'Methode niet toegestaan' });
  if (!ctx.code) return json(500, { error: 'GROUP_CODE is niet ingesteld op de server' });
  if (!codeMatches(request.headers.get('x-groep'), ctx.code)) return json(401, { error: 'Onjuiste groepscode' });
  return json(200, { places: await resolvePlaces(ctx.places, ctx.fetch) });
}

/** Openbare gezondheidscheck: doet één echte query (houdt Supabase wakker), geeft geen gegevens terug.
 *  Stuurt ook achtergebleven wijzigingen alsnog naar de sheet. */
export async function health(ctx) {
  try {
    const store = ctx.store();
    await store.init();
    await store.ping();
    // Alleen aantallen, geen inhoud: health is openbaar.
    const out = { ok: true };
    if (ctx.sheet) {
      try {
        out.naarSheet = await pushToSheet(store, ctx.sheet);
        out.wachtrij = (await store.unsynced(500)).length;
      } catch (err) { console.error('sheet', err.message); out.sheetFout = err.message.slice(0, 120); }
    }
    return json(200, out);
  } catch (err) {
    console.error('health', err);
    return json(503, { ok: false, error: 'Database niet bereikbaar' });
  }
}
