/**
 * Tenant Rep CRM <-> Google Sheet sync for the portfolio tracker.
 *
 * Setup (once):
 *   1. In the sheet: Extensions > Apps Script. Replace the editor contents with this file and save.
 *   2. Run the `setup` function (Run button). Approve the permissions prompt.
 *      It adds a "CRM ID" column header and logs your sync key (View > Logs / Execution log).
 *   3. Deploy > New deployment > type "Web app".
 *        Execute as: Me    Who has access: Anyone
 *      Copy the Web app URL.
 *   4. In the CRM: Import / Settings > Google Sheet sync. Paste the URL and the sync key.
 *
 * The sheet can stay Restricted (only you). The script runs as you; requests without the sync key are refused.
 * To revoke access, run `rotateKey` (old key stops working) or archive the deployment.
 */

const SHEET_NAME = ''; // blank = first tab
const ID_HEADER = 'CRM ID';

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
}

function key_() {
  return PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
}

function setup() {
  if (!key_()) PropertiesService.getScriptProperties().setProperty('SYNC_KEY', Utilities.getUuid());
  idColumn_();
  Logger.log('Sync key: ' + key_());
}

function rotateKey() {
  PropertiesService.getScriptProperties().setProperty('SYNC_KEY', Utilities.getUuid());
  Logger.log('New sync key: ' + key_());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function headers_() {
  const sh = sheet_();
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map((h) => String(h).trim());
}

// Returns the 1-based column of the CRM ID header, adding it after the last header if missing.
function idColumn_() {
  const sh = sheet_();
  const headers = headers_();
  const i = headers.indexOf(ID_HEADER);
  if (i >= 0) return i + 1;
  const col = headers.filter(String).length ? headers.length + 1 : 1;
  sh.getRange(1, col).setValue(ID_HEADER).setFontWeight('bold');
  return col;
}

// Data rows sit between the header and the row containing "Total:" (or the end of the sheet).
function totalRow_() {
  const sh = sheet_();
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  for (let r = 1; r < values.length; r++) {
    if (values[r].some((v) => /^total:?$/i.test(String(v).trim()))) return r + 1;
  }
  return sh.getLastRow() + 1;
}

function readAll_() {
  const sh = sheet_();
  idColumn_();
  const headers = headers_();
  const end = totalRow_();
  const rows = [];
  if (end > 2) {
    const values = sh.getRange(2, 1, end - 2, headers.length).getDisplayValues();
    values.forEach((v, i) => {
      if (v.some((x) => String(x).trim() !== '')) rows.push({ row: i + 2, values: v });
    });
  }
  return { ok: true, title: SpreadsheetApp.getActiveSpreadsheet().getName(), headers, rows };
}

function doGet(e) {
  if (!e || !e.parameter || e.parameter.key !== key_()) return json_({ ok: false, error: 'Invalid sync key' });
  return json_(readAll_());
}

/**
 * Body: { key, changes: [{ crmId, row?, values: { "<header>": value } }] }
 * A change finds its row by CRM ID (or the given row), otherwise it is added as a new row
 * directly under the last deal so the Total formulas pick it up.
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

function applyChanges_(changes) {
  const sh = sheet_();
  const idCol = idColumn_();
  const headers = headers_();
  let updated = 0;
  let added = 0;
  changes.forEach((ch) => {
    let row = null;
    const end = totalRow_();
    if (ch.crmId && end > 2) {
      const ids = sh.getRange(2, idCol, end - 2, 1).getDisplayValues();
      const i = ids.findIndex((v) => v[0] === ch.crmId);
      if (i >= 0) row = i + 2;
    }
    if (!row && ch.row && ch.row >= 2 && ch.row < end) row = ch.row;
    if (!row) {
      // Insert right after the last non-empty deal row (inside the SUM ranges), copying its formatting.
      const block = end > 2 ? sh.getRange(2, 1, end - 2, headers.length).getDisplayValues() : [];
      let last = 1;
      block.forEach((v, i) => {
        if (v.some((x) => String(x).trim() !== '')) last = i + 2;
      });
      sh.insertRowAfter(last);
      row = last + 1;
      added++;
    } else updated++;
    Object.keys(ch.values || {}).forEach((h) => {
      const c = headers.indexOf(h);
      if (c >= 0) sh.getRange(row, c + 1).setValue(ch.values[h]);
    });
    if (ch.crmId) sh.getRange(row, idCol).setValue(ch.crmId);
  });
  return { updated, added };
}
