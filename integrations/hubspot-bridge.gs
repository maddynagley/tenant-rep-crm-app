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
 *      crm.objects.deals.write, plus crm.objects.leads.read and crm.objects.leads.write so lead stages stay
 *      in step). Copy its access token.
 *      (HubSpot now lists private apps under Development → Legacy Apps.)
 *      Updating an existing bridge: add the write scopes to the private app (the token stays the same),
 *      paste this file over the old one, then Deploy → Manage deployments → edit → Version: New version.
 *   2. Here: Project Settings → Script properties → add HUBSPOT_TOKEN = <the token>.
 *   3. Run setup() once and approve the permissions; the execution log shows your sync key.
 *   4. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone. Copy the URL.
 *   5. In the CRM: Import / Settings → HubSpot live sync → paste the URL and the sync key.
 *
 * rotateKey() issues a new sync key (paste it into the CRM again).
 * installLeadTimer() (run once) gives companies added to HubSpot a lead every 15 minutes, CRM open or not.
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
    'submarket', 'square_footage', 'lease_expiration', 'hs_merged_object_ids',
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
    // Each company's lead stage, and companies whose lead changed (a lead edit doesn't touch the company).
    if (out.companies) {
      try {
        addLeadStages_(out.companies, since);
      } catch (err) {
        out.leadsError = leadsError_(err);
      }
    }
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
  companies: ['name', 'domain', 'address', 'city', 'state', 'submarket', 'square_footage', 'numberofemployees', 'lease_expiration', 'lead_stage'],
  contacts: ['firstname', 'lastname', 'email', 'jobtitle', 'phone', 'mobilephone', 'hs_linkedin_url'],
  deals: ['dealname', 'dealstage', 'closedate'],
};
// lead_stage isn't a company property: it's the stage of the company's lead record (Leads object).
const LEAD_PROP = 'lead_stage';
const LEAD_TO_COMPANY = 580; // HubSpot's "Lead with Primary Company" association
function realProps_(type) {
  return PUSH_PROPS[type].filter(function (p) { return p !== LEAD_PROP; });
}

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
        properties: realProps_(type),
        propertiesWithHistory: realProps_(type),
        inputs: changed.slice(k, k + 50).map(function (id) { return { id: id }; }),
      });
      (res.results || []).forEach(function (r) {
        const fix = {};
        realProps_(type).forEach(function (prop) {
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

// HubSpot's "create and associate companies with contacts" setting made a company for every contact the CRM
// sent on RESTORE_SINCE whose email domain didn't match one, although each contact was already linked to its
// real company. previewDuplicateCompanies() lists what would be merged; mergeDuplicateCompanies() merges each
// auto-created company into that real company (or, with no other company, the one company with its domain).
// Run the preview first, then the merge. The CRM folds its own copies in on the next sync.
function previewDuplicateCompanies() {
  return duplicateCompanies_(false);
}

function mergeDuplicateCompanies() {
  return duplicateCompanies_(true);
}

function duplicateCompanies_(apply) {
  const since = new Date(RESTORE_SINCE).getTime();
  const auto = [];
  let after;
  do {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(since) }, { propertyName: 'hs_object_source_label', operator: 'EQ', value: 'CRM_SETTING' }] }],
      properties: ['name', 'domain', 'createdate'],
      limit: 100,
    };
    if (after) body.after = after;
    const page = hubspot_('post', '/crm/v3/objects/companies/search', body);
    (page.results || []).forEach(function (r) { auto.push({ id: String(r.id), properties: r.properties || {} }); });
    after = page.paging && page.paging.next && page.paging.next.after;
  } while (after && auto.length < 2000);
  const autoIds = {};
  auto.forEach(function (a) { autoIds[a.id] = true; });
  attachAssociations_('companies', auto, 'contacts');
  const contacts = {};
  auto.forEach(function (a) { (a.contacts || []).forEach(function (id) { contacts[id] = { id: id }; }); });
  const contactList = Object.keys(contacts).map(function (id) { return contacts[id]; });
  attachAssociations_('contacts', contactList, 'companies');
  const plan = [];
  const left = [];
  auto.forEach(function (a) {
    const others = {};
    (a.contacts || []).forEach(function (cid) {
      (contacts[cid].companies || []).forEach(function (co) { if (!autoIds[co]) others[co] = true; });
    });
    let target = Object.keys(others);
    if (!target.length && a.properties.domain) {
      // No other company on its contacts: the one older company with the same domain, if there is exactly one.
      const same = searchIn_('companies', 'domain', [a.properties.domain]).filter(function (r) { return !autoIds[String(r.id)]; });
      target = same.map(function (r) { return String(r.id); });
    }
    if (target.length === 1) plan.push({ from: a.id, to: target[0], name: a.properties.name, domain: a.properties.domain });
    else left.push(a.properties.name + ' (' + a.id + ', ' + (target.length ? target.length + ' possible companies' : 'no other company') + ')');
  });
  let merged = 0;
  plan.forEach(function (m) {
    if (!apply) return Logger.log('Would merge ' + m.name + ' (' + m.domain + ', ' + m.from + ') into company ' + m.to);
    try {
      hubspot_('post', '/crm/v3/objects/companies/merge', { primaryObjectId: m.to, objectIdToMerge: m.from });
      merged++;
      Logger.log('Merged ' + m.name + ' (' + m.from + ') into ' + m.to);
    } catch (err) {
      Logger.log('Could not merge ' + m.name + ' (' + m.from + '): ' + err.message);
    }
  });
  left.forEach(function (x) { Logger.log('Left alone: ' + x); });
  Logger.log((apply ? 'Merged ' + merged : 'Would merge ' + plan.length) + ' auto-created companies; ' + left.length + ' left alone (listed above).');
  return { plan: plan.length, merged: merged, left: left.length };
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
  const leadWrites = [];
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
        // A lead stage is only ever set, never cleared (a company that stops being a lead keeps its HubSpot lead).
        if (k === LEAD_PROP && !mine) return;
        if (k === LEAD_PROP && current._leadsError) return (r.leadError = current._leadsError);
        const theirs = norm_(k, type === 'deals' && k === 'dealstage' ? now.stageLabel : now.properties[k]);
        if (mine === theirs) return (r.props[k] = theirs);
        const base = it.base && Object.prototype.hasOwnProperty.call(it.base, k) ? norm_(k, it.base[k]) : null;
        const hsChanged = base === null ? Boolean(theirs) : theirs !== base;
        // HubSpot changed this field since the last agreement and more recently than the CRM's edit: it stays.
        // (Except a lead stage never agreed on: lead stages are worked in the CRM, so the CRM's goes.)
        if (hsChanged && hsTime > crmTime && !(k === LEAD_PROP && base === null)) return (r.kept[k] = type === 'deals' && k === 'dealstage' ? now.stageLabel : now.properties[k]);
        // Never blank a HubSpot value on a first link.
        if (!mine && base === null) return (r.kept[k] = now.properties[k]);
        if (k === LEAD_PROP) return leadWrites.push({ i: i, stage: mine, leadId: now.lead && now.lead.id, name: props.name || now.properties.name });
        send[k] = mine;
        r.props[k] = mine;
      });
      if (Object.keys(send).length) updates.push({ i: i, id: r.hubspotId, properties: toWrite_(type, send, stages) });
    } else {
      Object.keys(props).forEach(function (k) {
        const v = norm_(k, props[k]);
        if (k === LEAD_PROP) return v && leadWrites.push({ i: i, stage: v, name: props.name });
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
  if (leadWrites.length) writeLeads_(leadWrites, results);
  // Companies the CRM sent that aren't leads (clients, landlords…): the lead timer leaves them alone.
  if (type === 'companies') {
    const notLeads = creates
      .filter(function (row) { return results[row.i].hubspotId && !norm_(LEAD_PROP, (items[row.i].props || {})[LEAD_PROP]); })
      .map(function (row) { return results[row.i].hubspotId; });
    if (notLeads.length) rememberNotLeads_(notLeads);
  }
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

// ---------- leads (a company's lead record carries its lead stage) ----------
function leadsError_(err) {
  const m = String(err && err.message ? err.message : err);
  return /40[13]/.test(m) ? 'Lead stages need the leads scopes (crm.objects.leads.read and .write) on the HubSpot private app' : m;
}

// Lead pipeline stages: name (lower case) → { id, pipeline }, ID → name, and the pipeline for new leads.
function leadStages_() {
  const res = hubspot_('get', '/crm/v3/pipelines/leads');
  const out = { byLabel: {}, byId: {}, pipeline: '' };
  (res.results || []).forEach(function (pl, n) {
    if (n === 0) out.pipeline = pl.id;
    (pl.stages || []).forEach(function (st) {
      out.byId[st.id] = st.label;
      if (!out.byLabel[String(st.label).toLowerCase()]) out.byLabel[String(st.label).toLowerCase()] = { id: st.id, pipeline: pl.id };
    });
  });
  return out;
}

// Company ID → its lead { id, label, modified } (the most recently changed one when a merge left several).
function leadsFor_(companyIds) {
  const stages = leadStages_();
  const companies = companyIds.map(function (id) { return { id: String(id) }; });
  attachAssociations_('companies', companies, 'leads');
  const leadIds = [];
  companies.forEach(function (c) { (c.leads || []).forEach(function (id) { if (leadIds.indexOf(id) < 0) leadIds.push(id); }); });
  const leads = {};
  for (let k = 0; k < leadIds.length; k += 100) {
    const res = hubspot_('post', '/crm/v3/objects/leads/batch/read', {
      properties: ['hs_pipeline_stage', 'hs_lastmodifieddate'],
      inputs: leadIds.slice(k, k + 100).map(function (id) { return { id: id }; }),
    });
    (res.results || []).forEach(function (r) { leads[String(r.id)] = r.properties || {}; });
  }
  const out = {};
  companies.forEach(function (c) {
    (c.leads || []).forEach(function (id) {
      const l = leads[id];
      if (!l) return;
      if (!out[c.id] || new Date(l.hs_lastmodifieddate) > new Date(out[c.id].modified)) out[c.id] = { id: id, label: stages.byId[l.hs_pipeline_stage] || '', modified: l.hs_lastmodifieddate };
    });
  });
  return out;
}

// Pulled companies get lead_stage; companies whose lead changed since `since` are added to the list.
function addLeadStages_(companies, since) {
  const byId = {};
  companies.forEach(function (c) { byId[String(c.id)] = c; });
  const changedLeads = [];
  let after;
  do {
    const body = { filterGroups: [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(since) }] }], properties: ['hs_lastmodifieddate'], limit: 100 };
    if (after) body.after = after;
    const page = hubspot_('post', '/crm/v3/objects/leads/search', body);
    (page.results || []).forEach(function (r) { changedLeads.push({ id: String(r.id) }); });
    after = page.paging && page.paging.next && page.paging.next.after;
  } while (after && changedLeads.length < MAX_PER_TYPE);
  attachAssociations_('leads', changedLeads, 'companies');
  const extra = [];
  changedLeads.forEach(function (l) { (l.companies || []).forEach(function (id) { if (!byId[id] && extra.indexOf(id) < 0) extra.push(id); }); });
  for (let k = 0; k < extra.length; k += 100) {
    const res = hubspot_('post', '/crm/v3/objects/companies/batch/read', { properties: TYPES.companies, inputs: extra.slice(k, k + 100).map(function (id) { return { id: id }; }) });
    (res.results || []).forEach(function (r) {
      const c = { id: String(r.id), properties: r.properties || {}, companies: [] };
      companies.push(c);
      byId[c.id] = c;
    });
  }
  const leads = leadsFor_(Object.keys(byId));
  Object.keys(leads).forEach(function (id) {
    const p = byId[id].properties;
    p.lead_stage = leads[id].label;
    // The company counts as changed when its lead did.
    if (new Date(leads[id].modified) > new Date(p.hs_lastmodifieddate || 0)) p.hs_lastmodifieddate = leads[id].modified;
  });
}

// ---------- every 15 minutes, even with the CRM closed ----------
// Run installLeadTimer() once from the Apps Script editor. Every 15 minutes, ensureLeads() gives each company
// added to HubSpot since the last run a lead at "New" if it has none (the CRM then keeps its stage in step).
// removeLeadTimer() turns it off.
function installLeadTimer() {
  removeLeadTimer();
  ScriptApp.newTrigger('ensureLeads').timeBased().everyMinutes(15).create();
  PropertiesService.getScriptProperties().setProperty('LEADS_CHECKED', String(Date.now() - 864e5));
  ensureLeads();
  Logger.log('Lead timer on: new HubSpot companies get a lead every 15 minutes.');
}

function removeLeadTimer() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ensureLeads') ScriptApp.deleteTrigger(t);
  });
}

function rememberNotLeads_(ids) {
  const props = PropertiesService.getScriptProperties();
  const list = (props.getProperty('NOT_LEADS') || '').split(',').filter(Boolean).concat(ids);
  props.setProperty('NOT_LEADS', list.slice(-800).join(','));
}

function ensureLeads() {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const started = Date.now();
    // A little overlap, so a company added during the last run isn't missed.
    const since = Number(props.getProperty('LEADS_CHECKED')) - 10 * 60000 || Date.now() - 864e5;
    const fresh = [];
    let after;
    do {
      const body = { filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(since) }] }], properties: ['name'], limit: 100 };
      if (after) body.after = after;
      const page = hubspot_('post', '/crm/v3/objects/companies/search', body);
      (page.results || []).forEach(function (r) { fresh.push({ id: String(r.id), name: (r.properties || {}).name }); });
      after = page.paging && page.paging.next && page.paging.next.after;
    } while (after && fresh.length < 500);
    let made = 0;
    if (fresh.length) {
      attachAssociations_('companies', fresh, 'leads');
      const stages = leadStages_();
      const st = stages.byLabel.new;
      const notLeads = (props.getProperty('NOT_LEADS') || '').split(',');
      fresh.filter(function (c) { return !(c.leads || []).length && notLeads.indexOf(c.id) < 0; }).forEach(function (c) {
        if (!st) return;
        hubspot_('post', '/crm/v3/objects/leads', {
          properties: { hs_lead_name: c.name || 'Lead', hs_pipeline: st.pipeline, hs_pipeline_stage: st.id },
          associations: [{ to: { id: c.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: LEAD_TO_COMPANY }] }],
        });
        made++;
      });
    }
    props.setProperty('LEADS_CHECKED', String(started));
    if (made) Logger.log('Created ' + made + ' lead' + (made > 1 ? 's' : '') + ' for new companies.');
  } finally {
    lock.releaseLock();
  }
}

// Lead stage changes from the CRM: update the company's lead, or create one linked to the company.
function writeLeads_(rows, results) {
  let stages;
  try {
    stages = leadStages_();
  } catch (err) {
    rows.forEach(function (row) { results[row.i].leadError = leadsError_(err); });
    return;
  }
  rows.forEach(function (row) {
    const r = results[row.i];
    const st = stages.byLabel[String(row.stage).toLowerCase()];
    if (r.error || !r.hubspotId || !st) return;
    try {
      if (row.leadId) {
        hubspot_('patch', '/crm/v3/objects/leads/' + row.leadId, { properties: { hs_pipeline_stage: st.id } });
      } else {
        hubspot_('post', '/crm/v3/objects/leads', {
          properties: { hs_lead_name: row.name || 'Lead', hs_pipeline: st.pipeline, hs_pipeline_stage: st.id },
          associations: [{ to: { id: r.hubspotId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: LEAD_TO_COMPANY }] }],
        });
      }
      r.props[LEAD_PROP] = row.stage;
    } catch (err) {
      r.leadError = leadsError_(err);
    }
  });
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
      properties: realProps_(type).concat([modified]),
      inputs: ids.slice(k, k + 100).map(function (id) { return { id: id }; }),
    });
    (res.results || []).forEach(function (r) {
      const p = r.properties || {};
      out[String(r.id)] = { properties: p, modified: p[modified], stageLabel: labels[p.dealstage] || '' };
    });
  }
  if (type === 'companies' && ids.length) {
    try {
      const leads = leadsFor_(ids);
      Object.keys(out).forEach(function (id) {
        const lead = leads[id];
        if (!lead) return;
        out[id].lead = lead;
        out[id].properties.lead_stage = lead.label;
        if (new Date(lead.modified) > new Date(out[id].modified || 0)) out[id].modified = lead.modified;
      });
    } catch (err) {
      out._leadsError = leadsError_(err);
    }
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
