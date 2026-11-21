import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaces, resolvePlaces, _clearPlaceCache } from '../lib/places.js';
import { handlePlaces } from '../lib/handler.js';

const RAW = JSON.stringify([
  { key: 'thuis-klein', label: 'Kasteel Klein', kind: 'kasteel', hh: 'Klein', adres: 'Voorbeeldstraat 1, Rotterdam' },
  { key: 'x', adres: '' },
  { key: 'bakker', label: 'Bakker', kind: 'bakker', adres: 'Broodstraat 2, Rotterdam' },
]);
const pdok = async (url) => {
  const q = decodeURIComponent(new URL(url).searchParams.get('q'));
  const docs = q.startsWith('Voorbeeld') ? [{ centroide_rd: 'POINT(91650.123 438820.987)' }] : [];
  return new Response(JSON.stringify({ response: { docs } }));
};

test('PLACES lezen: ongeldige regels overslaan', () => {
  assert.deepEqual(parsePlaces(RAW).map((p) => p.key), ['thuis-klein', 'bakker']);
  assert.deepEqual(parsePlaces('geen json'), []);
});

test('adres → RD, niet gevonden wordt overgeslagen; adres gaat niet mee terug', async () => {
  _clearPlaceCache();
  const out = await resolvePlaces(RAW, pdok);
  assert.deepEqual(out, [{ key: 'thuis-klein', label: 'Kasteel Klein', kind: 'kasteel', hh: 'Klein', rd: [91650.1, 438821] }]);
});

test('/api/places vraagt de groepscode', async () => {
  const req = (code) => new Request('http://x/api/places', { headers: { 'x-groep': code } });
  assert.equal((await handlePlaces(req('fout'), { code: 'c', places: RAW, fetch: pdok })).status, 401);
  const body = await (await handlePlaces(req('c'), { code: 'c', places: RAW, fetch: pdok })).json();
  assert.equal(body.places.length, 1);
  assert.ok(!JSON.stringify(body).includes('Voorbeeldstraat'));
});
