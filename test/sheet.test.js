import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseSheet, pushToSheet, importFromSheet } from '../lib/sheet.js';
import { handle, handleImport, health } from '../lib/handler.js';
import { memoryStore } from '../lib/store.js';

// ---------- nagebootste Google Sheet + Apps Script ----------
function fakeAppsScript(initial) {
  const grid = initial.map((r) => [...r]);
  const width = () => Math.max(...grid.map((r) => r.length));
  const range = (row, col, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => grid[row - 1 + i]?.[col - 1 + j] ?? '')),
    setValues: (vals) => vals.forEach((r, i) => r.forEach((v, j) => { (grid[row - 1 + i] ||= [])[col - 1 + j] = v; })),
    setValue: (v) => { (grid[row - 1] ||= [])[col - 1] = v; },
  });
  const sheet = {
    getRange: range,
    getLastRow: () => grid.length,
    getLastColumn: () => width(),
    getDataRange: () => range(1, 1, grid.length, width()),
    deleteRow: (r) => grid.splice(r - 1, 1),
  };
  const sandbox = {
    SpreadsheetApp: {
      openById: (id) => { if (id !== 'SHEETID') throw new Error('onbekend id'); return { getSheetByName: (n) => (n === 'form_data' ? sheet : null) }; },
      getActive: () => { throw new Error('los script heeft geen actieve spreadsheet'); },
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ TOKEN: 'tok', SPREADSHEET_ID: 'SHEETID' })[k] ?? null }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => s }) },
    Session: { getScriptTimeZone: () => 'Europe/Amsterdam' },
    Utilities: { formatDate: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` },
    Date, JSON, String, Math, RegExp, Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8'), sandbox);
  const fetch = async (url, init) => {
    const u = new URL(url);
    const text = init.method === 'POST'
      ? sandbox.doPost({ postData: { contents: init.body } })
      : sandbox.doGet({ parameter: Object.fromEntries(u.searchParams) });
    return new Response(text, { status: 200 });
  };
  return { grid, fetch, cfg: { url: 'https://script.example/exec', token: 'tok', fetch } };
}

const HEADER = ['Tijdstempel', 'Date', 'Bestuurder', 'Bijrijders', 'Aantal kilometers', 'Kosten Tanken', 'Literprijs'];
const SHEET_ROWS = [
  HEADER,
  [new Date(2026, 3, 19, 10), new Date(2026, 3, 19), 'Groot', '', 207, 78.46, 2.25],
  [new Date(2026, 3, 21, 9), new Date(2026, 3, 21), 'Groot', '', 12, '', ''],
  [new Date(2026, 3, 22, 9), new Date(2026, 3, 22), 'klein', 'Groot', 7, '', ''],
];

const rit = (over = {}) => ({ id: 'r1', type: 'rit', date: '2026-11-21', t: 1, hh: 'Klein', km: 12, upd: 100, ...over });
const req = (method, path, body) => new Request(`http://x${path}`, {
  method, headers: { 'x-groep': 'c', 'content-type': 'application/json' }, body: body && JSON.stringify(body),
});

// ---------- parseSheet ----------
test('parseSheet: rit + tankbeurt splitsen, app-regels en onleesbare regels overslaan, stabiele ids', () => {
  const header = [...HEADER, 'App-id'];
  const rows = [
    ['', '2026-04-19', 'Groot', '', 207, 78.46, 2.25, ''],
    ['', '19-4-2026', 'Groot', '', '12', '', '', ''],
    ['', '2026-04-21', 'Groot', '', 12, '', '', ''],            // zelfde inhoud als hierboven → eigen id
    ['', '2026-04-22', 'Klein', '', 7, '', '', 'abc123'],       // komt uit de app
    ['', '2026-04-23', 'Midden', '', 7, '', '', ''],            // onbekende bestuurder
    ['', '', '', '', '', '', '', ''],                            // lege regel
  ];
  const { entries, skipped } = parseSheet(header, rows, 5);
  assert.deepEqual(entries.map((e) => [e.type, e.date, e.hh, e.km ?? e.cost]), [
    ['rit', '2026-04-19', 'Groot', 207], ['tank', '2026-04-19', 'Groot', 78.46],
    ['rit', '2026-04-19', 'Groot', 12], ['rit', '2026-04-21', 'Groot', 12],
  ]);
  assert.deepEqual(skipped, [6]);
  assert.equal(new Set(entries.map((e) => e.id)).size, 4);
  assert.deepEqual(parseSheet(header, rows, 9).entries.map((e) => e.id), entries.map((e) => e.id));
});

// ---------- Apps Script + server samen ----------
test('app-regels komen in form_data, bijwerken en verwijderen via App-id', async () => {
  const sheet = fakeAppsScript(SHEET_ROWS);
  const store = memoryStore();
  const ctx = { code: 'c', store: () => store, sheet: sheet.cfg };

  await handle(req('POST', '/api/entries', { puts: [rit({ bij: 'Groot' }), { id: 't1', type: 'tank', date: '2026-11-21', t: 2, hh: 'Groot', cost: 80.5, lp: 2.3, upd: 101 }] }), ctx);
  assert.equal(sheet.grid[0][7], 'App-id');
  const row = (id) => sheet.grid.find((r) => r[7] === id);
  assert.deepEqual(row('r1').slice(1, 7).map((v) => (v instanceof Date ? v.toDateString() : v)),
    [new Date(2026, 10, 21).toDateString(), 'Klein', 'Groot', 12, '', '']);
  assert.ok(row('r1')[0] instanceof Date);
  assert.deepEqual(row('t1').slice(2, 7), ['Groot', '', '', 80.5, 2.3]);
  assert.deepEqual(await store.unsynced(10), []);

  await handle(req('POST', '/api/entries', { puts: [rit({ km: 15, upd: 200 })] }), ctx);
  assert.equal(row('r1')[4], 15);
  assert.equal(sheet.grid.length, 6);

  await handle(req('POST', '/api/entries', { dels: [{ id: 't1', upd: 300 }] }), ctx);
  assert.equal(row('t1'), undefined);
  assert.equal(sheet.grid.length, 5);
});

test('sheet onbereikbaar: opslaan lukt, health stuurt het later alsnog', async () => {
  const sheet = fakeAppsScript(SHEET_ROWS);
  const store = memoryStore();
  const down = { ...sheet.cfg, fetch: async () => { throw new TypeError('fetch failed'); } };
  const res = await handle(req('POST', '/api/entries', { puts: [rit()] }), { code: 'c', store: () => store, sheet: down });
  assert.equal(res.status, 200);
  assert.equal((await store.unsynced(10)).length, 1);
  assert.equal((await health({ store: () => store, sheet: sheet.cfg })).status, 200);
  assert.equal((await store.unsynced(10)).length, 0);
  assert.ok(sheet.grid.some((r) => r[7] === 'r1'));
});

test('import: bestaande regels inlezen, niet terugschrijven, geen dubbelingen, verwijderd blijft weg', async () => {
  const sheet = fakeAppsScript(SHEET_ROWS);
  const store = memoryStore();
  const ctx = { code: 'c', store: () => store, sheet: sheet.cfg };

  let r = await (await handleImport(req('POST', '/api/sheet-import'), ctx)).json();
  assert.deepEqual([r.added, r.found, r.skipped], [4, 4, []]);
  assert.deepEqual(await store.unsynced(10), []);                  // niet terug naar de sheet
  const list = (await (await handle(req('GET', '/api/entries'), ctx)).json()).entries;
  assert.equal(list.find((e) => e.type === 'tank').cost, 78.46);
  assert.equal(list.find((e) => e.hh === 'Klein').bij, 'Groot');

  r = await (await handleImport(req('POST', '/api/sheet-import'), ctx)).json();
  assert.equal(r.added, 0);

  const tank = list.find((e) => e.type === 'tank');
  await handle(req('POST', '/api/entries', { dels: [{ id: tank.id, upd: Date.now() + 1000 }] }), ctx);
  r = await (await handleImport(req('POST', '/api/sheet-import'), ctx)).json();
  assert.equal(r.added, 0);
  assert.equal(sheet.grid.length, SHEET_ROWS.length);              // ingelezen regels niet dubbel geschreven
});

test('import zonder koppeling: duidelijke fout', async () => {
  const res = await handleImport(req('POST', '/api/sheet-import'), { code: 'c', store: () => memoryStore(), sheet: null });
  assert.equal(res.status, 400);
});

test('server werkt km van een stand-rit bij als er achteraf een rit tussen komt', async () => {
  const store = memoryStore();
  const ctx = { code: 'c', store: () => store, sheet: null };
  await handle(req('POST', '/api/entries', { puts: [
    rit({ id: 'a', date: '2026-11-01', t: 1, km: 0, stand: 10000 }),
    rit({ id: 'c', date: '2026-11-05', t: 5, km: 100, stand: 10100 }),
  ] }), ctx);
  await handle(req('POST', '/api/entries', { puts: [rit({ id: 'b', date: '2026-11-03', t: 3, hh: 'Groot', km: 40 })] }), ctx);
  const list = (await (await handle(req('GET', '/api/entries'), ctx)).json()).entries;
  assert.equal(list.find((e) => e.id === 'c').km, 60);
});

test('pushToSheet zonder koppeling doet niets', async () => {
  assert.equal(await pushToSheet(memoryStore(), null), 0);
  await assert.rejects(importFromSheet(memoryStore(), null), /niet ingesteld/);
});
