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
  await expect(a.locator('#shStandHint')).toHaveText('10.002 → 10.080 = 78 km sinds de vorige stand');
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
  await expect(a.locator('#overview .item:not([data-id^="sfixture"])')).toHaveCount(4);
  await a.click('#btnCopyAll');
  const clip = await a.evaluate(() => navigator.clipboard.readText());
  const rows = clip.split('\n').map((r) => r.split('\t')).filter((r) => r[0] !== '2020-01-05');   // rit uit de sheet-fixture
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
  await expect(b.locator('#overview .item:not([data-id^="sfixture"])')).toHaveCount(4);
  await b.locator('#overview .item', { hasText: '⛽' }).click();
  await b.click('#shDelete');
  await b.click('#cfYes');
  await expect(b.locator('#overview .item:not([data-id^="sfixture"])')).toHaveCount(3);
  await expect(b.locator('#syncTxt')).toHaveText('Gedeeld');

  await a.click('#btnGear');
  await a.click('#btnSyncNow');
  await tab(a, 'overzicht');
  await expect(a.locator('#overview .item:not([data-id^="sfixture"])')).toHaveCount(3);

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

test('kosten: afrekening, km-prijs, categorieën en kosten toevoegen', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await login(p);
  await expect(p.locator('#gate')).toBeHidden();
  // 400 km Groot, 100 km Klein; Groot tankte 100
  for (const [hh, km] of [['Groot', '400'], ['Klein', '100']]) {
    await p.click('#btnManual'); await p.click(`#shHH >> text=${hh}`); await p.click('#shMode >> text=Aantal km');
    await p.fill('#shDate', '2026-10-01'); await p.fill('#shKm', km); await p.click('#shSave');
  }
  await tab(p, 'tank'); await p.click('#pickTank >> text=Groot'); await p.fill('#tCost', '100'); await p.fill('#tLp', '2,10'); await p.click('#btnTank');
  await tab(p, 'kosten');
  await expect(p.locator('#costsView')).toContainText('Waar gaat het geld heen?');
  await expect(p.locator('#costsView .legend')).toContainText('Verzekering');
  await expect(p.locator('#costsView .legend')).toContainText('Onderhoud');
  await expect(p.locator('#costsView .legend')).toContainText('Brandstof');
  await expect(p.locator('#costsView .facts')).toContainText('Duurste klus: nieuwe voorruit');
  // De vaste kosten (1132,60) zijn allemaal door Klein betaald ⇒ Groot betaalt Klein
  await expect(p.locator('#costsView')).toContainText('Groot betaalt Klein');
  const euros = async () => parseFloat((await p.locator('#costsView .amount').innerText()).replace(/[^\d,]/g, '').replace(',', '.'));
  const before = await euros();

  await p.click('#btnAddCost');
  await p.click('#ctHH >> text=Groot');
  await p.fill('#ctCost', '45,50'); await p.fill('#ctDesc', 'Wasstraat');
  await expect(p.locator('#ctCat')).toHaveText('🔧 Onderhoud');
  await p.click('#ctSave');
  await expect(p.locator('#pop')).toContainText('€ 45,50 genoteerd');
  await expect(p.locator('#costsView .item', { hasText: 'Wasstraat' })).toContainText('nog niet in de sheet');
  // Groot betaalt zelf 45,50 waarvan de helft voor Klein ⇒ 22,75 minder
  await expect.poll(euros).toBeCloseTo(before - 22.75, 2);
  await expect(p.locator('#syncTxt')).toHaveText('Gedeeld');
  // export voor Excel blijft alleen ritten en tankbeurten
  await tab(p, 'overzicht');
  await expect(p.locator('#overview .item', { hasText: 'Wasstraat' })).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('kilometerstand met niet-ingevulde km ertussen (samen of vol-naar-vol)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p);
  await expect(p.locator('#gate')).toBeHidden();
  const standRit = async (date, stand, km) => {
    await p.click('#btnManual'); await p.click('#shHH >> text=Klein'); await p.click('#shMode >> text=Kilometerstand');
    await p.fill('#shDate', date); await p.fill('#shStand', stand);
    if (km != null) {
      if (await p.locator('#shAllBox').isVisible()) await p.uncheck('#shAll');
      await p.fill('#shKm', km);
    }
  };
  // Eerste stand ooit in deze reeks (vroeg in 2025, vóór de andere testritten)
  await standRit('2025-01-01', '20000', '10'); await p.click('#shSave');
  // 100 km gereden, maar maar 30 voor deze rit: 70 km samen/vol-naar-vol
  await standRit('2025-01-05', '20100', '30');
  await expect(p.locator('#shStandHint')).toHaveText('20.000 → 20.100 = 100 km sinds de vorige stand · 70 km telt niet mee (samen of vol-naar-vol)');
  await p.click('#shSave');
  // Volgende rit: alles van deze rit, rekent vanaf 20.100
  await standRit('2025-01-09', '20150', null);
  await expect(p.locator('#shStandHint')).toHaveText('20.100 → 20.150 = 50 km sinds de vorige stand');
  await expect(p.locator('#shKmBox')).toBeHidden();
  await p.click('#shSave');
  await tab(p, 'overzicht');
  await expect(p.locator('#overview .item', { hasText: 'stand 20.100' })).toContainText('30 km');
  await expect(p.locator('#overview .item', { hasText: 'stand 20.150' })).toContainText('50 km');
  await ctx.close();
});

test('GPS-waarschuwingen bij stoppen: geen signaal en een lang gat', async ({ browser }) => {
  // Zonder locatietoestemming: geen enkele meting
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p);
  await expect(p.locator('#gate')).toBeHidden();
  await p.click('#btnStart');
  await p.click('#btnStop');
  await expect(p.locator('#shWarn')).toContainText('Geen GPS-signaal');
  await expect(p.locator('#shKm')).toHaveValue('');
  await p.fill('#shKm', '17');
  await p.click('#shSave');
  await expect(p.locator('#toast')).toContainText('17 km opgeslagen');

  // Wel metingen, maar 20 minuten zonder signaal in een rit van 30 minuten
  await p.click('#btnStart');
  await p.evaluate(() => {
    const k = 'kmdelen.v3.active', a = JSON.parse(localStorage.getItem(k));
    Object.assign(a, { start: Date.now() - 30 * 60000, m: 12000, fixes: 40, lastGood: Date.now() - 5 * 60000, gapMs: 15 * 60000 });
    localStorage.setItem(k, JSON.stringify(a));
  });
  await p.reload();
  await p.click('#btnStop');
  await expect(p.locator('#shWarn')).toContainText('zonder GPS-signaal');
  await expect(p.locator('#shKm')).toHaveValue('12');
  await p.fill('#shKm', '19');
  await p.click('#shSave');
  await expect(p.locator('#toast')).toContainText('19 km opgeslagen');
  await ctx.close();
});

test('Polo-diorama: buurt laadt, parkeerplek aanwijzen en wegzetten buiten de buurt', async ({ browser }) => {
  const ctx = await browser.newContext({ geolocation: { latitude: 52.0907, longitude: 5.1214, accuracy: 10 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await login(p);
  await expect(p.locator('#gate')).toBeHidden();
  await tab(p, 'polo');
  await expect(p.locator('#dioramaMsg')).toBeHidden({ timeout: 30000 });
  await expect(p.locator('#dioramaAttr')).toContainText('OpenStreetMap');

  // Aanwijzen op de kaart
  await p.click('#btnPark'); await p.click('#pkHH >> text=Klein'); await p.click('#pkPick');
  await expect(p.locator('#poloNote')).toContainText('Tik op de plek');
  await p.waitForTimeout(2500);
  const box = await p.locator('#diorama canvas').boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(p.locator('#poloText')).toContainText('Klein parkeerde hier');
  await expect(p.locator('#pop')).toContainText('Parkeerplek opgeslagen');

  // Huidige locatie (Utrecht) ligt buiten de buurt
  await p.waitForTimeout(3000);
  await p.click('#btnPark'); await p.click('#pkHere');
  await expect(p.locator('#poloNote')).toContainText('buiten de buurt');
  await expect(p.locator('#poloNote a')).toHaveAttribute('href', /52\.0907/);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('betaling invullen, openstaand bedrag zakt, en bevestigen als ontvangen', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await login(p);
  await expect(p.locator('#gate')).toBeHidden();
  await tab(p, 'kosten');
  await expect(p.locator('#costsView')).toContainText('Groot betaalt Klein');
  const euros = async () => parseFloat((await p.locator('#costsView .amount').innerText()).replace(/[^\d,]/g, '').replace(',', '.'));
  const before = await euros();

  await p.click('#btnPay');
  await expect(p.locator('#pyHH .sel-Groot')).toBeVisible();              // de schuldenaar staat al gekozen
  await expect(p.locator('#pyTo')).toHaveText('aan Klein');
  expect(await p.inputValue('#pyAmount')).toBe(before.toFixed(2).replace('.', ','));
  await p.fill('#pyAmount', '100'); await p.fill('#pyNote', 'Tikkie');
  await p.click('#pySave');
  await expect(p.locator('#pop')).toContainText('€ 100,00 betaald aan Klein');
  await expect.poll(euros).toBeCloseTo(before - 100, 2);
  await p.click('#btnBreakdown');
  await expect(p.locator('#breakdown')).toContainText('al betaald aan Klein');

  const row = p.locator('#costsView [data-pay]', { hasText: 'Tikkie' });
  await expect(row).toContainText('nog niet in de sheet');
  await row.locator('[data-ok]').click();
  await p.click('#cfYes');
  await expect(row).toContainText('✅ ontvangen');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('overzicht: link naar de spreadsheet, over de app en versiegeschiedenis', async ({ page }) => {
  await login(page);
  await expect(page.locator('#gate')).toBeHidden();
  await tab(page, 'overzicht');
  await expect(page.locator('#lnkSheet')).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/testsheet_abcdefghijklmnopqrstuvwxyz/edit');
  await expect(page.locator('#about')).toContainText('Over Disco Polo');
  await page.click('#about summary');
  await expect(page.locator('#about')).toContainText('Betalingen tussen de stellen');
});

test('ritten uit de spreadsheet: zichtbaar, maar aanpassen gaat via de sheet', async ({ page }) => {
  await login(page);
  await expect(page.locator('#gate')).toBeHidden();
  await tab(page, 'overzicht');
  const row = page.locator('#overview .item[data-id="sfixture00001r"]');
  await expect(row).toContainText('3 km');
  await row.click();
  await expect(page.locator('#toast')).toContainText('aanpassen of verwijderen doe je daar');
  await expect(page.locator('#sheetBg')).not.toHaveClass(/on/);
});

test('agenda: wie de Polo nu heeft, staat alvast geselecteerd; waarschuwing bij rijden voor de ander', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 51.93, longitude: 4.47 } });
  const p = await ctx.newPage();
  const now = Date.now(), h = 3600e3;
  await p.route('**/api/costs', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.agenda = [
      { start: now - h, end: now + 3 * h, allDay: false, title: 'Groot naar Ikea', hh: 'Groot' },
      { start: now + 26 * h, end: now + 50 * h, allDay: true, title: 'Klein weekendje', hh: 'Klein' },
      { start: now + 72 * h, end: now + 73 * h, allDay: false, title: 'Garage', hh: null },
    ];
    await route.fulfill({ response: res, json: body });
  });
  await login(p);
  await expect(p.locator('#gate')).toBeHidden();
  await expect(p.locator('#agendaCard')).toBeVisible();
  await expect(p.locator('#agendaNow')).toContainText('Groot');
  await expect(p.locator('#agendaCard')).toContainText('Klein');
  await expect(p.locator('#agendaCard')).toContainText('Garage');
  await expect(p.locator('#pickStart .sel-Groot')).toBeVisible();          // Groot staat alvast gekozen
  await p.click('#pickStart >> text=Klein');
  await p.click('#btnStart');
  await expect(p.locator('#toast')).toContainText('Groot heeft de Polo nu gereserveerd', { timeout: 5000 });
  await ctx.close();
});

test('rit pauzeren: GPS uit, afstand tijdens de pauze telt niet, na herladen nog gepauzeerd', async ({ browser }) => {
  const ctx = await browser.newContext({ geolocation: START, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  await login(p);
  await expect(p.locator('#gate')).toBeHidden();
  await p.click('#pickStart >> text=Klein');
  await p.click('#btnStart');
  let lat = START.latitude;
  for (let i = 0; i < 12; i++) { lat += 0.00045; await ctx.setGeolocation({ ...START, latitude: lat }); await p.waitForTimeout(1100); }
  const before = await p.locator('#actKm').innerText();
  expect(parseFloat(before.replace(',', '.'))).toBeGreaterThan(0.4);

  await p.click('#btnPause');
  await expect(p.locator('#btnPause')).toHaveText('▶ Verder rijden');
  await expect(p.locator('#gpsTxt')).toHaveText('Gepauzeerd');
  const t1 = await p.locator('#actTime').innerText();
  await ctx.setGeolocation({ ...START, latitude: lat + 0.05 });          // ~5,5 km verder tijdens de pauze
  await p.waitForTimeout(2500);
  await expect(p.locator('#actTime')).toHaveText(t1);                    // tijd staat stil
  await expect(p.locator('#actKm')).toHaveText(before);

  await p.reload();                                                      // app dicht en weer open
  await expect(p.locator('#btnPause')).toHaveText('▶ Verder rijden');
  await p.click('#btnPause');
  lat += 0.05;
  for (let i = 0; i < 6; i++) { lat += 0.00045; await ctx.setGeolocation({ ...START, latitude: lat }); await p.waitForTimeout(1100); }
  const after = parseFloat((await p.locator('#actKm').innerText()).replace(',', '.'));
  expect(after).toBeGreaterThan(parseFloat(before.replace(',', '.')));
  expect(after).toBeLessThan(1.2);                                       // de 5,5 km-sprong telt niet
  await p.click('#btnStop');
  await expect(p.locator('#shSub')).toContainText('rijtijd');
  await ctx.close();
});
