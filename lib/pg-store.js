// Postgres-opslag (Supabase, Neon of elke andere Postgres) via postgres.js.
// Supabase via Vercel zet POSTGRES_URL: de pooler in transactiemodus, dus geen prepared statements.

import postgres from 'postgres';

const TABLE = 'kmdelen_entries';

/** @returns {import('./store.js').Store} */
export function pgStore(url) {
  if (!url) throw new Error('POSTGRES_URL ontbreekt');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const sql = postgres(url, {
    max: 1,                 // één verbinding per functie-instantie
    prepare: false,         // vereist voor de transaction pooler (poort 6543)
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: local ? false : 'require',
    onnotice: () => {},
  });
  let ready;

  return {
    init() {
      ready ||= (async () => {
        await sql`
          CREATE TABLE IF NOT EXISTS ${sql(TABLE)} (
            id      text    PRIMARY KEY,
            data    jsonb   NOT NULL,
            upd     bigint  NOT NULL,
            deleted boolean NOT NULL DEFAULT false
          )`;
        // Supabase stelt het public-schema open via zijn REST-API. RLS zonder policies
        // sluit die route af; deze server verbindt als eigenaar en mag er wel bij.
        await sql`ALTER TABLE ${sql(TABLE)} ENABLE ROW LEVEL SECURITY`;
      })().catch((err) => { ready = undefined; throw err; });
      return ready;
    },
    async list() {
      const rows = await sql`SELECT id, data, upd, deleted FROM ${sql(TABLE)}`;
      return rows.map((r) => ({ id: r.id, data: r.data, upd: Number(r.upd), deleted: r.deleted }));
    },
    async upsert(id, data, upd, deleted) {
      const rows = await sql`
        INSERT INTO ${sql(TABLE)} (id, data, upd, deleted)
        VALUES (${id}, ${sql.json(data)}, ${upd}, ${deleted})
        ON CONFLICT (id) DO UPDATE
          SET data = EXCLUDED.data, upd = EXCLUDED.upd, deleted = EXCLUDED.deleted
          WHERE ${sql(TABLE)}.upd < EXCLUDED.upd
        RETURNING id`;
      return rows.length > 0;
    },
    async ping() {
      await sql`SELECT count(*) FROM ${sql(TABLE)}`;
    },
    end: () => sql.end({ timeout: 2 }),
  };
}
