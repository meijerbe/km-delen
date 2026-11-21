import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../lib/handler.js';
import { memoryStore } from '../lib/store.js';
import { cleanEntry } from '../lib/validate.js';

const setup = () => { const store = memoryStore(); return { code: 'geheim', store: () => store }; };
const req = (method, body, code = 'geheim') => new Request('http://x/api/entries', {
  method, headers: { 'x-groep': code, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const rit = (over = {}) => ({ id: 'r1', type: 'rit', date: '2026-11-21', t: 1, hh: 'Klein', km: 12, upd: 100, ...over });

test('zonder of met verkeerde code: 401', async () => {
  const ctx = setup();
  assert.equal((await handle(req('GET', null, 'fout'), ctx)).status, 401);
  assert.equal((await handle(req('GET', null, ''), ctx)).status, 401);
});

test('zonder GROUP_CODE op de server: 500', async () => {
  const res = await handle(req('GET'), { code: undefined, store: () => memoryStore() });
  assert.equal(res.status, 500);
});

test('database niet bereikbaar: 503 na de codecontrole', async () => {
  const res = await handle(req('GET'), { code: 'geheim', store: () => { throw new Error('geen url'); } });
  assert.equal(res.status, 503);
});

test('opslaan, ophalen, nieuwste wint en verwijderen', async () => {
  const ctx = setup();
  let r = await (await handle(req('POST', { puts: [rit()] }), ctx)).json();
  assert.equal(r.applied, 1);

  r = await (await handle(req('POST', { puts: [rit({ km: 99, upd: 50 })] }), ctx)).json();   // ouder: genegeerd
  assert.equal(r.applied, 0);
  r = await (await handle(req('POST', { puts: [rit({ km: 15, upd: 200 })] }), ctx)).json();  // nieuwer
  assert.equal(r.applied, 1);

  let list = (await (await handle(req('GET'), ctx)).json()).entries;
  assert.equal(list.length, 1);
  assert.equal(list[0].km, 15);
  assert.equal(list[0].upd, 200);

  await handle(req('POST', { dels: [{ id: 'r1', upd: 300 }] }), ctx);
  list = (await (await handle(req('GET'), ctx)).json()).entries;
  assert.deepEqual(list, [{ id: 'r1', upd: 300, deleted: true }]);
});

test('ongeldige regels worden geweigerd', async () => {
  const ctx = setup();
  const r = await (await handle(req('POST', { puts: [rit({ hh: 'Midden' }), rit({ id: 'ok' })] }), ctx)).json();
  assert.equal(r.applied, 1);
  assert.deepEqual(r.rejected, ['r1']);
});

test('cleanEntry', () => {
  assert.equal(cleanEntry(rit({ date: '21-11-2026' })), null);
  assert.equal(cleanEntry(rit({ km: -1 })), null);
  assert.equal(cleanEntry(rit({ id: '../x' })), null);
  assert.deepEqual(cleanEntry(rit({ km: 12.4, stand: 45678.2, bij: '  Groot ' })),
    { id: 'r1', type: 'rit', date: '2026-11-21', hh: 'Klein', t: 1, upd: 100, km: 12, src: 'handmatig', stand: 45678, bij: 'Groot' });
  assert.deepEqual(cleanEntry({ id: 't', type: 'tank', date: '2026-11-21', t: 1, hh: 'Groot', cost: 78.456, lp: 2.25, upd: 1 }),
    { id: 't', type: 'tank', date: '2026-11-21', hh: 'Groot', t: 1, upd: 1, cost: 78.46, lp: 2.25 });
  assert.equal(cleanEntry({ id: 't', type: 'tank', date: '2026-11-21', t: 1, hh: 'Groot', cost: 0, upd: 1 }), null);
});

test('health: 200 met database, 503 zonder, zonder groepscode', async () => {
  const { health } = await import('../lib/handler.js');
  assert.equal((await health({ store: () => memoryStore() })).status, 200);
  const res = await health({ store: () => { throw new Error('geen url'); } });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, error: 'Database niet bereikbaar' });
});
