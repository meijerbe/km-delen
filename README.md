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
2. **Storage → Create Database → Neon (Postgres)**, regio *Frankfurt (eu-central-1)*, en koppel die aan dit project. Dit zet `DATABASE_URL`; de tabel wordt bij de eerste aanroep zelf aangemaakt.
3. **Settings → Environment Variables**: `GROUP_CODE` = een code die jullie vieren afspreken (bijv. een zin van drie woorden).
4. **Deployments → Redeploy**, zodat de variabelen actief worden.
5. Open de link op de telefoon in Safari of Chrome, vul de groepscode in en kies *Zet op beginscherm*.

Daarna gaat elke push naar `main` automatisch live en krijgt elke pull request een eigen preview-link. GitHub Actions draait bij elke push de tests.

## Ontwikkelen

```bash
npm install
npm run dev          # http://localhost:4173, groepscode "test", opslag in geheugen
npm test             # unit-tests: rekenlogica en API
npx playwright install chromium
npm run test:e2e     # browsertests met nagebootste GPS-rit en twee telefoons
```

## Opbouw

| Pad | Inhoud |
| --- | --- |
| `public/index.html` | Schermen en opmaak |
| `public/app.js` | Interface, GPS-meting, synchronisatie (wachtrij voor offline invoer) |
| `public/core.js` | Pure rekenlogica: afstand, kilometerstanden, totalen, Excel-export |
| `api/entries.js` | Vercel Function `GET/POST /api/entries` |
| `lib/` | Afhandeling, validatie en opslag (Neon of in-memory) |
| `test/`, `e2e/` | Unit- en browsertests |

Beveiliging: de API vraagt de groepscode in header `x-groep`. Iedereen met de code kan lezen en schrijven; deel hem alleen met de vier gebruikers.
