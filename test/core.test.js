import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, trackStep, computeRides, counterBefore, totals, excelText, parseNum } from '../public/core.js';

const rit = (id, date, t, hh, km, extra = {}) => ({ id, type: 'rit', date, t, hh, km, upd: 1, ...extra });

test('haversine: 0,001° breedte ≈ 111 m', () => {
  const d = haversine({ lat: 52, lon: 4.5 }, { lat: 52.001, lon: 4.5 });
  assert.ok(Math.abs(d - 111.2) < 0.5, d);
});

test('trackStep telt een realistische rit en negeert ruis en sprongen', () => {
  let last = null, m = 0;
  const step = (lat, t, acc = 8) => { const r = trackStep(last, { lat, lon: 4.5, t, acc }); last = r.last; m += r.add; };
  step(52, 0);
  for (let i = 1; i <= 100; i++) step(52 + i * 0.00027, i * 1000);   // 100 × 30 m, ~108 km/u
  assert.ok(Math.abs(m - 3002) < 10, `afstand ${m}`);
  const before = m;
  step(last.lat + 0.00003, 101000);                                      // 3 m: stilstand-ruis
  step(last.lat + 0.01, 102000);                                         // 1,1 km in 1 s: foute fix
  step(last.lat + 0.0003, 103000, 200);                                  // onnauwkeurig
  assert.equal(m, before);
  step(last.lat + 0.02, 400000);                                         // na lange pauze: telt mee
  assert.ok(m > before + 2000);
});

test('computeRides: kilometerstand rekent vanaf vorige stand plus ritten zonder stand', () => {
  const list = [
    rit('a', '2026-11-01', 1, 'Klein', 20, { stand: 10000 }),   // eerste stand: km zoals ingevoerd
    rit('b', '2026-11-02', 2, 'Groot', 30),                      // GPS-rit, geen stand
    rit('c', '2026-11-03', 3, 'Klein', 999, { stand: 10080 }),   // 10080 − (10000 + 30) = 50
  ];
  const { km, counter } = computeRides(list);
  assert.equal(km.get('a').km, 20);
  assert.equal(km.get('c').km, 50);
  assert.equal(km.get('c').derived, true);
  assert.equal(counter, 10080);
});

test('vergeten rit achteraf invullen verschuift km naar de juiste bestuurder', () => {
  const list = [
    rit('a', '2026-11-01', 1, 'Klein', 0, { stand: 10000 }),
    rit('c', '2026-11-05', 5, 'Klein', 0, { stand: 10100 }),
  ];
  assert.equal(totals(list).Klein, 100);
  list.push(rit('b', '2026-11-03', 3, 'Groot', 40));           // achteraf ingevuld
  const t = totals(list);
  assert.equal(t.Groot, 40);
  assert.equal(t.Klein, 60);
});

test('counterBefore geeft de verwachte stand op een eerdere datum', () => {
  const list = [
    rit('a', '2026-11-01', 1, 'Klein', 0, { stand: 10000 }),
    rit('b', '2026-11-02', 2, 'Groot', 25),
    rit('c', '2026-11-09', 9, 'Klein', 0, { stand: 10200 }),
  ];
  assert.equal(counterBefore(list, '2026-11-05', 5), 10025);
  assert.equal(counterBefore(list, '2026-10-01', 1), null);
  assert.equal(counterBefore(list, '2026-11-10', 1, 'c'), 10025);
});

test('stand lager dan verwacht → 0 km met waarschuwing', () => {
  const { km } = computeRides([
    rit('a', '2026-11-01', 1, 'Klein', 0, { stand: 10000 }),
    rit('b', '2026-11-02', 2, 'Groot', 0, { stand: 9990 }),
  ]);
  assert.deepEqual(km.get('b'), { km: 0, derived: true, warn: true });
});

test('excelText volgt de kolommen van de bestaande sheet', () => {
  const list = [
    rit('a', '2026-04-19', 1, 'Groot', 207),
    { id: 't', type: 'tank', date: '2026-04-19', t: 2, hh: 'Groot', cost: 78.46, lp: 2.25, upd: 1 },
    rit('b', '2026-04-22', 3, 'Klein', 7, { bij: 'Groot' }),
  ];
  assert.equal(excelText(list, null, true), [
    'Date\tBestuurder\tBijrijders\tAantal kilometers\tKosten Tanken\tLiterprijs\tKilometerstand',
    '2026-04-19\tGroot\t\t207\t\t\t',
    '2026-04-19\tGroot\t\t\t78.46\t2.25\t',
    '2026-04-22\tKlein\tGroot\t7\t\t\t',
  ].join('\n'));
  assert.equal(excelText(list, '2026-05', false), '');
});

test('parseNum leest komma, punt en duizendtallen', () => {
  assert.equal(parseNum('78,46'), 78.46);
  assert.equal(parseNum('2.25'), 2.25);
  assert.equal(parseNum('€ 12'), 12);
  assert.equal(parseNum('45.678', true), 45678);
  assert.equal(parseNum('45.678'), 45.678);
  assert.ok(Number.isNaN(parseNum('')));
});

test('vaste km (uit de sheet) worden niet afgeleid, maar zetten wel de teller', () => {
  const { km, counter } = computeRides([
    rit('a', '2026-04-19', 1, 'Groot', 207, { stand: 45207, vast: true }),
    rit('b', '2026-04-21', 2, 'Groot', 12, { stand: 45230, vast: true }),   // klopt niet met 45207+12
    rit('c', '2026-04-22', 3, 'Klein', 0, { stand: 45240 }),
  ]);
  assert.equal(km.get('b').km, 12);
  assert.equal(km.get('c').km, 10);
  assert.equal(counter, 45240);
});

import { mergeRides, rideSig } from '../public/core.js';

test('mergeRides: sheet is de bron; database alleen voor wat nog niet in de sheet staat', () => {
  const now = Date.UTC(2026, 10, 22, 12);
  const sheet = [
    { id: 's1r', type: 'rit', date: '2026-11-20', hh: 'Klein', km: 40, sheet: true },
    { id: 's2t', type: 'tank', date: '2026-11-21', hh: 'Groot', cost: 60, sheet: true },
  ];
  const db = [
    { id: 's1r', type: 'rit', date: '2026-11-20', hh: 'Klein', km: 40, synced: true, upd: now - 3600e3 },   // ingelezen, staat in sheet
    { id: 'a1', type: 'rit', date: '2026-11-22', hh: 'Groot', km: 12, upd: now - 60e3 },                      // nog niet in sheet
    { id: 'a2', type: 'rit', date: '2026-11-22', hh: 'Klein', km: 7, synced: true, upd: now - 60e3 },        // net gesynct, sheet-cache loopt achter
    { id: 'a3', type: 'rit', date: '2026-11-19', hh: 'Klein', km: 9, synced: true, upd: now - 7200e3 },      // in sheet verwijderd/aangepast
    { id: 'k1', type: 'kost', date: '2026-11-22', hh: 'Klein', cost: 5 },                                    // geen rit: blijft
  ];
  const ids = mergeRides(db, sheet, now).map((e) => e.id).sort();
  assert.deepEqual(ids, ['a1', 'a2', 'k1', 's1r', 's2t']);
  // zodra de sheet de net-gesyncte rit kent: niet dubbel
  const withA2 = [...sheet, { id: 'sxr', type: 'rit', date: '2026-11-22', hh: 'Klein', km: 7, sheet: true }];
  assert.deepEqual(mergeRides(db, withA2, now).filter((e) => rideSig(e) === rideSig(db[2])).length, 1);
  // sheet nog nooit gelezen: database zoals hij is
  assert.equal(mergeRides(db, null, now), db);
});

import { mergeSheetList } from '../public/core.js';

test('mergeSheetList: in de sheet verwijderde betaling verdwijnt ook uit de app', () => {
  const now = Date.UTC(2026, 10, 22, 12);
  const sheet = [{ id: 'b1', type: 'betaling', amount: 500, src: 'sheet', app: true }];
  const app = [
    { id: 'b1', type: 'betaling', amount: 500, synced: true, upd: now - 3600e3 },     // staat in sheet
    { id: 'b2', type: 'betaling', amount: 0.1, synced: true, upd: now - 3600e3 },     // in de sheet verwijderd
    { id: 'b3', type: 'betaling', amount: 20, upd: now - 60e3 },                      // nog niet in de sheet
    { id: 'b4', type: 'betaling', amount: 5, synced: true, upd: now - 30e3 },         // net verstuurd, sheet loopt achter
  ];
  const m = mergeSheetList(sheet, app, { loadedAt: now - 10e3, now });
  assert.deepEqual(m.map((x) => [x.id, !!x.pending]), [['b1', false], ['b3', true], ['b4', true]]);
  assert.equal(m[0].editable, true);
});
