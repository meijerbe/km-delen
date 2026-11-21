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
