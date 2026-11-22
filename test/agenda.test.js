import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, zonedToUtc, hhOfTitle, fetchAgenda, _resetAgendaCache } from '../lib/agenda.js';
import { agendaNow } from '../public/core.js';

const ICS = [
  'BEGIN:VCALENDAR', 'X-WR-TIMEZONE:Europe/Amsterdam',
  'BEGIN:VEVENT', 'DTSTART;TZID=Europe/Amsterdam:20261122T100000', 'DTEND;TZID=Europe/Amsterdam:20261122T180000', 'SUMMARY:Groot naar Ikea', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261128', 'DTEND;VALUE=DATE:20261130', 'SUMMARY:Klein weekendje we', 'g', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261124T080000Z', 'DTEND:20261124T090000Z', 'SUMMARY:Garage\\, APK', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261125T080000Z', 'DTEND:20261125T090000Z', 'STATUS:CANCELLED', 'SUMMARY:Klein', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20250101', 'SUMMARY:Oud', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n').replace('SUMMARY:Klein weekendje we\r\ng', 'SUMMARY:Klein weekendje we\r\n g');   // gevouwen regel

test('zonedToUtc: Amsterdamse tijd, winter en zomer', () => {
  assert.equal(new Date(zonedToUtc(2026, 11, 22, 10, 0, 0, 'Europe/Amsterdam')).toISOString(), '2026-11-22T09:00:00.000Z');
  assert.equal(new Date(zonedToUtc(2026, 7, 1, 10, 0, 0, 'Europe/Amsterdam')).toISOString(), '2026-07-01T08:00:00.000Z');
});

test('parseIcs: tijden, hele dagen, gevouwen regels, geannuleerd en oud overslaan', () => {
  const now = Date.UTC(2026, 10, 22, 12);
  const ev = parseIcs(ICS, { from: now - 86400e3, to: now + 14 * 86400e3 });
  assert.deepEqual(ev.map((e) => [e.title, e.hh, e.allDay]), [
    ['Groot naar Ikea', 'Groot', false], ['Garage, APK', null, false], ['Klein weekendje weg', 'Klein', true],
  ]);
  assert.equal(new Date(ev[0].start).toISOString(), '2026-11-22T09:00:00.000Z');
  assert.equal(ev[2].end - ev[2].start, 2 * 86400e3);
});

test('hhOfTitle en agendaNow', () => {
  assert.equal(hhOfTitle('auto: groot'), 'Groot');
  assert.equal(hhOfTitle('Kleinigheden'), null);
  const now = Date.UTC(2026, 10, 22, 12);
  const ev = parseIcs(ICS, { from: now - 86400e3, to: now + 14 * 86400e3 });
  const a = agendaNow(ev, now);
  assert.equal(a.current.hh, 'Groot');
  assert.deepEqual(a.next.map((e) => e.title), ['Garage, APK', 'Klein weekendje weg']);
  assert.equal(agendaNow(null), null);
});

test('fetchAgenda: niet ingesteld = null, fout bij 404', async () => {
  _resetAgendaCache();
  assert.equal(await fetchAgenda(undefined), null);
  await assert.rejects(fetchAgenda('https://x', { fetchFn: async () => ({ ok: false, status: 404 }) }), /404/);
});

import { peopleMap } from '../lib/agenda.js';

test('namen en initialen per stel herkennen', () => {
  const m = peopleMap('Klein=anna,bob;Groot=c,s');
  assert.equal(hhOfTitle('C+S auto Ede', m), 'Groot');
  assert.equal(hhOfTitle('ma Bob auto verzoek', m), 'Klein');
  assert.equal(hhOfTitle('Kleien met Anna', m), 'Klein');        // "Kleien" telt niet, Anna wel
  assert.equal(hhOfTitle('Kleien', m), null);
  assert.equal(hhOfTitle('Anna en C samen', m), null);           // beide stellen: onbekend
  assert.equal(hhOfTitle('Groot weg', peopleMap('')), 'Groot');
});
