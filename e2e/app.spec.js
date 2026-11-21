import { test, expect } from '@playwright/test';

const START = { latitude: 51.9225, longitude: 4.4792, accuracy: 8 };

async function login(page, code = 'test') {
  await page.goto('/');
  await expect(page.locator('#gate')).toBeVisible();
  await page.fill('#gateCode', code);
  await page.click('#gateForm button[type=submit]');
}
const tab = (page, v) => page.click(`nav button[data-v=${v}]`);
const sheetPick = (page, hh) => page.click(`#shHH >> text=${hh}`);

test('rit met GPS, achteraf met kilometerstand, tanken, export en delen tussen telefoons', async ({ browser }) => {
  const ctxA = await browser.newContext({
    geolocation: START, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
  });
  const a = await ctxA.newPage();
  const errors = [];
  a.on('pageerror', (e) => errors.push(e.message));

  // Groepscode
  await login(a, 'fout');
  await expect(a.locator('#gateErr')).toHaveText('Deze code klopt niet.');
  await a.fill('#gateCode', 'test');
  await a.click('#gateForm button[type=submit]');
  await expect(a.locator('#gate')).toBeHidden();
  await expect(a.locator('#syncTxt')).toHaveText('Gedeeld');

  // GPS-rit: 36 × 50 m ≈ 1,8 km bij ~160 km/u (onder de sprongfilter)
  await a.click('#pickStart >> text=Groot');
  await a.click('#btnStart');
  let lat = START.latitude;
  for (let i = 0; i < 36; i++) {
    lat += 0.00045;
    await ctxA.setGeolocation({ ...START, latitude: lat });
    await a.waitForTimeout(1100);
  }
  await expect(a.locator('#actKm')).toHaveText(/^1,[78]$/);
  await a.click('#btnStop');
  await expect(a.locator('#shKm')).toHaveValue('2');
  await a.fill('#shBij', 'Klein');
  await a.click('#shSave');
  await expect(a.locator('#toast')).toContainText('2 km opgeslagen voor Groot');

  // Achteraf: eerste kilometerstand ooit (km zelf invullen)
  await a.click('#btnManual');
  await sheetPick(a, 'Klein');
  await a.click('#shMode >> text=Kilometerstand');
  await a.fill('#shDate', '2026-11-01');
  await a.fill('#shStand', '10.000');
  await expect(a.locator('#shKmBox')).toBeVisible();
  await a.fill('#shKm', '20');
  await a.click('#shSave');

  // Vandaag: stand 10.080 → 10.000 + 2 (GPS-rit) = 10.002 → 78 km
  await a.click('#btnManual');
  await sheetPick(a, 'Klein');
  await a.click('#shMode >> text=Kilometerstand');
  await expect(a.locator('#shKmBox')).toBeHidden();
  await a.fill('#shStand', '10080');
  await expect(a.locator('#shStandHint')).toHaveText('10.002 → 10.080 = 78 km');
  await a.click('#shSave');
  await expect(a.locator('#counterHint')).toHaveText('Kilometerteller nu ≈ 10.080');

  // Tanken
  await tab(a, 'tank');
  await a.click('#pickTank >> text=Groot');
  await a.fill('#tCost', '78,46');
  await a.fill('#tLp', '2,25');
  await expect(a.locator('#tLiters')).toHaveText('≈ 34,9 liter');
  await a.click('#btnTank');
  await expect(a.locator('#tankList .item')).toHaveCount(1);

  // Export voor Excel
  await tab(a, 'overzicht');
  await expect(a.locator('#overview .item')).toHaveCount(4);
  await a.click('#btnCopyAll');
  const clip = await a.evaluate(() => navigator.clipboard.readText());
  const rows = clip.split('\n').map((r) => r.split('\t'));
  expect(rows[0]).toEqual(['Date', 'Bestuurder', 'Bijrijders', 'Aantal kilometers', 'Kosten Tanken', 'Literprijs', 'Kilometerstand']);
  expect(rows[1]).toEqual(['2026-11-01', 'Klein', '', '20', '', '', '10000']);
  expect(rows.slice(2).map((r) => r.slice(1, 4))).toEqual(expect.arrayContaining([
    ['Groot', 'Klein', '2'], ['Klein', '', '78'], ['Groot', '', ''],
  ]));
  expect(clip).toContain('\t78.46\t2.25\t');
  await expect(a.locator('#syncTxt')).toHaveText('Gedeeld');

  // Tweede telefoon ziet alles en kan verwijderen
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await login(b);
  await expect(b.locator('#gate')).toBeHidden();
  await tab(b, 'overzicht');
  await expect(b.locator('#overview .item')).toHaveCount(4);
  await b.locator('#overview .item', { hasText: '⛽' }).click();
  await b.click('#shDelete');
  await b.click('#cfYes');
  await expect(b.locator('#overview .item')).toHaveCount(3);
  await expect(b.locator('#syncTxt')).toHaveText('Gedeeld');

  await tab(a, 'inst');
  await a.click('#btnSyncNow');
  await tab(a, 'overzicht');
  await expect(a.locator('#overview .item')).toHaveCount(3);

  // Vergeten rit achteraf (Groot, 30 km, gisteren-ish vóór de stand-rit) → Klein-rit wordt 48 km
  await tab(a, 'rit');
  await a.click('#btnManual');
  await sheetPick(a, 'Groot');
  await a.click('#shMode >> text=Aantal km');
  await a.fill('#shDate', '2026-11-02');
  await a.fill('#shKm', '30');
  await a.click('#shSave');
  await tab(a, 'overzicht');
  await expect(a.locator('#overview .item', { hasText: 'stand 10.080' })).toContainText('48 km');

  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

test('offline invoer wordt later alsnog gedeeld', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p);
  await expect(p.locator('#gate')).toBeHidden();
  await ctx.setOffline(true);
  await p.click('#btnManual');
  await p.click('#shMode >> text=Aantal km');
  await p.fill('#shKm', '11');
  await p.click('#shSave');
  await expect(p.locator('#syncTxt')).toHaveText('Offline · 1 wachtend');
  await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(p.locator('#syncTxt')).toHaveText('Gedeeld');
  await ctx.close();
});
