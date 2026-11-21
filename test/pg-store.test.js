// Draait alleen met een echte database: TEST_POSTGRES_URL=postgres://... npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pgStore } from '../lib/pg-store.js';
import { handle } from '../lib/handler.js';

const url = process.env.TEST_POSTGRES_URL;

test('Postgres-opslag via de API', { skip: !url && 'TEST_POSTGRES_URL niet gezet' }, async () => {
  const store = pgStore(url);
  const ctx = { code: 'c', store: () => store };
  const call = async (method, body) => (await handle(new Request('http://x/api/entries', {
    method, headers: { 'x-groep': 'c', 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  }), ctx)).json();
  try {
    const id = `t${Date.now()}`;
    const rit = { id, type: 'rit', date: '2026-11-21', t: 1, hh: 'Groot', km: 12, stand: 45678, bij: 'Klein', upd: 10 };
    assert.equal((await call('POST', { puts: [rit] })).applied, 1);
    assert.equal((await call('POST', { puts: [{ ...rit, km: 99, upd: 5 }] })).applied, 0);
    assert.equal((await call('POST', { puts: [{ ...rit, km: 13, upd: 20 }] })).applied, 1);
    let row = (await call('GET')).entries.find((e) => e.id === id);
    assert.deepEqual(row, { id, type: 'rit', date: '2026-11-21', hh: 'Groot', t: 1, km: 13, src: 'handmatig', stand: 45678, bij: 'Klein', upd: 20 });
    await call('POST', { dels: [{ id, upd: 30 }] });
    row = (await call('GET')).entries.find((e) => e.id === id);
    assert.deepEqual(row, { id, upd: 30, deleted: true });
  } finally {
    await store.end();
  }
});

test('Postgres ping', { skip: !url && 'TEST_POSTGRES_URL niet gezet' }, async () => {
  const store = pgStore(url);
  try { await store.init(); await store.ping(); } finally { await store.end(); }
});

test('Postgres: wachtrij voor de spreadsheet', { skip: !url && 'TEST_POSTGRES_URL niet gezet' }, async () => {
  const store = pgStore(url);
  try {
    await store.init();
    const id = `q${Date.now()}`;
    const data = { type: 'rit', date: '2026-11-21', hh: 'Klein', t: 1, km: 5 };
    await store.upsert(id, data, 10, false);
    assert.ok((await store.unsynced(1000)).some((r) => r.id === id));
    await store.markSynced(id, 10);
    assert.ok(!(await store.unsynced(1000)).some((r) => r.id === id));
    await store.upsert(id, { ...data, km: 6 }, 11, false);
    assert.ok((await store.unsynced(1000)).some((r) => r.id === id));
    await store.upsert(`${id}i`, data, 12, false, { synced: true });
    assert.ok(!(await store.unsynced(1000)).some((r) => r.id === `${id}i`));
  } finally {
    await store.end();
  }
});
