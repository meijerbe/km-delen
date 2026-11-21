// Postgres-opslag via Neon (Vercel Marketplace). De tabel wordt bij de eerste aanroep aangemaakt.

import { neon } from '@neondatabase/serverless';

/** @returns {import('./store.js').Store} */
export function neonStore(url) {
  if (!url) throw new Error('DATABASE_URL ontbreekt');
  const sql = neon(url);
  let ready;

  return {
    init() {
      ready ||= sql`
        CREATE TABLE IF NOT EXISTS entries (
          id      text    PRIMARY KEY,
          data    jsonb   NOT NULL,
          upd     bigint  NOT NULL,
          deleted boolean NOT NULL DEFAULT false
        )`.then(() => undefined, (err) => { ready = undefined; throw err; });
      return ready;
    },
    async list() {
      const rows = await sql`SELECT id, data, upd, deleted FROM entries`;
      return rows.map((r) => ({ id: r.id, data: r.data, upd: Number(r.upd), deleted: r.deleted }));
    },
    async upsert(id, data, upd, deleted) {
      const rows = await sql`
        INSERT INTO entries (id, data, upd, deleted)
        VALUES (${id}, ${JSON.stringify(data)}::jsonb, ${upd}, ${deleted})
        ON CONFLICT (id) DO UPDATE
          SET data = EXCLUDED.data, upd = EXCLUDED.upd, deleted = EXCLUDED.deleted
          WHERE entries.upd < EXCLUDED.upd
        RETURNING id`;
      return rows.length > 0;
    },
  };
}
