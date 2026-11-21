// Eén endpoint: /api/entries
//   GET  → alle regels (incl. verwijderde, zodat andere telefoons die ook weghalen)
//   POST → { puts: [regel], dels: [{ id, upd }] }; nieuwste `upd` wint
// Toegang met de groepscode in header `x-groep`.

import { createHash, timingSafeEqual } from 'node:crypto';
import { cleanEntry } from './validate.js';

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
 * @param {{ store: () => import('./store.js').Store, code: string | undefined }} ctx
 *   `store` is een functie zodat een ontbrekende database pas na de codecontrole een fout geeft.
 */
export async function handle(request, ctx) {
  if (!ctx.code) return json(500, { error: 'GROUP_CODE is niet ingesteld op de server' });
  if (!codeMatches(request.headers.get('x-groep'), ctx.code)) return json(401, { error: 'Onjuiste groepscode' });

  let store;
  try {
    store = ctx.store();
    await store.init();
  } catch (err) {
    console.error('database', err);
    return json(503, { error: 'Database niet bereikbaar' });
  }

  try {
    if (request.method === 'GET') {
      const rows = await store.list();
      return json(200, {
        entries: rows.map((r) => (r.deleted ? { id: r.id, upd: r.upd, deleted: true } : { ...r.data, upd: r.upd })),
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
      for (const raw of puts) {
        const e = cleanEntry(raw);
        if (!e) { rejected.push(raw?.id ?? null); continue; }
        const { upd, ...data } = e;
        if (await store.upsert(e.id, data, upd, false)) applied++;
      }
      for (const d of dels) {
        if (typeof d?.id !== 'string' || !(Number(d.upd) > 0)) { rejected.push(d?.id ?? null); continue; }
        if (await store.upsert(d.id, {}, Number(d.upd), true)) applied++;
      }
      return json(200, { ok: true, applied, rejected });
    }

    return json(405, { error: 'Methode niet toegestaan' });
  } catch (err) {
    console.error('handler', err);
    return json(500, { error: 'Serverfout' });
  }
}

/** Openbare gezondheidscheck: doet één echte query (houdt Supabase wakker), geeft geen gegevens terug. */
export async function health(ctx) {
  try {
    const store = ctx.store();
    await store.init();
    await store.ping();
    return json(200, { ok: true });
  } catch (err) {
    console.error('health', err);
    return json(503, { ok: false, error: 'Database niet bereikbaar' });
  }
}
