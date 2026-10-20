/**
 * Tenant Rep CRM <-> shared prospect list (a Google Sheet you work on with a partner).
 *
 * The CRM reads every tab and writes back only the shared columns it tracks. Rows are found by their
 * "CRM ID", so sorting, filtering or inserting rows in the sheet is fine.
 *
 * Setup (once):
 *   1. In the sheet: Extensions > Apps Script. Replace the editor contents with this file and save.
 *   2. Run the `setup` function and approve the permissions prompt. The execution log shows your sync key.
 *   3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Copy the Web app URL.
 *   4. In the CRM: Import / Settings > Shared prospect lists. Paste the URL and the sync key.
 *
 * Requests without the sync key are refused. rotateKey() issues a new key; archiving the deployment
 * turns the connection off.
 */

const ID_HEADER = 'CRM ID';
const MAX_ROWS = 3000;

function key_() {
  return PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
}

function setup() {
  if (!key_()) PropertiesService.getScriptProperties().setProperty('SYNC_KEY', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('Sync key: ' + key_());
}

function rotateKey() {
  PropertiesService.getScriptProperties().setProperty('SYNC_KEY', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('New sync key: ' + key_());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function headers_(sh) {
  if (sh.getLastColumn() < 1) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map((h) => String(h).trim());
}

function readTab_(sh) {
  const headers = headers_(sh);
  const rows = [];
  const last = Math.min(sh.getLastRow(), MAX_ROWS + 1);
  if (headers.length && last >= 2) {
    sh.getRange(2, 1, last - 1, headers.length)
      .getDisplayValues()
      .forEach((v, i) => {
        if (v.some((x) => String(x).trim() !== '')) rows.push({ row: i + 2, values: v });
      });
  }
  return { headers, rows };
}

function readAll_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabs = {};
  ss.getSheets().forEach((sh) => (tabs[sh.getName()] = readTab_(sh)));
  return { ok: true, title: ss.getName(), tabs };
}

function doGet(e) {
  if (!e || !e.parameter || e.parameter.key !== key_()) return json_({ ok: false, error: 'Invalid sync key' });
  return json_(readAll_());
}

/**
 * Body: { key, changes: [{ tab, crmId, row?, match?: { "<header>": value }, values: { "<header>": value } }] }
 * A change finds its row by CRM ID, then by the given row if that row still matches `match`, then by `match`
 * alone; otherwise it is added under the last filled row.
 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  if (body.key !== key_()) return json_({ ok: false, error: 'Invalid sync key' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const result = applyChanges_(body.changes || []);
    return json_(Object.assign(readAll_(), result));
  } finally {
    lock.releaseLock();
  }
}

const norm_ = (v) => String(v || '').trim().toLowerCase();

function applyChanges_(changes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let updated = 0;
  let added = 0;
  changes.forEach((ch) => {
    const sh = ss.getSheetByName(ch.tab);
    if (!sh) return;
    const headers = headers_(sh);
    const idCol = headers.indexOf(ID_HEADER) + 1;
    const data = readTab_(sh).rows;
    const matches = (r) =>
      Object.keys(ch.match || {}).every((h) => headers.indexOf(h) >= 0 && norm_(r.values[headers.indexOf(h)]) === norm_(ch.match[h]));
    let found = null;
    if (ch.crmId && idCol) found = data.find((r) => r.values[idCol - 1] === ch.crmId);
    if (!found && ch.row) found = data.find((r) => r.row === ch.row && ch.match && matches(r));
    if (!found && ch.match && Object.keys(ch.match).length) found = data.find((r) => matches(r) && (!idCol || !r.values[idCol - 1]));
    let row;
    if (found) {
      row = found.row;
      updated++;
    } else {
      row = (data.length ? data[data.length - 1].row : 1) + 1;
      if (row <= sh.getLastRow()) sh.insertRowBefore(row);
      added++;
    }
    Object.keys(ch.values || {}).forEach((h) => {
      const c = headers.indexOf(h);
      if (c >= 0) sh.getRange(row, c + 1).setValue(ch.values[h]);
    });
    if (ch.crmId && idCol) sh.getRange(row, idCol).setValue(ch.crmId);
  });
  return { updated, added };
}
