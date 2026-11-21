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
  const ok = await handleCosts(req('c'), { code: 'c', sheet: { costs: true }, sheetCosts: async () => [{ id: 'k1' }] });
  assert.deepEqual(await ok.json(), { costs: [{ id: 'k1' }], costsSync: true });
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
