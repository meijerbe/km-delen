/**
 * km-delen ↔ Google Sheet: kosten en betalingen
 *
 * Los script in je eigen Google-account (script.google.com → New project).
 * Project Settings → Script Properties:
 *   TOKEN          = SHEET_TOKEN uit Vercel
 *   SPREADSHEET_ID = het ID uit de URL van de spreadsheet
 * Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 *
 * doPost zet kosten in "Overige kosten" en betalingen in "Verrekeningen" (bijwerken/verwijderen via kolom "App-id").
 * Ritten en tankbeurten gaan niet via dit script maar via het Google-formulier (form_data is beveiligd).
 */

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
    const results = (body.ops || []).map(function (op) {
      const id = op.id || (op.entry && op.entry.id);
      try {
        var out;
        if (op.op === 'delete') out = remove_(id);
        else if (op.entry && op.entry.type === 'kost') out = upsertCost_(op.entry);
        else if (op.entry && op.entry.type === 'betaling') out = upsertPayment_(op.entry);
        else throw new Error('Alleen kosten en betalingen; ritten gaan via het formulier');
        SpreadsheetApp.flush();      // schrijffouten nu, bij deze regel (niet pas bij de volgende)
        return out;
      } catch (err) {
        // Met regelnummer/functie, zodat de fout in de Vercel-logs direct aan te wijzen is.
        const where = err && err.stack ? ' @ ' + String(err.stack).split('\n').slice(0, 3).join(' | ') : '';
        return { id: id, ok: false, error: String(err) + where };
      }
    });
    return json_({ ok: true, results: results });
  } finally {
    lock.releaseLock();
  }
}

/** Kostenpost of betaling met deze App-id verwijderen. */
function remove_(id) {
  const costs = book_().getSheetByName(COSTS_NAME);
  if (costs) {
    const row = findRow_(costs, costColumns_(costs), id);
    if (row) { costs.deleteRow(row); return { id: id, ok: true, removed: true }; }
  }
  const pays = book_().getSheetByName(PAYMENTS_NAME);
  if (pays && pays.getLastRow() >= 2) {
    const row = findRow_(pays, { id: PAYMENTS_HEADER.length }, id);
    if (row) { pays.deleteRow(row); return { id: id, ok: true, removed: true }; }
  }
  return { id: id, ok: true, removed: false };
}

const colName_ = function (c) { return c <= 26 ? String.fromCharCode(64 + c) : 'kolom ' + c; };

function checkToken_(t) {
  const expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return !!expected && t === expected;
}

function book_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

function sheet_(name) {
  const s = book_().getSheetByName(name);
  if (!s) throw new Error('Tabblad ' + name + ' niet gevonden');
  return s;
}

function findRow_(sheet, cols, id) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const ids = sheet.getRange(2, cols.id, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

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
  assertEditable_(sheet, row, [cols.cost, cols.desc, cols.date, cols.hh, cols.id]);
  if (cols.cost) sheet.getRange(row, cols.cost).setValue(e.cost);
  if (cols.desc) sheet.getRange(row, cols.desc).setValue(e.desc || '');
  if (cols.date) sheet.getRange(row, cols.date).setValue(new Date(p[0], p[1] - 1, p[2], 12));
  if (cols.hh) sheet.getRange(row, cols.hh).setValue(e.hh);
  sheet.getRange(row, cols.id).setValue(e.id);
  SpreadsheetApp.flush();             // waarden eerst: een fout daarin mag niet in tryFormat_ verdwijnen
  if (isNew && row > 2) {
    // Opmaak (€, datum) van de regel erboven overnemen
    [cols.cost, cols.date].forEach(function (c) {
      if (c) tryFormat_(sheet.getRange(row, c), sheet.getRange(row - 1, c).getNumberFormat());
    });
  }
  return { id: e.id, ok: true, row: row };
}

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
  assertEditable_(sheet, row, [1, 2, 3, 4, 5, 6, 7]);
  sheet.getRange(row, 1, 1, PAYMENTS_HEADER.length).setValues([[
    new Date(p[0], p[1] - 1, p[2], 12), e.hh, to, e.amount, e.note || '', e.ok ? '✓' : '', e.id,
  ]]);
  SpreadsheetApp.flush();
  tryFormat_(sheet.getRange(row, 1), 'dd-mm-yyyy');
  tryFormat_(sheet.getRange(row, 4), '"€"#,##0.00');
  return { id: e.id, ok: true, row: row };
}

/** Getalnotatie zetten; in een tabel met getypte kolommen mag dat niet en slaan we het over. */
function tryFormat_(range, format) {
  try { range.setNumberFormat(format); SpreadsheetApp.flush(); } catch (err) { /* getypte kolom */ }
}

/** Welke van deze kolommen in deze rij zijn beveiligd voor ons? Vooraf checken, zodat we geen halve rij schrijven. */
function blockedCols_(sheet, row, colNums) {
  if (!sheet.getProtections) return [];
  const blocked = {};
  const inside = function (r, c) { return row >= r.getRow() && row <= r.getLastRow() && c >= r.getColumn() && c <= r.getLastColumn(); };
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.canEdit() || p.isWarningOnly()) return;
    const r = p.getRange();
    colNums.forEach(function (c) { if (inside(r, c)) blocked[c] = true; });
  });
  sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) {
    if (p.canEdit() || p.isWarningOnly()) return;
    const free = p.getUnprotectedRanges();
    colNums.forEach(function (c) { if (!free.some(function (r) { return inside(r, c); })) blocked[c] = true; });
  });
  return Object.keys(blocked).map(Number);
}

function assertEditable_(sheet, row, colNums) {
  const bad = blockedCols_(sheet, row, colNums.filter(Boolean));
  if (bad.length) throw new Error('Beveiligd in ' + sheet.getName() + ' rij ' + row + ': kolom ' + bad.map(colName_).join(', ') + ' — er is niets geschreven');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
