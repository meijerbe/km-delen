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

De spreadsheet is de bron. De app leest alles rechtstreeks uit de (openbaar gedeelde) sheet via Google's gviz-uitvoer (`SPREADSHEET_ID` in Vercel): ritten en tankbeurten uit *form_data*, kosten uit *Overige kosten*, betalingen uit *Verrekeningen*.

Wat je in de app invoert, gaat zo de sheet in:

- **Ritten en tankbeurten** via het Google-formulier, net als met de hand (`FORM_ID` in Vercel; de vragen staan in `lib/form.js`). *form_data* is beveiligd, het formulier mag er wel in schrijven. De server kijkt eerst of de regel er al staat, zodat een herhaalde poging geen dubbele regel geeft. Kilometerstand en bijrijders zitten niet in het formulier en komen dus niet in de sheet.
- **Kosten en betalingen** via het Apps Script (`SHEET_WEBHOOK_URL` en `SHEET_TOKEN` in Vercel), met de kolom **App-id** om ze terug te vinden.

Tot iets in de sheet staat, toont de app het met "nog niet in de sheet" en kun je het in de app aanpassen of verwijderen. Staat het erin, dan pas je het in de sheet aan (kosten en betalingen met een App-id kunnen ook in de app). Lukt het versturen even niet, dan blijft het in de wachtrij en gaat het mee met de volgende wijziging of de health-check.

Het script staat los in een eigen Google-account (de sheet is van een werkaccount) en opent de sheet via het ID:

1. [script.google.com](https://script.google.com) → **New project**, plak [`google-apps-script/Code.gs`](google-apps-script/Code.gs) en sla op.
2. **Project Settings → Script Properties**: `TOKEN` = dezelfde waarde als `SHEET_TOKEN` in Vercel, `SPREADSHEET_ID` = het ID uit de URL van de spreadsheet.
3. **Deploy → New deployment → Web app**. Execute as: *Me*, Who has access: *Anyone*. Geef toestemming en kopieer de URL.
4. Zet in Vercel `SHEET_WEBHOOK_URL` = die URL en redeploy. Een nieuwe versie van het script: **Deploy → Manage deployments → ✏️ → New version** (de URL blijft gelijk).

### Reserveringen (gedeelde agenda)

Het Rit-scherm toont wie de Polo nu en straks gereserveerd heeft, uit de gedeelde Google-agenda. Zet in Vercel `CALENDAR_ICS` = het **geheime adres in iCal-indeling** van die agenda (Google Agenda → Instellingen → de agenda → *Agenda integreren*). Klein/Groot herkent de app aan dat woord in de titel, of aan de namen/initialen in `CALENDAR_PEOPLE` (bijv. `Klein=naam1,naam2;Groot=c,s`; losse woorden, dus "C+S" telt als c en s). Anders toont hij de titel. Wie nu gereserveerd heeft, staat bij *Wie rijdt er?* alvast gekozen, en rijdt het andere stel, dan volgt een waarschuwing. Herhalende afspraken worden (nog) niet meegenomen.

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

### Betalingen tussen de stellen

Met **💸 Betaling invullen** leg je vast dat het ene stel het andere iets heeft overgemaakt (bijv. Groot → Klein € 500). Het bedrag gaat van de afrekening af; onder *Hoe komt dit?* staat het als regel "al betaald aan / al ontvangen van". De ontvanger kan de betaling met **Ontvangen? Bevestig ✓** afvinken.

De spreadsheet is de bron: betalingen staan in het tabblad *Verrekeningen* (Datum, Van, Aan, Bedrag, Notitie, Bevestigd, App-id). Het script maakt dat tabblad zelf aan bij de eerste betaling. Je kunt er ook direct in typen; een ✓ (of wat dan ook) in *Bevestigd* telt als ontvangen. Regels met een App-id kun je in de app bewerken; de rest pas je in de sheet aan.


De workflow *Database wakker houden* roept elke drie dagen `/api/health` aan, zodat Supabase het gratis project niet pauzeert.

Daarna gaat elke push naar `main` automatisch live en krijgt elke pull request een eigen preview-link. GitHub Actions draait bij elke push de tests.

## Ontwikkelen

Zet bij elke wijziging een regel in `public/changelog.js` (nieuwste bovenaan); de app toont die onder *Overzicht → Over Disco Polo*.

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
| `api/` | Vercel Functions: gegevens, spreadsheet-gegevens, plekken en gezondheidscheck |
| `lib/` | Afhandeling, validatie, opslag (Postgres of in-memory), sheet lezen (`costs.js`, `rides.js`) en schrijven (`form.js`, `sheet.js`) |
| `google-apps-script/Code.gs` | Apps Script: kosten en betalingen in de sheet zetten |
| `test/`, `e2e/` | Unit- en browsertests |

Beveiliging: de API vraagt de groepscode in header `x-groep`. Iedereen met de code kan lezen en schrijven; deel hem alleen met de vier gebruikers.
