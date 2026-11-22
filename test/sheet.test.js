import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pushToSheet } from '../lib/sheet.js';
import { parseSheet } from '../lib/rides.js';
import { handle, health } from '../lib/handler.js';
import { memoryStore } from '../lib/store.js';

// ---------- nagebootste Google Sheet + Apps Script ----------
function makeSheet(grid, name = 'tab') {
  const formats = {};
  const width = () => Math.max(...grid.map((r) => r.length));
  const range = (row, col, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => grid[row - 1 + i]?.[col - 1 + j] ?? '')),
    setValues: (vals) => vals.forEach((r, i) => r.forEach((v, j) => { (grid[row - 1 + i] ||= [])[col - 1 + j] = v; })),
    setValue: (v) => { (grid[row - 1] ||= [])[col - 1] = v; },
    getValue: () => grid[row - 1]?.[col - 1] ?? '',
    getNumberFormat: () => formats[`${row},${col}`] || 'General',
    setNumberFormat: (f) => { formats[`${row},${col}`] = f; },
  });
  return {
    formats,
    getName: () => name,
    getRange: range,
    getLastRow: () => grid.length,
    getLastColumn: () => width(),
    getDataRange: () => range(1, 1, grid.length, width()),
    deleteRow: (r) => grid.splice(r - 1, 1),
  };
}

function fakeAppsScript(initial, costsInitial = [['Kosten', 'Beschrijving', 'Datum', 'Betaald door']]) {
  const grid = initial.map((r) => [...r]);
  const costsGrid = costsInitial.map((r) => [...r]);
  const sheet = makeSheet(grid, 'form_data'), costsSheet = makeSheet(costsGrid, 'Overige kosten'), extra = {}, extraGrids = {};
  const sandbox = {
    SpreadsheetApp: {
      ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
      flush: () => {},
      openById: (id) => {
        if (id !== 'SHEETID') throw new Error('onbekend id');
        return {
          getSheetByName: (n) => ({ form_data: sheet, 'Overige kosten': costsSheet, ...extra })[n] || null,
          getSheets: () => [sheet, costsSheet, ...Object.values(extra)],
          insertSheet: (n) => { const g = []; extraGrids[n] = g; extra[n] = makeSheet(g, n); extra[n].setFrozenRows = () => {}; return extra[n]; },
        };
      },
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
  return { grid, sheet, costsGrid, costsSheet, extraGrids, fetch, cfg: { url: 'https://script.example/exec', token: 'tok', fetch, costs: true } };
}

// Echte koppen van form_data
const HEADER = ['Timestamp', 'Date', 'Aantal kilometers', 'Eind kilometerstand', 'Bijrijders', 'Getankt?', 'Kosten tanken', 'Literprijs', 'Rate the trip', 'Gebruiker', 'Rating'];
const SHEET_ROWS = [
  HEADER,
  [new Date(2026, 3, 19, 10), new Date(2026, 3, 19), 207, 45207, '', 'Ja', 78.46, 2.25, '', 'Groot', 4],
  [new Date(2026, 3, 21, 9), new Date(2026, 3, 21), 12, 45219, '', 'Nee', '', '', '', 'Groot', ''],
  [new Date(2026, 3, 22, 9), new Date(2026, 3, 22), 7, 45226, 'Groot', 'Nee', '', '', '', 'klein', 5],
];


const rit = (over = {}) => ({ id: 'r1', type: 'rit', date: '2026-11-21', t: 1, hh: 'Klein', km: 12, upd: 100, ...over });
const req = (method, path, body) => new Request(`http://x${path}`, {
  method, headers: { 'x-groep': 'c', 'content-type': 'application/json' }, body: body && JSON.stringify(body),
});

// ---------- parseSheet ----------
test('parseSheet: rit + tankbeurt splitsen, app-regels en onleesbare regels overslaan, stabiele ids', () => {
  const header = [...HEADER, 'App-id'];
  const row = (date, km, stand, tank, cost, lp, user, id = '') => ['', date, km, stand, '', tank, cost, lp, '', user, '', id];
  const rows = [
    row('2026-04-19', 207, '', 'Ja', 78.46, 2.25, 'Groot'),
    row('19-4-2026', '12', '', 'Nee', '', '', 'Groot'),
    row('2026-04-21', 12, '', 'Nee', '', '', 'Groot'),         // zelfde inhoud als hierboven → eigen id
    row('2026-04-22', 7, '', 'Nee', '', '', 'Klein', 'abc123'), // komt uit de app
    row('2026-04-23', 7, '', 'Nee', '', '', 'Sem'),             // onbekende gebruiker
    new Array(12).fill(''),                                       // lege regel
  ];
  const { entries, skipped, unknownUsers } = parseSheet(header, rows, 5);
  assert.deepEqual(unknownUsers, ['Sem']);
  assert.deepEqual(entries.map((e) => [e.type, e.date, e.hh, e.km ?? e.cost]), [
    ['rit', '2026-04-19', 'Groot', 207], ['tank', '2026-04-19', 'Groot', 78.46],
    ['rit', '2026-04-19', 'Groot', 12], ['rit', '2026-04-21', 'Groot', 12],
  ]);
  assert.deepEqual(skipped, [6]);
  assert.equal(new Set(entries.map((e) => e.id)).size, 4);
  assert.deepEqual(parseSheet(header, rows, 9).entries.map((e) => e.id), entries.map((e) => e.id));
});

// ---------- Apps Script + server samen ----------
test('sheet onbereikbaar: opslaan lukt, health stuurt het later alsnog', async () => {
  const sheet = fakeAppsScript(SHEET_ROWS);
  const store = memoryStore();
  const down = { ...sheet.cfg, fetch: async () => { throw new TypeError('fetch failed'); } };
  const kost = { id: 'k5', type: 'kost', date: '2026-11-22', t: 1, hh: 'Klein', cost: 12, desc: 'Ruitenvloeistof', upd: 10 };
  const res = await handle(req('POST', '/api/entries', { puts: [kost] }), { code: 'c', store: () => store, sheet: down });
  assert.equal(res.status, 200);
  assert.equal((await store.unsynced(10)).length, 1);
  assert.equal((await health({ store: () => store, sheet: sheet.cfg })).status, 200);
  assert.equal((await store.unsynced(10)).length, 0);
  assert.ok(sheet.costsGrid.some((r) => r.includes('k5')));
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
});

test('kosten uit de app komen in Overige kosten, onder de laatste kostenregel, met opmaak van erboven', async () => {
  const sheet = fakeAppsScript(SHEET_ROWS, [
    ['Kosten', 'Beschrijving', 'Datum', 'Betaald door', '', '', '', ''],
    [13.1, 'RDW', new Date(2026, 3, 17), 'Klein', '', '', '', ''],
    [153.5, 'Centraal beheer', new Date(2026, 3, 22), 'Klein', '', '', '', 2583.02],
    ['', '', '', '', '', '', '', 1291.51],                                   // subtotaal zonder bedrag
  ]);
  sheet.costsSheet.formats['3,1'] = '"€"#,##0.00';
  const store = memoryStore();
  const ctx = { code: 'c', store: () => store, sheet: sheet.cfg };
  const kost = { id: 'k1', type: 'kost', date: '2026-11-20', t: 1, hh: 'Groot', cost: 30, desc: 'Voorlampen vervangen', upd: 10 };
  await handle(req('POST', '/api/entries', { puts: [kost] }), ctx);
  const g = sheet.costsGrid;
  assert.equal(g[0][8], 'App-id');
  assert.deepEqual(g[3].slice(0, 4).map((v) => (v instanceof Date ? v.toDateString() : v)), [30, 'Voorlampen vervangen', new Date(2026, 10, 20).toDateString(), 'Groot']);
  assert.equal(g[3][7], 1291.51);                                            // subtotaal blijft staan
  assert.equal(g[3][8], 'k1');
  assert.equal(sheet.costsSheet.formats['4,1'], '"€"#,##0.00');
  assert.equal(sheet.grid.length, SHEET_ROWS.length);                        // niets in form_data

  await handle(req('POST', '/api/entries', { puts: [{ ...kost, cost: 35, upd: 11 }] }), ctx);
  assert.equal(g[3][0], 35);
  await handle(req('POST', '/api/entries', { dels: [{ id: 'k1', upd: 12 }] }), ctx);
  assert.ok(!g.some((r) => r[8] === 'k1'));
});

test('betalingen: script maakt tabblad Verrekeningen aan, schrijft, bevestigt en verwijdert', async () => {
  const sheet = fakeAppsScript(SHEET_ROWS);
  const store = memoryStore();
  const ctx = { code: 'c', store: () => store, sheet: sheet.cfg };
  const pay = { id: 'b1', type: 'betaling', date: '2026-11-12', t: 1, hh: 'Groot', amount: 500, note: 'Tikkie', upd: 10 };
  await handle(req('POST', '/api/entries', { puts: [pay] }), ctx);
  const g = sheet.extraGrids.Verrekeningen;
  assert.deepEqual(g[0], ['Datum', 'Van', 'Aan', 'Bedrag', 'Notitie', 'Bevestigd', 'App-id']);
  assert.deepEqual(g[1].slice(1), ['Groot', 'Klein', 500, 'Tikkie', '', 'b1']);
  await handle(req('POST', '/api/entries', { puts: [{ ...pay, ok: true, upd: 11 }] }), ctx);
  assert.equal(g[1][5], '✓');
  assert.equal(g.length, 2);
  await handle(req('POST', '/api/entries', { dels: [{ id: 'b1', upd: 12 }] }), ctx);
  assert.equal(g.length, 1);
  assert.equal(sheet.grid.length, SHEET_ROWS.length);                       // form_data onaangeroerd
});

test('zonder script wachten kosten en betalingen; zonder formulier wachten ritten', async () => {
  const sheet = fakeAppsScript(SHEET_ROWS);
  const store = memoryStore();
  await handle(req('POST', '/api/entries', { puts: [{ id: 'b2', type: 'betaling', date: '2026-11-12', t: 1, hh: 'Groot', amount: 50, upd: 10 }] }),
    { code: 'c', store: () => store, sheet: { formId: 'F', sheetId: 'S', url: null, fetch: sheet.fetch } });
  assert.equal(sheet.extraGrids.Verrekeningen, undefined);
  assert.equal((await store.unsynced(10)).length, 1);
  const store2 = memoryStore();
  await handle(req('POST', '/api/entries', { puts: [{ id: 'r9', type: 'rit', date: '2026-11-12', t: 1, hh: 'Groot', km: 5, upd: 10 }] }),
    { code: 'c', store: () => store2, sheet: sheet.cfg });
  assert.equal((await store2.unsynced(10)).length, 1);
  assert.equal(sheet.grid.length, SHEET_ROWS.length);
});

test('betaling raakt form_data niet, ook als App-id daar ontbreekt en niet geschreven mag worden', async () => {
  const header = SHEET_ROWS[0].filter((h) => !/app-id/i.test(h));
  const sheet = fakeAppsScript([header, ...SHEET_ROWS.slice(1).map((r) => r.slice(0, header.length))]);
  sheet.extraGrids.Verrekeningen = undefined;
  const store = memoryStore();
  const ctx = { code: 'c', store: () => store, sheet: sheet.cfg };
  const before = JSON.stringify(sheet.grid);
  await handle(req('POST', '/api/entries', { puts: [{ id: 'b9', type: 'betaling', date: '2026-11-22', t: 1, hh: 'Groot', amount: 0.1, upd: 5 }] }), ctx);
  assert.equal(JSON.stringify(sheet.grid), before);                       // form_data onaangeroerd
  assert.deepEqual(sheet.extraGrids.Verrekeningen[1].slice(1), ['Groot', 'Klein', 0.1, '', '', 'b9']);
  assert.equal((await store.unsynced(10)).length, 0);
});

import { formBody } from '../lib/form.js';

function formEnv(sheetRowsGviz) {
  const posted = [];
  const fetch = async (url, init = {}) => {
    if (String(url).includes('/formResponse')) {
      posted.push(new URLSearchParams(init.body));
      return { ok: true, status: 200, text: async () => '<html><a href="viewform?usp=form_confirm">Nog een antwoord</a></html>' };
    }
    if (String(url).includes('/gviz/')) {
      const cols = ['Timestamp', 'Date', 'Aantal kilometers', 'Getankt?', 'Kosten tanken', 'Literprijs', 'Gebruiker'].map((label) => ({ label }));
      return { ok: true, status: 200, text: async () => `x(${JSON.stringify({ status: 'ok', table: { cols, rows: sheetRowsGviz } })});` };
    }
    throw new Error('onverwacht: ' + url);
  };
  return { posted, cfg: { url: 'https://script.example/exec', token: 't', costs: true, formId: 'FORM', sheetId: 'SHEETID', fetch } };
}
const gvRow = (date, km, getankt, cost, hh) => ({ c: [{ v: 'Date(2026,10,22,9,0,0)' }, { v: `Date(${date})` }, { v: km }, { v: getankt }, cost == null ? null : { v: cost }, null, { v: hh }] });

test('formulier: rit en tankbeurt goed ingevuld', () => {
  const r = formBody({ type: 'rit', date: '2026-11-22', hh: 'Klein', km: 12 });
  assert.equal(r.get('entry.77585565_year'), '2026'); assert.equal(r.get('entry.77585565_month'), '11'); assert.equal(r.get('entry.77585565_day'), '22');
  assert.equal(r.get('entry.2518882'), 'Klein'); assert.equal(r.get('entry.1326077704'), '12'); assert.equal(r.get('entry.1884246097'), 'No');
  const t = formBody({ type: 'tank', date: '2026-11-22', hh: 'Groot', cost: 61.5, lp: 1.95 });
  assert.deepEqual([t.get('entry.1326077704'), t.get('entry.1884246097'), t.get('entry.628239698'), t.get('entry.269946942')], ['0', 'Yes', '61.5', '1.95']);
});

test('formulier: nieuwe rit versturen, al aanwezige niet nog eens, bewerken na de sheet geweigerd', async () => {
  const env = formEnv([gvRow('2026,10,22', 7, 'No', null, 'Groot')]);      // Groot 7 km stond er al (bv. eerdere poging)
  const store = memoryStore();
  const ctx = { code: 'c', store: () => store, sheet: env.cfg };
  await handle(req('POST', '/api/entries', { puts: [
    { id: 'f1', type: 'rit', date: '2026-11-22', t: 1, hh: 'Klein', km: 12, upd: 10 },
    { id: 'f2', type: 'rit', date: '2026-11-22', t: 2, hh: 'Groot', km: 7, upd: 11 },
    { id: 'f3', type: 'tank', date: '2026-11-22', t: 3, hh: 'Groot', cost: 61.5, upd: 12 },
  ] }), ctx);
  assert.equal(env.posted.length, 2);                                       // f1 en f3; f2 stond er al
  assert.deepEqual(env.posted.map((p) => p.get('entry.2518882')), ['Klein', 'Groot']);
  assert.equal((await store.unsynced(10)).length, 0);
  const res = await handle(req('POST', '/api/entries', { puts: [{ id: 'f1', type: 'rit', date: '2026-11-22', t: 1, hh: 'Klein', km: 99, upd: 20 }] }), ctx);
  assert.deepEqual((await res.json()).rejected, ['f1']);
  assert.equal(env.posted.length, 2);
});

test('formulier geeft geen bevestiging: rit blijft in de wachtrij', async () => {
  const env = formEnv([]);
  const orig = env.cfg.fetch;
  env.cfg.fetch = async (url, init) => (String(url).includes('/formResponse') ? { ok: false, status: 302, text: async () => '' } : orig(url, init));
  const store = memoryStore();
  const errs = []; const oe = console.error; console.error = (...a) => errs.push(a.join(' '));
  try {
    await handle(req('POST', '/api/entries', { puts: [{ id: 'g1', type: 'rit', date: '2026-11-22', t: 1, hh: 'Klein', km: 5, upd: 10 }] }), { code: 'c', store: () => store, sheet: env.cfg });
  } finally { console.error = oe; }
  assert.equal((await store.unsynced(10)).length, 1);
  assert.ok(errs.some((e) => /Formulier gaf 302/.test(e)));
});
