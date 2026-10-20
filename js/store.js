/*
 * Data layer: everything is kept in this browser's IndexedDB (falling back to localStorage where IndexedDB
 * is unavailable). Nothing leaves the device.
 * Use Data > Export Backup regularly – browser storage is per-device.
 */
(function (root) {
  'use strict';
  const L = root.CRMLogic;
  const KEY = 'tenant-rep-crm.v1';
  const COLLECTIONS = ['companies', 'contacts', 'deals', 'activities', 'properties', 'marketing', 'comps', 'documents'];

  const DEFAULT_SETTINGS = {
    brokerName: '',
    homeMarket: '',
    defaultCommissionPct: 4,
    defaultEscalationPct: 3,
    defaultTermMonths: 60,
    staleDays: 60,
    lastBackup: '',
    houseSplitPct: 50,
    sheetSyncUrl: '',
    sheetSyncKey: '',
    sheetLastSync: '',
    outreachGoal: 10,
    postsPerWeek: 2,
    generatedIds: [],
    researchTeam: '',
    hubspotBridgeUrl: '',
    hubspotBridgeKey: '',
    hubspotLastSync: 0,
    myInitials: '',
    sharedLists: [{ id: 'mac', name: 'Metro Chamber (with KB)', url: '', key: '', lastSync: '' }],
  };

  function emptyDb() {
    const db = { version: 1, settings: Object.assign({}, DEFAULT_SETTINGS) };
    COLLECTIONS.forEach((c) => (db[c] = []));
    return db;
  }

  function normalize(db) {
    const out = Object.assign(emptyDb(), db || {});
    out.settings = Object.assign({}, DEFAULT_SETTINGS, (db && db.settings) || {});
    COLLECTIONS.forEach((c) => {
      if (!Array.isArray(out[c])) out[c] = [];
    });
    out.deals.forEach((d) => {
      if (d.stage) d.stage = L.normalizeDealStage(d.stage);
    });
    return out;
  }

  let db = emptyDb();
  const listeners = [];

  // ---------- storage: IndexedDB, with localStorage as the fallback ----------

  const IDB_NAME = 'tenant-rep-crm';
  const IDB_STORE = 'kv';
  let idb = null;

  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('IndexedDB is not available'));
      const req = root.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbCall(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, mode);
      const req = fn(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Save was interrupted'));
    });
  }
  const idbGet = (key) => idbCall('readonly', (st) => st.get(key));
  const idbPut = (key, value) => idbCall('readwrite', (st) => st.put(value, key));

  function loadLocal() {
    try {
      const raw = root.localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : emptyDb();
    } catch (e) {
      console.error('Could not load CRM data', e);
      return emptyDb();
    }
  }

  // Loads the data. The first time, it moves the localStorage copy into IndexedDB and removes the old copy
  // only after reading the new one back.
  const ready = (async () => {
    try {
      idb = await openIdb();
      let saved = await idbGet('db');
      if (!saved) {
        const raw = root.localStorage.getItem(KEY);
        if (raw) {
          saved = JSON.parse(raw);
          await idbPut('db', saved);
          if (await idbGet('db')) root.localStorage.removeItem(KEY);
        }
      }
      db = saved ? normalize(saved) : emptyDb();
    } catch (e) {
      console.warn('Using localStorage:', e.message);
      idb = null;
      db = loadLocal();
    }
  })();

  let pending = null;
  function saveFailed(e) {
    alert('Could not save – browser storage may be full or disabled. Export a backup now.\n\n' + e.message);
  }
  function persist() {
    if (idb) {
      // Coalesce bursts of changes into one write of the latest state.
      if (!pending)
        pending = Promise.resolve()
          .then(() => {
            pending = null;
            return idbPut('db', db);
          })
          .catch(saveFailed);
    } else {
      try {
        root.localStorage.setItem(KEY, JSON.stringify(db));
      } catch (e) {
        saveFailed(e);
      }
    }
    listeners.forEach((fn) => fn());
    return flush();
  }
  // Resolves once everything changed so far is saved.
  function flush() {
    return pending || Promise.resolve();
  }
  const backend = () => (idb ? 'IndexedDB' : 'localStorage');

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function all(col) {
    return db[col];
  }

  function get(col, id) {
    return db[col].find((r) => r.id === id) || null;
  }

  function upsert(col, rec, opts) {
    const now = new Date().toISOString();
    let existing = rec.id ? get(col, rec.id) : null;
    // touch:false records sync bookkeeping without counting as a user edit.
    const stamp = opts && opts.touch === false ? {} : { updatedAt: now };
    if (existing) {
      Object.assign(existing, rec, stamp);
    } else {
      existing = Object.assign({}, rec, { id: rec.id || uid(), createdAt: now, updatedAt: now });
      db[col].push(existing);
    }
    if (!(opts && opts.silent)) persist();
    return existing;
  }

  function bulkInsert(col, recs) {
    const created = recs.map((r) => upsert(col, r, { silent: true }));
    persist();
    return created;
  }

  // Deleting a company removes everything hanging off it; deleting a deal removes its survey properties.
  function remove(col, id, silent) {
    if (col === 'companies') {
      const dealIds = db.deals.filter((d) => d.companyId === id).map((d) => d.id);
      db.properties = db.properties.filter((p) => !dealIds.includes(p.dealId));
      db.deals = db.deals.filter((d) => d.companyId !== id);
      db.contacts = db.contacts.filter((c) => c.companyId !== id);
      db.activities = db.activities.filter((a) => a.companyId !== id);
    }
    if (col === 'deals') {
      db.properties = db.properties.filter((p) => p.dealId !== id);
      db.activities.forEach((a) => {
        if (a.dealId === id) a.dealId = '';
      });
    }
    if (col === 'contacts') {
      db.activities.forEach((a) => {
        if (a.contactId === id) a.contactId = '';
      });
    }
    db[col] = db[col].filter((r) => r.id !== id);
    if (!silent) persist();
  }

  // A merged record that doesn't exist yet must be whole; partial updates for missing records are dropped.
  const REQUIRED = { companies: ['name'], contacts: ['companyId', 'firstName'], deals: ['companyId', 'name'], activities: ['date'], properties: ['dealId'], marketing: ['title'], comps: ['building'], documents: ['name'] };
  function isComplete(col, rec) {
    return REQUIRED[col].every((k) => rec[k]);
  }

  function settings() {
    return db.settings;
  }

  function saveSettings(patch) {
    Object.assign(db.settings, patch);
    return persist();
  }

  // The Google Sheet connection (web app URL + sync key) never leaves this browser, so backups can't leak it.
  const DEVICE_ONLY_SETTINGS = ['sheetSyncUrl', 'sheetSyncKey', 'hubspotBridgeUrl', 'hubspotBridgeKey'];

  function exportJSON() {
    const copy = Object.assign({}, db, { settings: Object.assign({}, db.settings) });
    DEVICE_ONLY_SETTINGS.forEach((k) => delete copy.settings[k]);
    copy.settings.sharedLists = (db.settings.sharedLists || []).map((l) => Object.assign({}, l, { url: '', key: '' }));
    return JSON.stringify(copy, null, 2);
  }

  // mode 'replace' swaps everything; 'merge' adds/updates records by id.
  // A patchOnly file only updates records that already exist (it carries partial records).
  function importJSON(text, mode) {
    const incoming = normalize(JSON.parse(text));
    if (mode === 'replace') {
      DEVICE_ONLY_SETTINGS.forEach((k) => {
        if (!incoming.settings[k]) incoming.settings[k] = db.settings[k];
      });
      // Shared-list connections (URL + key) also stay on this device.
      incoming.settings.sharedLists = (incoming.settings.sharedLists || []).map((l) => {
        const mine = (db.settings.sharedLists || []).find((x) => x.id === l.id) || {};
        return Object.assign({}, l, { url: l.url || mine.url || '', key: l.key || mine.key || '' });
      });
      db = incoming;
    } else {
      COLLECTIONS.forEach((c) => {
        incoming[c].forEach((rec) => {
          const existing = get(c, rec.id);
          if (existing) Object.assign(existing, rec);
          else if (!incoming.patchOnly && isComplete(c, rec)) db[c].push(rec);
        });
      });
      // Shared settings an update file may set (never the device-only connection details).
      Object.keys(incoming.settingsPatch || {}).forEach((k) => {
        if (!DEVICE_ONLY_SETTINGS.includes(k) && k !== 'sharedLists') db.settings[k] = incoming.settingsPatch[k];
      });
      // An update file can also retire records (e.g. a duplicate deal merged into another).
      COLLECTIONS.forEach((c) => ((incoming.remove && incoming.remove[c]) || []).forEach((id) => get(c, id) && remove(c, id, true)));
    }
    return persist();
  }

  function clearAll() {
    const keep = Object.assign({}, db.settings);
    db = emptyDb();
    db.settings = Object.assign(db.settings, keep);
    persist();
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  // ---------- demo data (fictional companies) ----------

  function loadSampleData() {
    const t = L.todayISO();
    const inMonths = (m) => {
      const d = L.parseISODate(t);
      d.setMonth(d.getMonth() + m + 1, 0);
      return L.toISODate(d);
    };
    const days = (n) => L.addDays(t, n);

    const companies = [
      { name: 'Northwind Analytics', assetClass: 'Office', industry: 'Software', status: 'Engaged', priority: 'A', address: '400 Market St, Fl 12', building: 'Market Center', city: 'Downtown', submarket: 'CBD', sfOccupied: 28500, headcount: 140, leaseExpiration: inMonths(20), landlord: 'Granite Peak REIT', currentRate: 52.5, rateBasis: 'Full Service ($/SF/yr)', growthSignal: 'Growing', source: 'Referral', tags: 'tech, hybrid', notes: 'Hiring 40+ engineers next year. Hybrid 3 days/week.' },
      { name: 'Summit Cold Chain Logistics', assetClass: 'Industrial', industry: 'Logistics / 3PL', status: 'Contacted', priority: 'A', address: '1200 Commerce Pkwy', building: 'Commerce Park Bldg 3', city: 'Airport', submarket: 'Airport Industrial', sfOccupied: 185000, headcount: 220, leaseExpiration: inMonths(30), landlord: 'Prologis-style Fund IV', currentRate: 7.85, rateBasis: 'NNN ($/SF/yr)', growthSignal: 'Growing', source: 'CoStar', tags: 'cold storage, 32ft clear', notes: 'Needs 36’ clear, ESFR, 40+ docks. Exploring freezer expansion.' },
      { name: 'Harbor & Pine LLP', assetClass: 'Office', industry: 'Legal', status: 'Target', priority: 'B', address: '1 Harbor Plaza, Fl 22-23', building: 'Harbor Plaza', city: 'Downtown', submarket: 'CBD', sfOccupied: 46000, headcount: 165, leaseExpiration: inMonths(34), landlord: 'Harbor Plaza Owner LLC', currentRate: 58, rateBasis: 'Full Service ($/SF/yr)', growthSignal: 'Stable', source: 'CoStar', tags: 'law firm, trophy', notes: 'Managing partner owns real estate decisions.' },
      { name: 'Precision Fab Works', assetClass: 'Industrial', industry: 'Manufacturing', status: 'Target', priority: 'B', address: '88 Foundry Rd', building: '', city: 'East County', submarket: 'East Industrial', sfOccupied: 62000, headcount: 95, leaseExpiration: inMonths(14), landlord: 'Private owner', currentRate: 6.25, rateBasis: 'NNN ($/SF/yr)', growthSignal: 'Unknown', source: 'Drive-by', tags: 'heavy power, cranes', notes: 'Heavy power (2000A), 10-ton cranes. Relocation is costly – likely renewal leverage play.' },
      { name: 'BrightPath Health Partners', assetClass: 'Office', industry: 'Healthcare', status: 'Active Client', priority: 'A', address: '2200 Wellness Blvd', building: 'Wellness Pointe', city: 'Northside', submarket: 'North Suburban', sfOccupied: 18000, headcount: 90, leaseExpiration: inMonths(9), landlord: 'Medical Office Trust', currentRate: 31, rateBasis: 'Full Service ($/SF/yr)', growthSignal: 'Growing', source: 'Existing client', tags: 'medical office', notes: 'Rep agreement signed. Wants 20-25k RSF near hospital campus.' },
      { name: 'Vantage Ecommerce Fulfillment', assetClass: 'Industrial', industry: 'E-commerce', status: 'Nurture', priority: 'C', address: '5500 Distribution Way', building: 'Gateway Logistics Center', city: 'South County', submarket: 'I-5 Corridor', sfOccupied: 310000, headcount: 400, leaseExpiration: inMonths(52), landlord: 'Gateway Partners', currentRate: 6.9, rateBasis: 'NNN ($/SF/yr)', growthSignal: 'Contracting', source: 'ZoomInfo', tags: 'big box', notes: 'Possible sublease of 100k SF – watch for consolidation.' },
      { name: 'Copperline Engineering', assetClass: 'Office & Industrial', industry: 'Engineering', status: 'Contacted', priority: 'B', address: '700 Tech Ct', building: 'Tech Court Flex', city: 'West', submarket: 'West Flex/R&D', sfOccupied: 24000, headcount: 75, leaseExpiration: inMonths(23), landlord: 'Tech Court Holdings', currentRate: 18.5, rateBasis: 'Modified Gross ($/SF/yr)', growthSignal: 'Stable', source: 'LinkedIn', tags: 'flex, lab', notes: '40% office / 60% lab & assembly.' },
      { name: 'Meridian Wealth Advisors', assetClass: 'Office', industry: 'Financial Services', status: 'Target', priority: 'C', address: '1500 Oak Ave, Ste 300', building: 'Oak Center', city: 'Northside', submarket: 'North Suburban', sfOccupied: 7200, headcount: 30, leaseExpiration: inMonths(-1), landlord: 'Oak Center LP', currentRate: 34, rateBasis: 'Full Service ($/SF/yr)', growthSignal: 'Unknown', source: 'CoStar', tags: '', notes: 'Expiration passed per CoStar – confirm if renewed or in holdover.' },
    ];
    const created = bulkInsert('companies', companies);
    const id = (name) => created.find((c) => c.name === name).id;

    const contacts = bulkInsert('contacts', [
      { companyId: id('Northwind Analytics'), firstName: 'Dana', lastName: 'Reyes', title: 'COO', role: 'Decision Maker', email: 'dana.reyes@example.com', phone: '555-0101' },
      { companyId: id('Northwind Analytics'), firstName: 'Sam', lastName: 'Ortiz', title: 'Head of Workplace', role: 'Influencer', email: 'sam.ortiz@example.com', phone: '555-0102' },
      { companyId: id('Summit Cold Chain Logistics'), firstName: 'Jordan', lastName: 'Blake', title: 'VP Operations', role: 'Decision Maker', email: 'jblake@example.com', phone: '555-0201' },
      { companyId: id('Harbor & Pine LLP'), firstName: 'Morgan', lastName: 'Hale', title: 'Managing Partner', role: 'Decision Maker', email: 'mhale@example.com', phone: '555-0301' },
      { companyId: id('Precision Fab Works'), firstName: 'Chris', lastName: 'Nakamura', title: 'CFO', role: 'Decision Maker', email: 'cnakamura@example.com', phone: '555-0401' },
      { companyId: id('BrightPath Health Partners'), firstName: 'Alex', lastName: 'Patel', title: 'Director of Facilities', role: 'Decision Maker', email: 'apatel@example.com', phone: '555-0501' },
      { companyId: id('Copperline Engineering'), firstName: 'Riley', lastName: 'Chen', title: 'Controller', role: 'Influencer', email: 'rchen@example.com', phone: '555-0701' },
    ]);
    const cid = (last) => contacts.find((c) => c.lastName === last).id;

    const s = settings();
    const deals = bulkInsert('deals', [
      { name: 'Northwind – Expansion / Relocation', companyId: id('Northwind Analytics'), dealType: 'Relocation', assetClass: 'Office', stage: 'Market Survey', sfMin: 32000, sfMax: 40000, estSF: 36000, targetSubmarkets: 'CBD, Midtown', budgetRate: 50, rateBasis: 'Full Service ($/SF/yr)', termMonths: 88, escalationPct: 3, freeRentMonths: 8, commissionPct: s.defaultCommissionPct, targetOccupancy: inMonths(19), targetClose: inMonths(8), repAgreementSigned: true, repAgreementExpires: inMonths(12), requirements: 'Open plan, 2 training rooms, near transit, 2.5/1000 parking.' },
      { name: 'Summit – Freezer Expansion', companyId: id('Summit Cold Chain Logistics'), dealType: 'Expansion', assetClass: 'Industrial', stage: 'Intro Call', sfMin: 220000, sfMax: 260000, estSF: 240000, targetSubmarkets: 'Airport Industrial, I-5 Corridor', budgetRate: 8.25, rateBasis: 'NNN ($/SF/yr)', termMonths: 120, escalationPct: 3.5, freeRentMonths: 4, commissionPct: 3, targetClose: inMonths(14), requirements: '36’ clear, ESFR, 50+ dock doors, 4,000A power, trailer parking 100+.' },
      { name: 'BrightPath – Renewal vs. Relocation', companyId: id('BrightPath Health Partners'), dealType: 'Renewal', assetClass: 'Office', stage: 'RFP', sfMin: 20000, sfMax: 25000, estSF: 22000, targetSubmarkets: 'North Suburban', budgetRate: 32, rateBasis: 'Full Service ($/SF/yr)', termMonths: 120, escalationPct: 2.5, freeRentMonths: 6, commissionPct: s.defaultCommissionPct, targetOccupancy: inMonths(9), targetClose: inMonths(3), repAgreementSigned: true, repAgreementExpires: inMonths(10), requirements: 'Medical-grade HVAC, ground floor preferred, 5/1000 parking.' },
      { name: 'Precision Fab – Renewal', companyId: id('Precision Fab Works'), dealType: 'Renewal', assetClass: 'Industrial', stage: 'Closed Won', estSF: 62000, budgetRate: 6.75, rateBasis: 'NNN ($/SF/yr)', termMonths: 60, escalationPct: 3, commissionPct: 4, targetClose: days(-40) },
    ]);

    bulkInsert('properties', [
      { dealId: deals[0].id, building: 'Midtown Tower', address: '900 5th Ave', submarket: 'Midtown', availableSF: 38000, askingRate: 49, rateBasis: 'Full Service ($/SF/yr)', status: 'Toured', notes: 'Spec suites; LL open to 2 floors.' },
      { dealId: deals[0].id, building: 'Market Center', address: '400 Market St', submarket: 'CBD', availableSF: 36000, askingRate: 54, rateBasis: 'Full Service ($/SF/yr)', status: 'Proposal Requested', notes: 'Incumbent – blend & extend leverage.' },
      { dealId: deals[0].id, building: 'The Foundry', address: '22 Mill St', submarket: 'CBD', availableSF: 41000, askingRate: 47, rateBasis: 'Full Service ($/SF/yr)', status: 'Identified' },
      { dealId: deals[2].id, building: 'Wellness Pointe', address: '2200 Wellness Blvd', submarket: 'North Suburban', availableSF: 22000, askingRate: 31.5, rateBasis: 'Full Service ($/SF/yr)', status: 'Proposal Received' },
      { dealId: deals[2].id, building: 'Hospital Hill MOB', address: '15 Campus Dr', submarket: 'North Suburban', availableSF: 24000, askingRate: 33, rateBasis: 'Full Service ($/SF/yr)', status: 'Shortlisted' },
    ]);

    bulkInsert('activities', [
      { type: 'Meeting', date: days(-6), companyId: id('Northwind Analytics'), contactId: cid('Reyes'), dealId: deals[0].id, subject: 'Space program kickoff', notes: 'Headcount plan 180 by EOY next year.', followUpDate: days(1), done: false },
      { type: 'Tour', date: days(-3), companyId: id('Northwind Analytics'), contactId: cid('Ortiz'), dealId: deals[0].id, subject: 'Toured Midtown Tower', notes: 'Liked floor plates, concerned about elevators.', followUpDate: '', done: true },
      { type: 'Call', date: days(-12), companyId: id('Summit Cold Chain Logistics'), contactId: cid('Blake'), subject: 'Intro call', notes: 'Open to a meeting after Q-end.', followUpDate: days(-2), done: false },
      { type: 'Email', date: days(-100), companyId: id('Harbor & Pine LLP'), contactId: cid('Hale'), subject: 'Market update sent', notes: 'No response.', followUpDate: '', done: true },
      { type: 'Proposal', date: days(-2), companyId: id('BrightPath Health Partners'), contactId: cid('Patel'), dealId: deals[2].id, subject: 'Received LL proposal – Wellness Pointe', notes: 'Need to build comparison.', followUpDate: days(0), done: false },
      { type: 'Task', date: days(0), companyId: id('Meridian Wealth Advisors'), subject: 'Confirm lease status (holdover?)', followUpDate: days(3), done: false },
    ]);
  }

  root.CRMStore = {
    ready,
    flush,
    backend,
    COLLECTIONS,
    all,
    get,
    upsert,
    bulkInsert,
    remove,
    settings,
    saveSettings,
    exportJSON,
    importJSON,
    clearAll,
    onChange,
    loadSampleData,
    uid,
  };
})(window);
