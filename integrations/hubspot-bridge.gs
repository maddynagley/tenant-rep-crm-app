/**
 * Tenant Rep CRM – HubSpot bridge (Google Apps Script web app).
 *
 * Lets the CRM pick up emails (with opens and replies), notes, meetings and calls that HubSpot logs from
 * Outlook, plus new and updated companies, contacts and deals (e.g. ones the ZoomInfo extension sends to
 * HubSpot), without ever putting a HubSpot key in the browser. With two-way sync on, the CRM also sends its
 * new and edited companies, contacts and deals here (doPost), and this script writes them to HubSpot (and
 * deletes the ones Maddy deleted in the CRM and chose to delete in HubSpot too):
 * new records are matched first (companies by domain, then name; contacts by email; deals by name and
 * company) so nothing is doubled, and a field HubSpot changed more recently than the CRM is left alone.
 * The HubSpot token stays in this script's properties; the CRM only holds the bridge URL and a sync key.
 *
 * Setup (once):
 *   1. In HubSpot create a private app with read scopes (contacts, companies, deals, sales-email-read)
 *      and, for two-way sync, write scopes (crm.objects.companies.write, crm.objects.contacts.write,
 *      crm.objects.deals.write). Copy its access token.
 *      (HubSpot now lists private apps under Development → Legacy Apps.)
 *      Updating an existing bridge: add the write scopes to the private app (the token stays the same),
 *      paste this file over the old one, then Deploy → Manage deployments → edit → Version: New version.
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
  deals: ['hs_lastmodifieddate', 'createdate', 'dealname', 'dealstage', 'pipeline', 'closedate'],
};

// Contacts name their last-modified date differently from every other object.
const MODIFIED = { contacts: 'lastmodifieddate' };
// Which associations to read for each type.
const LINKS = { companies: [], contacts: ['companies'], deals: ['companies'] };

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

// ---------- two-way: CRM → HubSpot ----------
// Body: { key, companies: [item], contacts: [item], deals: [item] }, where an item is
//   { crmId, hubspotId, props, base, updatedAt, companyCrmId, companyHubspotId, associate }.
// props are HubSpot properties as the CRM has them; base is what both sides last agreed on (null if never).
// Answers each item with { crmId, hubspotId, props (what HubSpot now holds for them), kept, companyHubspotId, error }.
const PUSH_PROPS = {
  companies: ['name', 'domain', 'address', 'city', 'state', 'submarket', 'square_footage', 'numberofemployees', 'lease_expiration'],
  contacts: ['firstname', 'lastname', 'email', 'jobtitle', 'phone', 'mobilephone', 'hs_linkedin_url'],
  deals: ['dealname', 'dealstage', 'closedate'],
};

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  if (body.key !== PropertiesService.getScriptProperties().getProperty('SYNC_KEY')) return json_({ ok: false, error: 'Wrong sync key' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const out = { ok: true, now: Date.now() };
    const companyIds = {};
    ['companies', 'contacts', 'deals'].forEach(function (type) {
      out[type] = (body[type] || []).length ? pushType_(type, body[type].slice(0, 100), companyIds) : [];
    });
    // Records deleted in the CRM that Maddy chose to delete in HubSpot too (they go to HubSpot's recycling bin).
    if (body.archive) out.archived = archive_(body.archive);
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------- one-time repair ----------
// Run restoreBlankedFields() once from the Apps Script editor (select it, then Run). It puts back any synced
// field that an app or integration (like this bridge) blanked since RESTORE_SINCE, using the value it had just
// before. Fields cleared by a person in HubSpot are left alone. The execution log lists every change.
const RESTORE_SINCE = '2026-11-10T00:00:00Z';

function restoreBlankedFields() {
  const since = new Date(RESTORE_SINCE).getTime();
  const total = { companies: 0, contacts: 0, deals: 0 };
  ['companies', 'contacts', 'deals'].forEach(function (type) {
    const changed = [];
    let next = since;
    for (let round = 0; round < 20; round++) {
      const res = fetchSince_(type, TYPES[type], next);
      res.items.forEach(function (r) { if (changed.indexOf(r.id) < 0) changed.push(r.id); });
      if (!res.more || res.next <= next) break;
      next = res.next;
    }
    const updates = [];
    for (let k = 0; k < changed.length; k += 50) {
      const res = hubspot_('post', '/crm/v3/objects/' + type + '/batch/read', {
        properties: PUSH_PROPS[type],
        propertiesWithHistory: PUSH_PROPS[type],
        inputs: changed.slice(k, k + 50).map(function (id) { return { id: id }; }),
      });
      (res.results || []).forEach(function (r) {
        const fix = {};
        PUSH_PROPS[type].forEach(function (prop) {
          const history = ((r.propertiesWithHistory || {})[prop] || []).slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
          const latest = history[0];
          if (!latest || String(latest.value || '') !== '' || new Date(latest.timestamp).getTime() < since) return;
          // Only blanks written by an app or integration; a person clearing a field in HubSpot meant it.
          if (['INTEGRATION', 'API'].indexOf(String(latest.sourceType)) < 0) return Logger.log('Left alone: ' + type + ' ' + r.id + ' ' + prop + ' (cleared by ' + latest.sourceType + ')');
          const before = history.slice(1).filter(function (h) { return String(h.value || '') !== ''; })[0];
          if (before) fix[prop] = before.value;
        });
        if (Object.keys(fix).length) {
          updates.push({ id: r.id, properties: fix });
          Logger.log(type + ' ' + r.id + ' (' + ((r.properties || {}).name || (r.properties || {}).dealname || (r.properties || {}).email || '') + '): ' + JSON.stringify(fix));
        }
      });
    }
    for (let k = 0; k < updates.length; k += 100) hubspot_('post', '/crm/v3/objects/' + type + '/batch/update', { inputs: updates.slice(k, k + 100) });
    total[type] = updates.length;
  });
  Logger.log('Restored: ' + total.companies + ' companies, ' + total.contacts + ' contacts, ' + total.deals + ' deals.');
  return total;
}

// { companies: [ids], contacts: [ids], deals: [ids] } → per type { done: [ids], failed: [{ id, error }] }.
function archive_(req) {
  const out = {};
  ['companies', 'contacts', 'deals'].forEach(function (type) {
    const ids = (req[type] || []).map(String).slice(0, 100);
    out[type] = { done: [], failed: [] };
    if (!ids.length) return;
    try {
      hubspot_('post', '/crm/v3/objects/' + type + '/batch/archive', { inputs: ids.map(function (id) { return { id: id }; }) });
      out[type].done = ids;
    } catch (err) {
      ids.forEach(function (id) { out[type].failed.push({ id: id, error: err.message }); });
    }
  });
  return out;
}

// The same tidy form the CRM compares in ('' for blank).
function norm_(prop, v) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (prop === 'lease_expiration' || prop === 'closedate') {
    const d = new Date(/^\d+$/.test(s) ? Number(s) : s);
    return isNaN(d) ? '' : Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  }
  if (prop === 'square_footage' || prop === 'numberofemployees') return isNaN(Number(s.replace(/,/g, ''))) ? '' : String(Number(s.replace(/,/g, '')));
  if (prop === 'email') return s.toLowerCase();
  if (prop === 'domain') return s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];
  return s;
}

function pushType_(type, items, companyIds) {
  const results = items.map(function (it) { return { crmId: it.crmId, hubspotId: String(it.hubspotId || ''), props: {}, kept: {} }; });
  const stages = type === 'deals' ? stageIds_() : null;
  // Contacts and deals hang off a company the CRM may only just have sent.
  items.forEach(function (it, i) {
    if (type !== 'companies') results[i].companyHubspotId = String(it.companyHubspotId || companyIds[it.companyCrmId] || '');
  });
  // 1. New to HubSpot: look for the same record there first.
  findExisting_(type, items, results);
  // 2. Read what HubSpot holds now for every linked record, to keep its newer edits.
  const linked = results.filter(function (r) { return r.hubspotId; }).map(function (r) { return r.hubspotId; });
  const current = readCurrent_(type, linked);
  const updates = [];
  const creates = [];
  items.forEach(function (it, i) {
    const r = results[i];
    const props = it.props || {};
    const send = {};
    if (r.hubspotId) {
      const now = current[r.hubspotId];
      if (!now) {
        r.error = 'Not in HubSpot any more (deleted there?)';
        return;
      }
      const hsTime = new Date(now.modified || 0).getTime() || 0;
      const crmTime = new Date(it.updatedAt || 0).getTime() || 0;
      Object.keys(props).forEach(function (k) {
        if (PUSH_PROPS[type].indexOf(k) < 0) return;
        const mine = norm_(k, props[k]);
        const theirs = norm_(k, type === 'deals' && k === 'dealstage' ? now.stageLabel : now.properties[k]);
        if (mine === theirs) return (r.props[k] = theirs);
        const base = it.base ? norm_(k, it.base[k]) : null;
        const hsChanged = base === null ? Boolean(theirs) : theirs !== base;
        // HubSpot changed this field since the last agreement and more recently than the CRM's edit: it stays.
        if (hsChanged && hsTime > crmTime) return (r.kept[k] = type === 'deals' && k === 'dealstage' ? now.stageLabel : now.properties[k]);
        // Never blank a HubSpot value on a first link.
        if (!mine && base === null) return (r.kept[k] = now.properties[k]);
        send[k] = mine;
        r.props[k] = mine;
      });
      if (Object.keys(send).length) updates.push({ i: i, id: r.hubspotId, properties: toWrite_(type, send, stages) });
    } else {
      Object.keys(props).forEach(function (k) {
        const v = norm_(k, props[k]);
        if (PUSH_PROPS[type].indexOf(k) >= 0 && v) {
          send[k] = v;
          r.props[k] = v;
        }
      });
      if (type === 'deals' && !r.companyHubspotId) {
        r.error = 'Its company is not in HubSpot yet';
        return;
      }
      const properties = toWrite_(type, send, stages);
      if (type === 'deals' && !properties.pipeline) properties.pipeline = stages.pipeline;
      creates.push({ i: i, properties: properties });
    }
  });
  batchWrite_(type, 'update', updates, results);
  batchWrite_(type, 'create', creates, results);
  // 3. Link new (or moved) contacts and deals to their company.
  if (type !== 'companies') {
    const links = [];
    items.forEach(function (it, i) {
      const r = results[i];
      if (r.error || !r.hubspotId || !r.companyHubspotId) return;
      if (it.associate || !it.hubspotId) links.push({ from: { id: r.hubspotId }, to: { id: r.companyHubspotId } });
    });
    for (let k = 0; k < links.length; k += 100) {
      try {
        hubspot_('post', '/crm/v4/associations/' + type + '/companies/batch/associate/default', { inputs: links.slice(k, k + 100) });
      } catch (err) {
        Logger.log('Association failed: ' + err.message);
      }
    }
  }
  if (type === 'companies') results.forEach(function (r) { if (r.hubspotId) companyIds[r.crmId] = r.hubspotId; });
  return results;
}

// HubSpot property values to write: deal stages by name → this portal's stage ID.
function toWrite_(type, props, stages) {
  const out = {};
  Object.keys(props).forEach(function (k) {
    if (type === 'deals' && k === 'dealstage') {
      const st = stages.byLabel[String(props[k]).toLowerCase()];
      if (st) {
        out.dealstage = st.id;
        out.pipeline = st.pipeline;
      }
      return;
    }
    out[k] = props[k];
  });
  return out;
}

function findExisting_(type, items, results) {
  const want = [];
  items.forEach(function (it, i) {
    if (results[i].hubspotId) return;
    const p = it.props || {};
    if (type === 'companies' && (p.domain || p.name)) want.push({ i: i, prop: p.domain ? 'domain' : 'name', value: p.domain ? norm_('domain', p.domain) : String(p.name).trim() });
    if (type === 'contacts' && p.email) want.push({ i: i, prop: 'email', value: norm_('email', p.email) });
    if (type === 'deals' && p.dealname) want.push({ i: i, prop: 'dealname', value: String(p.dealname).trim() });
  });
  ['domain', 'name', 'email', 'dealname'].forEach(function (prop) {
    const group = want.filter(function (w) { return w.prop === prop; });
    for (let k = 0; k < group.length; k += 100) {
      const chunk = group.slice(k, k + 100);
      const found = searchIn_(type, prop, chunk.map(function (w) { return w.value; }));
      if (type === 'deals') attachAssociations_('deals', found, 'companies');
      chunk.forEach(function (w) {
        const hits = found.filter(function (f) {
          if (norm_(prop, f.properties[prop]).toLowerCase() !== String(w.value).toLowerCase()) return false;
          // A deal only matches one with the same name at the same company.
          return type !== 'deals' || (f.companies || []).indexOf(results[w.i].companyHubspotId) >= 0;
        });
        if (hits.length) results[w.i].hubspotId = String(hits[0].id);
      });
    }
  });
}

function searchIn_(type, prop, values) {
  const out = [];
  let after;
  do {
    const body = { filterGroups: [{ filters: [{ propertyName: prop, operator: 'IN', values: values }] }], properties: [prop], limit: 100 };
    if (after) body.after = after;
    const page = hubspot_('post', '/crm/v3/objects/' + type + '/search', body);
    (page.results || []).forEach(function (r) { out.push({ id: r.id, properties: r.properties || {} }); });
    after = page.paging && page.paging.next && page.paging.next.after;
  } while (after && out.length < 500);
  return out;
}

function readCurrent_(type, ids) {
  const out = {};
  const modified = MODIFIED[type] || 'hs_lastmodifieddate';
  const labels = type === 'deals' ? stageLabels_() : {};
  for (let k = 0; k < ids.length; k += 100) {
    const res = hubspot_('post', '/crm/v3/objects/' + type + '/batch/read', {
      properties: PUSH_PROPS[type].concat([modified]),
      inputs: ids.slice(k, k + 100).map(function (id) { return { id: id }; }),
    });
    (res.results || []).forEach(function (r) {
      const p = r.properties || {};
      out[String(r.id)] = { properties: p, modified: p[modified], stageLabel: labels[p.dealstage] || '' };
    });
  }
  return out;
}

function batchWrite_(type, action, rows, results) {
  for (let k = 0; k < rows.length; k += 100) {
    const chunk = rows.slice(k, k + 100);
    const inputs = chunk.map(function (row) { return action === 'update' ? { id: row.id, properties: row.properties } : { properties: row.properties }; });
    try {
      const res = hubspot_('post', '/crm/v3/objects/' + type + '/batch/' + action, { inputs: inputs });
      // Batch answers aren't in input order: creates are matched back by their properties.
      (res.results || []).forEach(function (r, n) {
        if (action === 'update') return;
        const row = chunk.filter(function (c) { return !c.done && sameWrite_(c.properties, r.properties || {}); })[0] || chunk[n];
        if (!row) return;
        row.done = true;
        results[row.i].hubspotId = String(r.id);
      });
    } catch (err) {
      // One bad record fails the batch: retry one by one so the rest still go through.
      chunk.forEach(function (row) {
        try {
          const r = action === 'update'
            ? hubspot_('patch', '/crm/v3/objects/' + type + '/' + row.id, { properties: row.properties })
            : hubspot_('post', '/crm/v3/objects/' + type, { properties: row.properties });
          if (action === 'create') results[row.i].hubspotId = String(r.id);
        } catch (e2) {
          // HubSpot already has this email: link to that contact instead.
          const existing = /Existing ID: (\d+)/.exec(e2.message);
          if (action === 'create' && existing) results[row.i].hubspotId = existing[1];
          else results[row.i].error = e2.message;
        }
      });
    }
  }
}

function sameWrite_(sent, got) {
  return Object.keys(sent).every(function (k) { return k === 'dealstage' || k === 'pipeline' || norm_(k, sent[k]) === norm_(k, got[k]); });
}

// Stage name (lower case) → { id, pipeline }, and the first pipeline for new deals; ID → name for reads.
function stageIds_() {
  const res = hubspot_('get', '/crm/v3/pipelines/deals');
  const out = { byLabel: {}, pipeline: 'default' };
  (res.results || []).forEach(function (pl, n) {
    if (n === 0 || pl.id === 'default') out.pipeline = pl.id;
    (pl.stages || []).forEach(function (st) {
      const key = String(st.label).toLowerCase();
      if (!out.byLabel[key] || pl.id === 'default') out.byLabel[key] = { id: st.id, pipeline: pl.id };
    });
  });
  return out;
}

function stageLabels_() {
  const res = hubspot_('get', '/crm/v3/pipelines/deals');
  const out = {};
  (res.results || []).forEach(function (pl) { (pl.stages || []).forEach(function (st) { out[st.id] = st.label; }); });
  return out;
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
  // Deal stages travel as their names too, since stage IDs differ from portal to portal.
  if (type === 'deals') {
    const labels = stageLabels_();
    results.forEach(function (r) { r.properties.dealstage_label = labels[r.properties.dealstage] || ''; });
  }
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
