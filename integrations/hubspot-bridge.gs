/**
 * Tenant Rep CRM – HubSpot bridge (Google Apps Script web app).
 *
 * Lets the CRM pick up emails (with opens and replies), notes, meetings and calls that HubSpot logs from
 * Outlook, plus new and updated companies and contacts (e.g. ones the ZoomInfo extension sends to HubSpot),
 * without ever putting a HubSpot key in the browser. The HubSpot token stays in this
 * script's properties; the CRM only holds the bridge URL and a sync key.
 *
 * Setup (once):
 *   1. In HubSpot create a private app with read scopes (contacts, companies, deals, sales-email-read)
 *      and copy its access token.
 *   2. Here: Project Settings → Script properties → add HUBSPOT_TOKEN = <the token>.
 *   3. Run setup() once and approve the permissions; the execution log shows your sync key.
 *   4. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone. Copy the URL.
 *   5. In the CRM: Import / Settings → HubSpot live sync → paste the URL and the sync key.
 *
 * rotateKey() issues a new sync key (paste it into the CRM again).
 */

const PAGE_SIZE = 100;
const MAX_PER_TYPE = 1000;

const TYPES = {
  emails: [
    'hs_lastmodifieddate',
    'hs_timestamp', 'hs_email_subject', 'hs_email_direction', 'hs_email_status', 'hs_email_open_count',
    'hs_email_reply_count', 'hs_email_click_count', 'hs_email_to_email', 'hs_email_from_email', 'hs_email_text',
  ],
  notes: ['hs_lastmodifieddate', 'hs_timestamp', 'hs_note_body'],
  meetings: ['hs_lastmodifieddate', 'hs_timestamp', 'hs_meeting_title', 'hs_meeting_start_time', 'hs_meeting_outcome', 'hs_meeting_body'],
  calls: ['hs_lastmodifieddate', 'hs_timestamp', 'hs_call_title', 'hs_call_body', 'hs_call_disposition', 'hs_call_direction', 'hs_call_duration'],
  companies: [
    'hs_lastmodifieddate', 'createdate', 'name', 'domain', 'website', 'industry', 'numberofemployees', 'address', 'city', 'state',
    'submarket', 'square_footage', 'lease_expiration',
  ],
  contacts: ['lastmodifieddate', 'createdate', 'firstname', 'lastname', 'email', 'jobtitle', 'phone', 'mobilephone', 'hs_linkedin_url'],
};

// Contacts name their last-modified date differently from every other object.
const MODIFIED = { contacts: 'lastmodifieddate' };
// Which associations to read for each type.
const LINKS = { companies: [], contacts: ['companies'] };

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SYNC_KEY')) props.setProperty('SYNC_KEY', Utilities.getUuid().replace(/-/g, ''));
  if (!props.getProperty('HUBSPOT_TOKEN')) Logger.log('Add a script property HUBSPOT_TOKEN with your HubSpot private app token, then run setup() again.');
  else Logger.log('HubSpot token found. Token check: ' + (checkToken_() ? 'OK' : 'FAILED (check the token and scopes)'));
  Logger.log('Your sync key: ' + props.getProperty('SYNC_KEY'));
}

function rotateKey() {
  PropertiesService.getScriptProperties().setProperty('SYNC_KEY', Utilities.getUuid().replace(/-/g, ''));
  setup();
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.key !== PropertiesService.getScriptProperties().getProperty('SYNC_KEY')) return json_({ ok: false, error: 'Wrong sync key' });
  try {
    // Fetch everything modified since the CRM's last sync (default: the last 7 days). `since=0` reads the
    // whole history; `types` limits the call to some types. When a type hits the cap, `more` and `next`
    // tell the CRM where to continue.
    const since = params.since === '0' ? 0 : Number(params.since) || Date.now() - 7 * 864e5;
    const wanted = params.types ? String(params.types).split(',') : Object.keys(TYPES);
    const now = Date.now();
    const out = { ok: true, now: now, more: {}, next: {} };
    wanted.filter(function (t) { return TYPES[t]; }).forEach(function (type) {
      const res = fetchSince_(type, TYPES[type], since);
      out[type] = res.items;
      out.more[type] = res.more;
      out.next[type] = res.next;
    });
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function fetchSince_(type, properties, since) {
  const modified = MODIFIED[type] || 'hs_lastmodifieddate';
  const results = [];
  let after;
  do {
    const body = {
      filterGroups: [{ filters: [{ propertyName: modified, operator: 'GTE', value: String(since) }] }],
      sorts: [{ propertyName: modified, direction: 'ASCENDING' }],
      properties: properties,
      limit: PAGE_SIZE,
    };
    if (after) body.after = after;
    const page = hubspot_('post', '/crm/v3/objects/' + type + '/search', body);
    (page.results || []).forEach(function (r) {
      const p = r.properties || {};
      if (p.hs_email_text) p.hs_email_text = String(p.hs_email_text).slice(0, 20000);
      if (p.hs_call_body) p.hs_call_body = String(p.hs_call_body).slice(0, 600);
      if (p.hs_meeting_body) p.hs_meeting_body = String(p.hs_meeting_body).slice(0, 600);
      if (p.hs_note_body) p.hs_note_body = String(p.hs_note_body).slice(0, 1500);
      results.push({ id: r.id, properties: p });
    });
    after = page.paging && page.paging.next && page.paging.next.after;
  } while (after && results.length < MAX_PER_TYPE);
  (LINKS[type] || ['companies', 'contacts', 'deals']).forEach(function (toType) { attachAssociations_(type, results, toType); });
  const last = results.length ? results[results.length - 1].properties[modified] : null;
  return { items: results, more: Boolean(after), next: last ? new Date(last).getTime() : since };
}

function attachAssociations_(type, results, toType) {
  for (let i = 0; i < results.length; i += 100) {
    const chunk = results.slice(i, i + 100);
    const res = hubspot_('post', '/crm/v4/associations/' + type + '/' + toType + '/batch/read', {
      inputs: chunk.map(function (r) { return { id: r.id }; }),
    });
    const map = {};
    (res.results || []).forEach(function (a) {
      map[a.from.id] = (a.to || []).map(function (t) { return String(t.toObjectId); });
    });
    chunk.forEach(function (r) { r[toType] = map[r.id] || []; });
  }
}

function hubspot_(method, path, payload) {
  const token = PropertiesService.getScriptProperties().getProperty('HUBSPOT_TOKEN');
  if (!token) throw new Error('HUBSPOT_TOKEN script property is missing');
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = UrlFetchApp.fetch('https://api.hubapi.com' + path, {
      method: method,
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: payload ? JSON.stringify(payload) : undefined,
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 429) {
      Utilities.sleep(1000 * (attempt + 1)); // HubSpot rate limit: back off and retry
      continue;
    }
    if (code >= 300) throw new Error('HubSpot ' + code + ': ' + res.getContentText().slice(0, 300));
    return JSON.parse(res.getContentText() || '{}');
  }
  throw new Error('HubSpot rate limit; try again in a minute');
}

function checkToken_() {
  try {
    hubspot_('get', '/crm/v3/objects/companies?limit=1');
    return true;
  } catch (e) {
    Logger.log(e.message);
    return false;
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
