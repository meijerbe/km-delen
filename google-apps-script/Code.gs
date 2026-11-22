/**
 * km-delen ↔ Google Sheet
 *
 * Los script in je eigen Google-account (script.google.com → New project), of gekoppeld aan de sheet.
 * Project Settings → Script Properties:
 *   TOKEN          = de code uit de installatie-instructie (SHEET_TOKEN in Vercel)
 *   SPREADSHEET_ID = het ID uit de URL van de spreadsheet (niet nodig als het script aan de sheet vastzit)
 * Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 *
 * - doPost: de app zet ritten/tankbeurten in het tabblad form_data (bijwerken of verwijderen via kolom "App-id").
 * - doGet:  levert de regels van form_data, zodat de app formulier-invoer kan inlezen.
 */

const SHEET_NAME = 'form_data';
const COSTS_NAME = 'Overige kosten';
const PAYMENTS_NAME = 'Verrekeningen';
const PAYMENTS_HEADER = ['Datum', 'Van', 'Aan', 'Bedrag', 'Notitie', 'Bevestigd', 'App-id'];
const ID_HEADER = 'App-id';

function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');
  if (!checkToken_(body.token)) return json_({ ok: false, error: 'token' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // form_data pas openen als een rit/tankbeurt het nodig heeft: kosten en betalingen raken dat tabblad niet.
    var rides = null;
    const ridesSheet = function () {
      if (!rides) { const sheet = sheet_(); rides = { sheet: sheet, cols: columns_(sheet) }; }
      return rides;
    };
    const results = (body.ops || []).map(function (op) {
      try {
        if (op.op === 'delete') return remove_(ridesSheet, op);
        if (op.entry && op.entry.type === 'kost') return upsertCost_(op.entry);
        if (op.entry && op.entry.type === 'betaling') return upsertPayment_(op.entry);
        const r = ridesSheet();
        return upsert_(r.sheet, r.cols, op.entry);
      }
      catch (err) {
        // Met regelnummer/functie, zodat de fout in de Vercel-logs direct aan te wijzen is.
        const where = err && err.stack ? ' @ ' + String(err.stack).split('\n').slice(0, 3).join(' | ') : '';
        return { id: op.id || (op.entry && op.entry.id), ok: false, error: String(err) + where };
      }
    });
    return json_({ ok: true, results: results });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  if (!checkToken_(e.parameter.token)) return json_({ ok: false, error: 'token' });
  const sheet = sheet_();
  const values = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  return json_({
    ok: true,
    header: values[0],
    rows: values.slice(1).map(function (r) {
      return r.map(function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v; });
    }),
  });
}

// ---------- intern ----------

function checkToken_(t) {
  const expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return !!expected && t === expected;
}

function book_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

function sheet_(name) {
  const s = book_().getSheetByName(name || SHEET_NAME);
  if (!s) throw new Error('Tabblad ' + (name || SHEET_NAME) + ' niet gevonden');
  return s;
}

/** Zoekt kolommen op koptekst, zodat de volgorde van het formulier niet uitmaakt. */
function columns_(sheet) {
  const header = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const find = function (re) {
    for (var i = 0; i < header.length; i++) if (re.test(String(header[i]).trim())) return i + 1;
    return 0;
  };
  const kmCol = find(/^aantal\s+kilomet/i);
  const cols = {
    ts: find(/^(tijdstempel|timestamp)/i),
    date: find(/^(date|datum)\b/i),
    hh: find(/^(bestuurder|gebruiker)/i),
    bij: find(/bijrijder/i),
    km: kmCol || find(/kilomet(?!erstand)/i),
    stand: find(/kilometerstand/i),
    getankt: find(/getankt/i),
    cost: find(/kosten/i),
    lp: find(/literprijs/i),
    id: find(new RegExp('^' + ID_HEADER + '$', 'i')),
  };
  // Geen App-id-kolom (form_data is beveiligd)? Dan is Timestamp de sleutel: zie keyTime_.
  if (!cols.id && !cols.ts) throw new Error('form_data heeft geen kolom App-id of Timestamp om ritten terug te vinden');
  return cols;
}

/** Vaste, unieke tijd per app-regel (op de seconde): staat in Timestamp als er geen App-id-kolom is. */
function keyTime_(e) {
  return Math.floor(Number(e.t) / 1000) * 1000;
}

/** Rij met deze Timestamp (op de seconde) én dezelfde datum en bestuurder; 0 als die er niet is. */
function findByTime_(sheet, cols, e) {
  if (!cols.ts || !e || !(Number(e.t) > 0)) return 0;
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const key = keyTime_(e) / 1000;
  const ts = sheet.getRange(2, cols.ts, last - 1, 1).getValues();
  for (var i = 0; i < ts.length; i++) {
    const v = ts[i][0];
    if (!(v instanceof Date) || Math.floor(v.getTime() / 1000) !== key) continue;
    const row = i + 2;
    if (e.hh && cols.hh && String(sheet.getRange(row, cols.hh).getValue()).trim().toLowerCase() !== String(e.hh).toLowerCase()) continue;
    return row;
  }
  return 0;
}

/** Kolom App-id helemaal achteraan toevoegen; lukt dat niet (beveiligd), dan een duidelijke melding. */
function addIdColumn_(sheet) {
  const col = sheet.getLastColumn() + 1;
  try {
    sheet.getRange(1, col).setValue(ID_HEADER);
    SpreadsheetApp.flush();
  } catch (err) {
    throw new Error('Kolom ' + ID_HEADER + ' kan niet worden toegevoegd in ' + sheet.getName() + ' (beveiligd). Zet "' + ID_HEADER + '" zelf in een vrije kolom achteraan.');
  }
  return col;
}

function findRow_(sheet, cols, id) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const ids = sheet.getRange(2, cols.id, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function upsert_(sheet, cols, e) {
  if (!e || !e.id) throw new Error('geen id');
  var row = cols.id ? findRow_(sheet, cols, e.id) : 0;
  if (!row) row = findByTime_(sheet, cols, e);
  const isNew = !row;
  if (isNew) row = sheet.getLastRow() + 1;
  const p = e.date.split('-').map(Number);
  const yn = yesNo_(sheet, cols);
  const vals = {};
  const set = function (c, v) { if (c) vals[c] = v; };
  // Met App-id: Timestamp = moment van wegschrijven. Zonder: de vaste sleutel-tijd van de regel.
  if (isNew || !cols.id) set(cols.ts, cols.id ? new Date() : new Date(keyTime_(e)));
  set(cols.date, new Date(p[0], p[1] - 1, p[2]));
  set(cols.hh, e.hh);
  set(cols.bij, e.type === 'rit' ? (e.bij || '') : '');
  set(cols.km, e.type === 'rit' ? e.km : '');
  set(cols.stand, e.type === 'rit' && e.stand != null ? e.stand : '');
  set(cols.getankt, e.type === 'tank' ? yn.yes : yn.no);
  set(cols.cost, e.type === 'tank' ? e.cost : '');
  set(cols.lp, e.type === 'tank' && e.lp != null ? e.lp : '');
  set(cols.id, e.id);
  // Cel voor cel: andere (formule- of beveiligde) kolommen van de rij blijven onaangeroerd.
  Object.keys(vals).forEach(function (c) { sheet.getRange(row, Number(c)).setValue(vals[c]); });
  return { id: e.id, ok: true, row: row };
}

function yesNo_(sheet, cols) {
  const out = { yes: 'Ja', no: 'Nee' };
  if (!cols.getankt || sheet.getLastRow() < 2) return out;
  const vals = sheet.getRange(2, cols.getankt, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  for (var i = 0; i < vals.length; i++) {
    if (/^(ja|yes|j|y)$/i.test(vals[i])) { out.yes = vals[i]; break; }
  }
  for (var j = 0; j < vals.length; j++) {
    if (/^(nee|no|n)$/i.test(vals[j])) { out.no = vals[j]; break; }
  }
  return out;
}

function remove_(ridesSheet, op) {
  const id = op.id;
  var row = 0, ridesError = null;
  try {
    const r = ridesSheet();
    row = r.cols.id ? findRow_(r.sheet, r.cols, id) : 0;
    if (!row && op.t && (!op.type || op.type === 'rit' || op.type === 'tank')) row = findByTime_(r.sheet, r.cols, op);
    if (row) {
      try { r.sheet.deleteRow(row); }
      catch (err) {   // rij weghalen mag niet (beveiliging): dan alleen onze cellen leegmaken
        ['ts', 'date', 'hh', 'bij', 'km', 'stand', 'getankt', 'cost', 'lp', 'id'].forEach(function (k) {
          if (r.cols[k]) r.sheet.getRange(row, r.cols[k]).setValue('');
        });
      }
      return { id: id, ok: true, removed: true };
    }
  } catch (err) { ridesError = err; }           // form_data onbruikbaar: verderop zoeken (kosten, betalingen)
  const costs = book_().getSheetByName(COSTS_NAME);
  if (costs) {
    const cc = costColumns_(costs);
    row = findRow_(costs, cc, id);
    if (row) { costs.deleteRow(row); return { id: id, ok: true, removed: true }; }
  }
  const pays = book_().getSheetByName(PAYMENTS_NAME);
  if (pays && pays.getLastRow() >= 2) {
    row = findRow_(pays, { id: PAYMENTS_HEADER.length }, id);
    if (row) { pays.deleteRow(row); return { id: id, ok: true, removed: true }; }
  }
  if (ridesError) throw ridesError;
  return { id: id, ok: true, removed: false };
}

// ---------- Overige kosten ----------

function costColumns_(sheet) {
  const header = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const find = function (re) {
    for (var i = 0; i < header.length; i++) if (re.test(String(header[i]).trim())) return i + 1;
    return 0;
  };
  const cols = {
    cost: find(/^(kosten|bedrag)/i), desc: find(/^(beschrijving|omschrijving)/i),
    date: find(/^datum/i), hh: find(/betaald\s*door/i), id: find(new RegExp('^' + ID_HEADER + '$', 'i')),
  };
  if (!cols.id) cols.id = addIdColumn_(sheet);
  return cols;
}

/** Laatste regel met een bedrag (de kolommen ernaast bevatten soms subtotalen). */
function lastCostRow_(sheet, cols) {
  const last = sheet.getLastRow();
  if (last < 2) return 1;
  const vals = sheet.getRange(2, cols.cost, last - 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).trim() !== '') return i + 2;
  return 1;
}

function upsertCost_(e) {
  const sheet = sheet_(COSTS_NAME);
  const cols = costColumns_(sheet);
  var row = findRow_(sheet, cols, e.id);
  const isNew = !row;
  if (isNew) row = lastCostRow_(sheet, cols) + 1;
  const p = e.date.split('-').map(Number);
  if (cols.cost) sheet.getRange(row, cols.cost).setValue(e.cost);
  if (cols.desc) sheet.getRange(row, cols.desc).setValue(e.desc || '');
  if (cols.date) sheet.getRange(row, cols.date).setValue(new Date(p[0], p[1] - 1, p[2]));
  if (cols.hh) sheet.getRange(row, cols.hh).setValue(e.hh);
  sheet.getRange(row, cols.id).setValue(e.id);
  if (isNew && row > 2) {
    // Opmaak (€, datum) van de regel erboven overnemen
    [cols.cost, cols.date].forEach(function (c) {
      if (c) sheet.getRange(row, c).setNumberFormat(sheet.getRange(row - 1, c).getNumberFormat());
    });
  }
  return { id: e.id, ok: true, row: row };
}

// ---------- Verrekeningen (betalingen tussen de stellen) ----------

function paymentsSheet_() {
  const book = book_();
  // Op naam zoeken, ongevoelig voor hoofdletters en spaties (een zelf aangemaakt tabblad heet soms "verrekeningen ").
  const want = PAYMENTS_NAME.toLowerCase();
  const found = book.getSheets().filter(function (s) { return s.getName().trim().toLowerCase() === want; })[0];
  if (found) return found;
  // Achteraan toevoegen: tussenvoegen verschuift beveiligde tabbladen, en dat mag niet.
  const sheet = book.insertSheet(PAYMENTS_NAME, book.getSheets().length);
  sheet.getRange(1, 1, 1, PAYMENTS_HEADER.length).setValues([PAYMENTS_HEADER]);
  if (sheet.setFrozenRows) sheet.setFrozenRows(1);
  return sheet;
}

function upsertPayment_(e) {
  const sheet = paymentsSheet_();
  const cols = { id: PAYMENTS_HEADER.length };
  var row = findRow_(sheet, cols, e.id);
  if (!row) row = sheet.getLastRow() + 1;
  const p = e.date.split('-').map(Number);
  const to = e.hh === 'Klein' ? 'Groot' : 'Klein';
  sheet.getRange(row, 1, 1, PAYMENTS_HEADER.length).setValues([[
    new Date(p[0], p[1] - 1, p[2]), e.hh, to, e.amount, e.note || '', e.ok ? '✓' : '', e.id,
  ]]);
  sheet.getRange(row, 1).setNumberFormat('dd-mm-yyyy');
  sheet.getRange(row, 4).setNumberFormat('"€"#,##0.00');
  return { id: e.id, ok: true, row: row };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
