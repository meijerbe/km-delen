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
const ID_HEADER = 'App-id';

function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');
  if (!checkToken_(body.token)) return json_({ ok: false, error: 'token' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = sheet_();
    const cols = columns_(sheet);
    const results = (body.ops || []).map(function (op) {
      try { return op.op === 'delete' ? remove_(sheet, cols, op.id) : upsert_(sheet, cols, op.entry); }
      catch (err) { return { id: op.id || (op.entry && op.entry.id), ok: false, error: String(err) }; }
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

function sheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
  const s = book.getSheetByName(SHEET_NAME);
  if (!s) throw new Error('Tabblad ' + SHEET_NAME + ' niet gevonden');
  return s;
}

/** Zoekt kolommen op koptekst, zodat de volgorde van het formulier niet uitmaakt. */
function columns_(sheet) {
  const header = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const find = function (re) {
    for (var i = 0; i < header.length; i++) if (re.test(String(header[i]).trim())) return i + 1;
    return 0;
  };
  const cols = {
    ts: find(/^(tijdstempel|timestamp)/i),
    date: find(/^(date|datum)\b/i),
    hh: find(/bestuurder/i),
    bij: find(/bijrijder/i),
    km: find(/kilometer/i),
    cost: find(/kosten/i),
    lp: find(/literprijs/i),
    id: find(new RegExp('^' + ID_HEADER + '$', 'i')),
  };
  if (!cols.id) {
    cols.id = header.filter(String).length + 1;
    sheet.getRange(1, cols.id).setValue(ID_HEADER);
  }
  return cols;
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
  const width = Math.max(sheet.getLastColumn(), cols.id);
  var row = findRow_(sheet, cols, e.id);
  var values = row ? sheet.getRange(row, 1, 1, width).getValues()[0] : new Array(width).fill('');
  const set = function (c, v) { if (c) values[c - 1] = v; };
  const p = e.date.split('-').map(Number);
  set(cols.ts, row && cols.ts ? values[cols.ts - 1] : new Date());
  set(cols.date, new Date(p[0], p[1] - 1, p[2]));
  set(cols.hh, e.hh);
  set(cols.bij, e.type === 'rit' ? (e.bij || '') : '');
  set(cols.km, e.type === 'rit' ? e.km : '');
  set(cols.cost, e.type === 'tank' ? e.cost : '');
  set(cols.lp, e.type === 'tank' && e.lp != null ? e.lp : '');
  set(cols.id, e.id);
  if (!row) row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, width).setValues([values]);
  return { id: e.id, ok: true, row: row };
}

function remove_(sheet, cols, id) {
  const row = findRow_(sheet, cols, id);
  if (row) sheet.deleteRow(row);
  return { id: id, ok: true, removed: !!row };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
