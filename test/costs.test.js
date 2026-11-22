import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parseDate, parseCostsTable, unwrapGviz, fetchSheetCosts, _resetCostsCache } from '../lib/costs.js';
import { costInsights, categoryOf } from '../public/core.js';
import { handleCosts, handle } from '../lib/handler.js';
import { memoryStore } from '../lib/store.js';

test('bedragen en datums zoals Google Sheets ze geeft', () => {
  assert.equal(parseMoney('€13.10'), 13.1);
  assert.equal(parseMoney('€2,583.02'), 2583.02);
  assert.equal(parseMoney('€ 1.291,51'), 1291.51);
  assert.equal(parseMoney('181,00'), 181);
  assert.equal(parseMoney(129), 129);
  assert.equal(parseDate('Date(2026,3,17)'), '2026-04-17');
  assert.equal(parseDate('04-17-26'), '2026-04-17');
  assert.equal(parseDate(null, '11-21-26'), '2026-11-21');
  assert.equal(parseDate('21-11-2026'), '2026-11-21');
});

// gviz-antwoord met de echte kolommen; subtotalen in de naamloze kolommen
const gviz = `/*O_o*/
google.visualization.Query.setResponse({"version":"0.6","status":"ok","table":{"cols":[
{"id":"A","label":"Kosten","type":"number"},{"id":"B","label":"Beschrijving","type":"string"},{"id":"C","label":"Datum","type":"date"},
{"id":"D","label":"Betaald door","type":"string"},{"id":"E","label":"","type":"string"},{"id":"F","label":"","type":"number"}],"rows":[
{"c":[{"v":13.1,"f":"€13.10"},{"v":"RDW - auto overzetten"},{"v":"Date(2026,3,17)","f":"04-17-26"},{"v":"Klein"},null,null]},
{"c":[{"v":153.5,"f":"€153.50"},{"v":"Centraal beheer - periode 17/4 - 17/5"},{"v":"Date(2026,3,22)","f":"04-22-26"},{"v":"Klein"},null,{"v":355.46,"f":"€355.46"}]},
{"c":[{"v":231,"f":"€231.00"},{"v":"APK"},{"v":"Date(2026,5,4)","f":"06-04-26"},{"v":"Klein"},null,null]},
{"c":[{"v":380,"f":"€380.00"},{"v":"Nieuwe voorruit"},{"v":"Date(2026,6,8)","f":"07-08-26"},{"v":"Klein"},null,null]},
{"c":[{"v":181,"f":"€181.00"},{"v":"Centraal beheer - periode 17/11 - 17/12"},{"v":"Date(2026,10,17)","f":"11-17-26"},{"v":"Klein"},null,null]},
{"c":[{"v":129,"f":"€129.00"},{"v":"Belastingen 14 oktober 2026 t/m 13 januari 2027"},{"v":"Date(2026,10,21)","f":"11-21-26"},{"v":"Klein"},null,null]},
{"c":[null,null,null,null,null,{"v":2583.02,"f":"€2,583.02"}]}
]}});`;

test('Overige kosten inlezen uit gviz, subtotalen overslaan', () => {
  const costs = parseCostsTable(unwrapGviz(gviz).table);
  assert.equal(costs.length, 6);
  assert.deepEqual(costs[0], { id: costs[0].id, type: 'kost', date: '2026-04-17', cost: 13.1, desc: 'RDW - auto overzetten', hh: 'Klein', src: 'sheet' });
  assert.equal(new Set(costs.map((c) => c.id)).size, 6);
});

test('zonder kopregel in labels: eerste rij als koppen (CSV-achtig)', () => {
  const t = { cols: [{ label: '' }, { label: '' }, { label: '' }, { label: '' }], rows: [
    { c: [{ v: 'Kosten' }, { v: 'Beschrijving' }, { v: 'Datum' }, { v: 'Betaald door' }] },
    { c: [{ v: '€19.00' }, { v: 'Parkeervergunning mei + juni' }, { v: '05-26-26' }, { v: 'Klein' }] },
  ] };
  assert.deepEqual(parseCostsTable(t).map((c) => [c.date, c.cost]), [['2026-05-26', 19]]);
});

test('fetchSheetCosts gebruikt de gviz-URL en cachet', async () => {
  _resetCostsCache();
  let calls = 0, url = '';
  const fetchFn = async (u) => { calls++; url = u; return new Response(gviz); };
  assert.equal((await fetchSheetCosts('ID1', { fetchFn })).length, 6);
  await fetchSheetCosts('ID1', { fetchFn });
  assert.equal(calls, 1);
  assert.match(url, /\/d\/ID1\/gviz\/tq\?tqx=out:json&headers=1&sheet=Overige%20kosten$/);
});

test('categorieën op omschrijving', () => {
  assert.equal(categoryOf('Centraal beheer - pechhulp').key, 'Verzekering');
  assert.equal(categoryOf('Belastingen 14 juli').key, 'Belasting');
  assert.equal(categoryOf('Achterlicht vervangen').key, 'Onderhoud');
  assert.equal(categoryOf('Parkeervergunning juli').key, 'Parkeren');
  assert.equal(categoryOf('Vignet Zwitserland').key, 'Reizen');
  assert.equal(categoryOf('RDW - auto overzetten').key, 'Overig');
});

test('afrekening: brandstof naar km, vaste kosten 50/50', () => {
  const entries = [
    { id: 'r1', type: 'rit', date: '2026-05-01', t: 1, hh: 'Klein', km: 300 },
    { id: 'r2', type: 'rit', date: '2026-05-02', t: 2, hh: 'Groot', km: 100 },
    { id: 't1', type: 'tank', date: '2026-05-03', t: 3, hh: 'Groot', cost: 80 },
  ];
  const costs = [{ type: 'kost', date: '2026-05-04', hh: 'Klein', cost: 200, desc: 'APK' }];
  const ins = costInsights(entries, costs, new Date(2026, 10, 21));
  // brandstof: Klein 60, Groot 20; Groot betaalde 80 → Klein −60, Groot +60
  // vast: Klein betaalde 200, helft 100 → Klein +100, Groot −100  ⇒  Groot betaalt Klein 40
  assert.deepEqual([ins.debtor, ins.creditor, ins.amount], ['Groot', 'Klein', 40]);
  assert.equal(ins.perKmFuel, 0.2);
  assert.equal(ins.perKmAll, 0.7);
  assert.ok(ins.facts.some((f) => /APK over zo'n 5 maanden/.test(f.text)));
});

test('weetjes over verzekering, belasting en duurste klus', () => {
  const costs = parseCostsTable(unwrapGviz(gviz).table);
  const ins = costInsights([], costs, new Date(2026, 10, 21));
  const txt = ins.facts.map((f) => f.text).join(' | ');
  assert.match(txt, /verzekering kost zo'n € 5,95 per dag/);
  assert.match(txt, /Duurste klus: nieuwe voorruit \(€ 380\)/);
  assert.match(txt, /Wegenbelasting betaald t\/m 13 januari/);
});

test('/api/costs: code verplicht, en fout van Google netjes doorgeven', async () => {
  const req = (code) => new Request('http://x/api/costs', { headers: { 'x-groep': code } });
  assert.equal((await handleCosts(req('fout'), { code: 'c' })).status, 401);
  const ok = await handleCosts(req('c'), { code: 'c', sheet: { costs: true }, sheetCosts: async () => [{ id: 'k1' }], sheetPayments: async () => [{ id: 'b1' }] });
  assert.deepEqual(await ok.json(), { costs: [{ id: 'k1' }], payments: [{ id: 'b1' }], rides: null, costsSync: true, sheetUrl: null });
  const bad = await handleCosts(req('c'), { code: 'c', sheetCosts: async () => { throw new Error('403'); } });
  assert.equal(bad.status, 502);
});

test('kosten uit de app wachten op SHEET_COSTS voordat ze naar de sheet gaan', async () => {
  const store = memoryStore();
  const sent = [];
  const fetch = async (_u, init) => { const b = JSON.parse(init.body); sent.push(...b.ops); return new Response(JSON.stringify({ ok: true, results: b.ops.map((o) => ({ id: o.id || o.entry.id, ok: true })) })); };
  const kost = { id: 'k1', type: 'kost', date: '2026-11-21', t: 1, hh: 'Klein', cost: 30, desc: 'Voorlampen', upd: 5 };
  const rq = (body) => new Request('http://x/api/entries', { method: 'POST', headers: { 'x-groep': 'c' }, body: JSON.stringify(body) });
  await handle(rq({ puts: [kost] }), { code: 'c', store: () => store, sheet: { url: 'u', token: 't', fetch, costs: false } });
  assert.equal(sent.length, 0);
  assert.equal((await store.unsynced(10)).length, 1);
  await handle(rq({ puts: [{ ...kost, upd: 6 }] }), { code: 'c', store: () => store, sheet: { url: 'u', token: 't', fetch, costs: true } });
  assert.deepEqual(sent.map((o) => o.entry.type), ['kost']);
});

import { parsePaymentsTable } from '../lib/costs.js';
import { cleanEntry } from '../lib/validate.js';

test('Verrekeningen inlezen; App-id wordt de id; Bevestigd = ✓', () => {
  const t = { cols: ['Datum', 'Van', 'Aan', 'Bedrag', 'Notitie', 'Bevestigd', 'App-id'].map((label) => ({ label })), rows: [
    { c: [{ v: 'Date(2026,10,12)' }, { v: 'Groot' }, { v: 'Klein' }, { v: 500, f: '€500.00' }, { v: 'Tikkie' }, { v: '✓' }, { v: 'abc' }] },
    { c: [{ v: 'Date(2026,10,20)' }, { v: 'Klein' }, { v: 'Groot' }, { v: 25 }, null, null, null] },
    { c: [null, null, null, null, null, null, null] },
  ] };
  const p = parsePaymentsTable(t);
  assert.deepEqual(p[0], { id: 'abc', type: 'betaling', date: '2026-11-12', hh: 'Groot', amount: 500, note: 'Tikkie', ok: true, src: 'sheet', app: true });
  assert.equal(p[1].ok, undefined);
  assert.match(p[1].id, /^v[0-9a-f]{12}$/);
  assert.deepEqual(parsePaymentsTable({ cols: [{ label: 'Kosten' }], rows: [] }), []);   // ander tabblad
});

test('Kosten met App-id: de sheet-versie krijgt de id van de app', () => {
  const t = { cols: ['Kosten', 'Beschrijving', 'Datum', 'Betaald door', 'App-id'].map((label) => ({ label })), rows: [
    { c: [{ v: 35 }, { v: 'Voorlampen' }, { v: 'Date(2026,10,20)' }, { v: 'Groot' }, { v: 'k1' }] },
  ] };
  assert.deepEqual(parseCostsTable(t)[0], { id: 'k1', type: 'kost', date: '2026-11-20', cost: 35, desc: 'Voorlampen', hh: 'Groot', src: 'sheet', app: true });
});

test('afrekening: betaling gaat van het openstaande bedrag af', () => {
  const entries = [
    { id: 'r1', type: 'rit', date: '2026-05-01', t: 1, hh: 'Klein', km: 100 },
    { id: 'r2', type: 'rit', date: '2026-05-02', t: 2, hh: 'Groot', km: 100 },
  ];
  const costs = [{ type: 'kost', date: '2026-05-04', hh: 'Klein', cost: 1000, desc: 'Verzekering' }];
  let ins = costInsights(entries, costs, new Date(2026, 10, 21));
  assert.deepEqual([ins.debtor, ins.creditor, ins.amount], ['Groot', 'Klein', 500]);
  ins = costInsights(entries, costs, new Date(2026, 10, 21), [{ hh: 'Groot', amount: 300 }]);
  assert.deepEqual([ins.debtor, ins.amount, ins.settle.Groot.paidPart, ins.settle.Klein.paidPart], ['Groot', 200, 300, -300]);
  ins = costInsights(entries, costs, new Date(2026, 10, 21), [{ hh: 'Groot', amount: 500 }]);
  assert.equal(ins.amount, 0);
});

test('betaling valideren', () => {
  const b = { id: 'b1', type: 'betaling', date: '2026-11-12', t: 1, hh: 'Groot', amount: 500.004, note: ' Tikkie ', ok: true, upd: 3 };
  assert.deepEqual(cleanEntry(b), { id: 'b1', type: 'betaling', date: '2026-11-12', hh: 'Groot', t: 1, upd: 3, amount: 500, note: 'Tikkie', ok: true });
  assert.equal(cleanEntry({ ...b, amount: 0 }), null);
});

import { parseRidesTable } from '../lib/costs.js';

test('ritten uit form_data via gviz', () => {
  const labels = ['Timestamp', '', 'Date', 'Aantal kilometers', 'Eind kilometerstand', '', '', 'Bijrijders', 'Getankt?', 'Kosten tanken', 'Literprijs', '', 'Rate the trip', 'Gebruiker', 'Rating'];
  const row = (vals) => ({ c: vals.map((v) => (v === null ? null : { v })) });
  const t = { cols: labels.map((label) => ({ label })), rows: [
    row(['Date(2026,10,21,5,7,15)', null, 'Date(2026,10,21)', 48, 45300, null, null, '', 'No', null, null, null, null, 'Klein', null]),
    row(['Date(2026,10,14,4,40,31)', null, 'Date(2026,10,14)', 0, null, null, null, '', 'Yes', 59.69, 1.99, null, null, 'Klein', null]),
  ] };
  const r = parseRidesTable(t);
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].type, r[0].date, r[0].km, r[0].stand, r[0].hh, r[0].sheet], ['rit', '2026-11-21', 48, 45300, 'Klein', true]);
  assert.deepEqual([r[1].type, r[1].date, r[1].cost, r[1].lp], ['tank', '2026-11-14', 59.69, 1.99]);
});
