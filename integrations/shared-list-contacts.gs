/**
 * Shared prospect list: keep the companies on the Target List and the Contacts tab in step.
 *
 * The Target List is about companies (one row each: details, status, next steps). People and their
 * details live only on the Contacts tab, where a company can have many contacts.
 *
 *   - A company typed on the Contacts tab that isn't on the Target List gets a Target List row
 *     (Status "Researching").
 *   - A company typed on the Target List that has no Contacts row gets one, ready for a name.
 *   - Typing a company that's already on the Target List, or a person already listed for that company
 *     on the Contacts tab, shows a warning; both are highlighted in red. Names match ignoring case.
 *
 * Target List Status choices: Researching, Initial Outreach, Follow Up, Engaged, Secured Meeting, Future Office.
 *
 * Setup (once): in the sheet, Extensions > Apps Script > + (Add a file) > Script, name it
 * "shared-list-contacts", paste this file and save. It runs by itself on every edit. To bring existing
 * rows across, reload the sheet and use the menu Shared list > Sync Target List and Contacts.
 *
 * Only edits made in the sheet trigger it; changes written by the CRM sync or the API don't.
 */

const SLC_CONTACTS_TAB = 'Contacts';
const SLC_TARGET_TAB = 'Target List';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Shared list').addItem('Sync Target List and Contacts', 'syncTargetListAndContacts').addToUi();
}

function onEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const first = Math.max(e.range.getRow(), 2);
  const last = e.range.getLastRow();
  if (last < first) return;
  const t = slcTabs_(sh.getParent());
  if (!t) return;
  if (sh.getName() === SLC_CONTACTS_TAB) {
    slcCopyCompanies_(t, t.contacts, t.ch, t.target, t.th, first, last, slcWarnDuplicates_(t, SLC_CONTACTS_TAB, first, last));
  } else if (sh.getName() === SLC_TARGET_TAB) {
    slcCopyCompanies_(t, t.target, t.th, t.contacts, t.ch, first, last, slcWarnDuplicates_(t, SLC_TARGET_TAB, first, last));
  }
}

function syncTargetListAndContacts() {
  const t = slcTabs_(SpreadsheetApp.getActiveSpreadsheet());
  if (!t) return;
  if (t.contacts.getLastRow() >= 2) slcCopyCompanies_(t, t.contacts, t.ch, t.target, t.th, 2, t.contacts.getLastRow(), []);
  if (t.target.getLastRow() >= 2) slcCopyCompanies_(t, t.target, t.th, t.contacts, t.ch, 2, t.target.getLastRow(), []);
}

const slcNorm_ = (v) => String(v || '').trim().toLowerCase();

function slcHeaders_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map((h) => String(h).trim());
}

function slcTabs_(ss) {
  const contacts = ss.getSheetByName(SLC_CONTACTS_TAB);
  const target = ss.getSheetByName(SLC_TARGET_TAB);
  if (!contacts || !target) return null;
  const ch = slcHeaders_(contacts);
  const th = slcHeaders_(target);
  if (ch.indexOf('Company Name') < 0 || th.indexOf('Company Name') < 0) return null;
  return { ss, contacts, target, ch, th };
}

// All data rows of a tab as { row, v } with display values, skipping blank rows.
function slcRows_(sh, headers) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh
    .getRange(2, 1, last - 1, headers.length)
    .getDisplayValues()
    .map((v, i) => ({ row: i + 2, v }))
    .filter((r) => r.v.some((x) => String(x).trim() !== ''));
}

// Shows a warning for each edited row that repeats a company (Target List) or a person at a company
// (Contacts), and returns those row numbers so they aren't copied across.
function slcWarnDuplicates_(t, tab, first, last) {
  const isContacts = tab === SLC_CONTACTS_TAB;
  const sh = isContacts ? t.contacts : t.target;
  const h = isContacts ? t.ch : t.th;
  const co = h.indexOf('Company Name');
  const nm = h.indexOf('Contact Name');
  const key = (v) => slcNorm_(v[co]) + (isContacts ? '|' + slcNorm_(v[nm]) : '');
  const rows = slcRows_(sh, h);
  const dupes = [];
  rows
    .filter((r) => r.row >= first && r.row <= last && slcNorm_(r.v[co]) && (!isContacts || slcNorm_(r.v[nm])))
    .forEach((r) => {
      const other = rows.find((o) => o.row !== r.row && key(o.v) === key(r.v));
      if (!other) return;
      dupes.push(r.row);
      const what = isContacts ? r.v[nm] + ' (' + r.v[co] + ')' : r.v[co];
      t.ss.toast(what + ' is already on the ' + tab + ' tab in row ' + other.row + '. Update that row and delete this one.', 'Duplicate', 10);
    });
  return dupes;
}

// Adds each company in rows first..last of `from` to `to` if `to` doesn't have it yet.
function slcCopyCompanies_(t, from, fh, to, th, first, last, skip) {
  const names = from.getRange(first, fh.indexOf('Company Name') + 1, last - first + 1, 1).getDisplayValues();
  names.forEach((r, i) => {
    const company = String(r[0] || '').trim();
    if (!company || skip.indexOf(first + i) >= 0) return;
    const rows = slcRows_(to, th);
    if (rows.some((x) => slcNorm_(x.v[th.indexOf('Company Name')]) === slcNorm_(company))) return;
    const row = (rows.length ? rows[rows.length - 1].row : 1) + 1;
    to.getRange(row, th.indexOf('Company Name') + 1).setValue(company);
    if (to === t.target && th.indexOf('Status') >= 0) to.getRange(row, th.indexOf('Status') + 1).setValue('Researching');
  });
}
