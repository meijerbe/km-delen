# Kilometers delen

Web-app om bij een gedeelde auto per rit bij te houden wie (stel **Klein** of **Groot**) hoeveel kilometer reed en wie tankte. De gegevens staan in één gedeelde database, zodat iedereen hetzelfde overzicht ziet. Export plakt direct in de bestaande Excel-sheet.

## Gebruik

- **Rit → Start rit**: meet met GPS. Houd de app open en het scherm aan (een web-app krijgt op iOS geen locatie met vergrendeld scherm).
- **Rit achteraf invullen**: als achtervang, op elke datum. Kies *Aantal km* of *Kilometerstand*.
  - Bij een kilometerstand rekent de app: stand − (vorige stand + km van ritten zonder stand daartussen).
  - Vul je later een vergeten rit in, dan schuiven die km automatisch van de eerstvolgende stand-rit naar de juiste bestuurder.
  - Bij de allereerste stand vul je ook het aantal km in.
- **Tanken**: wie tankte, bedrag en literprijs.
- **Overzicht**: km en percentage per stel per maand, tik op een regel om te wijzigen. *Kopieer alles voor Excel* geeft de kolommen `Date, Bestuurder, Bijrijders, Aantal kilometers, Kosten Tanken, Literprijs, Kilometerstand`.
- Invoer zonder bereik wordt bewaard en later alsnog gedeeld.

## Live zetten op Vercel (eenmalig)

1. **Vercel → Add New → Project** → importeer `meijerbe/km-delen`. Framework preset: *Other*. Verder niets invullen.
2. **Database: Supabase.** Koppel een Supabase-project aan dit Vercel-project via de Supabase-integratie (Supabase → Project Settings → Integrations → Vercel, of in Vercel bij de integratie). Die zet `POSTGRES_URL` (de pooler). De tabel `kmdelen_entries` wordt bij de eerste aanroep zelf aangemaakt, met Row Level Security aan zodat de Supabase REST-API er niet bij kan.
   Een andere Postgres (bijv. Neon) kan ook: zet dan `DATABASE_URL`.
3. **Settings → Environment Variables**: `GROUP_CODE` = een code die jullie vieren afspreken (bijv. een zin van drie woorden).
4. **Deployments → Redeploy**, zodat de variabelen actief worden.
5. Open de link op de telefoon in Safari of Chrome, vul de groepscode in en kies *Zet op beginscherm*.

### Koppeling met de Google Sheet

De app schrijft elke rit en tankbeurt naar het tabblad `form_data`, net als het Google-formulier. Het tabblad Overview rekent dus gewoon door.

De spreadsheet is van een werkaccount dat geen web-apps mag publiceren, dus het script staat los in een eigen Google-account en opent de sheet via het ID.

1. [script.google.com](https://script.google.com) → **New project**, plak [`google-apps-script/Code.gs`](google-apps-script/Code.gs) en sla op.
2. **Project Settings → Script Properties**: `TOKEN` = dezelfde waarde als `SHEET_TOKEN` in Vercel, `SPREADSHEET_ID` = het ID uit de URL van de spreadsheet.
3. **Deploy → New deployment → Web app**. Execute as: *Me*, Who has access: *Anyone*. Geef toestemming en kopieer de URL.
4. Zet in Vercel `SHEET_WEBHOOK_URL` = die URL en redeploy.
5. In de app: **Instellingen → Formulier-invoer ophalen** leest de bestaande regels eenmalig in (en later nieuwe formulier-invoer; dubbele regels worden overgeslagen).

Het script voegt in `form_data` een kolom **App-id** toe; daarmee worden wijzigingen en verwijderingen in de app ook in de sheet doorgevoerd. Lukt het schrijven naar de sheet even niet, dan gaat het mee met de volgende wijziging of de health-check.

### Polo-diorama

Het tabblad **📍 Polo** toont de buurt rond Bergselaan × Bergpolderstraat (500 × 500 m) als speelgoedblok met een ondergrond van 10 m (straat, klei, veen, zand), met de geparkeerde Polo erop.

- Gebouwen met echte hoogte uit **3D BAG**, straten/water/groen/bomen uit **OpenStreetMap**. De workflow *Buurt bijwerken* haalt ze op en zet ze in `public/buurt.json` (`npm run buurt` lokaal).
- Three.js staat gebundeld in `public/vendor/three-bundle.js` (`npm run vendor`).
- Parkeerplek: automatisch na een GPS-rit, of via **📍 Geparkeerd** (huidige locatie of aanwijzen op de kaart). Wordt gedeeld via de database, niet naar de spreadsheet gestuurd. Staat de Polo buiten de buurt, dan toont de app de afstand en een link naar Kaarten.

### Kosten

Het tabblad **Kosten** leest *Overige kosten* rechtstreeks uit de (openbaar gedeelde) spreadsheet via Google's gviz-uitvoer (`SPREADSHEET_ID` in Vercel). Het laat zien:

- de **afrekening**: brandstof naar verhouding van de km, vaste kosten 50/50, min wat elk stel al betaalde;
- wat een km kost (alleen brandstof en alles meegerekend), de verdeling per categorie en per maand;
- Polo-weetjes (verzekering per dag, duurste klus, wegenbelasting, volgende APK).

Kosten die je in de app invoert, gaan naar *Overige kosten* zodra het script is bijgewerkt en `SHEET_COSTS=1` in Vercel staat; tot die tijd wachten ze in de database.

De workflow *Database wakker houden* roept elke drie dagen `/api/health` aan, zodat Supabase het gratis project niet pauzeert.

Daarna gaat elke push naar `main` automatisch live en krijgt elke pull request een eigen preview-link. GitHub Actions draait bij elke push de tests.

## Ontwikkelen

```bash
npm install
npm run dev          # http://localhost:4173, groepscode "test", opslag in geheugen
npm test             # unit-tests; met TEST_POSTGRES_URL ook tegen een echte database
npx playwright install chromium
npm run test:e2e     # browsertests met nagebootste GPS-rit en twee telefoons
```

## Opbouw

| Pad | Inhoud |
| --- | --- |
| `public/index.html` | Schermen en opmaak |
| `public/app.js` | Interface, GPS-meting, synchronisatie (wachtrij voor offline invoer) |
| `public/core.js` | Pure rekenlogica: afstand, kilometerstanden, totalen, Excel-export |
| `api/` | Vercel Functions: gegevens, spreadsheet-import en gezondheidscheck |
| `lib/` | Afhandeling, validatie, opslag (Postgres of in-memory) en spreadsheet-koppeling |
| `google-apps-script/Code.gs` | Script in de Google Sheet: schrijft naar en leest uit `form_data` |
| `test/`, `e2e/` | Unit- en browsertests |

Beveiliging: de API vraagt de groepscode in header `x-groep`. Iedereen met de code kan lezen en schrijven; deel hem alleen met de vier gebruikers.
