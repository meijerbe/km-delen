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
| `api/entries.js`, `api/health.js` | Vercel Functions: gegevens en gezondheidscheck |
| `lib/` | Afhandeling, validatie en opslag (Postgres of in-memory) |
| `test/`, `e2e/` | Unit- en browsertests |

Beveiliging: de API vraagt de groepscode in header `x-groep`. Iedereen met de code kan lezen en schrijven; deel hem alleen met de vier gebruikers.
