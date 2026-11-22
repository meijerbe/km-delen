// Versiegeschiedenis — nieuwste bovenaan. Bij elke wijziging een regel toevoegen en VERSION ophogen.
export const CHANGES = [
  { v: '1.11', date: '2026-11-22', items: ['Reserveringen uit de gedeelde agenda op het Rit-scherm', 'Wie de Polo nu gereserveerd heeft, staat alvast geselecteerd', 'Waarschuwing als je rijdt terwijl het andere stel hem gereserveerd heeft'] },
  { v: '1.10', date: '2026-11-22', items: ['Opgeschoond: ritten alleen nog via het formulier, het script doet alleen kosten en betalingen', 'Kosten en betalingen die je in de spreadsheet verwijdert, verdwijnen ook uit de app'] },
  { v: '1.9', date: '2026-11-22', items: ['Ritten en tankbeurten komen rechtstreeks uit de spreadsheet (ook die via het formulier)', 'Wat al in de spreadsheet staat, pas je daar aan; in de app alleen wat er nog niet in staat', 'Knop "Formulier-invoer ophalen" is niet meer nodig', 'Ritten en tankbeurten uit de app gaan via het Google-formulier de spreadsheet in'] },
  { v: '1.8', date: '2026-11-22', items: ['Link naar de spreadsheet, over de app en deze versiegeschiedenis', 'Ritten uit de app komen ook zonder App-id-kolom in de spreadsheet'] },
  { v: '1.7', date: '2026-11-22', items: ['Betalingen tussen de stellen invullen en als ontvangen bevestigen', 'Afrekening toont wat al betaald is', 'Kosten en betalingen gaan naar de spreadsheet (tabblad Verrekeningen)'] },
  { v: '1.6', date: '2026-11-21', items: ['Onze huizen als kasteeltjes, Bakker Ids en het broodkarretje in de buurt'] },
  { v: '1.5', date: '2026-11-21', items: ['Polo-tab: de buurt in 3D met de geparkeerde Polo', 'Parkeerplek vastleggen met GPS of aanwijzen op de kaart'] },
  { v: '1.4', date: '2026-11-21', items: ['Kilometerstand vult niet-ingevulde km ertussen in', 'Waarschuwing bij zwak GPS; km aanpassen voor opslaan', 'GPS-correctie eruit'] },
  { v: '1.3', date: '2026-11-21', items: ['Kosten-tab: afrekening, prijs per km, categorieën en Polo-weetjes'] },
  { v: '1.2', date: '2026-11-21', items: ['Disco Polo-vormgeving met de Polo en ons vieren', 'Reacties, grappige teksten, landschap en toeter'] },
  { v: '1.1', date: '2026-11-21', items: ['Gekoppeld aan de Google Sheet: oude ritten ingelezen, nieuwe ritten erbij'] },
  { v: '1.0', date: '2026-11-21', items: ['Eerste versie: ritten met GPS of kilometerstand, tanken, delen tussen telefoons, export naar Excel'] },
];
export const VERSION = CHANGES[0].v;
