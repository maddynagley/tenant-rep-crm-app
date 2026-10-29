/*
 * UI for the Tenant Rep CRM. Hash-routed single page app, rendered with template strings.
 */
(function () {
  'use strict';
  const L = window.CRMLogic;
  const S = window.CRMStore;

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (v) =>
    String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const PROSPECT_STATUSES = ['Target', 'Contacted', 'Engaged', 'Nurture'];
  const LIST_STATUSES = ['Researching', 'Ready to contact', 'Contacted', 'Meeting set', 'On hold', 'Not a fit'];
  const GROWTH = ['Growing', 'Stable', 'Contracting', 'Unknown'];
  const SOURCES = ['CoStar', 'Referral', 'Cold Call', 'LinkedIn', 'ZoomInfo', 'Drive-by', 'Existing client', 'Event', 'Landlord tip'];

  // ---------- UI state (remembered per browser) ----------

  const UI_KEY = 'tenant-rep-crm.ui';
  const state = mergeUIState(
    {
      companies: { q: '', asset: 'All', status: '', submarket: '', window: '', priority: '', sort: 'score', dir: '', limit: 100, list: '', listStatus: '' },
      leads: { q: '', asset: 'All', stage: 'active', temp: '', sort: 'expiration', dir: '', limit: 100 },
      sharedList: { sort: 'score', dir: '' },
      prospecting: { period: 'thisWeek', drill: '' },
      research: { statsAsset: 'Office', statsSub: '', statsQuarter: '', statsMetric: 'vacancy' },
      today: { sub: '' },
      contacts: { q: '' },
      marketing: { tab: 'collateral', q: '' },
      comps: { tab: 'dates', q: '', asset: 'All' },
      coach: { open: false },
      pipeline: { view: 'board', asset: 'All', showClosed: false },
      activities: { tab: 'open', q: '' },
      expirations: { asset: 'All', horizon: 36, includeClients: true },
      portfolio: { asset: 'All', year: 'All' },
    },
    readUIState()
  );
  let importPreview = null;

  function mergeUIState(defaults, saved) {
    Object.keys(defaults).forEach((k) => Object.assign(defaults[k], saved[k] || {}));
    return defaults;
  }
  function readUIState() {
    try {
      return JSON.parse(localStorage.getItem(UI_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveUIState() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(state));
    } catch (e) {
      /* non-essential */
    }
  }

  // ---------- field definitions (drive forms) ----------

  // A client gives a budget as a rate (e.g. $32/SF/yr) or as a monthly total (e.g. $5,000/month).
  const BUDGET_CHOICES = [
    { value: 'Per RSF', label: 'Rate: $ per SF per year' },
    { value: 'Total per month', label: 'Monthly budget: total $ per month' },
  ];


  const distinct = (col, key) => Array.from(new Set(S.all(col).map((r) => r[key]).filter(Boolean))).sort();

  const FIELDS = {
    companies: [
      { section: 'Company' },
      { key: 'name', label: 'Company name', required: true, wide: true },
      { key: 'aliases', label: 'Also known as (brands, subsidiaries; comma separated)', wide: true },
      { key: 'assetClass', label: 'Asset class', type: 'select', options: L.ASSET_CLASSES, required: true },
      { key: 'industry', label: 'Industry', list: () => distinct('companies', 'industry') },
      { key: 'relationship', label: 'Relationship (only tenants show as leads)', type: 'select', options: L.RELATIONSHIPS },
      { key: 'status', label: 'Status', type: 'select', options: L.COMPANY_STATUSES },
      { key: 'leadStage', label: 'Lead stage', type: 'select', options: L.LEAD_STAGES },
      { key: 'leadTemp', label: 'Lead temperature', type: 'select', options: L.LEAD_TEMPS },
      { key: 'snoozeUntil', label: 'Hide from Today list until', type: 'date' },
      { key: 'doNotContact', label: 'Do not contact (keeps it off the Today list)', type: 'checkbox' },
      { key: 'doNotContactReason', label: 'Why not', type: 'select', options: L.DO_NOT_CONTACT_REASONS },
      { key: 'priority', label: 'Priority', type: 'select', options: ['A', 'B', 'C'] },
      { key: 'growthSignal', label: 'Growth signal', type: 'select', options: GROWTH },
      { key: 'source', label: 'Lead source', list: () => Array.from(new Set(SOURCES.concat(distinct('companies', 'source')))) },
      { key: 'website', label: 'Website', type: 'url' },
      { key: 'lastContacted', label: 'Last contacted', type: 'date' },
      { section: 'Current occupancy' },
      { key: 'address', label: 'Address', wide: true },
      { key: 'building', label: 'Building name' },
      { key: 'floor', label: 'Floor / suite' },
      { key: 'city', label: 'Market / city', list: () => distinct('companies', 'city') },
      { key: 'submarket', label: 'Submarket', list: () => distinct('companies', 'submarket') },
      { key: 'sfOccupied', label: 'SF occupied', type: 'number' },
      { key: 'partner', label: 'Partner on this account (fills {Partner} in emails; "None" if you work it alone)', list: () => Array.from(new Set(distinct('companies', 'partner').concat(distinct('deals', 'partnerBrokers')))).sort() },
      { key: 'headcount', label: 'Headcount', type: 'number' },
      { key: 'leaseExpiration', label: 'Lease expiration', type: 'date' },
      { key: 'landlord', label: 'Landlord / owner' },
      { key: 'currentRate', label: 'Current rent ($/SF)', type: 'number', step: '0.01' },
      { key: 'rateBasis', label: 'Rent basis', type: 'select', options: L.RATE_BASES },
      { key: 'clearHeight', label: 'Clear height (ft)', type: 'number', asset: 'Industrial' },
      { key: 'dockDoors', label: 'Dock doors', type: 'number', asset: 'Industrial' },
      { key: 'leaseOptions', label: 'Renewal / termination / ROFR options', wide: true },
      { section: 'Shared prospect list (these fields sync with the shared Google Sheet)' },
      {
        key: 'sharedList',
        label: 'On shared list',
        type: 'select',
        get options() {
          return (S.settings().sharedLists || []).map((l) => ({ value: l.id, label: l.name }));
        },
      },
      { key: 'listStatus', label: 'List status', type: 'select', options: LIST_STATUSES },
      { key: 'listLead', label: 'Lead', type: 'select', options: ['KB', 'MN', 'Both'] },
      { key: 'contactedBy', label: 'Contacted by', type: 'select', options: ['KB', 'MN', 'Both'] },
      { key: 'spaceNeed', label: 'Space need', type: 'select', options: ['Office', 'Industrial', 'Office & Industrial', 'Unknown'] },
      { key: 'foe', label: 'Foreign-owned (FOE)', type: 'select', options: ['Y', 'N'] },
      { key: 'localPresence', label: 'Local presence', type: 'select', options: ['None', 'Sales rep', 'Small office', 'Regional office', 'Facility', 'Unknown'] },
      { key: 'hqCity', label: 'HQ city' },
      { key: 'hqState', label: 'HQ state' },
      { key: 'hqCountry', label: 'HQ country' },
      { key: 'usHQ', label: 'US HQ' },
      { key: 'introVia', label: 'Intro via' },
      { key: 'nextStep', label: 'Next step', wide: true },
      { key: 'nextStepDate', label: 'Next step date', type: 'date' },
      { key: 'listNotes', label: 'Shared notes (visible to your list partner)', type: 'textarea', wide: true },
      { section: 'Notes' },
      { key: 'tags', label: 'Tags (comma separated)', wide: true },
      { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
    contacts: [
      { key: 'firstName', label: 'First name', required: true },
      { key: 'lastName', label: 'Last name' },
      { key: 'companyId', label: 'Company', type: 'ref', ref: 'companies', required: true },
      { key: 'title', label: 'Title' },
      { key: 'role', label: 'Role in decision', type: 'select', options: ['Decision Maker', 'Influencer', 'Gatekeeper', 'Champion', 'Other'] },
      { key: 'keyContact', label: '★ Main point of contact (emails and calls go to them first)', type: 'checkbox' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Office phone', type: 'tel' },
      { key: 'mobile', label: 'Mobile', type: 'tel' },
      { key: 'phoneDNC', label: 'Office phone is Do-Not-Call', type: 'checkbox' },
      { key: 'mobileDNC', label: 'Mobile is Do-Not-Call', type: 'checkbox' },
      { key: 'verification', label: 'Verification', type: 'select', options: ['Web-verified', 'ZoomInfo only', 'Unverified'] },
      { key: 'linkedin', label: 'LinkedIn URL', type: 'url', wide: true },
      { key: 'linkedinConnected', label: 'Connected on LinkedIn', type: 'checkbox' },
      {
        key: 'sharedList',
        label: 'Share on list (adds this person to the shared sheet)',
        type: 'select',
        get options() {
          return (S.settings().sharedLists || []).map((l) => ({ value: l.id, label: l.name }));
        },
      },
      { key: 'listRole', label: 'Role on shared list', type: 'select', options: ['Decision maker', 'Real estate / facilities', 'Executive', 'HR', 'Finance', 'Other'] },
      { key: 'listNotes', label: 'Shared notes (visible to your list partner)', type: 'textarea', wide: true },
      { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
    deals: [
      { section: 'Requirement' },
      { key: 'name', label: 'Deal name', required: true, wide: true },
      { key: 'companyId', label: 'Client', type: 'ref', ref: 'companies', required: true },
      { key: 'partnerBrokers', label: 'Partner broker(s) I\'m working it with', list: () => distinct('deals', 'partnerBrokers') },
      { key: 'otherBrokers', label: 'Other brokers involved (other offices, outside brokers)', wide: true },
      { key: 'dealType', label: 'Deal type', type: 'select', options: L.DEAL_TYPES },
      { key: 'assetClass', label: 'Asset class', type: 'select', options: L.ASSET_CLASSES, required: true },
      { key: 'stage', label: 'Stage', type: 'select', options: L.DEAL_STAGES.map((s) => s.name) },
      { key: 'sfMin', label: 'SF min (total)', type: 'number' },
      { key: 'sfMax', label: 'SF max (total)', type: 'number' },
      { key: 'officeSfMin', label: 'Office SF needed – min (part of the total)', type: 'number', asset: 'Industrial' },
      { key: 'officeSfMax', label: 'Office SF needed – max', type: 'number', asset: 'Industrial' },
      { key: 'estSF', label: 'Est. deal SF (for commission)', type: 'number' },
      { key: 'targetSubmarkets', label: 'Target submarkets' },
      { key: 'targetOccupancy', label: 'Target occupancy', type: 'date' },
      { key: 'headcountTarget', label: 'Planned headcount', type: 'number', asset: 'Office' },
      { key: 'parkingSpaces', label: 'Parking spaces needed', type: 'number' },
      { key: 'clearHeightMin', label: 'Min clear height (ft)', type: 'number', asset: 'Industrial' },
      { key: 'dockDoors', label: 'Dock doors', type: 'number', asset: 'Industrial' },
      { key: 'driveIns', label: 'Drive-in doors', type: 'number', asset: 'Industrial' },
      { key: 'power', label: 'Power (amps / volts)', asset: 'Industrial' },
      { key: 'requirements', label: 'Other requirements', type: 'textarea', wide: true },
      { section: 'Economics' },
      { key: 'budgetUnit', label: 'How the client gave their budget', type: 'select', options: BUDGET_CHOICES, noBlank: true, defaultValue: 'Per RSF' },
      { key: 'budgetRate', label: 'Budget – rate in $/SF/yr, or total $ per month (low end, or the single number)', type: 'number', step: '0.01' },
      { key: 'budgetRateMax', label: 'Budget – high end (if a range)', type: 'number', step: '0.01' },
      { key: 'rateBasis', label: 'Rent basis', type: 'select', options: L.RATE_BASES },
      { key: 'termMonths', label: 'Term (months)', type: 'number' },
      { key: 'escalationPct', label: 'Annual escalation %', type: 'number', step: '0.1' },
      { key: 'freeRentMonths', label: 'Free rent (months)', type: 'number' },
      { key: 'tiAllowance', label: 'TI allowance ($/SF)', type: 'number', step: '0.01' },
      { key: 'commissionPct', label: 'Commission % of aggregate rent', type: 'number', step: '0.01' },
      { key: 'splitPct', label: 'My split % (blank = 100)', type: 'number', step: '0.1' },
      { key: 'commissionOverride', label: 'Commission override ($)', type: 'number' },
      { key: 'probability', label: 'Probability % (blank = stage default)', type: 'number' },
      { section: 'Timing' },
      { key: 'targetClose', label: 'Target lease execution', type: 'date' },
      { key: 'closedDate', label: 'Closed date', type: 'date' },
      { key: 'repAgreementSigned', label: 'Rep agreement signed', type: 'checkbox' },
      { key: 'repAgreementExpires', label: 'Rep agreement expires', type: 'date' },
      { key: 'lostReason', label: 'Lost reason', wide: true },
      { section: 'Final lease terms (from the signed lease or final LOI)' },
      { key: 'finalRate', label: 'Starting rent ($/SF)', type: 'number', step: '0.01' },
      { key: 'finalRateBasis', label: 'Rent basis', type: 'select', options: L.RATE_BASES },
      { key: 'finalTermMonths', label: 'Term (months)', type: 'number' },
      { key: 'finalEscalationPct', label: 'Annual escalation %', type: 'number', step: '0.1' },
      { key: 'finalFreeRentMonths', label: 'Free rent (months)', type: 'number' },
      { key: 'finalTiAllowance', label: 'TI allowance ($/SF)', type: 'number', step: '0.01' },
      { key: 'finalOptions', label: 'Renewal / termination / expansion options', wide: true },
      { key: 'finalOtherTerms', label: 'Other key terms (security deposit, parking, signage…)', type: 'textarea', wide: true },
      { section: 'Closed deal results (for your portfolio metrics)' },
      { key: 'actualSF', label: 'Final SF', type: 'number' },
      { key: 'actualOfficeSF', label: 'Final office SF (part of the total)', type: 'number', asset: 'Industrial' },
      { key: 'totalLeaseValue', label: 'Total rent $ (total consideration)', type: 'number' },
      { key: 'firmCommission', label: 'Gross commission – firm ($)', type: 'number' },
      { key: 'commissionEarned', label: 'Gross commission – my share ($)', type: 'number' },
      { key: 'representation', label: 'TR / LL / Other', type: 'select', options: ['TR', 'LL', 'Other'] },
      { key: 'voucher', label: 'Voucher (brokers on the deal)' },
      { key: 'outsideBroker', label: 'Outside broker' },
      { key: 'outsideBrokerCompany', label: 'Outside broker company' },
      { key: 'submarket', label: 'Submarket (deal)' },
      { key: 'trxId', label: 'TRX # (transaction ID)' },
      { key: 'inPortfolioSheet', label: 'Track on my portfolio Google Sheet', type: 'checkbox' },
      { key: 'partnerDeal', label: "Partner's deal (keep the record, leave out of my production)", type: 'checkbox' },
      { key: 'leadBroker', label: 'Lead broker' },
      { key: 'building', label: 'Building' },
      { key: 'address', label: 'Address' },
      { key: 'leaseCommencement', label: 'Lease commencement', type: 'date' },
      { key: 'newLeaseExpiration', label: 'Lease expiration (LXD) – blank = commencement + term', type: 'date' },
      { key: 'renewalNoticeDate', label: 'Renewal option notice deadline', type: 'date' },
      { key: 'terminationOptionDate', label: 'Termination option deadline', type: 'date' },
      { key: 'otherCriticalDate', label: 'Other critical date', type: 'date' },
      { key: 'otherCriticalDateLabel', label: 'What the other date is (e.g. expansion right, ROFO)' },
      { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
    activities: [
      { key: 'type', label: 'Type', type: 'select', options: L.ACTIVITY_TYPES },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'companyId', label: 'Company (optional for personal tasks)', type: 'ref', ref: 'companies' },
      { key: 'contactId', label: 'Contact', type: 'ref', ref: 'contacts', filterBy: 'companyId' },
      { key: 'dealId', label: 'Deal', type: 'ref', ref: 'deals', filterBy: 'companyId' },
      { key: 'subject', label: 'Subject', required: true, wide: true },
      { key: 'notes', label: 'Notes / outcome', type: 'textarea', wide: true },
      { key: 'outcome', label: 'Outcome', type: 'select', options: L.OUTCOMES },
      { key: 'template', label: 'Template / message used', list: () => distinct('activities', 'template') },
      { key: 'opens', label: 'Email opens', type: 'number' },
      { key: 'followUpDate', label: 'Follow-up date', type: 'date' },
      { key: 'done', label: 'Follow-up complete', type: 'checkbox' },
    ],
    properties: [
      { key: 'building', label: 'Building', required: true },
      { key: 'address', label: 'Address' },
      { key: 'submarket', label: 'Submarket', list: () => distinct('companies', 'submarket').concat(distinct('properties', 'submarket')) },
      { key: 'status', label: 'Status', type: 'select', options: L.PROPERTY_STATUSES },
      { key: 'availableSF', label: 'Available SF (total)', type: 'number' },
      { key: 'officeSF', label: 'Office SF in the space', type: 'number', asset: 'Industrial' },
      { key: 'askingRate', label: 'Asking rent ($/SF)', type: 'number', step: '0.01' },
      { key: 'rateBasis', label: 'Rent basis', type: 'select', options: L.RATE_BASES },
      { key: 'landlord', label: 'Landlord / listing broker' },
      { key: 'tiAllowance', label: 'TI offered ($/SF)', type: 'number', step: '0.01' },
      { key: 'freeRentMonths', label: 'Free rent (months)', type: 'number' },
      { key: 'parkingRatio', label: 'Parking ratio (/1,000 SF)', type: 'number', step: '0.1' },
      { key: 'parkingSpaces', label: 'Parking spaces offered', type: 'number' },
      { key: 'clearHeight', label: 'Clear height (ft)', type: 'number', asset: 'Industrial' },
      { key: 'dockDoors', label: 'Dock doors', type: 'number', asset: 'Industrial' },
      { key: 'tourDate', label: 'Tour date', type: 'date' },
      { key: 'notes', label: 'Notes / pros & cons', type: 'textarea', wide: true },
    ],
  };

  const MARKETING_KINDS = ['One-pager / flyer', 'Market report', 'Email campaign', 'Social post', 'Event', 'Other'];
  const MARKETING_STATUSES = ['Idea', 'Drafting', 'Ready', 'Sent / Posted', 'Retired'];
  FIELDS.marketing = [
    { key: 'title', label: 'Title', required: true, wide: true },
    { key: 'kind', label: 'Type', type: 'select', options: MARKETING_KINDS },
    { key: 'status', label: 'Status', type: 'select', options: MARKETING_STATUSES },
    { key: 'assetClass', label: 'Asset class', type: 'select', options: L.ASSET_CLASSES },
    { key: 'submarket', label: 'Submarket', list: () => distinct('companies', 'submarket').concat(distinct('marketing', 'submarket')) },
    { key: 'partner', label: 'Partner broker(s)', list: () => distinct('marketing', 'partner') },
    { key: 'dataQuarter', label: 'Market data as of (e.g. 3Q26)' },
    { key: 'channel', label: 'Channel', type: 'select', options: ['LinkedIn', 'Email', 'Instagram', 'Print / in person', 'Website'] },
    { key: 'date', label: 'Publish / send date', type: 'date' },
    { key: 'link', label: 'Link to file or post (Drive, SharePoint, LinkedIn)', type: 'url', wide: true },
    { key: 'audience', label: 'Audience (who it is for)', wide: true },
    { section: 'Results' },
    { key: 'sentCount', label: 'Sent to (#)', type: 'number' },
    { key: 'opens', label: 'Opens', type: 'number' },
    { key: 'replies', label: 'Replies / responses', type: 'number' },
    { key: 'meetings', label: 'Meetings booked', type: 'number' },
    { key: 'impressions', label: 'Impressions (social)', type: 'number' },
    { key: 'reactions', label: 'Reactions (social)', type: 'number' },
    { key: 'comments', label: 'Comments (social)', type: 'number' },
    { section: 'Upgrades (one-pagers)' },
  ].concat(L.COLLATERAL_UPGRADES.map((u) => ({ key: u.key, label: u.label, type: 'checkbox' })), [
    { section: 'Notes' },
    { key: 'ideas', label: 'Ideas to improve it', type: 'textarea', wide: true },
    { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ]);

  FIELDS.comps = [
    { key: 'building', label: 'Building', required: true },
    { key: 'address', label: 'Address' },
    { key: 'submarket', label: 'Submarket', list: () => distinct('companies', 'submarket').concat(distinct('comps', 'submarket')) },
    { key: 'assetClass', label: 'Asset class', type: 'select', options: L.ASSET_CLASSES },
    { key: 'city', label: 'City' },
    { key: 'landlord', label: 'Landlord' },
    { key: 'yearBuilt', label: 'Year built', type: 'number' },
    { key: 'clearHeight', label: 'Clear height (ft)', type: 'number', asset: 'Industrial' },
    { key: 'tenant', label: 'Tenant' },
    { key: 'dealType', label: 'Deal type', type: 'select', options: L.DEAL_TYPES },
    { key: 'sf', label: 'RSF', type: 'number' },
    { key: 'signedDate', label: 'Lease signed', type: 'date' },
    { key: 'commencement', label: 'Commencement', type: 'date' },
    { key: 'termMonths', label: 'Term (months)', type: 'number' },
    { key: 'leaseExpiration', label: 'Lease expiration (if known; otherwise estimated from the term)', type: 'date' },
    { key: 'startingRent', label: 'Starting rent ($/SF)', type: 'number', step: '0.01' },
    { key: 'rateBasis', label: 'Rent basis', type: 'select', options: L.RATE_BASES },
    { key: 'escalationPct', label: 'Annual escalation %', type: 'number', step: '0.1' },
    { key: 'freeRentMonths', label: 'Free rent (months)', type: 'number' },
    { key: 'tiAllowance', label: 'TI allowance ($/SF)', type: 'number', step: '0.01' },
    { key: 'opex', label: 'Operating expenses ($/SF/yr)', type: 'number', step: '0.01' },
    // Internal comps are labeled with your firm's name (Import / Settings → Your firm).
    { key: 'source', label: 'Source', type: 'select', get options() { return ['My deal', S.settings().myFirm || 'My firm', 'Outside broker', 'CoStar', 'Research']; } },
    { key: 'confidential', label: 'Confidential (internal use only)', type: 'checkbox' },
    { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ];

  FIELDS.documents = [
    { key: 'name', label: 'Document name', required: true, wide: true },
    { key: 'kind', label: 'Type', type: 'select', options: ['LOI', 'Lease', 'Amendment', 'Proposal', 'Survey', 'Floor plan', 'Abstract', 'Other'] },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'url', label: 'Link (OneDrive, SharePoint, Google Drive or DocuSign)', type: 'url', wide: true, required: true },
    { key: 'companyId', label: 'Company', type: 'ref', ref: 'companies' },
    { key: 'dealId', label: 'Deal', type: 'ref', ref: 'deals', filterBy: 'companyId' },
    { key: 'shareable', label: 'OK to share with the client', type: 'checkbox' },
    { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ];

  FIELDS.criticalDates = [
    { key: 'companyId', label: 'Tenant / company', type: 'ref', ref: 'companies', required: true },
    { key: 'dealId', label: 'Deal (optional)', type: 'ref', ref: 'deals', filterBy: 'companyId' },
    { key: 'kind', label: 'Right / date', type: 'select', options: L.CRITICAL_DATE_KINDS },
    { key: 'label', label: 'Details (e.g. "2nd renewal", "Suite 400", "Floor 12")' },
    { key: 'date', label: 'Notice deadline / date', type: 'date' },
    { key: 'remindDays', label: 'Remind me this many days before (default 90)', type: 'number' },
    { key: 'status', label: 'Status', type: 'select', options: L.CRITICAL_DATE_STATUSES },
    { key: 'source', label: 'Source (lease abstract, CoStar, tenant, landlord…)' },
    { key: 'terms', label: "Terms (e.g. one 5-year renewal at 95% of FMV, 12 months' notice; fee = unamortized TI + 3 months' rent)", type: 'textarea', wide: true },
    { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ];

  FIELDS.templates = [
    { key: 'name', label: 'Template name (shows in Outreach results)', required: true, wide: true },
    { key: 'step', label: 'When to use it', type: 'select', options: L.TEMPLATE_STEPS },
    { key: 'active', label: 'Active (offered when drafting)', type: 'checkbox' },
    { key: 'buildings', label: 'Suggest first for tenants at (buildings or addresses, comma-separated)', wide: true },
    { key: 'subject', label: 'Subject', wide: true },
    { key: 'body', label: 'Body', type: 'textarea', wide: true, rows: 14 },
    { key: 'notes', label: 'Notes (why it works, when to use it)', type: 'textarea', wide: true },
  ];

  const LABELS = { criticalDates: 'Critical date', templates: 'Email template', documents: 'Document', comps: 'Comp', marketing: 'Marketing item', companies: 'Company', contacts: 'Contact', deals: 'Deal', activities: 'Activity', properties: 'Survey Property' };

  // ---------- derived data helpers ----------

  function companyName(id) {
    const c = S.get('companies', id);
    return c ? c.name : '';
  }
  function contactName(c) {
    return c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : '';
  }

  // Latest logged activity per company, or the last-contacted date synced from HubSpot.
  function lastTouchMap() {
    const today = L.todayISO();
    const map = {};
    S.all('companies').forEach((c) => {
      if (c.lastContacted && c.lastContacted <= today) map[c.id] = c.lastContacted;
    });
    S.all('activities').forEach((a) => {
      if (!a.date || a.date > today) return;
      if (!map[a.companyId] || a.date > map[a.companyId]) map[a.companyId] = a.date;
    });
    return map;
  }

  function scoreOf(company, touches) {
    return L.prospectScore(company, { lastActivityDate: touches[company.id] }).score;
  }

  function matchesAsset(recAsset, filter) {
    if (!filter || filter === 'All') return true;
    return recAsset === filter || recAsset === 'Office & Industrial';
  }

  // A short form for tasks: what to do, when, and which company, contact or deal it's for.
  const TASK_FIELDS = [
    { key: 'subject', label: 'Task', required: true, wide: true },
    { key: 'date', label: 'Due date', type: 'date', required: true },
    { key: 'type', label: 'Type', type: 'select', options: L.ACTIVITY_TYPES },
    { key: 'companyId', label: 'Company (optional for personal tasks)', type: 'ref', ref: 'companies' },
    { key: 'contactId', label: 'Contact', type: 'ref', ref: 'contacts', filterBy: 'companyId' },
    { key: 'dealId', label: 'Deal', type: 'ref', ref: 'deals', filterBy: 'companyId' },
    { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
    { key: 'done', label: 'Complete', type: 'checkbox' },
  ];

  function activityDue(a) {
    return a.followUpDate || (a.type === 'Task' ? a.date : '');
  }
  // Your own email domain, from your contact record (the one named like you in Settings).
  function myEmailDomain() {
    if (S.settings().myEmailDomain) return S.settings().myEmailDomain;
    const me = String(S.settings().brokerName || '').trim().toLowerCase();
    const p = me && S.all('contacts').find((c) => contactName(c).toLowerCase() === me && c.email);
    return p ? p.email.split('@')[1] : '';
  }

  // Activities once pointed at a colleague cc'd on the email; only someone at the company counts.
  function repairActivityContacts() {
    S.all('activities').forEach((a) => {
      const p = a.contactId && S.get('contacts', a.contactId);
      if (a.contactId && a.companyId && (!p || p.companyId !== a.companyId || L.isColleague(p, myEmailDomain()))) S.upsert('activities', { id: a.id, contactId: '' }, { silent: true, touch: false });
    });
  }

  // The contact to reach for a company: the given one if they work there, else the best one.
  function reachContact(companyId, contactId) {
    const p = S.get('contacts', contactId);
    const own = myEmailDomain();
    if (p && p.companyId === companyId && !L.isColleague(p, own)) return p;
    const rank = (c) => (c.keyContact ? 10 : 0) + (c.role === 'Decision Maker' ? 4 : 0) + (c.email ? 2 : 0) + (callableNumber(c) ? 2 : 0);
    return S.all('contacts').filter((c) => c.companyId === companyId && !L.isColleague(c, own)).sort((a, b) => rank(b) - rank(a))[0] || null;
  }

  // Call and email buttons for a task, follow-up or lead. `reply` is an email to answer in the same thread.
  function contactButtons(companyId, contactId, opts) {
    opts = opts || {};
    const p = companyId && reachContact(companyId, contactId);
    if (!p) return companyId ? `<a class="btn small" href="#/company/${esc(companyId)}" title="No contact saved for this company yet">Find a contact</a>` : '';
    const attrs = `data-company="${esc(companyId)}" data-contact="${esc(p.id)}"`;
    return (callableNumber(p) ? `<button class="btn small" data-action="call-card" ${attrs}>Call ${esc(p.firstName)}</button>` : '') +
      (p.email ? `<button class="btn small" data-action="draft-email" ${attrs}${opts.step ? ` data-step="${esc(opts.step)}"` : ''}${opts.reply ? ` data-reply="${esc(opts.reply)}"` : ''}>${esc(opts.emailLabel || 'Email ' + p.firstName)}</button>` : '');
  }

  // Envelope next to a company name: opens a recommended follow-up email, ready to copy or open in Outlook.
  function emailIcon(companyId, contactId, opts) {
    opts = opts || {};
    const p = companyId && reachContact(companyId, contactId);
    const to = p && p.email ? p : S.all('contacts').find((x) => x.companyId === companyId && x.email && !L.isColleague(x, myEmailDomain()));
    if (!to) return '';
    return `<button class="mail-icon" data-action="draft-email" data-recommended="1" data-company="${esc(companyId)}" data-contact="${esc(to.id)}"${opts.deal ? ` data-deal="${esc(opts.deal)}"` : ''}${opts.reply ? ` data-reply="${esc(opts.reply)}"` : ''} title="Recommended follow-up email to ${esc(contactName(to))}" aria-label="Draft follow-up email"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/></svg></button>`;
  }

  // Pencil-and-page button in a Notes card: opens a quick note that's added, dated, to the record's notes.
  function noteIcon(col, id) {
    return `<button class="mail-icon" data-action="quick-note" data-col="${col}" data-id="${esc(id)}" title="Add a note" aria-label="Add a note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h3"/></svg></button>`;
  }

  // Notes card for a deal or company: your own notes, then notes added elsewhere (logged or synced from HubSpot).
  function notesCard(col, rec, heading) {
    const added = S.all('activities')
      .filter((a) => a.type === 'Note' && (col === 'deals' ? a.dealId === rec.id || (a.companyId === rec.companyId && !a.dealId) : a.companyId === rec.id))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return `${heading === false ? '' : '<h2>Notes' + notesActions(col, rec.id) + '</h2>'}
      <h3 class="notes-sub">My notes</h3>
      ${rec.notes ? `<p class="pre">${esc(rec.notes)}</p>` : '<p class="muted">None yet. Use the page icon to add one.</p>'}
      <h3 class="notes-sub">Added notes <span class="muted">${added.length || ''}</span></h3>
      ${
        added.length
          ? `<ul class="plain added-notes">${added
              .slice(0, 4)
              .map((a) => `<li><span class="muted">${esc(L.fmtDate(a.date))}${a.source ? ' · ' + esc(a.source) : ''}</span> <a href="#" data-action="edit" data-col="activities" data-id="${esc(a.id)}">${esc(a.subject)}</a>${a.notes && a.notes !== a.subject ? `<div class="sub">${esc(L.emailSnippet({ notes: a.notes }, 220))}</div>` : ''}</li>`)
              .join('')}${added.length > 4 ? `<li class="muted">+ ${added.length - 4} more in Activity</li>` : ''}</ul>`
          : '<p class="muted">None. Notes you log as an activity, or from HubSpot, show here.</p>'
      }`;
  }
  function notesActions(col, id) {
    return `<span class="more icon-row">${summarizeIcon(col, id)}${noteIcon(col, id)}</span>`;
  }
  function summarizeIcon(col, id) {
    return `<button class="mail-icon" data-action="summarize" data-col="${col}" data-id="${esc(id)}" title="Summarize where things stand" aria-label="Summarize"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h10M4 18h7"/><path d="M18 14l1 2.2 2.2 1-2.2 1L18 20.4l-1-2.2-2.2-1 2.2-1z"/></svg></button>`;
  }

  // The company's submarket this quarter, from the Research stats on file, with Research's own talking points.
  function marketSnapshotCard(c) {
    const st = S.settings();
    const m = L.marketStatFor(st.marketStats || [], c, st.marketReports);
    if (!m) return '';
    const v = L.marketValues(m, c);
    const cur = m.current;
    const item = (label, value, sub) => (value ? `<div class="snap"><span class="kpi-label">${esc(label)}</span><strong>${esc(value)}</strong>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>` : '');
    return `<section class="card"><h2>Market snapshot · ${esc(v.StatsArea)} ${esc((cur.assetClass || '').toLowerCase())} · ${esc(cur.quarter)} <a class="more" href="#/research">All market stats</a></h2>
      ${cur.submarket === 'Market total' && c.submarket ? `<p class="hint">"${esc(c.submarket)}" isn't a submarket in the report, so these are market-wide numbers.</p>` : ''}
      <div class="snaps">${item('Vacancy', v.Vacancy, v.VacancyChange || (m.market ? 'Market ' + v.MarketVacancy : ''))}${item(cur.rentType === 'direct' ? 'Avg. direct asking rent' : 'Avg. asking rent', v.AskingRent, v.RentChange)}${item('Net absorption', v.NetAbsorption, cur.ytdAbsorption !== undefined ? v.YTDAbsorption + ' YTD' : '')}${item('Under construction', v.UnderConstruction)}</div>
      ${v.MarketStat ? `<p class="market-line">${esc(v.MarketStat)} <button class="link" data-action="copy-text" data-text="${esc(v.MarketStat)}">Copy</button></p>` : ''}
      ${m.notes.length ? `<details class="research-details"><summary>What Research says about ${esc(v.StatsArea)} (${m.notes.length})</summary><ul class="plain added-notes research-points">${m.notes.map((b) => `<li><span>${esc(b)}</span> <button class="link" data-action="copy-text" data-text="${esc(b)}">Copy</button></li>`).join('')}</ul></details>` : ''}
    </section>`;
  }

  function openBrief(col, id) {
    const deal = col === 'deals' ? S.get('deals', id) : null;
    const company = S.get('companies', deal ? deal.companyId : id);
    if (!company) return;
    const brief = L.dealBrief(
      {
        company,
        deal,
        activities: S.all('activities').filter((a) => a.companyId === company.id),
        properties: deal ? S.all('properties').filter((p) => p.dealId === deal.id) : [],
        contacts: S.all('contacts').filter((p) => p.companyId === company.id),
      },
      { today: L.todayISO() }
    );
    const dlg = $('#modal');
    if (dlg.open) dlg.close();
    dlg.innerHTML = `<form method="dialog" class="brief">
      <header><h2>Where things stand: ${esc(brief.title)}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></header>
      <div class="brief-body">${brief.sections.map((sec) => `<h3 class="notes-sub">${esc(sec.label)}</h3><ul>${sec.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`).join('')}</div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-action="copy-text" data-text="${esc(L.briefText(brief))}">Copy summary</button><button type="button" class="btn primary" data-action="close-modal">Done</button></footer>
    </form>`;
    dlg.showModal();
  }

  function marketLineFor(col, rec) {
    const c = col === 'deals' ? S.get('companies', rec.companyId) : rec;
    if (!c) return '';
    const m = L.marketStatFor(S.settings().marketStats || [], c, S.settings().marketReports);
    return m ? L.marketValues(m, c).MarketStat : '';
  }

  function openQuickNote(col, id) {
    const rec = S.get(col, id);
    if (!rec) return;
    const dlg = $('#modal');
    if (dlg.open) dlg.close();
    dlg.innerHTML = `<form method="dialog" id="quick-note-form" data-col="${col}" data-id="${esc(id)}">
      <header><h2>Add a note to ${esc(rec.name)}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></header>
      <div class="form-grid">
        <label class="wide">Note<textarea name="note" rows="5" required placeholder="What happened, what's next…"></textarea></label>
        <p class="hint wide">Saved at the top of the notes with today's date.${marketLineFor(col, rec) ? ' <button type="button" class="link" data-action="insert-market-line">Insert this quarter\'s market stats</button>' : ''}</p>
        ${rec.notes ? `<details class="wide"><summary>Earlier notes</summary><p class="pre">${esc(rec.notes)}</p></details>` : ''}
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">Add note</button></footer>
    </form>`;
    dlg.showModal();
    dlg.querySelector('textarea').focus();
  }

  // Automatic follow-up tasks after an initial email (see L.planFollowUpTasks). Runs after every sync or logged touch.
  function runWorkflows() {
    const s = S.settings();
    if (Number(s.followUpDays) === 0) return;
    const since = s.workflowSince || L.addDays(L.todayISO(), -7);
    const plan = L.planFollowUpTasks(
      { companies: S.all('companies'), contacts: S.all('contacts'), deals: S.all('deals'), activities: S.all('activities') },
      { days: s.followUpDays, since, created: s.workflowCreated, internalDomain: myEmailDomain() }
    );
    plan.add.forEach((t) => S.upsert('activities', t, { silent: true }));
    plan.complete.forEach((t) => S.upsert('activities', t, { silent: true }));
    if (plan.add.length || plan.complete.length || !s.workflowSince)
      S.saveSettings({ workflowSince: since, workflowCreated: (s.workflowCreated || []).concat(plan.add.map((t) => t.id)).slice(-2000) });
    if (plan.add.length) toast(`Added ${plan.add.length} follow-up task${plan.add.length > 1 ? 's' : ''} for emails with no reply yet.`);
  }

  function openFollowUps() {
    return S.all('activities')
      .filter((a) => !a.done && activityDue(a))
      .sort((a, b) => activityDue(a).localeCompare(activityDue(b)));
  }

  // Should this tenant already be in the market given their size?
  function processStartDate(company) {
    if (!company.leaseExpiration) return '';
    const d = L.parseISODate(company.leaseExpiration);
    d.setMonth(d.getMonth() - L.recommendedLeadTimeMonths(company.sfOccupied));
    return L.toISODate(d);
  }
  // Inside the lead-time window and not engaged. Expirations more than 6 months past are likely stale data, not live needs.
  function shouldBeInMarket(company) {
    const start = processStartDate(company);
    const today = L.todayISO();
    return (
      start &&
      start <= today &&
      company.leaseExpiration >= L.addDays(today, -183) &&
      ['Target', 'Contacted', 'Nurture'].includes(company.status)
    );
  }

  function rateUnit(basis) {
    return /\/mo/.test(basis || '') ? '/SF/mo' : '/SF/yr';
  }

  // ---------- small render helpers ----------

  function badge(text, cls) {
    return text ? `<span class="badge ${cls || ''}">${esc(text)}</span>` : '';
  }

  function assetBadge(a) {
    const cls = a === 'Office' ? 'office' : a === 'Industrial' ? 'industrial' : a ? 'mixed' : '';
    const short = a === 'Office & Industrial' ? 'Off + Ind' : a;
    return badge(short, 'asset ' + cls);
  }

  function statusBadge(s) {
    return badge(s, 'status-' + String(s || '').toLowerCase().replace(/[^a-z]+/g, '-'));
  }

  function expirationBadge(iso) {
    if (!iso) return '<span class="muted">—</span>';
    const m = L.monthsUntil(iso);
    const cls = m < 0 ? 'red' : m <= 12 ? 'red' : m <= 24 ? 'amber' : m <= 36 ? 'green' : 'gray';
    return `<span class="nowrap">${esc(L.fmtDate(iso))}</span> ${badge(L.fmtMonths(m), cls)}`;
  }

  function scoreChip(score) {
    const cls = score >= 75 ? 'hot' : score >= 55 ? 'warm' : 'cool';
    return `<span class="score ${cls}" title="Prospect score">${score}</span>`;
  }

  // Do-Not-Call numbers are shown for reference but never as click-to-call links.
  function phoneLink(num, dnc, suffix) {
    if (!num) return '';
    const label = esc(num) + (suffix ? ' ' + suffix : '');
    return dnc ? `<span class="dnc" title="Registered Do-Not-Call: don't cold call">${label} ${badge('DNC', 'red')}</span>` : `<a href="tel:${esc(num)}">${label}</a>`;
  }

  function verificationBadge(v) {
    if (!v) return '';
    return badge(v, v === 'Web-verified' ? 'green' : v === 'ZoomInfo only' ? 'amber' : 'gray');
  }

  function leadBadge(c) {
    if (L.doNotContact(c)) return badge('Do not contact' + (c.doNotContactReason ? ': ' + c.doNotContactReason : ''), 'red');
    const st = L.leadStage(c);
    if (!st) return '';
    const cls = { 'Secured Lead': 'green', Engaged: 'blue', 'Follow Up': 'amber', 'Initial Outreach': 'amber', 'Dead Lead': 'red' }[st] || 'gray';
    return badge('Lead: ' + st, cls) + (c.leadTemp ? ' ' + badge(c.leadTemp, { Hot: 'red', Warm: 'amber', Cold: 'blue' }[c.leadTemp]) : '');
  }

  function linkCompany(id) {
    const c = S.get('companies', id);
    return c ? `<a href="#/company/${esc(id)}">${esc(c.name)}</a>` : '<span class="muted">—</span>';
  }

  function emptyState(msg, actions) {
    return `<div class="empty"><p>${msg}</p>${actions || ''}</div>`;
  }

  function options(list, selected, blank) {
    const opts = blank !== undefined ? [`<option value="">${esc(blank)}</option>`] : [];
    return opts
      .concat(
        list.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const label = typeof o === 'object' ? o.label : o;
          return `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`;
        })
      )
      .join('');
  }

  // Table header that sorts its list: click once to sort, again to flip the direction.
  function sortHead(scope, key, label, cls) {
    const f = state[scope];
    const on = f.sort === key;
    const dir = on ? f.dir || (SORT_COLUMNS[scope][key].desc ? 'desc' : 'asc') : '';
    return `<th class="sortable${on ? ' on' : ''}${cls ? ' ' + cls : ''}" data-action="sort-by" data-scope="${scope}" data-key="${key}" aria-sort="${dir ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}" title="Sort by ${esc(label.toLowerCase())}">${esc(label)}<span class="sort-arrow">${dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}</span></th>`;
  }

  // Edit in place in list tables. Choices are quiet dropdowns; dates, numbers and text show as text and turn into an
  // input when clicked, saving on Enter or when you click away (Esc cancels).
  function inlineSelect(col, id, field, list, value, blank) {
    return `<select class="inline quiet" data-inline-col="${col}" data-inline-id="${esc(id)}" data-inline-field="${field}" aria-label="${esc(field)}">${options(list, value, blank)}</select>`;
  }
  function editCell(col, id, field, type, value, display) {
    return `<span class="cell-edit" tabindex="0" role="button" title="Click to edit" data-edit-col="${col}" data-edit-id="${esc(id)}" data-edit-field="${field}" data-edit-type="${type}" data-edit-value="${esc(value === undefined || value === null ? '' : value)}">${display || '<span class="muted">—</span>'}</span>`;
  }
  function saveInline(col, id, field, raw) {
    const rec = S.get(col, id);
    if (!rec) return;
    let value = raw;
    if (['sfOccupied', 'sf', 'headcount', 'budgetRate'].includes(field)) value = L.parseNumber(raw) === null ? '' : L.parseNumber(raw);
    if (String(rec[field] === undefined || rec[field] === null ? '' : rec[field]) === String(value)) return render();
    if (col === 'deals' && field === 'stage') {
      const patch = { id, stage: value };
      if (value === 'Closed Won' && !rec.closedDate) patch.closedDate = L.todayISO();
      if (value === 'Closed Won' && rec.stage !== 'Closed Won') celebrate();
      S.upsert('deals', patch);
    } else S.upsert(col, { id, [field]: value });
    toast('Saved.');
  }

  function assetTabs(current, scope) {
    return `<div class="seg" role="tablist">${['All', 'Office', 'Industrial']
      .map((a) => `<button class="${current === a ? 'on' : ''}" data-action="set-filter" data-scope="${scope}" data-key="asset" data-value="${a}">${a}</button>`)
      .join('')}</div>`;
  }

  // ---------- views ----------

  function viewDashboard() {
    const companies = S.all('companies');
    const deals = S.all('deals');
    const touches = lastTouchMap();
    const today = L.todayISO();
    const s = S.settings();

    if (!companies.length) {
      return `<h1>Welcome${s.brokerName ? ', ' + esc(s.brokerName.split(' ')[0]) : ''}</h1>
        <div class="card onboarding">
          <h2>Get started</h2>
          <ol>
            <li><a href="#/data">Import a CSV</a> of tenants from CoStar, Reonomy, ZoomInfo or your own spreadsheet. Lease expirations, SF and submarket map automatically.</li>
            <li>Or <button class="link" data-action="new" data-col="companies">add a company</button> by hand.</li>
            <li>Want to look around first? <button class="link" data-action="sample-data">Load demo data</button> (fictional companies, easy to clear later).</li>
          </ol>
        </div>`;
    }

    const prospects = companies.filter((c) => PROSPECT_STATUSES.includes(c.status));
    const expiring24 = companies.filter((c) => {
      const m = L.monthsUntil(c.leaseExpiration);
      return m !== null && m >= 0 && m <= 24 && c.status !== 'Not a Fit';
    });
    const open = deals.filter((d) => L.OPEN_STAGES.includes(d.stage));
    const openComm = open.reduce((t, d) => t + L.estimatedCommission(d).myShare, 0);
    const weighted = open.reduce((t, d) => t + L.weightedCommission(d), 0);
    const year = today.slice(0, 4);
    const wonYTD = deals
      .filter((d) => d.stage === 'Closed Won' && !d.partnerDeal && (d.closedDate || d.targetClose || '').slice(0, 4) === year)
      .reduce((t, d) => t + L.dealResults(d).commission, 0);
    const followUps = openFollowUps();
    const overdue = followUps.filter((a) => activityDue(a) < today);
    const dueSoon = followUps.filter((a) => activityDue(a) <= L.addDays(today, 7));

    const topProspects = companies
      .filter((c) => !['Active Client', 'Not a Fit'].includes(c.status))
      .map((c) => ({ c, score: scoreOf(c, touches) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const stale = prospects
      .filter((c) => {
        const last = touches[c.id];
        return !last || L.daysBetween(last, today) > s.staleDays;
      })
      .slice(0, 8);

    const inMarket = companies.filter(shouldBeInMarket);

    const summary = L.pipelineSummary(open);
    const maxComm = Math.max(1, ...summary.map((x) => x.commission));

    return `
      <div class="page-head"><h1>Dashboard</h1>
        <div class="actions">
          <button class="btn" data-action="new" data-col="activities">Log activity</button>
          <button class="btn primary" data-action="new" data-col="companies">+ Company</button>
        </div>
      </div>
      <div class="kpis">
        <a class="kpi" href="#/companies"><span class="kpi-label">Active prospects</span><span class="kpi-value">${prospects.length}</span><span class="kpi-sub">${companies.length} companies total</span></a>
        <a class="kpi" href="#/expirations"><span class="kpi-label">Leases expiring ≤ 24 mo</span><span class="kpi-value">${expiring24.length}</span><span class="kpi-sub">${L.fmtNumber(expiring24.reduce((t, c) => t + (L.parseNumber(c.sfOccupied) || 0), 0))} SF</span></a>
        <a class="kpi" href="#/pipeline"><span class="kpi-label">Open pipeline (my share)</span><span class="kpi-value">${L.fmtMoney(openComm, true)}</span><span class="kpi-sub">${L.fmtMoney(weighted, true)} weighted · ${open.length} deals</span></a>
        <a class="kpi" href="#/portfolio"><span class="kpi-label">Closed ${year}</span><span class="kpi-value">${L.fmtMoney(wonYTD, true)}</span><span class="kpi-sub">commission earned</span></a>
        <a class="kpi ${overdue.length ? 'alert' : ''}" href="#/activities"><span class="kpi-label">Follow-ups overdue</span><span class="kpi-value">${overdue.length}</span><span class="kpi-sub">${dueSoon.length} due within 7 days</span></a>
      </div>

      <div class="grid2">
        <section class="card">
          <h2>Follow-ups due <a class="more" href="#/activities">All →</a></h2>
          ${dueSoon.length ? followUpList(dueSoon.slice(0, 10)) : emptyState('Nothing due this week.')}
        </section>
        <section class="card">
          <h2>Who to call next <a class="more" href="#/companies">Prospect list →</a></h2>
          ${
            topProspects.length
              ? `<table class="tbl compact"><tbody>${topProspects
                  .map(
                    ({ c, score }) => `<tr data-href="#/company/${esc(c.id)}">
                      <td>${scoreChip(score)}</td>
                      <td><strong>${esc(c.name)}</strong><div class="sub">${esc([c.submarket, c.sfOccupied ? L.fmtNumber(c.sfOccupied) + ' SF' : ''].filter(Boolean).join(' · '))}</div></td>
                      <td>${assetBadge(c.assetClass)}</td>
                      <td class="right">${expirationBadge(c.leaseExpiration)}</td></tr>`
                  )
                  .join('')}</tbody></table>`
              : emptyState('No prospects yet.')
          }
        </section>
      </div>

      <div class="grid2">
        <section class="card">
          <h2>Pipeline by stage <a class="more" href="#/pipeline">Board →</a></h2>
          ${
            open.length
              ? `<div class="bars">${summary
                  .filter((x) => L.OPEN_STAGES.includes(x.stage))
                  .map(
                    (x) => `<div class="bar-row">
                      <span class="bar-label">${esc(x.stage)} <span class="muted">(${x.count})</span></span>
                      <span class="bar-track"><span class="bar" style="width:${(x.commission / maxComm) * 100}%"></span><span class="bar weighted" style="width:${(x.weighted / maxComm) * 100}%"></span></span>
                      <span class="bar-val">${L.fmtMoney(x.commission, true)}</span></div>`
                  )
                  .join('')}</div>
                <p class="legend"><span class="sw"></span> Est. commission <span class="sw weighted"></span> Weighted by probability</p>`
              : emptyState('No open deals.', '<button class="btn" data-action="new" data-col="deals">+ Deal</button>')
          }
        </section>
        <section class="card">
          <h2>Should be in the market now</h2>
          <p class="hint">Not yet engaged, and inside the typical lead time for their size (12–36 months before expiration).</p>
          ${
            inMarket.length
              ? companyMiniTable(inMarket.sort((a, b) => a.leaseExpiration.localeCompare(b.leaseExpiration)).slice(0, 8))
              : emptyState('No un-engaged tenants inside their lead-time window.')
          }
        </section>
      </div>

      <section class="card">
        <h2>Going stale</h2>
        <p class="hint">Prospects with no logged touch in ${esc(s.staleDays)}+ days.</p>
        ${stale.length ? companyMiniTable(stale, touches) : emptyState('Every prospect has been touched recently.')}
      </section>

      <div id="prospecting" class="page-section"><h2 class="section-title">Prospecting report</h2>${prospectingTab()}</div>`;
  }

  function companyMiniTable(list, touches) {
    return `<table class="tbl compact"><tbody>${list
      .map(
        (c) => `<tr data-href="#/company/${esc(c.id)}">
          <td><strong>${esc(c.name)}</strong><div class="sub">${esc([c.submarket, c.sfOccupied ? L.fmtNumber(c.sfOccupied) + ' SF' : ''].filter(Boolean).join(' · '))}</div></td>
          <td>${assetBadge(c.assetClass)}</td>
          <td class="right">${touches ? (touches[c.id] ? 'Last touch ' + esc(L.fmtDate(touches[c.id])) : '<span class="muted">Never touched</span>') : expirationBadge(c.leaseExpiration)}</td></tr>`
      )
      .join('')}</tbody></table>`;
  }

  function researchMailLink(quarter) {
    const s = S.settings();
    const to = String(s.researchTeam || '').split(/[;,\s]+/).filter((x) => x.includes('@'));
    if (!to.length) return '<a class="btn small" href="#/data" title="Add the research team in Import / Settings">Add research emails</a>';
    const first = String(s.brokerName || '').split(' ')[0];
    const mail = L.researchRequestEmail(quarter, S.all('marketing'), { to, signature: first });
    return `<a class="btn small" href="mailto:${to.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}">Draft email</a>`;
  }

  function tasksCard(list, attrs) {
    if (!list.length) return '';
    return `<section class="card"><h2>Open tasks <span class="muted">${list.length}</span> <button class="link more" data-action="new" data-col="activities" data-task="1" ${attrs}>+ Task</button></h2>${followUpList(list)}</section>`;
  }

  function followUpList(list) {
    const today = L.todayISO();
    return `<ul class="followups">${list
      .map((a) => {
        const due = activityDue(a);
        const cls = due < today ? 'red' : due === today ? 'amber' : 'gray';
        const contact = S.get('contacts', a.contactId);
        return `<li>
          <input type="checkbox" data-action="toggle-done" data-id="${esc(a.id)}" title="Mark complete" />
          <div class="fu-body">
            <div><strong>${esc(a.subject)}</strong> ${badge(a.type, 'gray')}</div>
            <div class="sub">${linkCompany(a.companyId)}${contact ? ' · ' + esc(contactName(contact)) : ''}</div>
          </div>
          ${badge(due < today ? 'Overdue · ' + L.fmtDate(due) : due === today ? 'Today' : L.fmtDate(due), cls)}
          ${/^q-research-/.test(a.id) ? researchMailLink(a.id.replace('q-research-', '')) : ''}
          ${
            a.workflow === 'follow-up'
              ? contactButtons(a.companyId, a.contactId, { step: 'Follow-up', reply: a.workflowEmailId, emailLabel: 'Draft follow-up' })
              : a.companyId && !/^q-research-/.test(a.id)
                ? contactButtons(a.companyId, a.contactId, {})
                : ''
          }
          <button class="icon-btn" data-action="edit" data-col="activities" data-id="${esc(a.id)}" title="Edit">✎</button>
        </li>`;
      })
      .join('')}</ul>`;
  }

  // ----- today -----

  const TOUCH_TYPES = ['Call', 'Email', 'Meeting', 'Tour', 'LinkedIn', 'Pitch', 'Proposal'];

  function callableNumber(p) {
    if (!p) return '';
    if (p.phone && !p.phoneDNC) return p.phone;
    return p.mobile && !p.mobileDNC ? p.mobile : '';
  }

  // The "reach out" link for a lead: tap-to-call (never a Do-Not-Call number), email, LinkedIn, or go find a contact.
  function reachLink(item) {
    const p = S.get('contacts', item.contactId);
    switch (item.channel) {
      case 'Call':
      case 'Email':
        return contactButtons(item.companyId, p.id, item.kind === 'opened' ? { reply: item.activityId, step: 'Follow-up', emailLabel: 'Reply to ' + p.firstName } : { emailLabel: 'Draft email to ' + p.firstName });
      case 'LinkedIn':
        return `<a class="btn small" href="${esc(p.linkedin)}" target="_blank" rel="noopener">LinkedIn ${esc(p.firstName)}</a>`;
      default:
        return `<a class="btn small" href="#/company/${esc(item.companyId)}">Find a contact</a>`;
    }
  }

  function touchButtons(companyId, contactId) {
    const attrs = `data-company="${esc(companyId)}" data-contact="${esc(contactId || '')}"`;
    return `<button class="btn small" data-action="log-touch" data-type="Call" ${attrs} title="Log a call today">✓ Called</button>
      <button class="btn small" data-action="log-touch" data-type="Email" ${attrs} title="Log an email today">✓ Emailed</button>
      <button class="btn small ghost" data-action="snooze" data-company="${esc(companyId)}" title="Hide from Today for a week">Snooze</button>`;
  }

  function initialsOf(name) {
    return String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase())
      .slice(0, 2)
      .join('');
  }
  const myInitials = () => S.settings().myInitials || initialsOf(S.settings().brokerName);

  function greeting() {
    const h = new Date().getHours();
    const first = String(S.settings().brokerName || '').trim().split(/\s+/)[0];
    return (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + (first ? ', ' + first : '');
  }

  function dayLine(followUps, outreach) {
    const parts = [];
    if (followUps) parts.push(followUps + (followUps === 1 ? ' follow-up due' : ' follow-ups due'));
    if (outreach) parts.push(outreach + ' people to reach out to');
    return parts.length ? parts.join(' and ') : 'a clear day';
  }

  // A brief burst in the palette's colors when a deal closes. Skipped for people who prefer reduced motion.
  function celebrate() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'confetti';
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const colors = ['#c6b39a', '#8d3a3c', '#e7e5db', '#7b694e', '#3b1319'];
    const bits = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 160,
      y: innerHeight / 3,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 11 - 3,
      r: Math.random() * Math.PI,
      w: 5 + Math.random() * 5,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const start = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      bits.forEach((b) => {
        b.x += b.vx;
        b.y += b.vy;
        b.vy += 0.35;
        b.r += 0.1;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.w / 4, b.w, b.w / 2);
        ctx.restore();
      });
      if (t - start < 1800) requestAnimationFrame(frame);
      else canvas.remove();
    })(start);
  }

  function viewToday() {
    const s = S.settings();
    if (!S.all('companies').length) return viewDashboard();
    const today = L.todayISO();
    const plan = L.dailyPlan(
      { companies: S.all('companies'), contacts: S.all('contacts'), deals: S.all('deals'), activities: S.all('activities'), criticalDates: S.all('criticalDates') },
      { today, outreachGoal: s.outreachGoal, initials: myInitials(), internalDomain: myEmailDomain(), submarket: state.today.sub, marketStats: s.marketStats || [], marketReports: s.marketReports || [] }
    );
    const touchedToday = S.all('activities').filter((a) => a.date === today && TOUCH_TYPES.includes(a.type)).length;
    const goal = Number(s.outreachGoal) || 10;
    const dateLabel = L.parseISODate(today).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const tasks = plan.tasks.map((t) => S.get('activities', t.activityId));

    const outreach = plan.outreach.map((item) => {
      const c = S.get('companies', item.companyId);
      const p = S.get('contacts', item.contactId);
      return `<li>
        <div class="fu-body">
          <div><a href="#/company/${esc(c.id)}"><strong>${esc(c.name)}</strong></a> ${emailIcon(c.id, item.contactId)} ${leadBadge(c)}</div>
          <div class="sub">${esc(item.why)}${p ? ' · ' + esc(contactName(p)) + (p.title ? ', ' + esc(p.title) : '') : ''}</div>
        </div>
        <div class="todo-actions">${reachLink(item)} ${touchButtons(c.id, item.contactId)}</div>
      </li>`;
    });

    const statsItems = plan.statsShare.map((item) => {
      const c = S.get('companies', item.companyId);
      const p = S.get('contacts', item.contactId);
      return `<li>
        <div class="fu-body">
          <div><a href="#/company/${esc(c.id)}"><strong>${esc(c.name)}</strong></a> ${leadBadge(c)}</div>
          <div class="sub">${esc(item.why)}${p ? ' · ' + esc(contactName(p)) : ''}</div>
        </div>
        <div class="todo-actions">${p && p.email ? `<button class="btn small" data-action="draft-email" data-stats="1" data-company="${esc(c.id)}" data-contact="${esc(p.id)}">Draft ${esc(item.quarter)} update to ${esc(p.firstName)}</button>` : `<a class="btn small" href="#/company/${esc(c.id)}">Find a contact</a>`} ${touchButtons(c.id, item.contactId)}</div>
      </li>`;
    });
    const subPicker = plan.submarkets.length
      ? `<select class="more" data-filter="today.sub" aria-label="Submarket">${options(plan.submarkets.map((x) => ({ value: x.name, label: x.name + ' (' + x.n + ')' })), state.today.sub, 'All submarkets')}</select>`
      : '';

    const openedItems = plan.opened.slice(0, 8).map((item) => {
      const c = S.get('companies', item.companyId);
      const p = S.get('contacts', item.contactId);
      return `<li>
        <div class="fu-body">
          <div><a href="#/company/${esc(c.id)}"><strong>${esc(c.name)}</strong></a> ${emailIcon(c.id, item.contactId, { reply: item.activityId })} ${leadBadge(c)}</div>
          <div class="sub">${esc(item.why)}${p ? ' · ' + esc(contactName(p)) : ''}</div>
        </div>
        <div class="todo-actions">${reachLink(item)}
          ${item.linkedin ? `<a class="btn small" href="${esc(item.linkedin)}" target="_blank" rel="noopener">Connect on LinkedIn</a><button class="btn small ghost" data-action="li-connected" data-contact="${esc(p.id)}">Connected ✓</button>` : ''}
          ${touchButtons(c.id, item.contactId)}</div>
      </li>`;
    });
    const careItems = plan.care.map((p) => {
      const c = S.get('companies', p.companyId);
      const d = S.get('deals', p.dealId);
      return `<li><div class="fu-body"><div><a href="#/company/${esc(p.companyId)}"><strong>${esc(c ? c.name : '')}</strong></a> ${badge(p.kind.replace('-', ' '), KIND_BADGE[p.kind])}</div>
        <div class="sub">${esc(p.label)} · due ${esc(L.fmtDate(p.date))}${d ? ' · ' + esc(d.name) : ''}${p.terms ? ' · ' + esc(p.terms) : ''}</div></div>
        <div class="todo-actions">${p.criticalDateId ? `<button class="btn small" data-action="edit" data-col="criticalDates" data-id="${esc(p.criticalDateId)}">Update status</button>` : ''}${touchButtons(p.companyId, '')}</div></li>`;
    });
    const posts = S.all('marketing').filter((m) => m.kind === 'Social post');
    const postGoal = Number(s.postsPerWeek) || 0;
    const postedThisWeek = posts.filter((m) => m.status === 'Sent / Posted' && m.date && m.date >= weekStart(today) && m.date <= today).length;
    const nextPost = posts.filter((m) => !['Sent / Posted', 'Retired'].includes(m.status)).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))[0];
    const staleCollateral = S.all('marketing').filter((m) => m.kind !== 'Social post' && L.collateralStale(m, today));
    const marketingItems = [];
    if (postGoal && postedThisWeek < postGoal)
      marketingItems.push(`<li><div class="fu-body"><div><strong>Post on LinkedIn</strong> ${badge(postedThisWeek + ' / ' + postGoal + ' this week', 'amber')}</div><div class="sub">${nextPost ? 'Next up: ' + esc(nextPost.title) : 'No post ideas queued yet.'}</div></div><div class="todo-actions">${nextPost ? `<button class="btn small" data-action="edit" data-col="marketing" data-id="${esc(nextPost.id)}">Open post</button>` : '<a class="btn small" href="#/marketing">Plan a post</a>'}</div></li>`);
    if (staleCollateral.length)
      marketingItems.push(`<li><div class="fu-body"><div><strong>Refresh ${staleCollateral.length} piece${staleCollateral.length > 1 ? 's' : ''} of collateral with ${esc(L.latestDataQuarter(today))} data</strong></div><div class="sub">${esc(staleCollateral.slice(0, 3).map((m) => m.title).join(' · '))}</div></div><div class="todo-actions"><a class="btn small" href="#/marketing">Open Marketing</a></div></li>`);

    const dealItems = plan.deals.slice(0, 6).map(
      (item) => `<li>
        <div class="fu-body">
          <div><a href="#/deal/${esc(item.dealId)}"><strong>${esc(item.title)}</strong></a> ${emailIcon(item.companyId, '', { deal: item.dealId })} ${badge(item.stage, 'blue')}</div>
          <div class="sub">${esc(item.why)}</div>
        </div>
        <div class="todo-actions"><button class="btn small" data-action="new" data-col="activities" data-company="${esc(item.companyId)}" data-deal="${esc(item.dealId)}">Log update</button>
        <button class="btn small ghost" data-action="edit" data-col="deals" data-id="${esc(item.dealId)}">Edit deal</button></div>
      </li>`
    );

    // Fridays only: a weekly status email to the client on every open deal, until it's sent or skipped.
    const recapItems =
      L.parseISODate(today).getDay() !== 5
        ? []
        : S.all('deals')
            .filter((d) => L.recapDue(d, S.all('activities'), today) && (s.recapSkipped || {})[d.id] !== today)
            .sort((a, b) => L.dealProbability(b) - L.dealProbability(a))
            .map((d) => {
              const p = reachContact(d.companyId, '');
              const attrs = `data-deal="${esc(d.id)}" data-company="${esc(d.companyId)}" data-contact="${esc(p ? p.id : '')}"`;
              return `<li><div class="fu-body"><div><a href="#/deal/${esc(d.id)}"><strong>${esc(d.name)}</strong></a> ${badge(d.stage, 'blue')}</div>
                <div class="sub">${esc(companyName(d.companyId))}${p ? ' · ' + esc(contactName(p)) : ''}${d.partnerBrokers ? ' · cc ' + esc(d.partnerBrokers) : ''}</div></div>
                <div class="todo-actions">${p && p.email ? `<button class="btn small" data-action="draft-email" data-recap="1" ${attrs}>Draft recap to ${esc(p.firstName)}</button>` : `<a class="btn small" href="#/company/${esc(d.companyId)}">Find a contact</a>`}
                <button class="btn small" data-action="recap-sent" ${attrs} title="Log the recap as sent">✓ Sent</button>
                <button class="btn small ghost" data-action="recap-skip" data-deal="${esc(d.id)}" title="No recap for this deal this week">Skip</button></div></li>`;
            });

    const updateItems = plan.updates.map((item) => {
      const action =
        item.action === 'create-deal'
          ? `<button class="btn small" data-action="new" data-col="deals" data-company="${esc(item.companyId)}">Start deal</button>`
          : item.dealId
            ? `<button class="btn small" data-action="edit" data-col="deals" data-id="${esc(item.dealId)}">Update deal</button>`
            : `<button class="btn small" data-action="edit" data-col="companies" data-id="${esc(item.companyId)}">Update company</button>`;
      return `<li><div class="fu-body"><div><a href="${item.dealId ? '#/deal/' + esc(item.dealId) : '#/company/' + esc(item.companyId)}"><strong>${esc(item.title)}</strong></a></div><div class="sub">${esc(item.why)}</div></div><div class="todo-actions">${action}</div></li>`;
    });

    const knock = plan.doorKnock.map((g) => {
      const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(g.address);
      return `<div class="knock">
        <div><strong>${esc(g.building || g.address)}</strong> <span class="muted">${esc(g.building ? g.address : '')}</span> · ${g.companyIds.length} leads · <a href="${esc(maps)}" target="_blank" rel="noopener">Map ↗</a></div>
        <ul class="plain">${g.companyIds
          .slice(0, 8)
          .map((id) => {
            const c = S.get('companies', id);
            return `<li><a href="#/company/${esc(id)}">${esc(c.name)}</a>${c.floor ? ' <span class="muted">· ' + esc(c.floor) + '</span>' : ''} ${c.leaseExpiration ? '<span class="muted">· exp. ' + esc(L.fmtDate(c.leaseExpiration)) + '</span>' : ''}</li>`;
          })
          .join('')}${g.companyIds.length > 8 ? `<li class="muted">+ ${g.companyIds.length - 8} more in this building (soonest expirations shown)</li>` : ''}</ul>
      </div>`;
    });

    const section = (title, items, empty, extra) =>
      `<section class="card"><h2>${title}</h2>${extra || ''}${items.length ? `<ul class="followups todo">${items.join('')}</ul>` : emptyState(empty)}</section>`;

    return `
      <div class="page-head"><div><h1>${esc(greeting())}</h1><div class="greeting-sub">${esc(dateLabel)} · ${esc(dayLine(tasks.length, plan.outreach.length))}</div></div>
        <div class="actions"><button class="btn" data-action="new" data-col="activities">Log activity</button></div>
      </div>
      <div class="kpis">
        <div class="kpi ${touchedToday >= goal ? 'good' : ''}"><span class="kpi-label">Touches logged today</span><span class="kpi-value">${touchedToday} / ${goal}</span><span class="kpi-sub">${touchedToday >= goal ? '<span class="kpi-goal">Goal met. Nice work.</span>' : 'calls, emails, meetings'}</span></div>
        <a class="kpi ${tasks.length ? 'alert' : ''}" href="#/activities"><span class="kpi-label">Follow-ups due</span><span class="kpi-value">${tasks.length}</span><span class="kpi-sub">today or overdue</span></a>
        <a class="kpi" href="#/leads"><span class="kpi-label">Leads waiting on a follow-up</span><span class="kpi-value">${plan.remaining.followUps}</span><span class="kpi-sub">${plan.remaining.fresh} new leads not yet touched</span></a>
        <a class="kpi" href="#/pipeline"><span class="kpi-label">Deals needing attention</span><span class="kpi-value">${plan.deals.length}</span><span class="kpi-sub">stale, past due or expiring rep agreement</span></a>
      </div>
      ${L.parseISODate(today).getDay() === 1 ? mondayProspectingCard(today) : ''}
      ${recapItems.length ? section('Friday recaps: send each client a weekly update', recapItems, '', '<p class="hint">A short status email on every active deal: what got done this week (even if it was quiet) and what\'s next. It drafts from the deal\'s tours, proposals, meetings and open tasks.</p>') : ''}
      ${tasks.length ? `<section class="card"><h2>Follow-ups you promised</h2>${followUpList(tasks)}</section>` : ''}
      ${section(
        'Reach out today' + (state.today.sub ? ' · ' + esc(state.today.sub) : '') + subPicker,
        outreach,
        state.today.sub ? 'No one in ' + esc(state.today.sub) + ' to reach out to today.' : 'No one to reach out to today. Add leads or check back tomorrow.',
        `<p class="hint">Tenants whose leases expire within two years come first, then follow-ups (hot first) and the best brand-new leads.${state.today.sub ? ' Showing ' + esc(state.today.sub) + ' only; pick All submarkets to go back.' : ' Pick a submarket to prospect one area at a time.'} Tap ✓ when done; it logs the touch and drops off the list.</p>`
      )}
      ${openedItems.length ? section('Opened your email: follow up while it\'s warm', openedItems, '', '<p class="hint">They opened it but haven\'t replied. Call or send a short follow-up, and connect on LinkedIn if you aren\'t already.</p>') : ''}
      ${statsItems.length ? section('Share the latest market stats', statsItems, '', `<p class="hint">Prospects you've reached before who haven't had this quarter's numbers for their submarket. Each draft quotes the latest stats from the Research page${state.today.sub ? ' (' + esc(state.today.sub) + ' only)' : ''}. Leases expiring soonest come first.</p>`) : ''}
      ${careItems.length ? section('Client care & critical dates', careItems, '', '<p class="hint">Clients you closed: see how the space is working, and stay ahead of their lease deadlines.</p>') : ''}
      ${dealItems.length ? section('Deals to move forward', dealItems, '', plan.deals.length > dealItems.length ? `<p class="hint">Top ${dealItems.length} of ${plan.deals.length} by probability. Log an update on each and the next ones appear.</p>` : '') : ''}
      ${marketingItems.length ? section('Marketing', marketingItems, '') : ''}
      ${updateItems.length ? section('Records to update', updateItems, '', plan.remaining.updates > updateItems.length ? `<p class="hint">Showing ${updateItems.length} of ${plan.remaining.updates}.</p>` : '') : ''}
      ${
        knock.length
          ? `<section class="card"><h2>Rather get out of the office? Door-knock here</h2><p class="hint">Buildings where several of your un-engaged leads sit. One trip covers them all.</p>${knock.join('')}</section>`
          : ''
      }`;
  }

  // ----- marketing -----

  const pct = (x) => (x ? Math.round(x * 100) + '%' : '0%');

  function weekStart(iso) {
    const d = L.parseISODate(iso);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return L.toISODate(d);
  }

  function statsTable(rows, label) {
    if (!rows.length) return emptyState('Nothing logged yet.');
    const meetings = rows.some((r) => r.meetings !== undefined);
    return `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>${esc(label)}</th><th class="right">Sent</th><th class="right">Opened</th><th class="right">Responded</th>${meetings ? '<th class="right">Meetings</th>' : ''}</tr></thead><tbody>${rows
      .map(
        (r) => `<tr><td>${esc(r.key)}</td><td class="right">${r.sent}</td><td class="right">${r.opened ? pct(r.openRate) : '<span class="muted">—</span>'}</td>
        <td class="right"><strong>${pct(r.responseRate)}</strong> <span class="muted">(${r.responded})</span></td>${meetings ? `<td class="right">${r.meetings}</td>` : ''}</tr>`
      )
      .join('')}</tbody></table></div>`;
  }

  // Mondays on Today: last week's prospecting in one line, with who to follow up with first.
  function mondayProspectingCard(today) {
    const r = L.prospectingReport({ companies: S.all('companies'), contacts: S.all('contacts'), deals: S.all('deals'), activities: S.all('activities') }, { today, period: 'lastWeek', internalDomain: myEmailDomain() });
    const t = r.totals;
    if (!t.initial && !t.followUp && !r.followUps.length) return '';
    return `<section class="card"><h2>Last week's prospecting <button class="link more" data-action="open-report">Full report</button></h2>
      <p>${t.initial} initial outreach and ${t.followUp} follow-ups to ${t.companies} companies · ${t.opened} opened (${pct(t.openRate)}) · <strong>${t.responses} responded</strong> · ${t.meetings} meetings</p>
      ${r.followUps.length ? `<p class="hint">Follow up first: ${r.followUps.slice(0, 5).map((x) => `<a href="#/company/${esc(x.companyId)}">${esc(x.company)}</a>`).join(', ')}</p>` : ''}</section>`;
  }

  // Prospecting report: only touches to prospects (no client or deal email), for a week, a month or 90 days.
  function prospectingTab() {
    const f = state.prospecting;
    const data = { companies: S.all('companies'), contacts: S.all('contacts'), deals: S.all('deals'), activities: S.all('activities') };
    const r = L.prospectingReport(data, { today: L.todayISO(), period: f.period || 'thisWeek', internalDomain: myEmailDomain() });
    const t = r.totals;
    // Each tile opens the list behind its number; clicking it again closes the list.
    const drill = f.drill || '';
    const tile = (key, label, value, sub) =>
      `<button class="kpi kpi-drill${drill === key ? ' on' : ''}" data-action="drill" data-key="${key}" aria-pressed="${drill === key}"><span class="kpi-label">${esc(label)}</span><span class="kpi-value">${esc(String(value))}</span><span class="kpi-sub">${esc(sub || '')}</span><span class="kpi-more">${drill === key ? 'Hide list' : 'See who'}</span></button>`;
    const drillRows = { initial: r.lists.initial, followUp: r.lists.followUp, opened: r.lists.opened, meetings: r.lists.meetings }[drill];
    const drillTitle = { initial: 'Initial outreach', followUp: 'Follow-ups', opened: 'Opened', responded: 'Responded', meetings: 'Meetings' }[drill];
    const drillCard = !drill
      ? ''
      : drill === 'responded'
        ? `<section class="card"><h2>${esc(drillTitle)} · ${esc(r.range.label)} <span class="muted">${r.responded.length}</span></h2>${
            r.responded.length
              ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Date</th><th>Company</th><th>Contact</th><th>Response</th></tr></thead><tbody>${r.responded.map((x) => `<tr data-href="#/company/${esc(x.companyId)}"><td class="nowrap">${esc(L.fmtDate(x.date))}</td><td><strong>${esc(x.company)}</strong></td><td>${esc(x.contact)}</td><td>${esc(x.how)}</td></tr>`).join('')}</tbody></table></div>`
              : emptyState('No responses in this period.')
          }</section>`
        : `<section class="card"><h2>${esc(drillTitle)} · ${esc(r.range.label)} <span class="muted">${drillRows.length}</span></h2>${
            drillRows.length
              ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Date</th><th>Company</th><th>Contact</th><th>How</th><th>Subject</th><th class="right">Opens</th><th>Reply</th></tr></thead><tbody>${drillRows
                  .map(
                    (x) => `<tr data-href="#/company/${esc(x.companyId)}"><td class="nowrap">${esc(L.fmtDate(x.date))}</td><td><strong>${esc(x.company)}</strong>${x.stage === 'Follow-up' ? '' : ''}</td><td>${esc(x.contact) || '<span class="muted">—</span>'}</td><td>${esc(x.type)}${x.outcome && x.outcome !== 'No response' ? `<div class="sub">${esc(x.outcome)}</div>` : ''}</td><td>${esc(x.subject)}</td><td class="right">${x.opens || '<span class="muted">—</span>'}</td><td>${x.answered ? badge('Responded', 'green') : x.stage ? '<span class="muted">Not yet</span>' : ''}</td></tr>`
                  )
                  .join('')}</tbody></table></div>`
              : emptyState('None in this period.')
          }</section>`;
    const periods = [['thisWeek', 'This week'], ['lastWeek', 'Last week'], ['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['last90', '90 days']];
    // 8 weeks: initial outreach and follow-ups stacked (2px gap between them), responses as their own chart.
    const max = Math.max(1, ...r.weeks.map((w) => w.initial + w.followUp));
    const maxR = Math.max(1, ...r.weeks.map((w) => w.responses));
    const wk = (w) => L.parseISODate(w.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const weekly = `<div class="wk-chart" role="img" aria-label="Prospecting touches by week, last 8 weeks">${r.weeks
      .map(
        (w) => `<div class="wk-col"><div class="wk-stack" data-tip="${esc('Week of ' + wk(w) + '\nInitial outreach ' + w.initial + '\nFollow-ups ' + w.followUp + '\nResponded ' + w.responses)}">
          <span class="seg-follow" style="height:${(w.followUp / max) * 100}%"></span><span class="seg-initial" style="height:${(w.initial / max) * 100}%"></span></div>
          <div class="wk-value">${w.initial + w.followUp || ''}</div><div class="wk-label">${esc(wk(w))}</div></div>`
      )
      .join('')}</div>
      <div class="legend"><span><i class="key-initial"></i>Initial outreach</span><span><i class="key-follow"></i>Follow-ups</span></div>`;
    const respChart = `<div class="wk-chart small" role="img" aria-label="Prospects who responded, by week">${r.weeks
      .map((w) => `<div class="wk-col"><div class="wk-stack" data-tip="${esc('Week of ' + wk(w) + ': ' + w.responses + ' responded')}"><span class="seg-initial" style="height:${(w.responses / maxR) * 100}%"></span></div><div class="wk-value">${w.responses || ''}</div><div class="wk-label">${esc(wk(w))}</div></div>`)
      .join('')}</div>`;

    // Takeaways from the last 90 days.
    const tips = [];
    const tpl = r.working.byTemplate.filter((x) => x.key !== '(none)' && x.sent >= 5).sort((a, b) => b.responseRate - a.responseRate);
    if (tpl.length > 1) tips.push(`"${tpl[0].key}" is your best template: ${pct(tpl[0].responseRate)} response on ${tpl[0].sent} sent, vs ${pct(tpl[tpl.length - 1].responseRate)} for "${tpl[tpl.length - 1].key}".`);
    const touch = r.working.byTouch;
    const later = touch.filter((x) => x.key !== '1st touch');
    const laterResp = later.reduce((n, x) => n + x.responded, 0);
    const allResp = touch.reduce((n, x) => n + x.responded, 0);
    if (allResp >= 3) tips.push(`${pct(laterResp / allResp)} of your responses came on a follow-up, not the first touch. Keep following up at least twice.`);
    const days = r.working.byDay.filter((x) => x.sent >= 5).sort((a, b) => b.responseRate - a.responseRate);
    if (days.length > 1) tips.push(`${days[0].key} gets the best response (${pct(days[0].responseRate)}); ${days[days.length - 1].key} the worst (${pct(days[days.length - 1].responseRate)}).`);
    if (r.openedNoReply.length) tips.push(`${r.openedNoReply.length} ${r.openedNoReply.length === 1 ? 'person' : 'people'} opened your email this period without replying. A call or short follow-up while it's warm converts best.`);
    if (t.initial + t.followUp && !t.followUp) tips.push('Every touch this period was a first touch. Most replies come on the second or third, so schedule follow-ups.');

    const who = (x) => `<a href="#/company/${esc(x.companyId)}"><strong>${esc(x.company)}</strong></a>${x.contact ? ` <span class="muted">· ${esc(x.contact)}</span>` : ''}`;
    return `<p class="hint">Prospecting only: calls, emails and LinkedIn messages to prospects you aren't working a deal with. Client, deal, landlord, broker and internal email are left out. A company's first touch is its initial outreach; later touches are follow-ups.</p>
      <div class="toolbar"><div class="seg">${periods.map(([v, l]) => `<button class="${(f.period || 'thisWeek') === v ? 'on' : ''}" data-action="set-filter" data-scope="prospecting" data-key="period" data-value="${v}">${l}</button>`).join('')}</div>
        <span class="muted">${esc(L.fmtDate(r.range.from))} – ${esc(L.fmtDate(r.range.to))}</span>
        <button class="btn small" data-action="copy-text" data-text="${esc(L.prospectingRecapText(r))}">Copy recap</button></div>
      <div class="kpis">
        ${tile('initial', 'Initial outreach', t.initial, t.companies + ' companies touched')}
        ${tile('followUp', 'Follow-ups', t.followUp, t.emails + ' emails · ' + t.calls + ' calls · ' + t.linkedin + ' LinkedIn')}
        ${tile('opened', 'Opened', t.opened, pct(t.openRate) + ' of emails')}
        ${tile('responded', 'Responded', t.responses, pct(t.responseRate) + ' of touches')}
        ${tile('meetings', 'Meetings', t.meetings, 'with prospects')}
      </div>
      ${t.conversation ? `<p class="hint">${t.conversation} email${t.conversation > 1 ? 's' : ''} in conversations with prospects who'd already replied ${t.conversation > 1 ? "aren't" : "isn't"} counted as follow-ups.</p>` : ''}
      ${drillCard}
      <section class="card"><h2>Follow up next <span class="muted">${r.followUps.length}</span></h2>
        <p class="hint">Prospects whose last touch (3 to 60 days ago) got no reply, ranked by opens, lead temperature and lease timing.</p>
        ${
          r.followUps.length
            ? `<ul class="followups todo">${r.followUps
                .map((x) => `<li><div class="fu-body"><div>${who(x)} ${emailIcon(x.companyId, x.contactId)}</div><div class="sub">${esc(x.why)}${x.subject ? ' · "' + esc(x.subject) + '"' : ''}</div></div><div class="todo-actions">${contactButtons(x.companyId, x.contactId, { step: 'Follow-up' })} ${touchButtons(x.companyId, x.contactId)}</div></li>`)
                .join('')}</ul>`
            : emptyState('Nobody waiting on a follow-up.')
        }</section>
      <div class="grid2">
        <section class="card"><h2>Responded <span class="muted">${r.responded.length}</span></h2>${r.responded.length ? `<ul class="plain added-notes">${r.responded.map((x) => `<li>${who(x)}<div class="sub">${esc(L.fmtDate(x.date))} · ${esc(x.how)}</div></li>`).join('')}</ul>` : emptyState('No responses in this period yet.')}</section>
        <section class="card"><h2>Opened, no reply <span class="muted">${r.openedNoReply.length}</span></h2>${r.openedNoReply.length ? `<ul class="plain added-notes">${r.openedNoReply.map((x) => `<li>${who(x)} ${emailIcon(x.companyId, '')}<div class="sub">Opened ${x.opens}x · ${esc(x.stage)} sent ${esc(L.fmtDate(x.date))} · "${esc(x.subject || '')}"</div></li>`).join('')}</ul>` : emptyState('None.')}</section>
      </div>
      <div class="grid2">
        <section class="card"><h2>Last 8 weeks</h2>${weekly}</section>
        <section class="card"><h2>Prospects who responded, by week</h2>${respChart}</section>
      </div>
      <section class="card"><h2>What's working <span class="muted">last 90 days</span></h2>
        ${tips.length ? `<ul class="plain added-notes">${tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Takeaways appear once there are a few weeks of prospecting logged.</p>'}
        <div class="grid2">
          <div><h3 class="notes-sub">By template</h3>${statsTable(r.working.byTemplate, 'Template')}</div>
          <div><h3 class="notes-sub">By touch</h3>${statsTable(r.working.byTouch, 'Touch')}</div>
        </div>
        <div class="grid2">
          <div><h3 class="notes-sub">By day sent</h3>${statsTable(r.working.byDay, 'Day')}</div>
          <div><h3 class="notes-sub">By channel</h3>${statsTable(r.working.byChannel, 'Channel')}</div>
        </div>
      </section>`;
  }

  function viewMarketing() {
    const f = state.marketing;
    const today = L.todayISO();
    const items = S.all('marketing');
    const q = f.q.trim().toLowerCase();
    const match = (m) => !q || [m.title, m.kind, m.submarket, m.partner, m.audience, m.notes, m.ideas].join(' ').toLowerCase().includes(q);
    const collateral = items.filter((m) => m.kind !== 'Social post' && match(m)).sort((a, b) => (b.date || b.updatedAt || '').localeCompare(a.date || a.updatedAt || ''));
    const posts = items.filter((m) => m.kind === 'Social post' && match(m));
    const stale = collateral.filter((m) => L.collateralStale(m, today));
    const goal = Number(S.settings().postsPerWeek) || 0;
    const thisWeek = posts.filter((p) => p.status === 'Sent / Posted' && p.date && p.date >= weekStart(today) && p.date <= today).length;
    const latestQ = L.latestDataQuarter(today);

    const tabs = [
      { v: 'collateral', l: `Collateral (${collateral.length})` },
      { v: 'social', l: `Social (${posts.length})` },
      { v: 'templates', l: `Email templates (${S.all('templates').length})` },
    ];
    let body = '';
    if (!['collateral', 'social', 'templates'].includes(f.tab)) f.tab = 'collateral';
    if (f.tab === 'collateral') {
      body = collateral.length
        ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Piece</th><th>Asset</th><th>Submarket</th><th>Partner</th><th>Data</th><th>Status</th><th class="right">Sent</th><th class="right">Responses</th></tr></thead><tbody>${collateral
            .map(
              (m) => `<tr data-action="edit" data-col="marketing" data-id="${esc(m.id)}" class="clickable">
              <td><strong>${esc(m.title)}</strong> ${badge(m.kind, 'gray')}${m.link ? ` <a href="${esc(m.link)}" target="_blank" rel="noopener">Open ↗</a>` : ''}${m.ideas ? `<div class="sub clamp" title="${esc(m.ideas)}">Ideas: ${esc(m.ideas)}</div>` : ''}</td>
              <td>${assetBadge(m.assetClass)}</td><td>${esc(m.submarket)}</td><td>${esc(m.partner)}</td>
              <td>${esc(m.dataQuarter)} ${L.collateralStale(m, today) ? badge('Update to ' + latestQ, 'amber') : ''}</td>
              <td>${badge(m.status, m.status === 'Sent / Posted' ? 'green' : m.status === 'Ready' ? 'blue' : 'gray')}</td>
              <td class="right">${esc(L.fmtNumber(m.sentCount))}</td>
              <td class="right">${m.sentCount ? pct((L.parseNumber(m.replies) || 0) / L.parseNumber(m.sentCount)) : '<span class="muted">—</span>'}</td></tr>`
            )
            .join('')}</tbody></table></div>`
        : emptyState('No collateral yet. Add your one-pagers, market reports and email campaigns to track them.', '<button class="btn primary" data-action="new" data-col="marketing">+ Collateral</button>');
    } else if (f.tab === 'social') {
      const upcoming = posts.filter((p) => !['Sent / Posted', 'Retired'].includes(p.status)).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
      const posted = posts.filter((p) => p.status === 'Sent / Posted').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const postRow = (p) => `<tr data-action="edit" data-col="marketing" data-id="${esc(p.id)}" class="clickable">
          <td class="nowrap">${esc(L.fmtDate(p.date)) || '<span class="muted">Unscheduled</span>'}</td><td>${p.image ? `<img class="post-thumb" src="${p.image}" alt="" />` : ''}<strong>${esc(p.title)}</strong>${p.image || p.caption ? ` <button class="btn small" data-action="social-preview" data-id="${esc(p.id)}">Caption & image</button>` : ''}${p.notes ? `<div class="sub clamp">${esc(p.notes)}</div>` : ''}</td>
          <td>${esc(p.channel)}</td><td>${badge(p.status, 'gray')}</td>
          <td class="right">${esc(L.fmtNumber(p.impressions))}</td><td class="right">${esc(L.fmtNumber(p.reactions))}</td><td class="right">${esc(L.fmtNumber(p.comments))}</td></tr>`;
      const head = '<thead><tr><th>Date</th><th>Post</th><th>Channel</th><th>Status</th><th class="right">Impressions</th><th class="right">Reactions</th><th class="right">Comments</th></tr></thead>';
      body = `<section class="card"><h2>Up next</h2>${upcoming.length ? `<div class="table-wrap"><table class="tbl compact">${head}<tbody>${upcoming.map(postRow).join('')}</tbody></table></div>` : emptyState('No post ideas queued.', '<button class="btn" data-action="new" data-col="marketing">+ Post idea</button>')}</section>
        <section class="card"><h2>Posted</h2>${posted.length ? `<div class="table-wrap"><table class="tbl compact">${head}<tbody>${posted.map(postRow).join('')}</tbody></table></div>` : emptyState('Nothing posted yet.')}</section>
        <div class="drop-zone" data-drop="highlights"><strong>Drag a Market Highlights PDF from Research here</strong> <span class="muted">or</span> <button class="btn small" data-action="pick-file" data-kind="highlights">Choose a file</button>
          <div class="sub">It becomes a LinkedIn post: a caption written from the highlights, and the page saved as an image to attach.</div></div>`;
    } else if (f.tab === 'templates') {
      const stats = {};
      const prospecting = L.prospectTouches({ companies: S.all('companies'), contacts: S.all('contacts'), deals: S.all('deals'), activities: S.all('activities') }, { internalDomain: myEmailDomain() }).touches;
      L.outreachStats(prospecting, (a) => a.template).forEach((r) => (stats[r.key] = r));
      const list = S.all('templates').slice().sort((a, b) => L.TEMPLATE_STEPS.indexOf(a.step) - L.TEMPLATE_STEPS.indexOf(b.step) || a.name.localeCompare(b.name));
      body = `<p class="hint">Use placeholders like {FirstName}, {Company}, {Building}, {Submarket}, {LeaseExpiration}, {MonthsToExpiration}, {SF}, {MyFirstName} and {MyFirm}. Market stats placeholders like {MarketStat}, {Vacancy}, {VacancyChange} and {AskingRent} fill in from the latest Research numbers for the company's submarket (see Research). For rent emails, {Rate}, {CompBuilding}, {MonthlyRent}, {AnnualRent}, {AnnualIncrease} and {MeetingDay} become fill-ins in the Draft email window: type the quoted rate and the rent math is done for you. So does any [bracketed note]. They fill in when you click Draft email on a company or on Today. Results come from emails tagged with the template's name.</p>
        ${
          list.length
            ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Template</th><th>When</th><th>Subject</th><th class="right">Sent</th><th class="right">Response rate</th></tr></thead><tbody>${list
                .map((t) => {
                  const r = stats[t.name];
                  return `<tr class="clickable" data-action="edit" data-col="templates" data-id="${esc(t.id)}"><td><strong>${esc(t.name)}</strong> ${t.active === false ? badge('Inactive', 'gray') : ''}<div class="sub clamp">${esc(t.body)}</div></td><td>${esc(t.step)}</td><td>${esc(t.subject)}</td><td class="right">${r ? r.sent : 0}</td><td class="right">${r && r.sent ? `<strong>${pct(r.responseRate)}</strong>` : '<span class="muted">—</span>'}</td></tr>`;
                })
                .join('')}</tbody></table></div>`
            : emptyState('No templates yet.', '<button class="btn primary" data-action="new" data-col="templates">+ Template</button>')
        }`;
    }

    return `
      <div class="page-head"><h1>Marketing</h1>
        <div class="actions">${f.tab === 'templates' ? '<button class="btn primary" data-action="new" data-col="templates">+ Template</button>' : `<button class="btn primary" data-action="new" data-col="marketing">+ ${f.tab === 'social' ? 'Post idea' : 'Collateral'}</button>`}</div>
      </div>
      <div class="kpis">
        <div class="kpi ${goal && thisWeek >= goal ? 'good' : ''}"><span class="kpi-label">Posts this week</span><span class="kpi-value">${thisWeek} / ${goal}</span><span class="kpi-sub">weekly goal (Settings)</span></div>
        <div class="kpi ${stale.length ? 'alert' : ''}"><span class="kpi-label">Collateral to refresh</span><span class="kpi-value">${stale.length}</span><span class="kpi-sub">market data older than ${esc(latestQ)}</span></div>
        <div class="kpi"><span class="kpi-label">Pieces tracked</span><span class="kpi-value">${collateral.length}</span><span class="kpi-sub">${posts.length} social posts</span></div>
      </div>
      <div class="toolbar">
        <div class="seg">${tabs.map((t) => `<button class="${f.tab === t.v ? 'on' : ''}" data-action="set-filter" data-scope="marketing" data-key="tab" data-value="${t.v}">${esc(t.l)}</button>`).join('')}</div>
        ${f.tab === 'outreach' ? '' : `<input type="search" placeholder="Search title, submarket, partner…" value="${esc(f.q)}" data-filter="marketing.q" id="f-marketing-q" />`}
      </div>
      ${body}`;
  }

  // Quarterly Research stats by submarket: they feed the {MarketStat}-style template placeholders.
  // Research: quarterly market stats and report notes, by asset class (office, industrial, flex).
  function viewResearch() {
    return `<div class="page-head"><div><h1>Research</h1><div class="greeting-sub">Quarterly market stats from Research reports, by submarket</div></div>
        <div class="actions"><button class="btn primary" data-action="pick-file" data-kind="marketStats">Import a report</button></div>
      </div>
      ${marketStatsTab()}`;
  }

  function marketStatsTab() {
    const f = state.research;
    const st = S.settings();
    const stats = st.marketStats || [];
    const reports = st.marketReports || [];
    const asset = f.statsAsset || 'Office';
    const fmtSF = (n) => (n === undefined || n === null ? '—' : L.fmtNumber(Math.round(n)));
    const fmtMSF = (n) => (n === undefined || n === null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + ' MSF' : L.fmtNumber(Math.round(n)) + ' SF');
    const quarters = Array.from(new Set(stats.map((x) => x.quarter + '|' + x.assetClass)))
      .map((k) => ({ quarter: k.split('|')[0], assetClass: k.split('|')[1], n: stats.filter((x) => x.quarter + '|' + x.assetClass === k).length }))
      .sort((a, b) => L.compareQuarters(b.quarter, a.quarter) || a.assetClass.localeCompare(b.assetClass));
    const mine = quarters.filter((q) => q.assetClass === asset).map((q) => q.quarter);
    // The quarter being viewed (latest by default) and the one before it, for changes.
    const latest = mine.includes(f.statsQuarter) ? f.statsQuarter : mine[0];
    const prevQ = mine[mine.indexOf(latest) + 1];
    const report = reports.find((r) => r.quarter === latest && r.assetClass === asset);
    const rows = stats.filter((x) => x.assetClass === asset && x.quarter === latest);
    const total = rows.find((x) => x.submarket === 'Market total');
    const prevTotal = (prevQ ? stats.find((x) => x.assetClass === asset && x.quarter === prevQ && x.submarket === 'Market total') : null) || (total ? L.previousStat(total, stats) : null);
    // Changes are against the quarter before: one on file, or worked back from what Research says changed.
    const prevLabel = prevQ || L.previousQuarter(latest);
    const change = (cur, prev, kind) => {
      if (cur === undefined || cur === null || !prev || prev === undefined || prev === null) return '';
      if (kind === 'bps') {
        const bps = Math.round((cur - prev) * 100);
        return (bps === 0 ? 'flat' : (bps < 0 ? 'down ' : 'up ') + Math.abs(bps) + ' bps') + ' vs ' + prevLabel;
      }
      const pct = ((cur - prev) / Math.abs(prev)) * 100;
      return (Math.abs(pct) < 0.05 ? 'flat' : (pct < 0 ? 'down ' : 'up ') + Math.abs(pct).toFixed(1) + '%') + ' vs ' + prevLabel;
    };
    const tile = (label, value, sub) => `<div class="kpi"><span class="kpi-label">${esc(label)}</span><span class="kpi-value">${esc(value)}</span><span class="kpi-sub">${esc(sub || '')}</span></div>`;
    const copyList = (list) =>
      `<ul class="plain added-notes research-points">${list.map((b) => `<li><span>${esc(b)}</span> <button class="link" data-action="copy-text" data-text="${esc(b)}">Copy</button></li>`).join('')}</ul>`;

    // Horizontal bars by submarket (one series, so no legend: the title names it), with the market as a reference line.
    const metric = f.statsMetric === 'askingRent' ? 'askingRent' : 'vacancy';
    const fmtMetric = (n) => (metric === 'vacancy' ? Number(n).toFixed(1) + '%' : '$' + Number(n).toFixed(2));
    const bars = rows.filter((x) => x.submarket !== 'Market total' && !/total/i.test(x.submarket) && x[metric] !== undefined).sort((a, b) => b[metric] - a[metric]);
    const max = Math.max(...bars.map((x) => x[metric]), total && total[metric] ? total[metric] : 0) * 1.08 || 1;
    const tip = (x) => [x.submarket, 'Vacancy ' + (x.vacancy !== undefined ? x.vacancy.toFixed(1) + '%' : '—'), 'Asking rent ' + (x.askingRent ? '$' + x.askingRent.toFixed(2) + '/SF' : '—'), 'Net absorption ' + fmtSF(x.netAbsorption) + ' SF', 'Under construction ' + fmtSF(x.underConstruction) + ' SF'].join('\n');
    const chart = bars.length
      ? `<div class="bar-chart" role="img" aria-label="${esc((metric === 'vacancy' ? 'Vacancy' : 'Average asking rent') + ' by submarket, ' + latest)}">
          ${total && total[metric] ? `<div class="bar-ref-key"><span class="ref-swatch"></span>Market ${esc(fmtMetric(total[metric]))}</div>` : ''}
          ${bars
            .map(
              (x) => `<div class="bar-row" data-tip="${esc(tip(x))}"><span class="bar-label">${esc(x.submarket)}</span><span class="bar-track"><span class="bar" style="width:${((x[metric] / max) * 100).toFixed(1)}%"></span>${total && total[metric] ? `<span class="bar-ref" style="left:${((total[metric] / max) * 100).toFixed(1)}%"></span>` : ''}</span><span class="bar-value">${esc(fmtMetric(x[metric]))}</span></div>`
            )
            .join('')}
        </div>`
      : '';

    // Trend across the quarters on file, for the market or one submarket: one small chart per measure (never two
    // scales on one chart).
    const seriesFor = (sub) =>
      mine
        .slice()
        .reverse()
        .filter((q) => L.compareQuarters(q, latest) <= 0)
        .map((q) => stats.find((x) => x.assetClass === asset && x.quarter === q && x.submarket === sub))
        .filter(Boolean);
    const spark = (key, label, fmt, sub) => {
      const pts = seriesFor(sub || 'Market total').filter((x) => x[key] !== undefined);
      if (pts.length < 2) return '';
      const vals = pts.map((x) => x[key]);
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      const X = (i) => 20 + (i * 260) / (pts.length - 1);
      const Y = (v) => (hi === lo ? 40 : 66 - ((v - lo) / (hi - lo)) * 50);
      return `<div class="trend"><div class="kpi-label">${esc(label)}</div><svg viewBox="0 0 300 84" role="img" aria-label="${esc(label + ' by quarter')}">
        <polyline points="${pts.map((x, i) => X(i) + ',' + Y(x[key])).join(' ')}" />
        ${pts.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x[key])}" r="4" data-tip="${esc(x.quarter + ': ' + fmt(x[key]))}"></circle>`).join('')}
        <text x="${X(0)}" y="82" text-anchor="start">${esc(pts[0].quarter)}</text><text x="${X(pts.length - 1)}" y="82" text-anchor="end">${esc(pts[pts.length - 1].quarter)} · ${esc(fmt(pts[pts.length - 1][key]))}</text>
      </svg></div>`;
    };
    const trendsFor = (sub, who) => [spark('vacancy', who + ' vacancy', (v) => v.toFixed(1) + '%', sub), spark('askingRent', who + ' asking rent', (v) => '$' + v.toFixed(2), sub), spark('netAbsorption', 'Quarterly net absorption', fmtMSF, sub)].join('');
    const trends = trendsFor('Market total', 'Market');

    const hl = (report && report.highlights) || {};
    const notesFor = (sub) => (report ? (report.submarkets || {})[L.matchSubmarket(Object.keys(report.submarkets || {}), sub)] || [] : []);
    // One submarket on its own: its numbers, how it compares, Research's notes and a client-ready summary.
    // A report with no market total (e.g. one custom corridor) opens straight on its submarket.
    const subRow = (f.statsSub && rows.find((x) => x.submarket === f.statsSub)) || (!total && rows.length ? rows[0] : null);
    const subView = () => {
      const b = L.submarketBrief(stats, asset, subRow.submarket, latest);
      const x = b.row;
      const m = b.market;
      const p = b.previous;
      const vsMkt = (a, mk, kind) => (a === undefined || !mk || mk === undefined ? '' : kind === 'pts' ? 'Market ' + mk.toFixed(1) + '%' : 'Market $' + mk.toFixed(2));
      const notes = notesFor(x.submarket);
      const subTrends = trendsFor(x.submarket, x.submarket);
      // Side-by-side bars against the market (same scale, one measure per pair).
      const pair = (label, a, mk, fmt) =>
        a === undefined || !m || mk === undefined
          ? ''
          : `<div class="pair"><div class="kpi-label">${esc(label)}</div>${[[x.submarket, a, true], ['Market', mk, false]]
              .map(([n, v, on]) => `<div class="bar-row" data-tip="${esc(n + ': ' + fmt(v))}"><span class="bar-label">${esc(n)}</span><span class="bar-track"><span class="bar${on ? '' : ' bar-muted'}" style="width:${((v / Math.max(a, mk) / 1.08) * 100).toFixed(1)}%"></span></span><span class="bar-value">${esc(fmt(v))}</span></div>`)
              .join('')}</div>`;
      return `
      <div class="kpis">
        ${tile('Vacancy', x.vacancy !== undefined ? x.vacancy.toFixed(1) + '%' : '—', [change(x.vacancy, p && p.vacancy, 'bps'), vsMkt(x.vacancy, m && m.vacancy, 'pts')].filter(Boolean).join(' · '))}
        ${tile(x.rentType === 'direct' ? 'Avg. direct asking rent' : 'Avg. asking rent', x.askingRent ? '$' + x.askingRent.toFixed(2) : '—', [change(x.askingRent, p && p.askingRent), vsMkt(x.askingRent, m && m.askingRent)].filter(Boolean).join(' · '))}
        ${tile('Net absorption, ' + latest, fmtMSF(x.netAbsorption), x.ytdAbsorption !== undefined ? fmtMSF(x.ytdAbsorption) + ' year to date' : '')}
        ${tile('Under construction', fmtMSF(x.underConstruction), x.inventory ? fmtMSF(x.inventory) + ' inventory' : '')}
      </div>
      <div class="grid2">
        <section class="card"><h2>Key points · ${esc(x.submarket)} ${esc(latest)} <button class="link more" data-action="copy-text" data-text="${esc(b.points.join('\n'))}">Copy all</button></h2>${copyList(b.points)}</section>
        <section class="card"><h2>For a client <button class="link more" data-action="copy-text" data-text="${esc(b.paragraph)}">Copy</button></h2><p class="client-summary">${esc(b.paragraph)}</p>
          <p class="hint">Built from the numbers above. Edit it to fit the conversation; the vacancy and rent lines are safe to quote.</p></section>
      </div>
      ${notes.length ? `<section class="card"><h2>What Research says about ${esc(x.submarket)}</h2>${copyList(notes)}</section>` : ''}
      ${(() => {
        const deals = report && report.deals ? report.deals[L.matchSubmarket(Object.keys(report.deals), x.submarket)] || [] : [];
        return deals.length
          ? `<section class="card"><h2>Notable leases · ${esc(x.submarket)} ${esc(latest)}</h2><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Building</th><th>Tenant</th><th>Type</th><th class="right">SF</th></tr></thead><tbody>${deals.map((d) => `<tr><td>${esc(d.building)}</td><td>${d.tenant ? esc(d.tenant) : '<span class="muted">—</span>'}</td><td>${esc(d.type)}</td><td class="right">${esc(L.fmtNumber(d.sf))}</td></tr>`).join('')}</tbody></table></div><p class="hint">From the report. Add one to Comps with + Comp if you get its terms.</p></section>`
          : '';
      })()}
      <div class="grid2">
        <section class="card"><h2>Compared with the market</h2>${pair('Vacancy', x.vacancy, m && m.vacancy, (v) => v.toFixed(1) + '%')}${pair('Asking rent', x.askingRent, m && m.askingRent, (v) => '$' + v.toFixed(2))}</section>
        ${subTrends ? `<section class="card"><h2>Trend</h2><div class="trends">${subTrends}</div></section>` : `<section class="card"><h2>Trend</h2><p class="muted">Shows here once a second quarter is on file.</p></section>`}
      </div>`;
    };

    const view = subRow
      ? subView()
      : latest
      ? `
      <div class="kpis">
        ${tile('Vacancy', total && total.vacancy !== undefined ? total.vacancy.toFixed(1) + '%' : '—', change(total && total.vacancy, prevTotal && prevTotal.vacancy, 'bps'))}
        ${tile(total && total.rentType === 'direct' ? 'Avg. direct asking rent' : 'Avg. asking rent', total && total.askingRent ? '$' + total.askingRent.toFixed(2) : '—', change(total && total.askingRent, prevTotal && prevTotal.askingRent) || (asset === 'Office' ? 'per SF, full service' : 'per SF, NNN'))}
        ${tile('Net absorption, ' + latest, total ? fmtMSF(total.netAbsorption) : '—', total && total.ytdAbsorption !== undefined ? fmtMSF(total.ytdAbsorption) + ' year to date' : '')}
        ${tile('Under construction', total ? fmtMSF(total.underConstruction) : '—', total && total.inventory ? fmtMSF(total.inventory) + ' inventory' : '')}
      </div>
      ${
        hl['Leasing Market Fundamentals'] || hl.Outlook
          ? `<div class="grid2">
          ${hl['Leasing Market Fundamentals'] ? `<section class="card"><h2>What changed this quarter</h2>${copyList(hl['Leasing Market Fundamentals'])}</section>` : ''}
          ${hl.Outlook ? `<section class="card"><h2>Outlook</h2>${copyList(hl.Outlook)}</section>` : ''}
        </div>`
          : ''
      }
      ${trends ? `<section class="card"><h2>Trend</h2><div class="trends">${trends}</div></section>` : ''}
      <section class="card"><h2>By submarket · ${esc(latest)} <span class="seg small more">${[['vacancy', 'Vacancy'], ['askingRent', 'Asking rent']].map(([v, l]) => `<button class="${metric === v ? 'on' : ''}" data-action="set-filter" data-scope="research" data-key="statsMetric" data-value="${v}">${l}</button>`).join('')}</span></h2>
        ${chart}
        <div class="table-wrap"><table class="tbl compact stats-table"><thead><tr><th>Submarket</th><th class="right">Vacancy</th><th class="right">${total && total.rentType === 'direct' ? 'Direct asking rent' : 'Asking rent'}</th><th class="right">Net absorption</th><th class="right">YTD absorption</th><th class="right">Under construction</th><th class="right">Inventory</th></tr></thead><tbody>${rows
          .slice()
          .sort((a, b) => (a.submarket === 'Market total') - (b.submarket === 'Market total'))
          .map((x) => {
            const notes = notesFor(x.submarket);
            const prev = (prevQ ? stats.find((y) => y.assetClass === asset && y.quarter === prevQ && y.submarket === x.submarket) : null) || L.previousStat(x, stats);
            return `<tr class="${/total/i.test(x.submarket) ? 'total-row' : ''}"><td><strong>${esc(x.submarket)}</strong>${notes.length ? `<details class="research-details"><summary>What Research says (${notes.length})</summary>${copyList(notes)}</details>` : ''}</td>
              <td class="right">${x.vacancy !== undefined ? x.vacancy.toFixed(1) + '%' : '—'}${prev && prev.vacancy !== undefined ? `<div class="sub">${esc(change(x.vacancy, prev.vacancy, 'bps'))}</div>` : ''}</td>
              <td class="right">${x.askingRent ? '$' + x.askingRent.toFixed(2) : '—'}</td><td class="right">${esc(fmtSF(x.netAbsorption))}</td><td class="right">${esc(fmtSF(x.ytdAbsorption))}</td><td class="right">${esc(fmtSF(x.underConstruction))}</td><td class="right">${esc(fmtSF(x.inventory))}</td></tr>`;
          })
          .join('')}</tbody></table></div></section>
      ${hl['Major Transactions'] ? `<section class="card"><h2>Major transactions</h2>${copyList(hl['Major Transactions'])}</section>` : ''}`
      : emptyState(`No ${asset.toLowerCase()} stats yet. Drop this quarter's Research report above.`);

    return `${importPreview && importPreview.kind === 'research' ? researchPreviewCard() : ''}
      <div class="toolbar"><div class="seg">${L.RESEARCH_ASSETS.map((a) => `<button class="${asset === a ? 'on' : ''}" data-action="set-filter" data-scope="research" data-key="statsAsset" data-value="${a}">${a}</button>`).join('')}</div>
        ${rows.length ? `<select data-filter="research.statsSub" aria-label="Submarket">${options(rows.map((x) => ({ value: x.submarket === 'Market total' ? '' : x.submarket, label: x.submarket === 'Market total' ? (report && report.market ? report.market : 'Market') + ' overall' : x.submarket })).sort((a, b) => (a.value ? 1 : 0) - (b.value ? 1 : 0) || 0), subRow ? subRow.submarket : '')}</select>` : ''}
        ${mine.length ? `<select data-filter="research.statsQuarter" aria-label="Quarter">${options(mine, latest)}</select>` : ''}</div>
      ${view}
      <div class="drop-zone" data-drop="marketStats"><strong>Drag this quarter's Research report here</strong> (the PDF, or an Excel/CSV stats table) <span class="muted">or</span> <button class="btn small" data-action="pick-file" data-kind="marketStats">Choose a file</button>
        <div class="sub">The submarket statistics, the market observations and each submarket's current conditions are read from the report. You confirm the quarter before anything is saved. Each new quarter is compared with the one before.</div></div>
      ${quarters.length ? `<section class="card"><h2>Quarters on file</h2><ul class="plain added-notes">${quarters.map((q) => `<li>${esc(q.quarter)} · ${esc(q.assetClass)} <span class="muted">· ${q.n <= 3 ? esc(stats.filter((x) => x.quarter === q.quarter && x.assetClass === q.assetClass).map((x) => x.submarket).join(', ')) : q.n + ' submarkets'}${reports.some((r) => r.quarter === q.quarter && r.assetClass === q.assetClass) ? ' · report notes' : ''}</span> <button class="link" data-action="move-stats" data-quarter="${esc(q.quarter)}" data-asset="${esc(q.assetClass)}">Change quarter</button> <button class="link" data-action="remove-stats" data-quarter="${esc(q.quarter)}" data-asset="${esc(q.assetClass)}">Remove</button></li>`).join('')}</ul></section>` : ''}
      <section class="card"><h2>Placeholders for templates</h2>
        <p class="hint">Use these in Marketing → Email templates. They come from the company's submarket (or the market total when its submarket isn't in the report), for its asset class, and update each time you load a new quarter.</p>
        <dl class="info">${[
          ['{MarketStat}', 'A ready sentence: "Northside office vacancy was 24.1% in 3Q26, down 40 bps from 2Q26, asking rents averaged $43.10/SF (up 1.4% from 2Q26) and net absorption was -45,000 SF."'],
          ['{ResearchNote}', "Research's own line on the submarket's vacancy this quarter"],
          ['{MarketTrend}', "Research's first line on the market this quarter"],
          ['{Vacancy} / {VacancyChange}', '24.1% / down 40 bps from 2Q26'],
          ['{AskingRent} / {RentChange}', '$43.10/SF / up 1.4% from 2Q26'],
          ['{NetAbsorption}, {UnderConstruction}, {Deliveries}', 'In SF'],
          ['{MarketVacancy}', 'The metro-wide vacancy, for comparison'],
          ['{Quarter} / {StatsArea}', '3Q26 / the submarket the numbers are for'],
        ]
          .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
          .join('')}</dl></section>`;
  }

  function researchPreviewCard() {
    const p = importPreview;
    const r = p.report;
    const hl = Object.entries(r.highlights || {});
    const subs = Object.keys(r.submarkets || {});
    return `<section class="card import-preview">
      <h2>Review report: ${esc(p.filename)}</h2>
      ${
        r.rows.length
          ? `<p>Found ${r.rows.length === 1 ? 'statistics for one submarket' : r.rows.length + ' rows of submarket statistics'}${hl.length ? `, ${hl.reduce((n, [, v]) => n + v.length, 0)} market observations` : ''}${subs.length ? ` and notes for ${subs.length === 1 ? '' : subs.length + ' submarkets: '}${esc(subs.join(', '))}` : ''}${Object.keys(r.deals || {}).length ? `, plus ${Object.values(r.deals).reduce((n, v) => n + v.length, 0)} notable leases` : ''}.</p>`
          : '<p class="red-text">No submarket statistics table was found in this PDF. Market observations and submarket notes are still saved if found.</p>'
      }
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Submarket</th><th class="right">Vacancy</th><th class="right">Asking rent</th><th class="right">Net absorption</th><th class="right">Under construction</th></tr></thead><tbody>${r.rows
        .map((x) => `<tr><td>${esc(x.submarket)}</td><td class="right">${x.vacancy !== undefined ? x.vacancy.toFixed(1) + '%' : '—'}</td><td class="right">${x.askingRent ? '$' + x.askingRent.toFixed(2) : '—'}</td><td class="right">${esc(L.fmtNumber(x.netAbsorption))}</td><td class="right">${esc(L.fmtNumber(x.underConstruction))}</td></tr>`)
        .join('')}</tbody></table></div>
      <form id="research-form" class="form-grid">
        <label>Quarter<input name="quarter" value="${esc(r.quarter)}" placeholder="2Q26" required pattern="[1-4][Qq][0-9]{2}" /></label>
        <label>Asset class<select name="assetClass">${options(L.RESEARCH_ASSETS, r.assetClass)}</select></label>
        <div class="wide actions"><button class="btn primary" type="submit">Save ${esc(r.quarter)} ${esc(r.assetClass.toLowerCase())} stats</button><button class="btn" type="button" data-action="cancel-import">Cancel</button></div>
        <p class="hint wide">${r.rows.some((x) => x.submarket === 'Market total') ? 'Saving replaces any stats already on file for the same quarter and asset class.' : 'This report covers ' + (r.rows.length === 1 ? 'one submarket' : r.rows.length + ' submarkets') + ', so it is added to the quarter alongside any others on file.'}</p>
      </form>
    </section>`;
  }

  // ----- comps & critical dates -----

  const KIND_BADGE = { 'check-in': 'blue', commencement: 'green', planning: 'amber', notice: 'red', expiration: 'red', other: 'gray' };

  function touchpointRow(p, actions) {
    const d = S.get('deals', p.dealId);
    return `<tr>
      <td class="nowrap">${esc(L.fmtDate(p.date))}</td>
      <td>${badge(p.kind.replace('-', ' '), KIND_BADGE[p.kind])} ${esc(p.label)}${p.terms ? `<div class="sub">${esc(p.terms)}</div>` : ''}</td>
      <td>${linkCompany(p.companyId)}${d ? `<div class="sub"><a href="#/deal/${esc(p.dealId)}">${esc(d.name)}</a></div>` : ''}</td>
      <td class="right nowrap">${p.criticalDateId ? `<button class="icon-btn" data-action="edit" data-col="criticalDates" data-id="${esc(p.criticalDateId)}" title="Edit">✎</button>` : ''}${actions ? touchButtons(p.companyId, '') : ''}</td></tr>`;
  }

  // Every lease right you track for a company (or all companies), open ones first.
  function criticalDatesTable(list, showCompany) {
    const order = (r) => (['Open', ''].includes(r.status || '') ? '0' : '1') + (r.date || '9999');
    const today = L.todayISO();
    return `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Deadline</th><th>Right</th>${showCompany ? '<th>Tenant</th>' : ''}<th>Terms</th><th>Status</th><th></th></tr></thead><tbody>${list
      .slice()
      .sort((a, b) => order(a).localeCompare(order(b)))
      .map((r) => {
        const open = !r.status || r.status === 'Open';
        const soon = open && r.date && r.date >= today && r.date <= L.addDays(today, 365);
        return `<tr>
          <td class="nowrap">${r.date ? badge(L.fmtDate(r.date), !open ? 'gray' : r.date < today ? 'gray' : soon ? 'red' : 'amber') : '<span class="muted">No date</span>'}</td>
          <td><strong>${esc(r.kind)}</strong>${r.label ? `<div class="sub">${esc(r.label)}</div>` : ''}</td>
          ${showCompany ? `<td>${linkCompany(r.companyId)}</td>` : ''}
          <td>${esc(r.terms || '')}${r.source ? `<div class="sub">Source: ${esc(r.source)}</div>` : ''}</td>
          <td>${badge(r.status || 'Open', open ? 'blue' : 'gray')}</td>
          <td class="right"><button class="icon-btn" data-action="edit" data-col="criticalDates" data-id="${esc(r.id)}" title="Edit">✎</button></td></tr>`;
      })
      .join('')}</tbody></table></div>`;
  }

  function criticalDatesCard(companyId, dealId) {
    const list = S.all('criticalDates').filter((r) => r.companyId === companyId);
    const attrs = `data-company="${esc(companyId)}"${dealId ? ` data-deal="${esc(dealId)}"` : ''}`;
    return `<section class="card"><h2>Lease rights & critical dates <button class="link more" data-action="new" data-col="criticalDates" ${attrs}>+ Add</button></h2>
      ${list.length ? criticalDatesTable(list, false) : emptyState('Track renewal and termination options, expansion rights, ROFO/ROFR and other deadlines from the lease. You\'ll get a reminder on Today before each notice deadline.', `<button class="btn" data-action="new" data-col="criticalDates" ${attrs}>+ Critical date</button>`)}</section>`;
  }

  // Estimated expirations show the year with "~"; known ones show the month.
  function compLXDCell(c) {
    const x = L.compLXD(c);
    if (!x) return '';
    const d = L.parseISODate(x.date);
    return x.estimated
      ? `<span title="Estimated: signed ${esc(L.fmtDate(c.signedDate))}, about 2 months to commencement, then a ${esc(c.termMonths)}-month term">~${d.getFullYear()}</span>`
      : esc(d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
  }

  // The "?" next to Import comps: when to import and when to match a file.
  function compsHelp() {
    return `<section class="card help-panel"><h2>Import comps or Match a file? <button class="link more" data-action="toggle-comps-help">Close</button></h2>
      <div class="grid2">
        <div><h3 class="notes-sub">Import comps: add new information</h3>
          <p>Use it whenever a new comp sheet arrives (e.g. next quarter's file).</p>
          <ul class="plain"><li>Adds new deals, and fills in or updates comps it recognizes as the same deal.</li><li>Never deletes anything.</li><li>Anything that looks like a duplicate is held for your approval.</li><li>A comp it can't recognize (like a badly saved copy from an old import) is left alone.</li></ul></div>
        <div><h3 class="notes-sub">Match a file: make the CRM agree with a sheet</h3>
          <p>Use it to clean up when the CRM's comps don't line up with a sheet. The sheet is the source of truth.</p>
          <ul class="plain"><li>Pairs each row with the CRM comp for the same tenant and building, even if its terms were saved wrong.</li><li>Shows every field that differs (CRM → file) and lets you correct it.</li><li>Finds leftover copies of the same tenant and offers to delete them.</li><li>Lists comps that aren't in the file, kept unless you tick them.</li></ul></div>
      </div>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Situation</th><th>Use</th></tr></thead><tbody>
        <tr><td>A new comp sheet arrives</td><td>Import comps</td></tr>
        <tr><td>You updated a few rows in a sheet you already imported</td><td>Import comps</td></tr>
        <tr><td>The CRM's comps don't line up with a sheet and re-importing didn't fix it</td><td>Match a file</td></tr>
        <tr><td>You suspect duplicates or wrong terms from an old import</td><td>Match a file</td></tr>
      </tbody></table></div>
      <p class="hint">Rule of thumb: Import for new sheets; Match a file only to fix a mess.</p>
    </section>`;
  }

  // Building quotes saved from the Draft email window; 6 months old or more is flagged to re-confirm.
  function quotedRates(q) {
    const list = L.quotedRateList(S.settings().buildingRates || {}, q, L.todayISO());
    const total = Object.keys(S.settings().buildingRates || {}).length;
    const buildings = Array.from(
      new Set(
        S.all('companies')
          .map((c) => c.building)
          .concat(S.all('comps').map((c) => c.building), Object.values(S.settings().buildingRates || {}).map((r) => r.building))
          .filter(Boolean)
      )
    ).sort();
    const form = `<form id="quote-form" class="quote-form">
        <input type="hidden" name="key" />
        <label>Building<input name="building" list="quote-buildings" placeholder="e.g. Royal Woods" required /></label>
        <label>Rate ($/SF/yr)<input name="rate" inputmode="decimal" placeholder="12.75" required /></label>
        <label>Type<select name="basis">${options(L.QUOTE_BASES, 'NNN')}</select></label>
        <label id="quote-opex" hidden>OpEx ($/SF/yr)<input name="opex" inputmode="decimal" placeholder="3.50" /></label>
        <label>Date quoted<input type="date" name="date" value="${L.todayISO()}" /></label>
        <span class="quote-form-buttons"><button type="submit" class="btn primary">Save quote</button><button type="button" class="btn" data-action="clear-quote" hidden>Cancel edit</button></span>
        <datalist id="quote-buildings">${buildings.map((b) => `<option value="${esc(b)}"></option>`).join('')}</datalist>
      </form>`;
    return `<section class="card"><h2>Quoted rates</h2>
      <p class="hint">What each building is quoting. Add one here, or type a rate in the Draft email window and it's saved for that building. The next email to a tenant there starts with it. Quotes 6 months old or more are flagged to re-confirm; saving the rate again restarts the clock.</p>
      ${form}
      ${
        list.length
          ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Building</th><th class="right">Quote</th><th>Saved</th><th></th><th></th></tr></thead><tbody>${list
              .map(
                (r) => `<tr><td><strong>${esc(r.building)}</strong></td><td class="right nowrap">${esc(r.text)}</td><td class="nowrap">${esc(L.fmtDate(r.date))}</td>
              <td>${r.stale ? badge('Re-confirm · ' + r.ageMonths + ' mo old', 'red') : `<span class="muted">${r.ageMonths ? r.ageMonths + ' mo ago' : 'This month'}</span>`}</td>
              <td class="right nowrap"><button class="btn small" data-action="edit-quote" data-key="${esc(r.key)}">Edit</button> <button class="btn small" data-action="delete-quote" data-key="${esc(r.key)}">Remove</button></td></tr>`
              )
              .join('')}</tbody></table></div>`
          : emptyState(total ? 'No saved quotes match that search.' : 'No quotes saved yet. Add one above, or type a quoted rate in the Draft email window.')
      }</section>`;
  }

  function viewComps() {
    const f = state.comps;
    const today = L.todayISO();
    const tp = L.clientTouchpoints(S.all('deals'), { today, touches: lastTouchMap(), horizonDays: 730, criticalDates: S.all('criticalDates') });
    const rights = S.all('criticalDates');
    const q = f.q.trim().toLowerCase();
    const comps = S.all('comps')
      .filter((c) => !q || [c.building, c.address, c.city, c.submarket, c.tenant, c.landlord, c.notes].join(' ').toLowerCase().includes(q))
      .filter((c) => matchesAsset(c.assetClass, f.asset))
      .sort((a, b) => (b.signedDate || b.commencement || '').localeCompare(a.signedDate || a.commencement || ''));
    const head = '<thead><tr><th>Date</th><th>What</th><th>Client</th><th></th></tr></thead>';
    const dates = `
      <section class="card"><h2>Due now</h2><p class="hint">Check-ins with clients you closed (30 days after move-in, 6 months, then every year) and lease deadlines coming up. Logging a touch with the client clears a check-in; marking a right Exercised or Waived clears its reminder.</p>
        ${tp.due.length ? `<div class="table-wrap"><table class="tbl compact">${head}<tbody>${tp.due.map((p) => touchpointRow(p, true)).join('')}</tbody></table></div>` : emptyState('Nothing due.')}</section>
      <section class="card"><h2>Coming up (next 2 years)</h2>
        ${tp.upcoming.length ? `<div class="table-wrap"><table class="tbl compact">${head}<tbody>${tp.upcoming.map((p) => touchpointRow(p, false)).join('')}</tbody></table></div>` : emptyState('Add lease rights below, or commencement, expiration and option dates to your closed deals, to build this tracker.')}</section>
      <section class="card"><h2>Lease rights & options <span class="muted">${rights.length}</span> <button class="link more" data-action="new" data-col="criticalDates">+ Add</button></h2>
        <p class="hint">Renewal, termination, expansion and contraction options, ROFO/ROFR and other rights for any tenant: clients, prospects or companies you're watching.</p>
        ${rights.length ? criticalDatesTable(rights, true) : emptyState('None tracked yet. Add them here or from a company page.')}</section>`;
    // OpEx gets its own column once any comp has it.
    const showOpex = comps.some((c) => L.parseNumber(c.opex));
    const compTable = comps.length
      ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Building</th><th>Tenant</th><th>Asset</th><th>Type</th><th class="right">RSF</th><th>Signed</th><th class="right">Term</th><th class="right">Rent</th><th class="right">Esc.</th><th class="right">Free</th><th class="right">TI</th>${showOpex ? '<th class="right">OpEx</th>' : ''}<th>LXD</th><th>Source</th></tr></thead><tbody>${comps
          .map(
            (c) => `<tr class="clickable" data-action="edit" data-col="comps" data-id="${esc(c.id)}">
            <td><strong>${esc(c.building)}</strong>${c.confidential ? ' ' + badge('Confidential', 'red') : ''}<div class="sub">${esc([c.address, c.city, c.submarket].filter(Boolean).join(' · '))}</div>${c.clearHeight || c.yearBuilt || c.landlord ? `<div class="sub">${esc([c.clearHeight ? c.clearHeight + "' clear" : '', c.yearBuilt ? 'Built ' + c.yearBuilt : '', c.landlord ? 'LL: ' + c.landlord : ''].filter(Boolean).join(' · '))}</div>` : ''}</td>
            <td>${esc(c.tenant)}</td><td>${assetBadge(c.assetClass)}</td><td>${esc(c.dealType)}</td>
            <td class="right">${esc(L.fmtNumber(c.sf))}</td><td class="nowrap">${esc(L.fmtDate(c.signedDate))}</td>
            <td class="right">${c.termMonths ? esc(c.termMonths) + ' mo' : ''}</td>
            <td class="right nowrap">${c.startingRent ? '$' + esc(Number(c.startingRent).toFixed(2)) + ' <span class="muted">' + esc(String(c.rateBasis || '').replace(/\s*\(.*\)/, '')) + '</span>' : ''}</td>
            <td class="right nowrap">${c.escalationPct ? esc(c.escalationPct) + '%' : c.escalationPct === 0 || c.escalationPct === '0' ? '0% <span class="sub">flat</span>' : ''}</td><td class="right">${c.freeRentMonths ? esc(c.freeRentMonths) + ' mo' : ''}</td>
            <td class="right">${c.tiAllowance ? '$' + esc(c.tiAllowance) : ''}</td>${showOpex ? `<td class="right">${c.opex ? '$' + esc(Number(c.opex).toFixed(2)) : ''}</td>` : ''}<td class="nowrap">${compLXDCell(c)}</td><td>${esc(c.source)}</td></tr>`
          )
          .join('')}</tbody></table></div>`
      : S.all('comps').length
        ? emptyState('No comps match these filters.')
        : emptyState('No comps yet. Drop a comp spreadsheet below, open a closed deal and tap "Save as comp", or add one by hand.', '<button class="btn primary" data-action="new" data-col="comps">+ Comp</button>');
    const dropZone = `<div class="drop-zone" data-drop="comps"><strong>Drag an Excel or CSV comp sheet here</strong> <span class="muted">or</span> <button class="btn small" data-action="pick-file" data-kind="comps">Choose a file</button>
      <div class="sub">Columns like Building, Tenant, SF, Signed, Term, Rent, Escalations, Free Rent and TI are matched automatically. You review them before anything is saved.</div></div>`;
    return `
      <div class="page-head"><h1>Comps & Critical Dates</h1>
        <div class="actions"><button class="btn" data-action="new" data-col="criticalDates">+ Critical date</button><button class="help-btn${state.comps.help ? ' on' : ''}" data-action="toggle-comps-help" title="When to use Import comps vs Match a file" aria-expanded="${state.comps.help ? 'true' : 'false'}" aria-label="Help: importing comps">?</button><button class="btn" data-action="pick-file" data-kind="comps">Import comps</button><button class="btn" data-action="pick-file" data-kind="compsAlign" title="Compare the CRM with a comp sheet and fix what differs">Match a file</button><button class="btn" data-action="export-comps">Export comps</button><button class="btn primary" data-action="new" data-col="comps">+ Comp</button></div>
      </div>
      <div class="toolbar">
        <div class="seg">
          <button class="${f.tab === 'dates' ? 'on' : ''}" data-action="set-filter" data-scope="comps" data-key="tab" data-value="dates">Critical dates (${tp.due.length} due)</button>
          <button class="${f.tab === 'comps' ? 'on' : ''}" data-action="set-filter" data-scope="comps" data-key="tab" data-value="comps">Comps (${S.all('comps').length})</button>
          <button class="${f.tab === 'quotes' ? 'on' : ''}" data-action="set-filter" data-scope="comps" data-key="tab" data-value="quotes">Quoted rates (${Object.keys(S.settings().buildingRates || {}).length})</button>
        </div>
        ${f.tab === 'comps' ? assetTabs(f.asset, 'comps') + `<input type="search" placeholder="Search building, tenant, submarket…" value="${esc(f.q)}" data-filter="comps.q" id="f-comps-q" />` : ''}
        ${f.tab === 'quotes' ? `<input type="search" placeholder="Search a building…" value="${esc(f.q)}" data-filter="comps.q" id="f-comps-q" />` : ''}
      </div>
      ${state.comps.help ? compsHelp() : ''}
      ${f.tab === 'comps' ? compTable + dropZone : f.tab === 'quotes' ? quotedRates(f.q) : dates}`;
  }

  // ----- coach sidebar -----

  function renderCoach() {
    const panel = $('#coach');
    if (!panel) return;
    const tips = L.coachTips(
      { companies: S.all('companies'), contacts: S.all('contacts'), deals: S.all('deals'), activities: S.all('activities'), marketing: S.all('marketing') },
      { today: L.todayISO(), postsPerWeek: S.settings().postsPerWeek }
    );
    const open = tips.filter((t) => t.done === false).length;
    $('#coach-count').textContent = open || '';
    panel.hidden = !state.coach.open;
    document.body.classList.toggle('coach-open', Boolean(state.coach.open));
    if (!state.coach.open) return;
    panel.innerHTML = `<header><h2>Coach</h2><button class="icon-btn" data-action="toggle-coach" aria-label="Close">✕</button></header>
      <p class="hint">What's worked in your own outreach, and whether you're doing it. Each item re-checks itself as you update the CRM.</p>
      <ul class="coach-list">${tips
        .map(
          (t) => `<li class="${t.done === true ? 'done' : t.done === false ? 'todo' : 'info'}">
          <span class="coach-mark">${t.done === true ? '✓' : t.done === false ? '○' : '•'}</span>
          <div><strong>${esc(t.title)}</strong><div class="sub">${esc(t.detail)}</div><div class="coach-status">${esc(t.status)}</div></div></li>`
        )
        .join('')}</ul>`;
  }

  // ----- sortable columns (Companies and Leads) -----

  const byName = (a, b) => a.c.name.localeCompare(b.c.name);
  const rankIn = (list, v) => (v ? (list.indexOf(v) + 1 || list.length + 1) : '');
  // Expirations more than 6 months past are likely stale data, so they sort after current ones.
  const staleLXD = (r) => (r.c.leaseExpiration && r.c.leaseExpiration < L.addDays(L.todayISO(), -183) ? 1 : 0);
  // Never touched counts as the longest since touch.
  const lastTouchCol = { get: (r) => r.last || '0000' };
  const SORT_COLUMNS = {
    companies: {
      score: { get: (r) => r.score, desc: true },
      name: { get: (r) => r.c.name },
      asset: { get: (r) => r.c.assetClass },
      status: { get: (r) => rankIn(L.COMPANY_STATUSES, r.c.status) },
      submarket: { get: (r) => r.c.submarket },
      sf: { get: (r) => L.parseNumber(r.c.sfOccupied), desc: true },
      expiration: { get: (r) => r.c.leaseExpiration, group: staleLXD },
      lastTouch: lastTouchCol,
    },
    leads: {
      name: { get: (r) => r.c.name },
      stage: { get: (r) => rankIn(L.LEAD_STAGES, L.leadStage(r.c)) },
      temp: { get: (r) => rankIn(L.LEAD_TEMPS, r.c.leadTemp) },
      sf: { get: (r) => L.parseNumber(r.c.sfOccupied), desc: true },
      expiration: { get: (r) => r.c.leaseExpiration, group: staleLXD },
      lastTouch: lastTouchCol,
      score: { get: (r) => r.score, desc: true },
    },
    sharedList: {
      score: { get: (r) => L.parseNumber(r.c.research && r.c.research.score), desc: true },
      name: { get: (r) => r.c.name },
      status: { get: (r) => rankIn(LIST_STATUSES, r.c.listStatus || 'Researching') },
      lead: { get: (r) => r.c.listLead },
      contactedBy: { get: (r) => r.c.contactedBy },
      contact: { get: (r) => (r.p ? contactName(r.p) : '') },
      nextStep: { get: (r) => r.c.nextStepDate || r.c.nextStep },
      lastTouch: { get: (r) => r.c.lastContacted || '0000' },
    },
  };

  // ----- leads -----

  function leadList() {
    const f = state.leads;
    const touches = lastTouchMap();
    const inPipeline = new Set(S.all('deals').filter((d) => d.stage !== 'Closed Lost').map((d) => d.companyId));
    const all = S.all('companies').filter((c) => L.leadStage(c) && !inPipeline.has(c.id) && matchesAsset(c.assetClass, f.asset));
    const counts = {};
    all.forEach((c) => (counts[L.leadStage(c)] = (counts[L.leadStage(c)] || 0) + 1));
    const q = f.q.trim().toLowerCase();
    const rows = all
      .filter((c) => {
        const st = L.leadStage(c);
        if (f.stage === 'active' ? st === 'Dead Lead' : st !== f.stage) return false;
        if (f.temp && c.leadTemp !== f.temp) return false;
        return !q || [c.name, c.aliases, c.industry, c.address, c.building, c.submarket, c.tags].join(' ').toLowerCase().includes(q);
      })
      .map((c) => ({ c, last: touches[c.id] || '', score: scoreOf(c, touches) }));
    const sorted = L.sortRows(rows, SORT_COLUMNS.leads, SORT_COLUMNS.leads[f.sort] ? f.sort : 'expiration', f.dir, byName);
    return { rows: sorted, counts, total: all.length };
  }

  function viewLeads() {
    const f = state.leads;
    const { rows, counts, total } = leadList();
    const shown = rows.slice(0, f.limit || 100);
    const contactsBy = {};
    S.all('contacts').forEach((p) => (contactsBy[p.companyId] = contactsBy[p.companyId] || []).push(p));
    const chips = [{ value: 'active', label: 'All active', n: total - (counts['Dead Lead'] || 0) }].concat(L.LEAD_STAGES.map((st) => ({ value: st, label: st, n: counts[st] || 0 })));
    return `
      <div class="page-head"><h1>Leads</h1>
        <div class="actions"><button class="btn primary" data-action="new" data-col="companies">+ Lead</button></div>
      </div>
      <p class="hint">Companies you're working to win, before there's a deal. Mark one <strong>Secured Lead</strong> and a deal is created in the Pipeline under Intro Call.</p>
      <div class="seg wrap stage-chips">${chips
        .map((ch) => `<button class="${f.stage === ch.value ? 'on' : ''}" data-action="set-filter" data-scope="leads" data-key="stage" data-value="${esc(ch.value)}">${esc(ch.label)} <span class="muted">${ch.n}</span></button>`)
        .join('')}</div>
      <div class="toolbar">
        ${assetTabs(f.asset, 'leads')}
        <input type="search" placeholder="Search name, building, industry…" value="${esc(f.q)}" data-filter="leads.q" id="f-leads-q" />
        <select data-filter="leads.temp">${options(L.LEAD_TEMPS, f.temp, 'Any temperature')}</select>
        <select data-filter="leads.sort">${options(
          [
            { value: 'expiration', label: 'Sort: Lease expiration' },
            { value: 'lastTouch', label: 'Sort: Longest since touch' },
            { value: 'score', label: 'Sort: Prospect score' },
            { value: 'name', label: 'Sort: Name' },
            { value: 'stage', label: 'Sort: Stage' },
            { value: 'temp', label: 'Sort: Temperature' },
            { value: 'sf', label: 'Sort: Size (SF)' },
          ],
          f.sort
        )}</select>
      </div>
      <p class="count">${rows.length} leads</p>
      ${
        rows.length
          ? `<div class="table-wrap"><table class="tbl">
          <thead><tr>${sortHead('leads', 'name', 'Company')}<th>Asset</th>${sortHead('leads', 'stage', 'Stage')}${sortHead('leads', 'temp', 'Temp.')}${sortHead('leads', 'sf', 'RSF', 'right')}${sortHead('leads', 'expiration', 'Lease expiration')}${sortHead('leads', 'lastTouch', 'Last touch')}<th>Best contact</th></tr></thead>
          <tbody>${shown
            .map(({ c, last }) => {
              const p = (contactsBy[c.id] || []).slice().sort((a, b) => (b.role === 'Decision Maker') - (a.role === 'Decision Maker') || Boolean(b.email) - Boolean(a.email))[0];
              return `<tr data-href="#/company/${esc(c.id)}">
              <td><strong>${esc(c.name)}</strong> <span class="icon-row">${summarizeIcon('companies', c.id)}${emailIcon(c.id, p ? p.id : '')}</span><div class="sub">${esc([c.industry, c.building || c.address].filter(Boolean).join(' · '))}</div></td>
              <td>${inlineSelect('companies', c.id, 'assetClass', L.ASSET_CLASSES, c.assetClass, '—')}</td>
              <td><select class="inline" data-lead-stage="${esc(c.id)}">${options(L.LEAD_STAGES, L.leadStage(c))}</select></td>
              <td><select class="inline" data-lead-temp="${esc(c.id)}">${options(L.LEAD_TEMPS, c.leadTemp, '—')}</select></td>
              <td class="right">${editCell('companies', c.id, 'sfOccupied', 'number', c.sfOccupied, c.sfOccupied ? esc(L.fmtNumber(c.sfOccupied)) : '')}</td>
              <td>${editCell('companies', c.id, 'leaseExpiration', 'date', c.leaseExpiration, c.leaseExpiration ? expirationBadge(c.leaseExpiration) : '')}</td>
              <td>${last ? esc(L.fmtDate(last)) : '<span class="muted">Never</span>'}</td>
              <td>${p ? `${esc(contactName(p))}<div class="sub">${esc(p.title)}</div>` : '<span class="muted">None yet</span>'}</td></tr>`;
            })
            .join('')}</tbody></table></div>
          ${rows.length > shown.length ? `<div class="show-more"><span class="muted">Showing ${shown.length} of ${rows.length}</span> <button class="btn" data-action="show-more" data-scope="leads">Show ${Math.min(200, rows.length - shown.length)} more</button></div>` : ''}`
          : emptyState('No leads match these filters.')
      }`;
  }

  // ----- companies -----

  function filteredCompanies() {
    const f = state.companies;
    const touches = lastTouchMap();
    const q = f.q.trim().toLowerCase();
    let list = S.all('companies').filter((c) => {
      if (!matchesAsset(c.assetClass, f.asset)) return false;
      if (f.status === '__prospects') {
        if (!PROSPECT_STATUSES.includes(c.status)) return false;
      } else if (f.status && c.status !== f.status) return false;
      if (f.submarket && c.submarket !== f.submarket) return false;
      if (f.priority && c.priority !== f.priority) return false;
      if (f.window) {
        const w = L.expirationWindow(c.leaseExpiration);
        if (f.window === '0-24') {
          const m = L.monthsUntil(c.leaseExpiration);
          if (m === null || m < 0 || m > 24) return false;
        } else if (f.window === '0-36') {
          const m = L.monthsUntil(c.leaseExpiration);
          if (m === null || m < 0 || m > 36) return false;
        } else if (!w || w.key !== f.window) return false;
      }
      if (q) {
        const hay = [c.name, c.aliases, c.industry, c.address, c.building, c.city, c.submarket, c.landlord, c.tags, c.notes].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const withScore = list.map((c) => ({ c, score: scoreOf(c, touches), last: touches[c.id] || '' }));
    return L.sortRows(withScore, SORT_COLUMNS.companies, SORT_COLUMNS.companies[f.sort] ? f.sort : 'score', f.dir, byName);
  }

  // A search shouldn't come up empty because a filter (e.g. "Next 24 months") hides the company.
  function hiddenSearchMatches(shownCount) {
    const f = state.companies;
    const q = f.q.trim().toLowerCase();
    if (!q || !(f.status || f.submarket || f.priority || f.window || (f.asset && f.asset !== 'All'))) return '';
    const all = S.all('companies').filter((c) => [c.name, c.aliases, c.industry, c.address, c.building, c.city, c.submarket, c.landlord, c.tags, c.notes].join(' ').toLowerCase().includes(q)).length;
    const hidden = all - shownCount;
    return hidden > 0 ? `<p class="hint">${hidden} more compan${hidden > 1 ? 'ies match' : 'y matches'} "${esc(f.q.trim())}" but ${hidden > 1 ? 'are' : 'is'} hidden by your filters. <button class="link" data-action="clear-company-filters">Show all matches</button></p>` : '';
  }

  function companyTabs() {
    const f = state.companies;
    const lists = S.settings().sharedLists || [];
    if (!lists.length) return '';
    return `<div class="seg wrap">${[{ id: '', name: 'All companies' }]
      .concat(lists)
      .map((l) => `<button class="${(f.list || '') === l.id ? 'on' : ''}" data-action="set-filter" data-scope="companies" data-key="list" data-value="${esc(l.id)}">${esc(l.name)}${l.id ? ` <span class="muted">${S.all('companies').filter((c) => c.sharedList === l.id && !c.listRemoved).length}</span>` : ''}</button>`)
      .join('')}</div>`;
  }

  function viewSharedList(listId) {
    const f = state.companies;
    const list = (S.settings().sharedLists || []).find((l) => l.id === listId);
    if (!list) {
      f.list = '';
      return viewCompanies();
    }
    const q = f.q.trim().toLowerCase();
    const all = S.all('companies').filter((c) => c.sharedList === listId);
    const rows = all
      .filter((c) => (f.listStatus ? (f.listStatus === 'Removed' ? c.listRemoved : !c.listRemoved && c.listStatus === f.listStatus) : !c.listRemoved))
      .filter((c) => !q || [c.name, c.industry, c.listNotes, c.nextStep, c.hqCity, c.usHQ].join(' ').toLowerCase().includes(q))
      .map((c) => ({ c, p: c.listPrimaryContact ? S.get('contacts', c.listPrimaryContact) : null }));
    const ls = state.sharedList;
    const sorted = L.sortRows(rows, SORT_COLUMNS.sharedList, SORT_COLUMNS.sharedList[ls.sort] ? ls.sort : 'score', ls.dir, byName);
    const counts = {};
    all.forEach((c) => {
      const k = c.listRemoved ? 'Removed' : c.listStatus || 'Researching';
      counts[k] = (counts[k] || 0) + 1;
    });
    const statusCls = { 'Meeting set': 'green', Contacted: 'blue', 'Ready to contact': 'amber', 'Not a fit': 'red' };
    return `
      <div class="page-head"><div><h1>${esc(list.name)}</h1><div class="greeting-sub">Shared with your list partner through Google Sheets${list.lastSync ? ' · synced ' + esc(new Date(list.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : ''}</div></div>
        <div class="actions">${list.url ? `<button class="btn" data-action="sync-list" data-list="${esc(listId)}">Sync now</button>` : '<a class="btn" href="#/data">Connect the sheet</a>'}<button class="btn primary" data-action="new" data-col="companies" data-list="${esc(listId)}">+ Company</button></div>
      </div>
      ${companyTabs()}
      <div class="toolbar">
        <div class="seg wrap">${['', ...LIST_STATUSES, 'Removed']
          .filter((st) => !st || counts[st])
          .map((st) => `<button class="${(f.listStatus || '') === st ? 'on' : ''}" data-action="set-filter" data-scope="companies" data-key="listStatus" data-value="${esc(st)}">${esc(st || 'All')} <span class="muted">${st ? counts[st] : all.filter((c) => !c.listRemoved).length}</span></button>`)
          .join('')}</div>
        <input type="search" placeholder="Search company, industry, notes…" value="${esc(f.q)}" data-filter="companies.q" id="f-companies-q" />
      </div>
      ${
        rows.length
          ? `<div class="table-wrap"><table class="tbl"><thead><tr>${sortHead('sharedList', 'score', 'Score', 'right')}${sortHead('sharedList', 'name', 'Company')}${sortHead('sharedList', 'status', 'Status')}${sortHead('sharedList', 'lead', 'Lead')}${sortHead('sharedList', 'contactedBy', 'Contacted by')}${sortHead('sharedList', 'contact', 'Primary contact')}${sortHead('sharedList', 'nextStep', 'Next step')}${sortHead('sharedList', 'lastTouch', 'Last touch')}</tr></thead><tbody>${sorted
              .map(({ c, p }) => {
                return `<tr data-href="#/company/${esc(c.id)}">
                  <td class="right">${c.research && c.research.score ? `<strong>${esc(c.research.score)}</strong>` : '<span class="muted">—</span>'}</td>
                  <td><strong>${esc(c.name)}</strong> ${c.listRemoved ? badge('Removed from shared list', 'red') : ''}<div class="sub">${esc([c.industry, [c.hqCity, c.hqState || c.hqCountry].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</div></td>
                  <td>${badge(c.listStatus || 'Researching', statusCls[c.listStatus] || 'gray')}</td>
                  <td>${esc(c.listLead)}</td><td>${esc(c.contactedBy)}</td>
                  <td>${p ? esc(contactName(p)) + (p.title ? `<div class="sub">${esc(p.title)}</div>` : '') : '<span class="muted">—</span>'}</td>
                  <td>${esc(c.nextStep)}${c.nextStepDate ? `<div class="sub">${esc(L.fmtDate(c.nextStepDate))}</div>` : ''}</td>
                  <td>${c.lastContacted ? esc(L.fmtDate(c.lastContacted)) : '<span class="muted">Never</span>'}</td></tr>`;
              })
              .join('')}</tbody></table></div>`
          : emptyState(list.url ? 'No companies match.' : 'Connect the shared Google Sheet in Import / Settings to bring in the list.')
      }`;
  }

  function viewCompanies() {
    const f = state.companies;
    if (f.list) return viewSharedList(f.list);
    const rows = filteredCompanies();
    const shown = rows.slice(0, f.limit || 100);
    const totalSF = rows.reduce((t, r) => t + (L.parseNumber(r.c.sfOccupied) || 0), 0);
    const submarkets = distinct('companies', 'submarket');
    const windows = [{ value: '0-24', label: 'Next 24 months' }, { value: '0-36', label: 'Next 36 months' }].concat(
      L.EXPIRATION_WINDOWS.map((w) => ({ value: w.key, label: w.label }))
    );
    return `
      <div class="page-head"><h1>Companies & Prospects</h1>
        <div class="actions">
          <button class="btn" data-action="export-companies">Export CSV</button>
          <a class="btn" href="#/data">Import CSV</a>
          <button class="btn primary" data-action="new" data-col="companies">+ Company</button>
        </div>
      </div>
      ${companyTabs()}
      <div class="toolbar">
        ${assetTabs(f.asset, 'companies')}
        <input type="search" placeholder="Search name, address, landlord, tags…" value="${esc(f.q)}" data-filter="companies.q" id="f-companies-q" />
        <select data-filter="companies.status">${options([{ value: '__prospects', label: 'All prospects' }].concat(L.COMPANY_STATUSES), f.status, 'Any status')}</select>
        <select data-filter="companies.window">${options(windows, f.window, 'Any expiration')}</select>
        <select data-filter="companies.submarket">${options(submarkets, f.submarket, 'Any submarket')}</select>
        <select data-filter="companies.priority">${options(['A', 'B', 'C'], f.priority, 'Any priority')}</select>
        <select data-filter="companies.sort">${options(
          [
            { value: 'score', label: 'Sort: Prospect score' },
            { value: 'expiration', label: 'Sort: Lease expiration' },
            { value: 'sf', label: 'Sort: Size (SF)' },
            { value: 'lastTouch', label: 'Sort: Longest since touch' },
            { value: 'name', label: 'Sort: Name' },
            { value: 'status', label: 'Sort: Status' },
            { value: 'submarket', label: 'Sort: Submarket' },
            { value: 'asset', label: 'Sort: Asset' },
          ],
          f.sort
        )}</select>
      </div>
      <p class="count">${rows.length} companies · ${L.fmtNumber(totalSF)} SF</p>
      ${hiddenSearchMatches(rows.length)}
      ${
        rows.length
          ? `<div class="table-wrap"><table class="tbl">
          <thead><tr>${sortHead('companies', 'score', 'Score')}${sortHead('companies', 'name', 'Company')}${sortHead('companies', 'asset', 'Asset')}${sortHead('companies', 'status', 'Status')}${sortHead('companies', 'submarket', 'Submarket')}${sortHead('companies', 'sf', 'SF', 'right')}${sortHead('companies', 'expiration', 'Lease expiration')}${sortHead('companies', 'lastTouch', 'Last touch')}</tr></thead>
          <tbody>${shown
            .map(
              ({ c, score, last }) => `<tr data-href="#/company/${esc(c.id)}">
              <td>${scoreChip(score)}</td>
              <td><strong>${esc(c.name)}</strong> <span class="icon-row">${summarizeIcon('companies', c.id)}${emailIcon(c.id, '')}</span> ${c.priority ? badge(c.priority, 'prio') : ''}<div class="sub">${esc([c.industry, c.building || c.address].filter(Boolean).join(' · '))}</div></td>
              <td>${inlineSelect('companies', c.id, 'assetClass', L.ASSET_CLASSES, c.assetClass, '—')}</td>
              <td>${inlineSelect('companies', c.id, 'status', L.COMPANY_STATUSES, c.status, '—')}</td>
              <td>${editCell('companies', c.id, 'submarket', 'text', c.submarket, esc(c.submarket))}</td>
              <td class="right">${editCell('companies', c.id, 'sfOccupied', 'number', c.sfOccupied, esc(L.fmtNumber(c.sfOccupied)))}</td>
              <td>${editCell('companies', c.id, 'leaseExpiration', 'date', c.leaseExpiration, c.leaseExpiration ? expirationBadge(c.leaseExpiration) : '')}${shouldBeInMarket(c) ? ' <span class="flag" title="Inside typical lead time and not engaged">⚑</span>' : ''}</td>
              <td>${last ? esc(L.fmtDate(last)) : '<span class="muted">Never</span>'}</td></tr>`
            )
            .join('')}</tbody></table></div>
          ${rows.length > shown.length ? `<div class="show-more"><span class="muted">Showing ${shown.length} of ${rows.length}</span> <button class="btn" data-action="show-more">Show ${Math.min(200, rows.length - shown.length)} more</button></div>` : ''}`
          : emptyState('No companies match these filters.')
      }`;
  }

  function viewCompany(id) {
    const c = S.get('companies', id);
    if (!c) return emptyState('Company not found. <a href="#/companies">Back to list</a>');
    const touches = lastTouchMap();
    const { score, breakdown } = L.prospectScore(c, { lastActivityDate: touches[c.id] });
    const contacts = S.all('contacts').filter((x) => x.companyId === id).sort((a, b) => !!b.keyContact - !!a.keyContact);
    const deals = S.all('deals').filter((x) => x.companyId === id);
    const acts = S.all('activities')
      .filter((x) => x.companyId === id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const m = L.monthsUntil(c.leaseExpiration);
    const start = processStartDate(c);
    const lead = L.recommendedLeadTimeMonths(c.sfOccupied);
    const annualRent = (L.parseNumber(c.sfOccupied) || 0) * (L.parseNumber(c.currentRate) || 0) * (/\/mo/.test(c.rateBasis || '') ? 12 : 1);

    const info = [
      ['Also known as', c.aliases],
      ['Industry', c.industry],
      ['Address', [c.address, c.floor].filter(Boolean).join(', ')],
      ['Building', c.building],
      ['Market / submarket', [c.city, c.submarket].filter(Boolean).join(' · ')],
      ['SF occupied', L.fmtNumber(c.sfOccupied)],
      ['Headcount', L.fmtNumber(c.headcount)],
      ['SF / person', c.sfOccupied && c.headcount ? Math.round(c.sfOccupied / c.headcount) : ''],
      ['Landlord', c.landlord],
      ['Current rent', c.currentRate ? '$' + c.currentRate + ' ' + (c.rateBasis || '') : ''],
      ['Est. annual rent', annualRent ? L.fmtMoney(annualRent) : ''],
      ['Clear height', c.clearHeight ? c.clearHeight + ' ft' : ''],
      ['Dock doors', c.dockDoors],
      ['Lease options', c.leaseOptions],
      ['Growth signal', c.growthSignal],
      ['Lead source', c.source],
      ['Last contacted', L.fmtDate(c.lastContacted)],
      ['Company size (ZoomInfo)', c.ziEmployees ? L.fmtNumber(c.ziEmployees) + ' employees company-wide' + (c.ziHQ ? ' · HQ ' + c.ziHQ : '') : ''],
      ['ZoomInfo industry', c.ziIndustry],
      ['Website', c.website ? `<a href="${esc(/^https?:/.test(c.website) ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener">${esc(c.website)}</a>` : '', true],
      ['Tags', c.tags],
      ['HubSpot', c.hubspotUrl ? `<a href="${esc(c.hubspotUrl)}" target="_blank" rel="noopener">Open record ↗</a>` : '', true],
    ].filter((r) => r[1] !== '' && r[1] !== undefined && r[1] !== null);

    return `
      <div class="crumbs"><a href="#/companies">Companies</a> /</div>
      <div class="page-head">
        <div><h1>${esc(c.name)} ${emailIcon(id, '')}</h1>
          <div class="head-badges">${!L.isProspect(c) ? badge(c.relationship, 'blue') + ' ' : ''}${assetBadge(c.assetClass)} ${statusBadge(c.status)} ${leadBadge(c)} ${c.priority ? badge('Priority ' + c.priority, 'prio') : ''} ${scoreChip(score)}</div>
        </div>
        <div class="actions">
          <button class="btn primary" data-action="draft-email" data-company="${esc(id)}">Draft email</button>
          <button class="btn" data-action="new" data-col="activities" data-company="${esc(id)}" data-task="1">+ Task</button>
          <button class="btn" data-action="new" data-col="activities" data-company="${esc(id)}">Log activity</button>
          <button class="btn" data-action="new" data-col="contacts" data-company="${esc(id)}">+ Contact</button>
          <button class="btn" data-action="new" data-col="deals" data-company="${esc(id)}">+ Deal</button>
          <button class="btn" data-action="edit" data-col="companies" data-id="${esc(id)}">Edit</button>
          <button class="btn" data-action="merge-company" data-company="${esc(id)}" title="Merge this duplicate into another company">Merge</button>
          <button class="btn danger" data-action="delete" data-col="companies" data-id="${esc(id)}">Delete</button>
        </div>
      </div>
      ${tasksCard(openFollowUps().filter((a) => a.companyId === id), `data-company="${esc(id)}"`)}
      <div class="grid3">
        <section class="card">
          <h2>Lease timing</h2>
          ${
            c.leaseExpiration
              ? `<div class="big">${esc(L.fmtDate(c.leaseExpiration))}</div>
                 <p>${m < 0 ? `Expired ${Math.abs(m)} months ago — confirm renewal or holdover.` : `<strong>${m}</strong> months remaining.`}</p>
                 <p class="hint">At ${c.sfOccupied ? L.fmtNumber(c.sfOccupied) + ' SF' : 'this size'}, tenants typically start ~${lead} months out.
                 ${start ? `Process should start by <strong>${esc(L.fmtDate(start))}</strong>.` : ''}</p>
                 ${shouldBeInMarket(c) ? '<p class="flag-line">⚑ Inside the lead-time window and not yet engaged.</p>' : ''}`
              : `<p class="muted">Unknown expiration. Find it out — it's the #1 driver of timing.</p>`
          }
        </section>
        <section class="card">
          <h2>Prospect score: ${score}</h2>
          <table class="tbl compact"><tbody>
            <tr><td>Lease timing</td><td class="right">${breakdown.timing} / 40</td></tr>
            <tr><td>Size</td><td class="right">${breakdown.size} / 25</td></tr>
            <tr><td>Growth signal</td><td class="right">${breakdown.growth} / 15</td></tr>
            <tr><td>Priority</td><td class="right">${breakdown.priority} / 10</td></tr>
            <tr><td>Coverage gap</td><td class="right">${breakdown.coverage} / 10</td></tr>
          </tbody></table>
        </section>
        <section class="card">
          <h2>Details</h2>
          <dl class="info">${info.map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`).join('')}</dl>
        </section>
      </div>
      <section class="card">${notesCard('companies', c)}</section>
      ${marketSnapshotCard(c)}
      ${sharedListCard(c)}
      ${criticalDatesCard(id)}

      <div class="grid2">
        <section class="card">
          <h2>Contacts <button class="link more" data-action="link-contact" data-company="${esc(id)}">+ Add</button></h2>
          ${
            contacts.length
              ? `<table class="tbl compact"><tbody>${contacts
                  .map(
                    (p) => `<tr><td><button class="star ${p.keyContact ? 'on' : ''}" data-action="toggle-key" data-id="${esc(p.id)}" title="${p.keyContact ? 'Main point of contact' : 'Make main point of contact'}">${p.keyContact ? '★' : '☆'}</button><strong>${esc(contactName(p))}</strong> ${p.role ? badge(p.role, p.role === 'Decision Maker' ? 'green' : 'gray') : ''} ${verificationBadge(p.verification)}<div class="sub">${esc(p.title)}</div>${p.notes ? `<div class="sub clamp" title="${esc(p.notes)}">${esc(p.notes)}</div>` : ''}</td>
                    <td>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}<div class="sub">${phoneLink(p.phone, p.phoneDNC)}${p.mobile ? ' · ' + phoneLink(p.mobile, p.mobileDNC, '(m)') : ''}</div>${p.linkedin ? `<div class="sub"><a href="${esc(p.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a></div>` : ''}</td>
                    <td class="right nowrap">${p.email ? `<button class="icon-btn" data-action="draft-email" data-company="${esc(id)}" data-contact="${esc(p.id)}" title="Draft an email from a template">Email</button>` : ''}<button class="icon-btn" data-action="new" data-col="activities" data-company="${esc(id)}" data-contact="${esc(p.id)}" title="Log activity">Log</button><button class="icon-btn" data-action="edit" data-col="contacts" data-id="${esc(p.id)}" title="Edit">✎</button></td></tr>`
                  )
                  .join('')}</tbody></table>`
              : emptyState('No contacts yet.', `<button class="btn" data-action="link-contact" data-company="${esc(id)}">+ Add a contact</button>`)
          }
        </section>
        <section class="card">
          <h2>Deals <button class="link more" data-action="new" data-col="deals" data-company="${esc(id)}">+ Add</button></h2>
          ${deals.length ? dealMiniTable(deals) : emptyState('No deals yet.')}
        </section>
      </div>

      ${documentsCard(S.all('documents').filter((x) => x.companyId === id), { company: id })}
      <section class="card">
        <h2>Activity <button class="link more" data-action="new" data-col="activities" data-company="${esc(id)}">+ Log</button></h2>
        ${acts.length ? activityTimeline(acts) : emptyState('No activity logged yet.')}
      </section>`;
  }

  function sharedListCard(c) {
    const list = (S.settings().sharedLists || []).find((l) => l.id === c.sharedList);
    if (!list) return '';
    const r = c.research || {};
    const rows = [
      ['Status', c.listStatus],
      ['Lead', c.listLead],
      ['Contacted by', c.contactedBy],
      ['Next step', [c.nextStep, L.fmtDate(c.nextStepDate)].filter(Boolean).join(' · ')],
      ['HQ', [c.hqCity, c.hqState, c.hqCountry].filter(Boolean).join(', ')],
      ['US HQ', c.usHQ],
      ['Local presence', c.localPresence],
      ['Foreign-owned', c.foe],
      ['Intro via', c.introVia],
      ['Shared notes', c.listNotes],
    ].filter((x) => x[1]);
    const research = [
      ['Score', r.score ? r.score + (r.rank ? ` (rank ${r.rank})` : '') + (r.confidence ? ` · ${r.confidence} confidence` : '') : ''],
      ['Likely Atlanta operation', r.operation],
      ['Approach', r.approach],
      ['Recruitment angle', r.angle],
      ['Atlanta fit', r.fit],
      ['Submarkets to screen', r.submarkets],
      ['Evidence', r.evidence],
      ['Risk', r.risk],
    ].filter((x) => x[1]);
    return `<section class="card"><h2>${esc(list.name)} ${c.listRemoved ? badge('Removed from shared list', 'red') : ''}<button class="link more" data-action="edit" data-col="companies" data-id="${esc(c.id)}">Edit</button></h2>
      <p class="hint">These fields sync both ways with the shared Google Sheet. Your other CRM details stay private.</p>
      ${rows.length ? `<dl class="info">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${research.length ? `<h3 class="form-section">Prospect research</h3><dl class="info">${research.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    </section>`;
  }

  // Spaces a building offers (entered, or estimated from its ratio and the space's size) against what the deal needs.
  function parkingCell(p, d) {
    const ratio = L.parseNumber(p.parkingRatio);
    const sf = L.parseNumber(p.availableSF);
    const spaces = L.parseNumber(p.parkingSpaces) || (ratio && sf ? Math.floor((ratio * sf) / 1000) : null);
    if (!spaces) return ratio ? esc(ratio) + '/1,000' : '';
    const need = L.parseNumber(d.parkingSpaces);
    const label = (L.parseNumber(p.parkingSpaces) ? '' : '~') + L.fmtNumber(spaces);
    const title = L.parseNumber(p.parkingSpaces) ? 'Spaces offered' : `Estimated from ${ratio}/1,000 SF on ${L.fmtNumber(sf)} SF`;
    return need && spaces < need ? `<span title="${esc(title)}">${badge(label + ' (need ' + L.fmtNumber(need) + ')', 'red')}</span>` : `<span title="${esc(title)}">${esc(label)}</span>`;
  }

  function dealTermsCard(d) {
    const rate = d.finalRate ? '$' + Number(d.finalRate).toFixed(2) + ' ' + String(d.finalRateBasis || d.rateBasis || '').replace(/\s*\(.*\)/, '') : '';
    const rows = [
      ['Lease executed', L.fmtDate(d.closedDate)],
      ['Commencement', L.fmtDate(d.leaseCommencement)],
      ['Lease expiration (LXD)', L.fmtDate(L.dealLXD(d)) + (d.newLeaseExpiration || !L.dealLXD(d) ? '' : ' (calculated)')],
      ['Size', L.dealSizeLabel(d) + (d.actualOfficeSF ? ' · ' + L.fmtNumber(d.actualOfficeSF) + ' SF office' : '')],
      ['Starting rent', rate],
      ['Term', d.finalTermMonths ? d.finalTermMonths + ' months' : ''],
      ['Escalations', d.finalEscalationPct ? d.finalEscalationPct + '% / yr' : ''],
      ['Free rent', d.finalFreeRentMonths ? d.finalFreeRentMonths + ' months' : ''],
      ['TI allowance', d.finalTiAllowance ? '$' + d.finalTiAllowance + '/SF' : ''],
      ['Options', d.finalOptions],
      ['Renewal notice deadline', L.fmtDate(d.renewalNoticeDate)],
      ['Termination option', L.fmtDate(d.terminationOptionDate)],
      ['Other', d.finalOtherTerms],
    ].filter((r) => r[1]);
    if (d.stage !== 'Closed Won' && rows.length <= 1) return '';
    return `<section class="card"><h2>Final lease terms <button class="link more" data-action="edit" data-col="deals" data-id="${esc(d.id)}">Edit</button></h2>
      ${rows.length ? `<dl class="info">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${!L.dealLXD(d) ? '<p class="hint">Add the commencement date and term (or the LXD) so renewal planning and check-ins land on your calendar. Or send me the final LOI or lease and I\'ll fill this in.</p>' : ''}</section>`;
  }

  function documentsCard(docs, ctx) {
    const attrs = `data-col="documents"${ctx.deal ? ` data-deal="${esc(ctx.deal)}"` : ''}${ctx.company ? ` data-company="${esc(ctx.company)}"` : ''}`;
    return `<section class="card"><h2>Documents <button class="link more" data-action="new" ${attrs}>+ Add link</button></h2>
      ${
        docs.length
          ? `<table class="tbl compact"><tbody>${docs
              .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
              .map(
                (x) => `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener"><strong>${esc(x.name)}</strong> ↗</a> ${badge(x.kind, 'gray')} ${x.shareable ? badge('Shareable', 'green') : ''}${x.notes ? `<div class="sub">${esc(x.notes)}</div>` : ''}</td>
                <td class="nowrap">${esc(L.fmtDate(x.date))}</td>
                <td class="right nowrap"><button class="icon-btn" data-action="copy-link" data-url="${esc(x.url)}" title="Copy link to share">⧉</button><button class="icon-btn" data-action="edit" data-col="documents" data-id="${esc(x.id)}" title="Edit">✎</button><button class="icon-btn" data-action="delete" data-col="documents" data-id="${esc(x.id)}" title="Delete">✕</button></td></tr>`
              )
              .join('')}</tbody></table>`
          : emptyState('No documents yet. Save the LOI, lease and amendments to OneDrive or SharePoint and add the link here.')
      }</section>`;
  }

  function dealMiniTable(deals) {
    return `<table class="tbl compact"><tbody>${deals
      .map((d) => {
        const est = L.estimatedCommission(d);
        return `<tr data-href="#/deal/${esc(d.id)}"><td><strong>${esc(d.name)}</strong><div class="sub">${esc([d.dealType, d.estSF ? L.fmtNumber(d.estSF) + ' SF' : ''].filter(Boolean).join(' · '))}</div></td>
          <td>${badge(d.stage, d.stage === 'Closed Won' ? 'green' : d.stage === 'Closed Lost' ? 'red' : 'blue')}</td>
          <td class="right">${L.fmtMoney(est.myShare, true)}</td></tr>`;
      })
      .join('')}</tbody></table>`;
  }

  function activityTimeline(acts) {
    return `<ul class="timeline">${acts
      .map((a) => {
        const contact = S.get('contacts', a.contactId);
        const deal = S.get('deals', a.dealId);
        const due = activityDue(a);
        return `<li>
          <div class="tl-date">${esc(L.fmtDate(a.date))}</div>
          <div class="tl-body">
            <div>${badge(a.type, 'gray')} <strong>${esc(a.subject)}</strong>
              <button class="icon-btn" data-action="edit" data-col="activities" data-id="${esc(a.id)}" title="Edit">✎</button></div>
            <div class="sub">${[contact ? esc(contactName(contact)) : '', deal ? `<a href="#/deal/${esc(deal.id)}">${esc(deal.name)}</a>` : ''].filter(Boolean).join(' · ')}</div>
            ${a.notes ? `<p class="pre">${esc(a.notes)}</p>` : ''}
            ${a.body ? `<details class="email-full"><summary>Show full ${a.type === 'Note' ? 'note' : 'email'}</summary><div class="pre email-body">${esc(a.body)}</div></details>` : ''}
            ${due ? `<div class="sub">Follow-up ${esc(L.fmtDate(due))} ${a.done ? badge('done', 'green') : due < L.todayISO() ? badge('overdue', 'red') : badge('open', 'amber')}</div>` : ''}
          </div></li>`;
      })
      .join('')}</ul>`;
  }

  // ----- contacts -----

  function viewContacts() {
    const q = state.contacts.q.trim().toLowerCase();
    const touches = {};
    S.all('contacts').forEach((c) => {
      if (c.lastContacted) touches[c.id] = c.lastContacted;
    });
    S.all('activities').forEach((a) => {
      if (a.contactId && (!touches[a.contactId] || a.date > touches[a.contactId])) touches[a.contactId] = a.date;
    });
    const list = S.all('contacts')
      .filter((c) => !q || [contactName(c), c.title, c.email, companyName(c.companyId), c.notes].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.lastName || a.firstName || '').localeCompare(b.lastName || b.firstName || ''));
    return `
      <div class="page-head"><h1>Contacts</h1>
        <div class="actions">
          <button class="btn" data-action="export-contacts">Export CSV</button>
          <a class="btn" href="#/data">Import CSV</a>
          <button class="btn primary" data-action="new" data-col="contacts">+ Contact</button>
        </div>
      </div>
      <div class="toolbar"><input type="search" placeholder="Search name, title, company, email…" value="${esc(state.contacts.q)}" data-filter="contacts.q" id="f-contacts-q" /></div>
      <p class="count">${list.length} contacts</p>
      ${
        list.length
          ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Email</th><th>Phone</th><th>Last touch</th><th></th></tr></thead><tbody>
          ${list
            .map(
              (c) => `<tr>
              <td><strong>${esc(contactName(c))}</strong> ${verificationBadge(c.verification)}<div class="sub">${esc(c.title)}</div></td>
              <td>${linkCompany(c.companyId)}</td>
              <td>${inlineSelect('contacts', c.id, 'role', FIELDS.contacts.find((x) => x.key === 'role').options, c.role, '—')}</td>
              <td>${editCell('contacts', c.id, 'email', 'email', c.email, esc(c.email))}${c.email ? ` <a class="icon-btn" href="mailto:${esc(c.email)}" title="Email">↗</a>` : ''}</td>
              <td class="nowrap">${editCell('contacts', c.id, 'phone', 'tel', c.phone, c.phone ? esc(c.phone) + (c.phoneDNC ? ' ' + badge('DNC', 'red') : '') : '')}${c.mobile ? `<div class="sub">${phoneLink(c.mobile, c.mobileDNC, '(m)')}</div>` : ''}</td>
              <td>${touches[c.id] ? esc(L.fmtDate(touches[c.id])) : '<span class="muted">Never</span>'}</td>
              <td class="right nowrap">${c.linkedin ? `<a class="icon-btn" href="${esc(c.linkedin)}" target="_blank" rel="noopener" title="LinkedIn">in</a>` : ''}
                <button class="icon-btn" data-action="new" data-col="activities" data-company="${esc(c.companyId)}" data-contact="${esc(c.id)}" title="Log activity">Log</button>
                <button class="icon-btn" data-action="edit" data-col="contacts" data-id="${esc(c.id)}" title="Edit">✎</button>
                <button class="icon-btn" data-action="delete" data-col="contacts" data-id="${esc(c.id)}" title="Delete">✕</button></td></tr>`
            )
            .join('')}</tbody></table></div>`
          : emptyState('No contacts found.')
      }`;
  }

  // ----- pipeline -----

  function viewPipeline() {
    const f = state.pipeline;
    const deals = S.all('deals').filter((d) => matchesAsset(d.assetClass, f.asset));
    const stages = L.DEAL_STAGES.map((s) => s.name).filter((s) => f.showClosed || L.OPEN_STAGES.includes(s));
    const open = deals.filter((d) => L.OPEN_STAGES.includes(d.stage));
    const openComm = open.reduce((t, d) => t + L.estimatedCommission(d).myShare, 0);
    const weighted = open.reduce((t, d) => t + L.weightedCommission(d), 0);
    const openSF = open.reduce((t, d) => t + (L.parseNumber(d.estSF || d.sfMax || d.sfMin) || 0), 0);

    let body;
    if (!deals.length) body = emptyState('No deals yet.', '<button class="btn primary" data-action="new" data-col="deals">+ Deal</button>');
    else if (f.view === 'board') {
      body = `<div class="board">${stages
        .map((stage) => {
          // Newest to the stage first (deals from before this was tracked fall back to when they were added).
          const since = (d) => d.stageChangedAt || d.createdAt || '';
          const inStage = deals.filter((d) => d.stage === stage).sort((a, b) => since(b).localeCompare(since(a)));
          const total = inStage.reduce((t, d) => t + L.estimatedCommission(d).myShare, 0);
          return `<div class="col" data-stage="${esc(stage)}">
            <div class="col-head"><strong>${esc(stage)}</strong><span class="muted">${inStage.length} · ${L.fmtMoney(total, true)}</span></div>
            ${inStage
              .map((d) => {
                const est = L.estimatedCommission(d);
                return `<a class="deal-card" draggable="true" data-deal="${esc(d.id)}" href="#/deal/${esc(d.id)}">
                  <div class="dc-title"><span>${esc(d.name)}</span><span class="icon-row">${summarizeIcon('deals', d.id)}${L.OPEN_STAGES.includes(d.stage) ? emailIcon(d.companyId, '', { deal: d.id }) : ''}</span></div>
                  <div class="sub">${esc(companyName(d.companyId))}${d.partnerBrokers ? ' · with ' + esc(d.partnerBrokers) : ''}</div>
                  <div class="dc-meta">${assetBadge(d.assetClass)} ${L.dealSizeLabel(d) ? `<span>${esc(L.dealSizeLabel(d))}${L.dealOfficeLabel(d) ? ' · ' + esc(L.dealOfficeLabel(d)) : ''}</span>` : badge('Add RSF', 'amber')}</div>
                  <div class="dc-meta"><strong>${L.fmtMoney(est.myShare, true)}</strong><span class="muted">${L.dealProbability(d)}%</span>${d.targetClose ? `<span class="muted">${esc(L.fmtDate(d.targetClose))}</span>` : ''}</div>
                </a>`;
              })
              .join('')}
          </div>`;
        })
        .join('')}</div>
        <p class="hint">Drag cards between columns to change stage.</p>`;
    } else {
      const sorted = deals.slice().sort((a, b) => L.DEAL_STAGES.findIndex((s) => s.name === a.stage) - L.DEAL_STAGES.findIndex((s) => s.name === b.stage));
      body = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Deal</th><th>Type</th><th>Asset</th><th>Stage</th><th class="right">SF</th><th class="right">Agg. value</th><th class="right">Commission (mine)</th><th class="right">Prob.</th><th>Target close</th></tr></thead><tbody>
        ${sorted
          .map((d) => {
            const est = L.estimatedCommission(d);
            return `<tr data-href="#/deal/${esc(d.id)}"><td><strong>${esc(d.name)}</strong> ${L.OPEN_STAGES.includes(d.stage) ? emailIcon(d.companyId, '', { deal: d.id }) : ''}<div class="sub">${esc(companyName(d.companyId))}</div></td>
              <td>${inlineSelect('deals', d.id, 'dealType', L.DEAL_TYPES, d.dealType, '—')}</td><td>${inlineSelect('deals', d.id, 'assetClass', L.ASSET_CLASSES, d.assetClass)}</td><td>${inlineSelect('deals', d.id, 'stage', L.DEAL_STAGES.map((x) => x.name), d.stage)}</td>
              <td class="right nowrap">${esc(L.dealSizeLabel(d)) || badge('Add RSF', 'amber')}${L.dealOfficeLabel(d) ? `<div class="sub">${esc(L.dealOfficeLabel(d))}</div>` : ''}</td>
              <td class="right">${L.fmtMoney(est.aggregateValue, true)}</td>
              <td class="right">${L.fmtMoney(est.myShare)}</td>
              <td class="right">${L.dealProbability(d)}%</td>
              <td>${editCell('deals', d.id, 'targetClose', 'date', d.targetClose, esc(L.fmtDate(d.targetClose)))}</td></tr>`;
          })
          .join('')}</tbody></table></div>`;
    }

    return `
      <div class="page-head"><h1>Deal Pipeline</h1>
        <div class="actions">
          <button class="btn" data-action="export-deals">Export CSV</button>
          <button class="btn primary" data-action="new" data-col="deals">+ Deal</button>
        </div>
      </div>
      <div class="toolbar">
        ${assetTabs(f.asset, 'pipeline')}
        <div class="seg">
          <button class="${f.view === 'board' ? 'on' : ''}" data-action="set-filter" data-scope="pipeline" data-key="view" data-value="board">Board</button>
          <button class="${f.view === 'table' ? 'on' : ''}" data-action="set-filter" data-scope="pipeline" data-key="view" data-value="table">Table</button>
        </div>
        <label class="check"><input type="checkbox" data-filter="pipeline.showClosed" ${f.showClosed ? 'checked' : ''}/> Show closed</label>
      </div>
      <p class="count">${open.length} open deals · ${L.fmtNumber(openSF)} SF · ${L.fmtMoney(openComm)} est. commission · ${L.fmtMoney(weighted)} weighted</p>
      ${body}`;
  }

  function viewDeal(id) {
    const d = S.get('deals', id);
    if (!d) return emptyState('Deal not found. <a href="#/pipeline">Back to pipeline</a>');
    const est = L.estimatedCommission(d);
    const prob = L.dealProbability(d);
    const props = S.all('properties').filter((p) => p.dealId === id);
    const acts = S.all('activities')
      .filter((a) => a.dealId === id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    // The company's other activity (not tied to any deal) is shown too, so nothing is hidden.
    const companyActs = S.all('activities')
      .filter((a) => a.companyId === d.companyId && !a.dealId)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const isInd = d.assetClass !== 'Office';
    const isOff = d.assetClass !== 'Industrial';

    const reqs = [
      ['Deal type', d.dealType],
      ['Size', L.dealSizeLabel(d) || 'RSF not set yet'],
      ...(L.dealOfficeLabel(d) ? [['Office portion', L.dealOfficeLabel(d)]] : []),
      ['Budget', `${inlineSelect('deals', d.id, 'budgetUnit', [{ value: 'Per RSF', label: '$/SF per year' }, { value: 'Total per month', label: 'Monthly budget' }], d.budgetUnit || 'Per RSF')} ${editCell('deals', d.id, 'budgetRate', 'number', d.budgetRate, d.budgetRate ? esc(L.dealBudgetLabel(d)) : '')}`, true],
      ['Est. deal SF', L.fmtNumber(d.estSF)],
      ['Target submarkets', d.targetSubmarkets],
      ['Target occupancy', L.fmtDate(d.targetOccupancy)],
      ['Planned headcount', isOff ? L.fmtNumber(d.headcountTarget) : ''],
      ['Parking', d.parkingSpaces ? L.fmtNumber(d.parkingSpaces) + ' spaces' : d.parkingRatio ? d.parkingRatio + ' / 1,000 SF' : ''],
      ['Min clear height', isInd && d.clearHeightMin ? d.clearHeightMin + ' ft' : ''],
      ['Dock doors', isInd ? d.dockDoors : ''],
      ['Drive-ins', isInd ? d.driveIns : ''],
      ['Power', isInd ? d.power : ''],
      ['Rep agreement', d.repAgreementSigned ? 'Signed' + (d.repAgreementExpires ? ', expires ' + L.fmtDate(d.repAgreementExpires) : '') : 'Not signed'],
      ['Target execution', L.fmtDate(d.targetClose)],
      ['Closed', L.fmtDate(d.closedDate)],
      ['Lost reason', d.lostReason],
    ].filter((r) => r[1] !== '' && r[1] !== undefined && r[1] !== null);

    return `
      <div class="crumbs"><a href="#/pipeline">Pipeline</a> / ${linkCompany(d.companyId)} /</div>
      <div class="page-head">
        <div><h1>${esc(d.name)} ${emailIcon(d.companyId, '', { deal: id })}</h1><div class="head-badges">${assetBadge(d.assetClass)} ${badge(d.dealType, 'gray')} ${badge(d.stage, 'blue')} ${L.dealLXD(d) ? badge('LXD ' + L.fmtDate(L.dealLXD(d)), 'amber') : d.stage === 'Closed Won' ? badge('Add LXD', 'red') : ''}</div>
          ${d.partnerBrokers || d.otherBrokers ? `<div class="sub">With ${esc([d.partnerBrokers, d.otherBrokers].filter(Boolean).join(' · also '))}</div>` : ''}</div>
        <div class="actions">
          <button class="btn" data-action="new" data-col="activities" data-company="${esc(d.companyId)}" data-deal="${esc(id)}" data-task="1">+ Task</button>
          <button class="btn" data-action="new" data-col="activities" data-company="${esc(d.companyId)}" data-deal="${esc(id)}">Log activity</button>
          ${d.stage === 'Closed Won' ? `<button class="btn" data-action="deal-to-comp" data-id="${esc(id)}">Save as comp</button>` : ''}
          <button class="btn" data-action="edit" data-col="deals" data-id="${esc(id)}">Edit</button>
          <button class="btn danger" data-action="delete" data-col="deals" data-id="${esc(id)}">Delete</button>
        </div>
      </div>
      <div class="stepper">${L.DEAL_STAGES.map(
        (s) => `<button class="${s.name === d.stage ? 'on' : ''} ${s.name === 'Closed Lost' ? 'lost' : ''}" data-action="set-stage" data-id="${esc(id)}" data-stage="${esc(s.name)}">${esc(s.name)}</button>`
      ).join('')}</div>
      ${tasksCard(openFollowUps().filter((a) => a.dealId === id), `data-company="${esc(d.companyId)}" data-deal="${esc(id)}"`)}
      ${S.all('criticalDates').some((r) => r.companyId === d.companyId) ? criticalDatesCard(d.companyId, id) : ''}

      <div class="grid3">
        <section class="card">
          <h2>Commission estimate</h2>
          <div class="big">${L.fmtMoney(est.myShare)}</div>
          <p class="sub">my share · ${L.fmtMoney((est.myShare * prob) / 100)} weighted at ${prob}%</p>
          <table class="tbl compact"><tbody>
            <tr><td>Deal SF</td><td class="right">${esc(L.fmtNumber(d.estSF || d.sfMax || d.sfMin) || '—')}</td></tr>
            <tr><td>Rent</td><td class="right">${d.budgetRate ? (L.isMonthlyTotal(d) ? '$' + esc(L.fmtNumber(d.budgetRate)) + '/mo total' : '$' + esc(d.budgetRate) + esc(rateUnit(d.rateBasis))) : '—'}</td></tr>
            <tr><td>Term</td><td class="right">${d.termMonths ? esc(d.termMonths) + ' mo' : '—'}</td></tr>
            <tr><td>Escalations</td><td class="right">${d.escalationPct ? esc(d.escalationPct) + '%/yr' : '—'}</td></tr>
            <tr><td>Free rent</td><td class="right">${d.freeRentMonths ? esc(d.freeRentMonths) + ' mo' : '—'}</td></tr>
            <tr><td>Aggregate rent</td><td class="right">${L.fmtMoney(est.aggregateValue)}</td></tr>
            <tr><td>Commission ${L.parseNumber(d.commissionOverride) !== null ? '(override)' : '@ ' + esc(d.commissionPct || 0) + '%'}</td><td class="right">${L.fmtMoney(est.commission)}</td></tr>
            <tr><td>My split</td><td class="right">${esc(L.parseNumber(d.splitPct) === null ? 100 : d.splitPct)}%</td></tr>
          </tbody></table>
        </section>
        <section class="card">
          <h2>Requirement</h2>
          <dl class="info">${reqs.map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`).join('')}</dl>
          ${d.requirements ? `<p class="pre">${esc(d.requirements)}</p>` : ''}
        </section>
        <section class="card">
          ${
            d.stage === 'Closed Won'
              ? (() => {
                  const r = L.dealResults(d);
                  return `<h2>Results ${r.hasActuals ? '' : badge('estimated', 'amber')}</h2>
                  <table class="tbl compact"><tbody>
                    <tr><td>SF</td><td class="right">${L.fmtNumber(Math.round(r.sf))}</td></tr>
                    <tr><td>Total rent</td><td class="right">${L.fmtMoney(r.rent)}</td></tr>
                    <tr><td>Commission earned</td><td class="right"><strong>${L.fmtMoney(r.commission)}</strong></td></tr>
                    ${d.leaseCommencement ? `<tr><td>Commencement</td><td class="right">${esc(L.fmtDate(d.leaseCommencement))}</td></tr>` : ''}
                    ${d.newLeaseExpiration ? `<tr><td>New expiration</td><td class="right">${esc(L.fmtDate(d.newLeaseExpiration))}</td></tr>` : ''}
                  </tbody></table>
                  ${r.hasActuals ? '' : '<p class="hint">Edit the deal and fill in “Closed deal results” to record actual numbers.</p>'}`;
                })()
              : ''
          }
          ${d.stage === 'Closed Won' ? `<h2 class="notes-after">Notes${notesActions('deals', id)}</h2>` : `<h2>Notes${notesActions('deals', id)}</h2>`}
          ${notesCard('deals', d, false)}
          ${d.hubspotUrl ? `<p><a href="${esc(d.hubspotUrl)}" target="_blank" rel="noopener">Open in HubSpot ↗</a></p>` : ''}
        </section>
      </div>

      ${dealTermsCard(d)}
      ${documentsCard(S.all('documents').filter((x) => x.dealId === id), { deal: id, company: d.companyId })}

      <section class="card">
        <h2>Market survey & tours <button class="link more" data-action="new" data-col="properties" data-deal="${esc(id)}">+ Add property</button></h2>
        ${
          props.length
            ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Building</th><th>Status</th><th class="right">Avail. SF</th><th class="right">Asking</th><th class="right">Est. yr-1 rent</th><th class="right">TI</th><th class="right">Free rent</th>${isInd ? '<th class="right">Clear</th><th class="right">Docks</th>' : ''}<th class="right">Parking</th><th>Tour</th><th></th></tr></thead><tbody>
          ${props
            .map((p) => {
              const sf = L.parseNumber(d.estSF) || L.parseNumber(p.availableSF) || 0;
              const yr1 = sf * (L.parseNumber(p.askingRate) || 0) * (/\/mo/.test(p.rateBasis || '') ? 12 : 1);
              const cls = { Selected: 'green', Shortlisted: 'green', Rejected: 'red', 'Proposal Received': 'blue', Toured: 'amber' }[p.status] || 'gray';
              return `<tr class="${p.status === 'Rejected' ? 'dim' : ''}"><td><strong>${esc(p.building)}</strong><div class="sub">${esc([p.address, p.submarket].filter(Boolean).join(' · '))}</div>${p.notes ? `<div class="sub pre">${esc(p.notes)}</div>` : ''}</td>
                <td>${badge(p.status, cls)}</td>
                <td class="right">${esc(L.fmtNumber(p.availableSF))}${p.officeSF ? `<div class="sub">${esc(L.fmtNumber(p.officeSF))} office</div>` : ''}</td>
                <td class="right nowrap">${p.askingRate ? '$' + esc(p.askingRate) + '<span class="sub"> ' + esc(rateUnit(p.rateBasis)) + '</span>' : ''}</td>
                <td class="right">${yr1 ? L.fmtMoney(yr1) : ''}</td>
                <td class="right">${p.tiAllowance ? '$' + esc(p.tiAllowance) : ''}</td>
                <td class="right">${p.freeRentMonths ? esc(p.freeRentMonths) + ' mo' : ''}</td>
                ${isInd ? `<td class="right">${p.clearHeight ? esc(p.clearHeight) + "'" : ''}</td><td class="right">${esc(p.dockDoors)}</td>` : ''}
                <td class="right nowrap">${parkingCell(p, d)}</td>
                <td>${esc(L.fmtDate(p.tourDate))}</td>
                <td class="right nowrap"><button class="icon-btn" data-action="edit" data-col="properties" data-id="${esc(p.id)}" title="Edit">✎</button><button class="icon-btn" data-action="delete" data-col="properties" data-id="${esc(p.id)}" title="Delete">✕</button></td></tr>`;
            })
            .join('')}</tbody></table></div>
            <p class="hint">Est. yr-1 rent uses the deal SF when set, otherwise the space's available SF.</p>`
            : emptyState('No properties on the survey yet.')
        }
      </section>

      <section class="card">
        <h2>Activity <span class="muted">${acts.length}</span></h2>
        ${acts.length ? activityTimeline(acts) : emptyState('No activity logged against this deal yet.')}
      </section>
      ${companyActs.length ? `<section class="card"><h2>Other activity with ${esc(companyName(d.companyId))} <span class="muted">${companyActs.length}</span></h2><p class="hint">Not tied to a deal. Edit an item and pick this deal to move it above.</p>${activityTimeline(companyActs.slice(0, 50))}</section>` : ''}`;
  }

  // ----- activities -----

  function viewActivities() {
    const f = state.activities;
    const q = f.q.trim().toLowerCase();
    const today = L.todayISO();
    let list;
    if (f.tab === 'open') list = openFollowUps();
    else list = S.all('activities').slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (q) list = list.filter((a) => [a.subject, a.notes, a.type, companyName(a.companyId), contactName(S.get('contacts', a.contactId))].join(' ').toLowerCase().includes(q));
    const overdue = list.filter((a) => f.tab === 'open' && activityDue(a) < today);

    return `
      <div class="page-head"><h1>Activities & Follow-ups</h1>
        <div class="actions"><button class="btn primary" data-action="new" data-col="activities">Log activity</button></div>
      </div>
      <div class="toolbar">
        <div class="seg">
          <button class="${f.tab === 'open' ? 'on' : ''}" data-action="set-filter" data-scope="activities" data-key="tab" data-value="open">Open follow-ups</button>
          <button class="${f.tab === 'all' ? 'on' : ''}" data-action="set-filter" data-scope="activities" data-key="tab" data-value="all">All activity</button>
        </div>
        <input type="search" placeholder="Search…" value="${esc(f.q)}" data-filter="activities.q" id="f-activities-q" />
      </div>
      <p class="count">${list.length} ${f.tab === 'open' ? 'open follow-ups' + (overdue.length ? ` · <span class="red-text">${overdue.length} overdue</span>` : '') : 'activities'}</p>
      ${
        !list.length
          ? emptyState(f.tab === 'open' ? 'No open follow-ups. Nice.' : 'No activity yet.')
          : f.tab === 'open'
          ? `<section class="card">${followUpList(list)}</section>`
          : `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Subject</th><th>Company</th><th>Contact</th><th>Follow-up</th><th></th></tr></thead><tbody>
            ${list
              .map(
                (a) => `<tr><td class="nowrap">${esc(L.fmtDate(a.date))}</td><td>${badge(a.type, 'gray')}</td>
                <td><strong>${esc(a.subject)}</strong>${a.notes ? `<div class="sub clamp">${esc(a.notes)}</div>` : ''}</td>
                <td>${linkCompany(a.companyId)}</td><td>${esc(contactName(S.get('contacts', a.contactId)))}</td>
                <td class="nowrap">${activityDue(a) ? esc(L.fmtDate(activityDue(a))) + ' ' + (a.done ? badge('done', 'green') : '') : ''}</td>
                <td class="right nowrap"><button class="icon-btn" data-action="edit" data-col="activities" data-id="${esc(a.id)}" title="Edit">✎</button><button class="icon-btn" data-action="delete" data-col="activities" data-id="${esc(a.id)}" title="Delete">✕</button></td></tr>`
              )
              .join('')}</tbody></table></div>`
      }`;
  }

  // ----- lease expirations -----

  function viewExpirations() {
    const f = state.expirations;
    const today = L.todayISO();
    const horizon = Number(f.horizon) || 36;
    const list = S.all('companies').filter((c) => {
      if (!c.leaseExpiration || c.status === 'Not a Fit') return false;
      if (!f.includeClients && ['Active Client', 'Past Client'].includes(c.status)) return false;
      if (!matchesAsset(c.assetClass, f.asset)) return false;
      const m = L.monthsUntil(c.leaseExpiration, today);
      return m <= horizon;
    });
    list.sort((a, b) => a.leaseExpiration.localeCompare(b.leaseExpiration));

    const groups = [];
    list.forEach((c) => {
      const d = L.parseISODate(c.leaseExpiration);
      const key = c.leaseExpiration < today ? 'Past / Holdover' : 'Q' + (Math.floor(d.getMonth() / 3) + 1) + ' ' + d.getFullYear();
      let g = groups.find((x) => x.key === key);
      if (!g) groups.push((g = { key, items: [] }));
      g.items.push(c);
    });

    const unknown = S.all('companies').filter((c) => !c.leaseExpiration && matchesAsset(c.assetClass, f.asset) && c.status !== 'Not a Fit').length;

    return `
      <div class="page-head"><h1>Lease Expirations</h1>
        <div class="actions"><button class="btn" data-action="export-expirations">Export call list</button></div>
      </div>
      <div class="toolbar">
        ${assetTabs(f.asset, 'expirations')}
        <select data-filter="expirations.horizon">${options(
          [12, 18, 24, 36, 48, 60].map((n) => ({ value: n, label: 'Next ' + n + ' months' })),
          horizon
        )}</select>
        <label class="check"><input type="checkbox" data-filter="expirations.includeClients" ${f.includeClients ? 'checked' : ''}/> Include clients</label>
      </div>
      <p class="count">${list.length} leases · ${L.fmtNumber(list.reduce((t, c) => t + (L.parseNumber(c.sfOccupied) || 0), 0))} SF
        ${unknown ? ` · <a href="#/companies" data-action="set-filter" data-scope="companies" data-key="window" data-value="unknown">${unknown} with unknown expiration</a>` : ''}</p>
      ${
        groups.length
          ? groups
              .map(
                (g) => `<section class="card">
            <h2>${esc(g.key)} <span class="muted">${g.items.length} · ${L.fmtNumber(g.items.reduce((t, c) => t + (L.parseNumber(c.sfOccupied) || 0), 0))} SF</span></h2>
            <table class="tbl compact"><tbody>${g.items
              .map(
                (c) => `<tr data-href="#/company/${esc(c.id)}">
                <td class="nowrap" style="width:9rem">${esc(L.fmtDate(c.leaseExpiration))}</td>
                <td><strong>${esc(c.name)}</strong>${shouldBeInMarket(c) ? ' <span class="flag" title="Inside typical lead time and not engaged">⚑</span>' : ''}<div class="sub">${esc([c.building || c.address, c.submarket].filter(Boolean).join(' · '))}</div></td>
                <td>${assetBadge(c.assetClass)}</td>
                <td class="right">${esc(L.fmtNumber(c.sfOccupied))} SF</td>
                <td>${statusBadge(c.status)}</td>
                <td class="sub">${esc(c.landlord)}</td></tr>`
              )
              .join('')}</tbody></table></section>`
              )
              .join('')
          : emptyState('No lease expirations in this window.')
      }`;
  }

  // ----- portfolio (closed deals) -----

  function closedDeals(f) {
    return S.all('deals').filter(
      (d) =>
        d.stage === 'Closed Won' &&
        !d.partnerDeal &&
        matchesAsset(d.assetClass, f.asset) &&
        (f.year === 'All' || L.dealCloseDate(d).slice(0, 4) === String(f.year))
    );
  }

  function breakdownTable(rows, label, maxComm) {
    return `<table class="tbl compact"><thead><tr><th>${esc(label)}</th><th class="right">Deals</th><th class="right">SF</th><th class="right">Total rent</th><th class="right">Commission</th><th class="bar-col"></th></tr></thead><tbody>
      ${rows
        .map(
          (r) => `<tr><td><strong>${esc(r.key)}</strong></td><td class="right">${r.count}</td><td class="right">${L.fmtNumber(Math.round(r.sf))}</td>
          <td class="right">${L.fmtMoney(r.rent, true)}</td><td class="right">${L.fmtMoney(r.commission)}</td>
          <td class="bar-col"><span class="bar-track"><span class="bar weighted" style="width:${(r.commission / maxComm) * 100}%"></span></span></td></tr>`
        )
        .join('')}</tbody></table>`;
  }

  function viewPortfolio() {
    const f = state.portfolio;
    const all = S.all('deals').filter((d) => d.stage === 'Closed Won' && !d.partnerDeal);
    const years = Array.from(new Set(all.map((d) => L.dealCloseDate(d).slice(0, 4)).filter(Boolean))).sort().reverse();
    const deals = closedDeals(f).sort((a, b) => L.dealCloseDate(b).localeCompare(L.dealCloseDate(a)));
    const t = L.summarizeDeals(deals);
    const estimated = deals.filter((d) => !L.dealResults(d).hasActuals).length;
    const firm = deals.reduce((s, d) => s + (L.parseNumber(d.firmCommission) || 0), 0);
    const split = L.parseNumber(S.settings().houseSplitPct) === null ? 50 : L.parseNumber(S.settings().houseSplitPct);
    const inYear = (d) => f.year === 'All' || L.dealCloseDate(d).slice(0, 4) === String(f.year);
    const rescinded = S.all('deals').filter((d) => d.stage === 'Closed Lost' && d.inPortfolioSheet && L.isRescinded(d) && inYear(d));
    // Recorded for reference but not part of my production.
    const excluded = S.all('deals').filter((d) => d.partnerDeal && d.stage === 'Closed Won' && inYear(d));

    const head = `
      <div class="page-head"><div><h1>Portfolio & Production</h1>${sheetSyncStatus()}</div>
        <div class="actions">
          ${S.settings().sheetSyncUrl ? '<button class="btn" data-action="sync-sheet">⟳ Sync Google Sheet</button>' : '<a class="btn" href="#/data">Connect Google Sheet</a>'}
          <button class="btn" data-action="export-portfolio">Export CSV</button>
          <button class="btn" data-action="pick-file" data-kind="portfolio">Import closed deals</button>
          <button class="btn primary" data-action="new-closed-deal">+ Closed deal</button>
        </div>
      </div>`;
    if (!all.length)
      return (
        head +
        `<div class="card onboarding"><h2>Track your closed-deal metrics</h2>
          <p>Bring in your portfolio analysis to see total SF, total rent and commission earned, by year, asset class, deal type and client.</p>
          <ol>
            <li><button class="link" data-action="pick-file" data-kind="portfolio">Import a CSV</button> of closed deals. Columns like <em>Client, Close Date, SF, Total Rent, Commission, Deal Type, Property Type, Term, Expiration</em> are recognized automatically.</li>
            <li>Or <button class="link" data-action="new-closed-deal">add a closed deal</button> by hand. Deals you move to <strong>Closed Won</strong> in the pipeline show up here too.</li>
          </ol>
          <p class="hint">Each closed deal's new lease expiration is copied to the client, so your past deals feed the renewal pipeline.</p></div>`
      );

    const byYear = L.portfolioBreakdown(deals, (d) => L.dealCloseDate(d).slice(0, 4)).sort((a, b) => b.key.localeCompare(a.key));
    const byAsset = L.portfolioBreakdown(deals, (d) => d.assetClass);
    const byType = L.portfolioBreakdown(deals, (d) => d.dealType);
    const byClient = L.portfolioBreakdown(deals, (d) => companyName(d.companyId)).slice(0, 10);
    const maxOf = (rows) => Math.max(1, ...rows.map((r) => r.commission));

    const today = L.todayISO();
    const renewals = S.all('companies')
      .filter((c) => all.some((d) => d.companyId === c.id) && c.leaseExpiration && matchesAsset(c.assetClass, f.asset))
      .map((c) => ({ c, m: L.monthsUntil(c.leaseExpiration, today) }))
      .filter((x) => x.m !== null && x.m <= 48)
      .sort((a, b) => a.c.leaseExpiration.localeCompare(b.c.leaseExpiration));

    return (
      head +
      `<div class="toolbar">
        ${assetTabs(f.asset, 'portfolio')}
        <select data-filter="portfolio.year">${options([{ value: 'All', label: 'All years' }].concat(years.map((y) => ({ value: y, label: y }))), f.year)}</select>
      </div>
      <div class="kpis">
        <div class="kpi"><span class="kpi-label">Deals closed</span><span class="kpi-value">${t.count}</span><span class="kpi-sub">avg ${L.fmtNumber(Math.round(t.avgSF))} SF</span></div>
        <div class="kpi"><span class="kpi-label">Total SF</span><span class="kpi-value">${L.fmtNumber(Math.round(t.sf))}</span><span class="kpi-sub">square feet transacted</span></div>
        <div class="kpi"><span class="kpi-label">Total rent $</span><span class="kpi-value">${L.fmtMoney(t.rent, true)}</span><span class="kpi-sub">aggregate lease value</span></div>
        <div class="kpi"><span class="kpi-label">Commission earned (my share)</span><span class="kpi-value">${L.fmtMoney(t.commission, true)}</span><span class="kpi-sub">${firm ? `of ${L.fmtMoney(firm, true)} firm gross · ` : ''}avg ${L.fmtMoney(t.avgCommission, true)}/deal</span></div>
        <div class="kpi"><span class="kpi-label">Take-home (after ${esc(split)}% house split)</span><span class="kpi-value">${L.fmtMoney((t.commission * (100 - split)) / 100, true)}</span><span class="kpi-sub">from closed deals</span></div>
        <div class="kpi"><span class="kpi-label">Commission per SF</span><span class="kpi-value">$${t.commissionPerSF.toFixed(2)}</span><span class="kpi-sub">${t.effectiveRate.toFixed(2)}% of total rent</span></div>
      </div>
      ${estimated ? `<p class="hint">${estimated} of ${deals.length} deals have no recorded results, so their figures are estimates from the deal economics. Add the final SF, total rent and commission on those deals to make these numbers exact.</p>` : ''}
      ${
        rescinded.length + excluded.length
          ? `<p class="hint">Not counted: ${rescinded
              .map((d) => `<a href="#/deal/${esc(d.id)}">${esc(companyName(d.companyId))}</a> (rescinded${d.partnerDeal ? ', partner deal' : ''})`)
              .concat(excluded.map((d) => `<a href="#/deal/${esc(d.id)}">${esc(companyName(d.companyId))}</a> (partner deal${d.leadBroker ? ' – ' + esc(d.leadBroker) : ''})`))
              .join(', ')}.</p>`
          : ''
      }
      <section class="card"><h2>By year</h2>${breakdownTable(byYear, 'Year', maxOf(byYear))}</section>
      <div class="grid2">
        <section class="card"><h2>By asset class</h2>${breakdownTable(byAsset, 'Asset class', maxOf(byAsset))}</section>
        <section class="card"><h2>By deal type</h2>${breakdownTable(byType, 'Deal type', maxOf(byType))}</section>
      </div>
      <div class="grid2">
        <section class="card"><h2>Top clients</h2>${breakdownTable(byClient, 'Client', maxOf(byClient))}</section>
        <section class="card"><h2>Renewals coming from your closed deals</h2>
          <p class="hint">Past clients whose lease expires within 4 years, which makes them your warmest renewal prospects.</p>
          ${renewals.length ? companyMiniTable(renewals.map((x) => x.c)) : emptyState('No client lease expirations within 4 years. Add the new lease expiration to your closed deals to fill this list.')}
        </section>
      </div>
      <section class="card"><h2>Closed deals <span class="muted">${deals.length}</span></h2>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Closed</th><th>Client / deal</th><th>Type</th><th>Asset</th><th class="right">SF</th><th class="right">Total rent</th><th class="right">Commission</th><th></th></tr></thead><tbody>
        ${deals
          .map((d) => {
            const r = L.dealResults(d);
            return `<tr data-href="#/deal/${esc(d.id)}"><td class="nowrap">${esc(L.fmtDate(L.dealCloseDate(d)))}</td>
              <td><strong>${esc(companyName(d.companyId))}</strong><div class="sub">${esc([d.name, d.building || d.address].filter(Boolean).join(' · '))}</div></td>
              <td>${esc(d.dealType)}</td><td>${assetBadge(d.assetClass)}</td>
              <td class="right">${L.fmtNumber(Math.round(r.sf))}</td><td class="right">${L.fmtMoney(r.rent)}</td><td class="right">${L.fmtMoney(r.commission)}</td>
              <td>${r.hasActuals ? '' : badge('est.', 'amber')}</td></tr>`;
          })
          .join('')}</tbody></table></div>
      </section>`
    );
  }

  // ----- data & settings -----

  function viewData() {
    const s = S.settings();
    const counts = S.COLLECTIONS.map((c) => `${S.all(c).length} ${c}`).join(' · ');
    return `
      <div class="page-head"><h1>Import, Export & Settings</h1></div>
      ${importPreview && importPreview.kind !== 'research' ? importPreviewCard() : ''}
      <div class="grid2">
        <section class="card">
          <h2>Import from CSV or Excel</h2>
          <p>Export a list from CoStar, Reonomy, ZoomInfo, LinkedIn Sales Navigator or Excel (Save As → CSV), then import it here.
          Columns like <em>Tenant Name, SF Occupied, Lease Expiration, Submarket, Address, Landlord, Industry, Employees</em> are recognized automatically.</p>
          <div class="actions">
            <button class="btn primary" data-action="pick-file" data-kind="companies">Import companies / tenants</button>
            <button class="btn" data-action="pick-file" data-kind="contacts">Import contacts</button>
            <button class="btn" data-action="pick-file" data-kind="portfolio">Import closed deals</button>
            <button class="btn" data-action="download-template">Company template</button>
            <button class="btn" data-action="download-portfolio-template">Closed-deal template</button>
          </div>
        </section>
        <section class="card">
          <h2>Backup & restore</h2>
          <p>Your data lives in this browser only. Export a backup file regularly and keep it somewhere safe (e.g. OneDrive / Google Drive).
          Restore it on another computer to move your CRM.</p>
          <p class="sub">${counts}<br/>Last backup: ${s.lastBackup ? esc(L.fmtDate(s.lastBackup)) : '<strong>never</strong>'}${storageProtected === null ? '' : `<br/>Protected from automatic browser clean-up: ${storageProtected ? 'yes' : 'not granted by this browser (bookmark the CRM to help), so keep backing up'}`}</p>
          <div class="actions">
            <button class="btn primary" data-action="export-json">Export backup</button>
            <button class="btn" data-action="pick-file" data-kind="backup">Restore backup…</button>
          </div>
        </section>
      </div>
      <div class="grid2">
        <section class="card">
          <h2>Settings</h2>
          <form id="settings-form" class="form-grid">
            <label>Your name<input name="brokerName" value="${esc(s.brokerName)}" /></label>
            <label>Home market<input name="homeMarket" value="${esc(s.homeMarket)}" /></label>
            <label>Default commission %<input name="defaultCommissionPct" type="number" step="0.01" value="${esc(s.defaultCommissionPct)}" /></label>
            <label>Default escalation %<input name="defaultEscalationPct" type="number" step="0.1" value="${esc(s.defaultEscalationPct)}" /></label>
            <label>Default term (months)<input name="defaultTermMonths" type="number" value="${esc(s.defaultTermMonths)}" /></label>
            <label>"Going stale" after (days)<input name="staleDays" type="number" value="${esc(s.staleDays)}" /></label>
            <label>House split % (firm keeps)<input name="houseSplitPct" type="number" step="0.1" value="${esc(s.houseSplitPct)}" /></label>
            <label>Daily outreach goal (Today list)<input name="outreachGoal" type="number" min="1" value="${esc(s.outreachGoal)}" /></label>
            <label>Follow-up task after an initial email with no reply (days; 0 turns it off)<input name="followUpDays" type="number" min="0" value="${esc(s.followUpDays)}" /></label>
            <label>Social posts per week goal<input name="postsPerWeek" type="number" min="0" value="${esc(s.postsPerWeek)}" /></label>
            <label>Your firm (for email templates)<input name="myFirm" value="${esc(s.myFirm)}" /></label>
            <label class="wide">Research team emails (for the quarterly stats request)<input name="researchTeam" value="${esc(s.researchTeam)}" placeholder="name@company.com, name@company.com" /></label>
            <div class="wide"><button class="btn primary" type="submit">Save settings</button></div>
          </form>
        </section>
        <section class="card">
          <h2>Shared prospect lists</h2>
          <p>Two-way sync with a Google Sheet you share with a partner. Set it up once per sheet with the <a href="integrations/shared-list-sync.gs" target="_blank" rel="noopener">shared-list script</a> (instructions at the top), then paste its web-app URL and sync key here.</p>
          ${(s.sharedLists || [])
            .map(
              (l) => `<form class="form-grid list-form" data-list="${esc(l.id)}">
            <label>List name<input name="name" value="${esc(l.name)}" /></label>
            <label>Your initials on this list<input name="initials" value="${esc(s.myInitials || initialsOf(s.brokerName))}" maxlength="4" /></label>
            <label class="wide">Web app URL<input name="url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(l.url)}" /></label>
            <label class="wide">Sync key<input name="key" type="password" autocomplete="off" value="${esc(l.key)}" /></label>
            <div class="wide actions"><button class="btn primary" type="submit">Save</button>${l.url ? `<button class="btn" type="button" data-action="sync-list" data-list="${esc(l.id)}">Sync now</button>` : ''}</div>
            <p class="hint wide">${esc(listStatus[l.id] || (l.lastSync ? 'Last synced ' + new Date(l.lastSync).toLocaleString() : 'Not connected yet.'))}</p>
          </form>`
            )
            .join('')}
          <button class="btn" type="button" data-action="add-list">+ Add another shared list</button>
        </section>
        <section class="card">
          <h2>HubSpot live sync</h2>
          <p>Brings in the emails (with opens and replies), meetings and calls HubSpot logs from Outlook, every few minutes while the CRM is open.
          Set it up once with the <a href="integrations/hubspot-bridge.gs" target="_blank" rel="noopener">bridge script</a> (instructions at the top), then paste its web-app URL and sync key here. Your HubSpot key stays in your Google account, never in this browser.</p>
          <form id="settings-form-hubspot" class="form-grid">
            <label class="wide">Web app URL<input name="hubspotBridgeUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(s.hubspotBridgeUrl)}" /></label>
            <label class="wide">Sync key<input name="hubspotBridgeKey" type="password" autocomplete="off" value="${esc(s.hubspotBridgeKey)}" /></label>
            <div class="wide actions"><button class="btn primary" type="submit">Save</button>${s.hubspotBridgeUrl ? '<button class="btn" type="button" data-action="sync-hubspot">Sync now</button><button class="btn" type="button" data-action="backfill-hubspot" title="One time: every email and note HubSpot has, not just the past week">Load full history</button>' : ''}</div>
          </form>
          <p class="hint">${s.hubspotLastSync ? 'Last synced ' + esc(new Date(s.hubspotLastSync).toLocaleString()) + (hubspotStatus ? ' · ' + esc(hubspotStatus) : '') : hubspotStatus ? esc(hubspotStatus) : 'Not connected yet.'}</p>
        </section>
        <section class="card">
          <h2>Google Sheet sync (portfolio)</h2>
          <p>Keeps your closed deals in step with your portfolio Google Sheet in both directions. Set it up once with the
          <a href="integrations/google-sheets-sync.gs" target="_blank" rel="noopener">sync script</a>
          (instructions at the top of the file), then paste its web-app URL and sync key here.</p>
          <form id="settings-form-sync" class="form-grid">
            <label class="wide">Web app URL<input name="sheetSyncUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(s.sheetSyncUrl)}" /></label>
            <label class="wide">Sync key<input name="sheetSyncKey" type="password" autocomplete="off" value="${esc(s.sheetSyncKey)}" /></label>
            <div class="wide actions"><button class="btn primary" type="submit">Save</button>${s.sheetSyncUrl ? '<button class="btn" type="button" data-action="sync-sheet">Sync now</button>' : ''}</div>
          </form>
          ${sheetSyncStatus()}
        </section>
        <section class="card">
          <h2>Demo data & reset</h2>
          <p>Load a handful of fictional office and industrial tenants to explore the app, or wipe everything to start fresh.</p>
          <div class="actions">
            <button class="btn" data-action="sample-data">Load demo data</button>
            <button class="btn danger" data-action="clear-all">Delete all data</button>
          </div>
        </section>
      </div>`;
  }

  // Comps that may already be in the CRM (or repeat a row above) wait for Maddy's call; nothing is doubled silently.
  function compPlan(p, opts) {
    const comps = p.result.records.map((r) => L.cleanImportedComp(r, Object.assign({ termUnit: p.termUnit }, opts || {})));
    return L.planCompImport(comps, S.all('comps'));
  }
  // "Match a file": the CRM's comps lined up with a sheet, with every difference and what to do about it.
  function alignPlan(p) {
    const comps = p.result.records.map((r) => L.cleanImportedComp(r, { termUnit: p.termUnit, assetClass: p.alignAsset || p.assetClass }));
    return Object.assign({ comps }, L.alignComps(comps, S.all('comps')));
  }
  const COMP_LABELS = { building: 'Building', address: 'Address', city: 'City', submarket: 'Submarket', assetClass: 'Asset', landlord: 'Landlord', tenant: 'Tenant', dealType: 'Type', sf: 'RSF', signedDate: 'Signed', commencement: 'Commencement', termMonths: 'Term', leaseExpiration: 'LXD', startingRent: 'Rent', rateBasis: 'Basis', escalationPct: 'Escalation', freeRentMonths: 'Free rent', tiAllowance: 'TI', opex: 'OpEx', yearBuilt: 'Built', clearHeight: 'Clear height', notes: 'Notes' };
  function compValue(field, v) {
    if (v === '' || v === undefined || v === null) return 'blank';
    if (field === 'termMonths' || field === 'freeRentMonths') return v + ' mo';
    if (field === 'escalationPct') return Number(v) === 0 ? '0% (flat)' : v + '%';
    if (['startingRent', 'tiAllowance', 'opex'].includes(field)) return '$' + Number(v).toFixed(2);
    if (field === 'sf') return L.fmtNumber(v);
    if (field === 'rateBasis') return String(v).replace(/\s*\(.*\)/, '');
    return String(v);
  }
  function alignPreviewCard() {
    const p = importPreview;
    const a = alignPlan(p);
    const label = (c) => esc([c.tenant, c.building].filter(Boolean).join(' · '));
    const fix = a.matched.filter((m) => m.diffs.length);
    const ok = a.matched.length - fix.length;
    const leftovers = a.extras.filter((e) => e.leftover);
    const others = a.extras.filter((e) => !e.leftover);
    return `<section class="card import-preview">
      <h2>Make comps match: ${esc(p.filename)}</h2>
      <p>${a.comps.length} rows in the file. <strong>${ok}</strong> already match the CRM exactly${fix.length ? `, <strong>${fix.length}</strong> differ` : ''}${a.missing.length ? `, <strong>${a.missing.length}</strong> aren't in the CRM` : ''}${leftovers.length ? `, and <strong>${leftovers.length}</strong> look like leftover copies` : ''}. Nothing changes until you apply.</p>
      <form id="align-form" class="form-grid">
        <label>Asset class for rows without one<select id="align-asset">${options(['Office', 'Industrial'], p.alignAsset || p.assetClass)}</select></label>
        <div class="wide">
        ${
          fix.length
            ? `<h3 class="notes-sub">Fix ${fix.length} comp${fix.length > 1 ? 's' : ''} to match the file</h3><div class="table-wrap"><table class="tbl compact"><thead><tr><th></th><th>Comp</th><th>What changes (CRM → file)</th></tr></thead><tbody>${fix
                .map((m) => `<tr><td><input type="checkbox" name="fix-${m.row}" checked /></td><td><strong>${label(m.comp)}</strong></td><td>${m.diffs.map((d) => `<div><span class="muted">${esc(COMP_LABELS[d.field] || d.field)}:</span> ${esc(compValue(d.field, d.crm))} → <strong>${esc(compValue(d.field, d.file))}</strong></div>`).join('')}</td></tr>`)
                .join('')}</tbody></table></div>`
            : ''
        }
        ${
          a.missing.length
            ? `<h3 class="notes-sub">Add ${a.missing.length} comp${a.missing.length > 1 ? 's' : ''} that aren't in the CRM</h3><div class="table-wrap"><table class="tbl compact"><thead><tr><th></th><th>Comp</th><th>Terms</th><th></th></tr></thead><tbody>${a.missing
                .map((m) => `<tr><td><input type="checkbox" name="add-${m.row}" ${m.repeatOf >= 0 ? '' : 'checked'} /></td><td><strong>${label(m.comp)}</strong></td><td>${esc([compValue('sf', m.comp.sf) + ' SF', m.comp.startingRent ? compValue('startingRent', m.comp.startingRent) : '', m.comp.termMonths ? m.comp.termMonths + ' mo' : ''].filter((x) => x && x !== 'blank SF').join(' · '))}</td><td>${m.repeatOf >= 0 ? badge('Possible duplicate of row ' + (m.repeatOf + 1), 'amber') + ' <span class="sub">Tick to add it anyway</span>' : ''}</td></tr>`)
                .join('')}</tbody></table></div>`
            : ''
        }
        ${
          leftovers.length
            ? `<h3 class="notes-sub">Delete ${leftovers.length} leftover cop${leftovers.length > 1 ? 'ies' : 'y'}</h3><p class="hint">Comps for a tenant that's in the file, but not the one matched to its row (usually saved by an earlier import). Untick any you want to keep.</p><div class="table-wrap"><table class="tbl compact"><tbody>${leftovers
                .map((e) => `<tr><td><input type="checkbox" name="del-${esc(e.existing.id)}" checked /></td><td><strong>${label(e.existing)}</strong></td><td>${esc([compValue('sf', e.existing.sf) + ' SF', e.existing.startingRent ? compValue('startingRent', e.existing.startingRent) : 'no rent', e.existing.termMonths ? e.existing.termMonths + ' mo' : ''].join(' · '))}</td></tr>`)
                .join('')}</tbody></table></div>`
            : ''
        }
        ${
          others.length
            ? `<details><summary>${others.length} other ${esc(p.alignAsset || p.assetClass).toLowerCase()} comp${others.length > 1 ? 's' : ''} in the CRM that aren't in this file (kept)</summary><p class="hint">Tick any you want to delete.</p><div class="table-wrap"><table class="tbl compact"><tbody>${others
                .map((e) => `<tr><td><input type="checkbox" name="del-${esc(e.existing.id)}" /></td><td>${label(e.existing)}</td><td>${esc(e.existing.source || '')}</td></tr>`)
                .join('')}</tbody></table></div></details>`
            : ''
        }
        </div>
        <div class="wide actions"><button class="btn primary" type="submit">Apply</button><button class="btn" type="button" data-action="cancel-import">Cancel</button></div>
      </form>
    </section>`;
  }

  function compDuplicateReview(p) {
    const plan = compPlan(p);
    const flagged = plan.map((x, i) => Object.assign({ i }, x)).filter((x) => x.status !== 'new');
    if (!flagged.length) return `<p class="wide hint">No duplicates: all ${plan.length} comps are new to the CRM.</p>`;
    const line = (c) => esc([c.tenant, c.building, c.sf ? L.fmtNumber(c.sf) + ' SF' : '', c.signedDate ? L.fmtDate(c.signedDate) : '', c.startingRent ? '$' + Number(c.startingRent).toFixed(2) : '', c.termMonths ? c.termMonths + ' mo' : ''].filter(Boolean).join(' · '));
    return `<div class="wide dup-review">
      <h3 class="notes-sub">Review ${flagged.length} possible duplicate${flagged.length > 1 ? 's' : ''}</h3>
      <p class="hint">Nothing is added twice unless you choose to. An expansion, extension or a second deal with the same tenant is fine to add as a separate comp; the same deal again is not.</p>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Row in file</th><th>Matches</th><th>Why</th><th>What to do</th></tr></thead><tbody>${flagged
        .map((x) => {
          const choices =
            x.where === 'crm'
              ? [{ value: 'update', label: 'Update the existing comp' }, { value: 'add', label: 'Add as a separate comp' }, { value: 'skip', label: 'Skip this row' }]
              : [{ value: 'skip', label: 'Skip this row' }, { value: 'add', label: 'Add as a separate comp' }];
          const def = x.status === 'duplicate' && x.where === 'crm' ? 'update' : 'skip';
          return `<tr class="${x.status === 'possible' ? 'dup-possible' : ''}"><td>${line(x.comp)}</td><td>${x.where === 'crm' ? 'In the CRM: ' : 'Row ' + (x.match.row + 1) + ' of this file: '}${line(x.match)}</td><td>${badge(x.status === 'duplicate' ? 'Same deal' : 'Possible duplicate', x.status === 'duplicate' ? 'gray' : 'amber')} <span class="sub">${esc(x.reason)}</span></td><td><select name="dup-${x.i}">${options(choices, def)}</select></td></tr>`;
        })
        .join('')}</tbody></table></div></div>`;
  }

  function importPreviewCard() {
    const p = importPreview;
    if (p.kind === 'compsAlign') return alignPreviewCard();
    const mapped = Object.keys(p.result.mapping);
    const required = { companies: 'name', contacts: 'company', portfolio: 'company', comps: 'building', marketStats: 'submarket' }[p.kind];
    const isComps = p.kind === 'comps';
    const isStats = p.kind === 'marketStats';
    const unmapped = p.result.headers.filter((h, i) => !Object.values(p.result.mapping).includes(i));
    const sample = p.result.records.slice(0, 5);
    return `<section class="card import-preview">
      <h2>Review import: ${esc(p.filename)}</h2>
      <p>${p.result.records.length} rows found. Matched columns:</p>
      <div class="mapping">${mapped.map((k) => `<span class="badge green">${esc(p.result.headers[p.result.mapping[k]])} → ${esc(k)}</span>`).join(' ')}
        ${unmapped.map((h) => `<span class="badge gray" title="Will be ignored">${esc(h)} (ignored)</span>`).join(' ')}</div>
      ${!mapped.includes(required) && !(isComps && mapped.includes('address')) ? `<p class="red-text">No ${isStats ? 'submarket' : isComps ? 'building or address' : p.kind === 'companies' ? 'company/tenant name' : 'client/company'} column was recognized. Rename that column to "${isStats ? 'Submarket' : isComps ? 'Building' : 'Company'}" and try again.</p>` : ''}
      <div class="table-wrap"><table class="tbl compact"><thead><tr>${mapped.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead>
        <tbody>${sample.map((r) => `<tr>${mapped.map((k) => `<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <form id="import-form" class="form-grid">
        ${isComps ? compDuplicateReview(p) : ''}
        ${
          isStats
            ? `<label>Quarter<input name="quarter" value="${esc(p.quarter)}" placeholder="3Q26" required pattern="[1-4][Qq][0-9]{2}" /></label>
        <label>Asset class<select name="assetClass">${options(L.RESEARCH_ASSETS, p.assetClass)}</select></label>`
            : `<label>Asset class when not in file<select name="assetClass">${options(L.ASSET_CLASSES, state.companies.asset !== 'All' ? state.companies.asset : 'Office')}</select></label>`
        }
        ${
          isStats
            ? ''
            : isComps
            ? `<label>Source when not in file<select name="source">${options(FIELDS.comps.find((x) => x.key === 'source').options, 'Outside broker')}</select></label>
        <label class="check"><input type="checkbox" name="confidential" /> Mark these comps confidential (internal use only)</label>`
            : `<label>Status for new companies<select name="status">${options(L.COMPANY_STATUSES, p.kind === 'portfolio' ? 'Past Client' : 'Target')}</select></label>
        <label>Lead source<input name="source" value="${esc(p.kind === 'contacts' ? '' : p.kind === 'portfolio' ? 'Portfolio import' : 'CSV import')}" /></label>`
        }
        <div class="wide actions">
          <button class="btn primary" type="submit">Import ${p.result.records.length} rows</button>
          <button class="btn" type="button" data-action="cancel-import">Cancel</button>
        </div>
        <p class="hint wide">${isComps || isStats ? '' : 'Companies whose name (and address, when given) already exist are updated rather than duplicated. '}${p.kind === 'contacts' ? 'Contacts with an email already in the CRM are skipped; companies that do not exist yet are created.' : ''}${p.kind === 'portfolio' ? 'Each row becomes a Closed Won deal under its client (clients are created if needed). Re-importing the same client, close date and SF updates the deal instead of duplicating it.' : ''}${isStats ? 'Each row is one submarket for this quarter; a row named Total or Atlanta becomes the market total. Importing the same quarter again replaces it.' : ''}${isComps ? 'Each row becomes a comp. A comp already in the CRM (same building, tenant, date and SF) is updated instead of duplicated. Lease expirations are estimated from the term when the sheet has none.' : ''}</p>
      </form>
    </section>`;
  }

  // ---------- forms / modal ----------

  function refOptions(field, rec) {
    if (field.ref === 'companies')
      return S.all('companies')
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name }));
    if (field.ref === 'contacts') return S.all('contacts').map((c) => ({ value: c.id, label: contactName(c), company: c.companyId }));
    if (field.ref === 'deals') return S.all('deals').map((d) => ({ value: d.id, label: d.name, company: d.companyId }));
    return [];
  }

  function fieldHTML(f, rec) {
    if (f.section) return `<h3 class="wide form-section">${esc(f.section)}</h3>`;
    const v = rec[f.key];
    const id = 'fld-' + f.key;
    const req = f.required ? ' required' : '';
    const attrs = `class="${f.wide ? 'wide' : ''}" ${f.asset ? `data-asset="${f.asset}"` : ''}`;
    let input;
    switch (f.type) {
      case 'select':
        input = `<select id="${id}" name="${f.key}"${req}>${options(f.options, v || f.defaultValue, f.noBlank ? undefined : '')}</select>`;
        break;
      case 'ref': {
        // A search box over a hidden select: type to filter, or add a new contact or company by name.
        const opts = refOptions(f, rec);
        const cur = opts.find((o) => o.value === v);
        input = `<div class="ref-box"><input id="${id}" class="ref-search" data-ref="${f.ref}"${f.noCreate ? ' data-no-create="1"' : ''}${f.exclude ? ` data-exclude="${esc(f.exclude)}"` : ''} autocomplete="off" placeholder="Type to search…" value="${esc(cur ? cur.label : '')}"${req}/><div class="ref-menu" hidden></div><select name="${f.key}" hidden ${f.filterBy ? `data-filter-by="${f.filterBy}"` : ''}><option value=""></option>${opts
          .map((o) => `<option value="${esc(o.value)}" ${o.company ? `data-company="${esc(o.company)}"` : ''} ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`)
          .join('')}</select></div>`;
        break;
      }
      case 'textarea':
        input = `<textarea id="${id}" name="${f.key}" rows="${f.rows || 3}"${req}>${esc(v)}</textarea>`;
        break;
      case 'checkbox':
        return `<label class="check ${f.wide ? 'wide' : ''}" ${f.asset ? `data-asset="${f.asset}"` : ''}><input type="checkbox" name="${f.key}" ${v ? 'checked' : ''}/> ${esc(f.label)}</label>`;
      default: {
        const list = f.list ? (typeof f.list === 'function' ? f.list() : f.list) : null;
        input = `<input id="${id}" name="${f.key}" type="${f.type || 'text'}" ${f.type === 'number' ? `step="${f.step || 'any'}"` : ''} value="${esc(v)}"${req} ${list ? `list="${id}-list"` : ''}/>${
          list ? `<datalist id="${id}-list">${list.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : ''
        }`;
      }
    }
    return `<label ${attrs}>${esc(f.label)}${f.required ? ' *' : ''}${input}</label>`;
  }

  function defaultsFor(col, ctx) {
    const s = S.settings();
    const today = L.todayISO();
    switch (col) {
      case 'companies':
        return Object.assign(
          { status: 'Target', priority: 'B', growthSignal: 'Unknown', assetClass: state.companies.asset !== 'All' ? state.companies.asset : '' },
          ctx.list ? { sharedList: ctx.list, listStatus: 'Researching', source: ((S.settings().sharedLists || []).find((l) => l.id === ctx.list) || {}).name } : {}
        );
      case 'contacts':
        return { companyId: ctx.company || '' };
      case 'criticalDates':
        return { companyId: ctx.company || (S.get('deals', ctx.deal) || {}).companyId || '', dealId: ctx.deal || '', kind: 'Renewal option', status: 'Open' };
      case 'templates':
        return { step: 'Intro', active: true, body: 'Hi {FirstName},\n\n\n\nBest,\n{MyFirstName}' };
      case 'documents': {
        const d = S.get('deals', ctx.deal);
        return { kind: 'LOI', date: today, dealId: ctx.deal || '', companyId: ctx.company || (d ? d.companyId : '') };
      }
      case 'marketing':
        return { kind: state.marketing.tab === 'social' ? 'Social post' : 'One-pager / flyer', status: 'Drafting', channel: state.marketing.tab === 'social' ? 'LinkedIn' : '', dataQuarter: L.latestDataQuarter(today) };
      case 'deals': {
        const c = S.get('companies', ctx.company);
        return {
          companyId: ctx.company || '',
          name: c ? c.name + ' – ' : '',
          stage: 'Intro Call',
          dealType: 'New Lease',
          assetClass: c && c.assetClass ? c.assetClass : '',
          sfMin: c ? c.sfOccupied : '',
          rateBasis: c && c.assetClass === 'Industrial' ? 'NNN ($/SF/yr)' : 'Full Service ($/SF/yr)',
          commissionPct: s.defaultCommissionPct,
          escalationPct: s.defaultEscalationPct,
          termMonths: s.defaultTermMonths,
        };
      }
      case 'activities':
        return { type: ctx.task ? 'Task' : 'Call', date: ctx.task ? L.addDays(today, 1) : today, companyId: ctx.company || (S.get('deals', ctx.deal) || {}).companyId || '', contactId: ctx.contact || '', dealId: ctx.deal || '', done: false };
      case 'properties': {
        const d = S.get('deals', ctx.deal);
        return { dealId: ctx.deal, status: 'Identified', rateBasis: d ? d.rateBasis : '' };
      }
    }
    return {};
  }

  // ----- draft email from a template -----

  function draftContext(companyId, contactId, dealId) {
    const c = S.get('companies', companyId) || {};
    const p = S.get('contacts', contactId) || {};
    const deal = S.get('deals', dealId) || S.all('deals').find((d) => d.companyId === companyId && L.OPEN_STAGES.includes(d.stage));
    const st = S.settings();
    return { company: c, contact: p, me: { name: st.brokerName, firm: st.myFirm }, partner: (deal && deal.partnerBrokers) || c.partner, rentGrowth: st.rentGrowth, buildingRates: st.buildingRates || {}, deal, market: L.marketStatFor(S.settings().marketStats || [], c, S.settings().marketReports), today: L.todayISO() };
  }

  // Who to call and their numbers, with click-to-call, copy, and logging the call.
  function openCallCard(companyId, contactId) {
    const c = S.get('companies', companyId);
    const p = reachContact(companyId, contactId);
    if (!c || !p) return;
    const others = S.all('contacts').filter((x) => x.companyId === companyId && x.id !== p.id && (x.phone || x.mobile));
    const line = (label, num, dnc) =>
      num
        ? `<div class="call-line"><span class="muted">${label}</span>${dnc ? `<span class="call-num">${esc(num)}</span> ${badge('Do not call', 'red')}` : `<a class="call-num" href="tel:${esc(num)}">${esc(num)}</a><button type="button" class="btn small" data-action="copy-text" data-text="${esc(num)}">Copy</button>`}</div>`
        : '';
    const last = S.all('activities').filter((a) => a.companyId === companyId && a.date && a.date <= L.todayISO() && a.type !== 'Task').sort((a, b) => b.date.localeCompare(a.date))[0];
    const dlg = $('#modal');
    if (dlg.open) dlg.close();
    dlg.innerHTML = `<form method="dialog" class="call-card">
      <header><h2>Call ${esc(contactName(p))}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></header>
      <p class="sub">${esc([p.title, c.name].filter(Boolean).join(' · '))}</p>
      ${line('Office', p.phone, p.phoneDNC)}${line('Mobile', p.mobile, p.mobileDNC)}
      ${last ? `<p class="hint">Last touch: ${esc(L.fmtDate(last.date))} · ${esc(last.type)} · ${esc(last.subject || '')}</p>` : ''}
      ${others.length ? `<details><summary>Other people at ${esc(c.name)} (${others.length})</summary>${others.map((x) => `<div class="call-line"><span>${esc(contactName(x))}<span class="sub"> ${esc(x.title || '')}</span></span>${x.phone && !x.phoneDNC ? `<a href="tel:${esc(x.phone)}">${esc(x.phone)}</a>` : ''}${x.mobile && !x.mobileDNC ? ` <a href="tel:${esc(x.mobile)}">${esc(x.mobile)} (m)</a>` : ''}</div>`).join('')}</details>` : ''}
      <footer><span class="spacer"></span>
        ${p.email ? `<button type="button" class="btn" data-action="draft-email" data-company="${esc(companyId)}" data-contact="${esc(p.id)}">Email instead</button>` : ''}
        <button type="button" class="btn primary" data-action="log-touch" data-type="Call" data-company="${esc(companyId)}" data-contact="${esc(p.id)}">✓ Called – log it</button>
      </footer>
    </form>`;
    dlg.showModal();
  }

  const REC_DRAFT = '__recommended';
  const RECAP_DRAFT = '__recap';
  const MARKET_DRAFT = '__market';
  function openDraft(companyId, contactId, step, replyId, opts) {
    opts = opts || {};
    const c = S.get('companies', companyId);
    if (!c) return;
    const people = S.all('contacts').filter((p) => p.companyId === companyId && p.email);
    const templates = S.all('templates').filter((t) => t.active !== false);
    const contact = S.get('contacts', contactId) || people.slice().sort((a, b) => !!b.keyContact - !!a.keyContact || (b.role === 'Decision Maker') - (a.role === 'Decision Maker'))[0] || null;
    const suggested = (step && templates.find((t) => t.step === step)) || L.suggestTemplate(templates, c, { today: L.todayISO(), lastTouch: lastTouchMap()[companyId] });
    const dlg = $('#modal');
    const reply = S.get('activities', replyId);
    const openDeal = draftContext(companyId, '', opts.dealId).deal;
    if (dlg.open) dlg.close();
    dlg.innerHTML = `<form method="dialog" id="draft-form" data-company="${esc(companyId)}" data-deal="${esc(opts.dealId || '')}" data-reply="${esc(reply ? reply.id : '')}" data-reply-subject="${esc(reply ? 'RE: ' + String(reply.subject || '').replace(/^(re|fw|fwd|reply):\s*/gi, '') : '')}">
      <header><h2>Draft email to ${esc(c.name)}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></header>
      ${
        !people.length
          ? `<p class="hint">No contact with an email address at ${esc(c.name)} yet. Add one first.</p>`
          : `<div class="form-grid">
          <label>To<span class="draft-to"><select name="contact">${options(people.map((p) => ({ value: p.id, label: contactName(p) + ' <' + p.email + '>' })), contact && contact.id)}</select><button type="button" class="btn small" data-action="copy-draft-to" title="Copy the email address">Copy</button></span></label>
          <label>Template<select name="template">${options(
            [{ value: REC_DRAFT, label: 'Recommended follow-up' }]
              .concat(openDeal ? [{ value: RECAP_DRAFT, label: 'Weekly recap' }] : [])
              .concat(draftContext(companyId, '', opts.dealId).market ? [{ value: MARKET_DRAFT, label: 'Market update (latest stats)' }] : [])
              .concat(templates.map((t) => ({ value: t.id, label: t.name + ' (' + t.step + ')' }))),
            opts.recap && openDeal ? RECAP_DRAFT : opts.stats ? MARKET_DRAFT : opts.recommended || !suggested ? REC_DRAFT : suggested.id
          )}</select></label>
          <label class="wide">Cc<span class="draft-to"><input name="cc" placeholder="Optional" /><button type="button" class="btn small" data-action="copy-draft-cc" title="Copy the cc addresses">Copy</button></span></label>
          <p class="hint wide" id="draft-why"></p>
          <div class="wide fill-ins" id="draft-fillins" hidden></div>
          <label class="wide">Subject<input name="subject" /></label>
          <label class="wide">Body<textarea name="body" rows="14"></textarea></label>
          <p class="hint wide">Anything in [brackets] is missing from the CRM. Fill it in here, or on the company, before sending.</p>
        </div>`
      }
      <footer><span class="spacer"></span>
        ${people.length ? '<button type="button" class="btn" data-action="copy-draft">Copy text</button><a class="btn primary" id="draft-open" href="#">Open in Outlook</a>' : '<button type="button" class="btn" data-action="close-modal">Close</button>'}
      </footer>
    </form>`;
    dlg.showModal();
    if (people.length) fillDraft();
  }

  function fillDraft() {
    const f = $('#draft-form');
    const ctx = draftContext(f.dataset.company, f.elements.contact.value, f.dataset.deal);
    let draft;
    if (f.elements.template.value === MARKET_DRAFT) {
      draft = L.marketUpdateDraft(ctx);
    } else if (f.elements.template.value === RECAP_DRAFT) {
      draft = L.weeklyRecap(
        Object.assign({ activities: S.all('activities').filter((a) => a.companyId === f.dataset.company), properties: S.all('properties').filter((p) => p.dealId === ctx.deal.id) }, ctx)
      );
      draft.why = draft.done.length ? 'Recap of ' + draft.done.length + ' thing' + (draft.done.length > 1 ? 's' : '') + ' logged on this deal that week. Edit freely before sending.' : 'Nothing logged on this deal that week, so it says it was a quieter week.';
      const partners = L.partnerEmails(ctx.deal, S.all('contacts'));
      draft.cc = partners.found.join(', ');
      if (partners.missing.length) draft.why += ' To cc ' + partners.missing.join(' and ') + ' automatically, save them as a contact with an email.';
    } else if (f.elements.template.value === REC_DRAFT) {
      // The email being followed up: the one named, else the last one you sent them.
      const lastEmail =
        S.get('activities', f.dataset.reply) ||
        S.all('activities')
          .filter((a) => a.companyId === f.dataset.company && a.type === 'Email' && !a.inbound && a.date && a.date <= L.todayISO())
          .sort((a, b) => b.date.localeCompare(a.date))[0];
      draft = L.followUpDraft(Object.assign({ lastEmail }, ctx));
      // A deal note starts its own thread; a prospect follow-up stays in the earlier one.
      if (!(ctx.deal && L.OPEN_STAGES.includes(ctx.deal.stage)) && f.dataset.replySubject) draft.subject = f.dataset.replySubject;
    } else {
      const t = S.get('templates', f.elements.template.value);
      renderFillIns(t, ctx);
      ctx.inputs = readFillIns();
      draft = { subject: f.dataset.replySubject || L.fillTemplate(t.subject, ctx), body: L.fillTemplate(t.body, ctx), why: '' };
    }
    if (!S.get('templates', f.elements.template.value)) renderFillIns(null, ctx);
    f.elements.subject.value = draft.subject;
    f.elements.body.value = draft.body;
    f.elements.cc.value = draft.cc || '';
    $('#draft-why').textContent = draft.why;
    $('#draft-why').hidden = !draft.why;
    updateDraftLink();
  }
  // Fill-ins for the chosen template (rate, meeting day, SF, partner, blank CRM details, [bracketed notes]).
  // Typing in one rewrites the subject and body.
  function renderFillIns(t, ctx) {
    const box = $('#draft-fillins');
    const fields = t ? L.templateFillIns((t.subject || '') + '\n' + (t.body || ''), ctx) : [];
    box.hidden = !fields.length;
    if (!fields.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `<p class="fill-ins-head">Fill-ins <span class="hint">Typing here rewrites the subject and body, so make other edits last.</span></p>
      <div class="fill-ins-grid">${fields
        .map(
          (f) => `<${f.solo ? 'div class="fill-in-field"' : 'label'}${f.bracket ? ' class="wide"' : ''}${f.key === 'OpEx' ? ' id="opex-field"' + (fields.some((x) => x.key === 'RateBasis' && x.value === 'NNN + OpEx') ? '' : ' hidden') : ''}>${esc(f.bracket ? L.fillTemplate(f.label, ctx) : f.label)}
          <span class="fill-in-row">${
            f.type === 'select'
              ? `<select data-fill-in="${esc(f.key)}">${options(f.options, f.value)}</select>`
              : f.type === 'date'
                ? `<input type="hidden" data-fill-in="${esc(f.key)}" value="${esc(f.value)}" /><input type="date" id="add-day" title="Add another day" />`
                : `<input data-fill-in="${esc(f.key)}" type="text"${f.type === 'number' ? ' inputmode="decimal"' : ''} value="${esc(f.value)}" />`
          }${
            f.saveTo ? `<button type="button" class="btn small" data-action="save-fill-in" data-field="${f.saveTo}" data-key="${esc(f.key)}" title="Save to the company so it fills in next time">Save to company</button>` : ''
          }</span>${f.solo ? `<label class="check fill-in-solo"><input type="checkbox" data-fill-in="Solo"${f.checked ? ' checked' : ''} /> Working this one alone (no partner)</label>` : ''}${f.key === 'Rate' ? `<span class="fill-in-note${f.stale ? ' stale' : ''}" id="rate-note">${esc(f.note || 'Saved for this building when you leave the box, so the next tenant there starts with it.')}</span>` : ''}${f.type === 'date' ? `<span class="fill-in-days" id="fill-in-days">${dayChips(f.value)}</span><span class="fill-in-note">Tap 1 to 3 days; they read as "Tuesday, Nov 3 or Wednesday, Nov 4".</span>` : ''}
        </${f.solo ? 'div' : 'label'}>`
        )
        .join('')}</div>`;
  }
  function onRateFillIn(changed) {
    const rateEl = $('#draft-fillins [data-fill-in="Rate"]');
    if (!rateEl) return;
    const f = $('#draft-form');
    const c = S.get('companies', f.dataset.company) || {};
    const compEl = $('#draft-fillins [data-fill-in="CompBuilding"]');
    const building = (compEl && compEl.value.trim()) || c.building || c.address;
    const rates = S.settings().buildingRates || {};
    const basisEl = $('#draft-fillins [data-fill-in="RateBasis"]');
    const opexEl = $('#draft-fillins [data-fill-in="OpEx"]');
    if (['Rate', 'RateBasis', 'OpEx'].includes(changed) && L.parseNumber(rateEl.value) && building) {
      const saved = L.rememberedRate(rates, building, L.todayISO());
      // Re-typing the same rate re-confirms it and restarts the 6 months.
      S.saveSettings({ buildingRates: L.rememberRate(rates, saved ? saved.building : building, rateEl.value, L.todayISO(), basisEl && basisEl.value, opexEl && opexEl.value) });
    } else if (changed === 'CompBuilding') {
      const saved = L.rememberedRate(rates, building, L.todayISO());
      if (saved) {
        rateEl.value = saved.rate;
        if (basisEl) basisEl.value = saved.basis || 'NNN';
        if (opexEl) opexEl.value = saved.opex || '';
      }
      refillTemplateDraft();
    }
    if ($('#opex-field')) $('#opex-field').hidden = !(basisEl && basisEl.value === 'NNN + OpEx');
    const now = L.rememberedRate(S.settings().buildingRates || {}, building, L.todayISO());
    const note = $('#rate-note');
    note.textContent = now ? now.note : 'Saved for this building when you leave the box, so the next tenant there starts with it.';
    note.classList.toggle('stale', Boolean(now && now.stale));
  }
  // Meeting-day buttons: the next 5 weekdays plus any day added with the date box; picked ones are highlighted.
  function dayChips(value) {
    const picked = String(value || '').split(',').filter(Boolean);
    const days = Array.from(new Set(L.nextBusinessDays(L.todayISO(), 5).concat(picked))).sort();
    const label = (iso) => L.parseISODate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return days.map((d) => `<button type="button" class="btn small${picked.includes(d) ? ' on' : ''}" data-action="pick-day" data-day="${d}" aria-pressed="${picked.includes(d)}">${esc(label(d))}</button>`).join('');
  }
  function toggleMeetingDay(day, add) {
    const el = $('#draft-fillins [data-fill-in="MeetingDay"]');
    if (!el || !day) return;
    const picked = el.value.split(',').filter(Boolean);
    const next = picked.includes(day) && !add ? picked.filter((d) => d !== day) : Array.from(new Set(picked.concat(day)));
    el.value = next.sort().join(',');
    $('#fill-in-days').innerHTML = dayChips(el.value);
    refillTemplateDraft();
  }
  function readFillIns() {
    const inputs = {};
    document.querySelectorAll('#draft-fillins [data-fill-in]').forEach((el) => (inputs[el.dataset.fillIn] = el.type === 'checkbox' ? (el.checked ? 'yes' : 'no') : el.value));
    return inputs;
  }
  function refillTemplateDraft() {
    const f = $('#draft-form');
    const t = S.get('templates', f.elements.template.value);
    if (!t) return;
    const ctx = Object.assign(draftContext(f.dataset.company, f.elements.contact.value, f.dataset.deal), { inputs: readFillIns() });
    f.elements.subject.value = f.dataset.replySubject || L.fillTemplate(t.subject, ctx);
    f.elements.body.value = L.fillTemplate(t.body, ctx);
    updateDraftLink();
  }
  function updateDraftLink() {
    const f = $('#draft-form');
    const p = S.get('contacts', f.elements.contact.value);
    $('#draft-open').href = L.mailtoLink(p ? p.email : '', f.elements.subject.value, f.elements.body.value, f.elements.cc.value.split(/[;,\s]+/).filter(Boolean).join(','));
  }

  function openForm(col, id, ctx) {
    ctx = ctx || {};
    const existing = id ? S.get(col, id) : null;
    const rec = existing ? Object.assign({}, existing) : defaultsFor(col, ctx);
    const dlg = $('#modal');
    const task = col === 'activities' && rec.type === 'Task';
    if (task) rec.date = activityDue(rec) || rec.date;
    const fields = task ? TASK_FIELDS : FIELDS[col];
    const contextAsset = col === 'properties' ? (S.get('deals', rec.dealId) || {}).assetClass : '';
    dlg.innerHTML = `<form method="dialog" id="record-form" data-col="${col}" data-id="${esc(existing ? existing.id : '')}" data-context-asset="${esc(contextAsset || '')}"${task ? ' data-task="1"' : ''}>
      <header><h2>${existing ? 'Edit' : 'New'} ${task ? 'task' : LABELS[col]}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></header>
      <div class="form-grid">${fields.map((f) => fieldHTML(f, rec)).join('')}</div>
      <footer>
        ${col === 'activities' && !existing && !task ? '<label class="check"><input type="checkbox" name="__another" /> Save & schedule next touch</label>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </footer>
    </form>`;
    if (col === 'properties') dlg.querySelector('form').insertAdjacentHTML('beforeend', `<input type="hidden" name="dealId" value="${esc(rec.dealId)}"/>`);
    syncFormDependencies(dlg.querySelector('form'));
    dlg.showModal();
    const first = dlg.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea');
    if (first && !existing) first.focus();
  }

  // Show/hide asset-specific fields and filter contact/deal pickers by the chosen company.
  function syncFormDependencies(form) {
    const assetSel = form.querySelector('[name=assetClass]');
    const asset = assetSel ? assetSel.value : form.dataset.contextAsset;
    $$('[data-asset]', form).forEach((el) => {
      el.hidden = !(!asset || asset === 'Office & Industrial' || asset === el.dataset.asset);
    });
    const company = form.querySelector('[name=companyId]');
    $$('select[data-filter-by]', form).forEach((sel) => {
      $$('option[data-company]', sel).forEach((o) => {
        o.hidden = company && company.value && o.dataset.company !== company.value;
      });
      if (sel.selectedOptions[0] && sel.selectedOptions[0].hidden) sel.value = '';
    });
    $$('.ref-box', form).forEach(syncRefText);
  }

  // ----- searchable company / contact / deal pickers -----

  function syncRefText(box) {
    const sel = box.querySelector('select');
    box.querySelector('.ref-search').value = sel.value && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
  }

  function renderRefMenu(input) {
    const box = input.closest('.ref-box');
    const sel = box.querySelector('select');
    const menu = box.querySelector('.ref-menu');
    const typed = input.value.trim();
    const current = sel.value && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
    const q = typed === current ? '' : typed.toLowerCase();
    const all = [...sel.options].filter((o) => o.value && !o.hidden && o.value !== input.dataset.exclude);
    const hits = all.filter((o) => !q || o.textContent.toLowerCase().includes(q)).slice(0, 40);
    const exact = all.some((o) => o.textContent.trim().toLowerCase() === q);
    const form = input.closest('form');
    const company = form && form.querySelector('select[name=companyId]');
    let create = '';
    // Someone saved under another company (e.g. a duplicate) can be moved here instead of re-entered.
    const otherDeals = q && input.dataset.ref === 'deals' && company && company.value ? [...sel.options].filter((o) => o.value && o.hidden && o.textContent.toLowerCase().includes(q)).slice(0, 10) : [];
    if (otherDeals.length)
      create += `<div class="ref-empty">Deals for other companies:</div>` + otherDeals.map((o) => `<button type="button" data-ref-pick="${esc(o.value)}">${esc(o.textContent)}<span class="sub"> · ${esc(companyName(o.dataset.company))}</span></button>`).join('');
    const elsewhere = q && input.dataset.ref === 'contacts' && company && company.value ? [...sel.options].filter((o) => o.value && o.hidden && o.textContent.toLowerCase().includes(q)).slice(0, 10) : [];
    if (elsewhere.length)
      create += `<div class="ref-empty">Saved under another company:</div>` + elsewhere.map((o) => `<button type="button" data-ref-move="${esc(o.value)}">${esc(o.textContent)}<span class="sub"> · ${esc(companyName(o.dataset.company))} → move to ${esc(companyName(company.value))}</span></button>`).join('');
    if (input.dataset.noCreate) {
      /* picking only */
    } else if (q && !exact && input.dataset.ref === 'companies') create = `<button type="button" class="ref-new" data-ref-create="companies">+ Add "${esc(typed)}" as a new company</button>`;
    else if (q && !exact && input.dataset.ref === 'contacts')
      create += company && company.value
        ? `<button type="button" class="ref-new" data-ref-create="contacts">+ Add "${esc(typed)}" as a new contact at ${esc(companyName(company.value))}</button>`
        : '<div class="ref-empty">Pick a company first to add a new contact.</div>';
    menu.innerHTML =
      hits.map((o) => `<button type="button" data-ref-pick="${esc(o.value)}" class="${o.value === sel.value ? 'on' : ''}">${esc(o.textContent)}${input.dataset.ref !== 'companies' && o.dataset.company && !(company && company.value) ? `<span class="sub"> · ${esc(companyName(o.dataset.company))}</span>` : ''}</button>`).join('') +
      (!hits.length && !create ? '<div class="ref-empty">No matches.</div>' : '') +
      create;
    menu.hidden = false;
  }

  function pickRef(box, value) {
    const sel = box.querySelector('select');
    sel.value = value;
    box.querySelector('.ref-menu').hidden = true;
    syncRefText(box);
    // Picking a contact or deal with no company chosen yet fills in its company.
    const form = box.closest('form');
    const company = form && form.querySelector('select[name=companyId]');
    const opt = sel.selectedOptions[0];
    if (company && company !== sel && !company.value && opt && opt.dataset.company) {
      company.value = opt.dataset.company;
      company.dispatchEvent(new Event('change', { bubbles: true }));
      sel.value = value;
      syncRefText(box);
    }
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function moveContactHere(box, contactId) {
    const p = S.get('contacts', contactId);
    const companyId = box.closest('form').querySelector('select[name=companyId]').value;
    if (!p || !companyId || !confirm(`Move ${contactName(p)} from ${companyName(p.companyId)} to ${companyName(companyId)}?`)) return;
    S.upsert('contacts', { id: p.id, companyId });
    const opt = box.querySelector(`select option[value="${CSS.escape(p.id)}"]`);
    opt.dataset.company = companyId;
    opt.hidden = false;
    pickRef(box, p.id);
    toast(`Moved ${contactName(p)} to ${companyName(companyId)}.`);
  }

  // Attach a contact already in the CRM to this company, or add a new one by name.
  function openLinkContact(companyId) {
    const dlg = $('#modal');
    if (dlg.open) dlg.close();
    dlg.innerHTML = `<form method="dialog" id="link-contact-form">
      <header><h2>Add a contact to ${esc(companyName(companyId))}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></header>
      <div class="form-grid"><select name="companyId" hidden><option value="${esc(companyId)}" selected></option></select>
        ${fieldHTML({ key: 'contactId', label: 'Search your contacts by name', type: 'ref', ref: 'contacts', filterBy: 'companyId', wide: true }, {})}
        <p class="hint wide">Type a name. Someone saved under another company (for example a duplicate like "raymondjames.com") can be moved here. If they aren't in the CRM yet, add them by name and fill in the rest on their contact record.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-action="new" data-col="contacts" data-company="${esc(companyId)}">New contact form</button><button type="button" class="btn primary" data-action="close-modal">Done</button></footer>
    </form>`;
    syncFormDependencies(dlg.querySelector('form'));
    dlg.showModal();
    dlg.querySelector('.ref-search').focus();
  }

  // Merge a duplicate company into another and delete the duplicate.
  function openMerge(companyId) {
    const dlg = $('#modal');
    if (dlg.open) dlg.close();
    dlg.innerHTML = `<form method="dialog" id="merge-form" data-from="${esc(companyId)}">
      <header><h2>Merge ${esc(companyName(companyId))} into another company</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></header>
      <div class="form-grid">
        ${fieldHTML({ key: 'targetId', label: 'Keep this company', type: 'ref', ref: 'companies', required: true, noCreate: true, exclude: companyId, wide: true }, {})}
        <p class="hint wide">Its contacts, deals, emails, tasks, documents and critical dates move to the company you keep, which also picks up any details it's missing. "${esc(companyName(companyId))}" is saved as an alias, and HubSpot activity for it will land on the kept company. Then this duplicate is deleted.</p>
      </div>
      <footer><span class="spacer"></span><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">Merge</button></footer>
    </form>`;
    dlg.showModal();
    dlg.querySelector('.ref-search').focus();
  }

  function mergeCompanies(fromId, toId) {
    const r = S.mergeCompanies(fromId, toId);
    if (!r) return;
    $('#modal').close();
    location.hash = '#/company/' + toId;
    toast(`Merged ${r.name} into ${companyName(toId)} (${r.moved} records moved).`);
  }

  function createRef(box, kind) {
    const name = box.querySelector('.ref-search').value.trim();
    const sel = box.querySelector('select');
    let rec;
    if (kind === 'companies') rec = S.upsert('companies', { name, status: 'Target', priority: 'B', growthSignal: 'Unknown', source: 'Manual' });
    else {
      const companyId = box.closest('form').querySelector('select[name=companyId]').value;
      const parts = name.split(/\s+/);
      rec = S.upsert('contacts', { companyId, firstName: parts[0], lastName: parts.slice(1).join(' ') });
    }
    const label = kind === 'companies' ? rec.name : contactName(rec);
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(rec.id)}" ${rec.companyId ? `data-company="${esc(rec.companyId)}"` : ''}>${esc(label)}</option>`);
    pickRef(box, rec.id);
    toast(`Added ${label}. ${kind === 'contacts' ? 'Open the company page to add their email and phone.' : ''}`);
  }

  function readForm(form, col) {
    const rec = {};
    (form.dataset.task ? TASK_FIELDS : FIELDS[col]).forEach((f) => {
      if (f.section) return;
      const el = form.elements[f.key];
      if (!el) return;
      if (f.type === 'checkbox') rec[f.key] = el.checked;
      else if (f.type === 'number') rec[f.key] = el.value === '' ? '' : Number(el.value);
      else rec[f.key] = el.value.trim();
    });
    if (form.elements.dealId && col === 'properties') rec.dealId = form.elements.dealId.value;
    if (form.dataset.task) rec.followUpDate = rec.date;
    return rec;
  }

  function saveForm(form) {
    const col = form.dataset.col;
    const rec = readForm(form, col);
    if (form.dataset.id) rec.id = form.dataset.id;
    if (col === 'deals' && rec.stage === 'Closed Won' && !rec.closedDate) rec.closedDate = L.todayISO();
    if (col === 'activities' && !form.dataset.id && ['Call', 'Email', 'LinkedIn', 'Meeting'].includes(rec.type) && rec.companyId && (rec.date || '') <= L.todayISO()) {
      const touch = sharedListTouch(S.get('companies', rec.companyId));
      if (Object.keys(touch).length) S.upsert('companies', Object.assign({ id: rec.companyId }, touch), { silent: true });
    }
    if (col === 'deals' && rec.stage === 'Closed Won' && (!form.dataset.id || S.get('deals', form.dataset.id).stage !== 'Closed Won')) setTimeout(celebrate, 200);
    const wasSecured = col === 'companies' && form.dataset.id && L.leadStage(S.get('companies', form.dataset.id)) === 'Secured Lead';
    const saved = S.upsert(col, rec);
    if (col === 'activities') runWorkflows();
    if (col === 'companies' && !wasSecured && L.leadStage(saved) === 'Secured Lead' && createDealForLead(saved.id)) toast('Secured! Created a deal in Intro Call.');
    if (col === 'deals' && saved.inPortfolioSheet && S.settings().sheetSyncUrl) setTimeout(() => syncSheet(false), 0);
    const touched = col === 'companies' ? saved : col === 'contacts' ? S.get('companies', saved.companyId) : col === 'activities' ? S.get('companies', saved.companyId) : null;
    const listId = (col === 'contacts' && saved.sharedList) || (touched && touched.sharedList);
    if (listId) setTimeout(() => syncSharedList(listId, false), 300);
    const another = form.elements.__another && form.elements.__another.checked;
    $('#modal').close();
    if (!form.dataset.id && col === 'companies') location.hash = '#/company/' + saved.id;
    else if (!form.dataset.id && col === 'deals') location.hash = '#/deal/' + saved.id;
    else render();
    if (another) {
      // Close out this touch and queue the next one, prefilled.
      openForm('activities', null, { company: saved.companyId, contact: saved.contactId, deal: saved.dealId });
      const f = $('#record-form');
      f.elements.type.value = 'Task';
      f.elements.date.value = L.addDays(L.todayISO(), 7);
      f.elements.followUpDate.value = L.addDays(L.todayISO(), 7);
      f.elements.subject.value = 'Follow up: ' + saved.subject;
    }
  }

  // ---------- import / export ----------

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  const COMPANY_COLUMNS = [
    { key: 'name', label: 'Company' },
    { key: 'assetClass', label: 'Asset Class' },
    { key: 'industry', label: 'Industry' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'address', label: 'Address' },
    { key: 'building', label: 'Building' },
    { key: 'floor', label: 'Floor/Suite' },
    { key: 'city', label: 'City' },
    { key: 'submarket', label: 'Submarket' },
    { key: 'sfOccupied', label: 'SF Occupied' },
    { key: 'headcount', label: 'Employees' },
    { key: 'leaseExpiration', label: 'Lease Expiration' },
    { key: 'landlord', label: 'Landlord' },
    { key: 'currentRate', label: 'Current Rent' },
    { key: 'rateBasis', label: 'Rent Basis' },
    { key: 'growthSignal', label: 'Growth' },
    { key: 'source', label: 'Source' },
    { key: 'website', label: 'Website' },
    { key: 'tags', label: 'Tags' },
    { key: 'notes', label: 'Notes' },
  ];

  function stamp() {
    return L.todayISO();
  }

  function exportCompanies(rows, name) {
    const touches = lastTouchMap();
    const primary = (id) => {
      const cs = S.all('contacts').filter((c) => c.companyId === id);
      return cs.find((c) => c.role === 'Decision Maker') || cs[0];
    };
    const cols = COMPANY_COLUMNS.concat([
      { label: 'Prospect Score', value: (c) => scoreOf(c, touches) },
      { label: 'Months to Expiration', value: (c) => L.monthsUntil(c.leaseExpiration) },
      { label: 'Last Touch', value: (c) => touches[c.id] || '' },
      { label: 'Primary Contact', value: (c) => contactName(primary(c.id)) },
      { label: 'Contact Title', value: (c) => (primary(c.id) || {}).title || '' },
      { label: 'Contact Phone', value: (c) => (primary(c.id) || {}).phone || '' },
      { label: 'Contact Email', value: (c) => (primary(c.id) || {}).email || '' },
    ]);
    download(name + '-' + stamp() + '.csv', L.toCSV(rows, cols));
  }

  function importCompanies(records, opts) {
    const existing = S.all('companies');
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const toCreate = [];
    records.forEach((rec) => {
      if (!rec.name) return skipped++;
      const clean = L.cleanImportedCompany(rec, {});
      const key = L.normalizeCompanyName(clean.name);
      const addr = L.normalizeAddress(clean.address);
      const match = existing
        .concat(toCreate)
        .find((c) => L.normalizeCompanyName(c.name) === key && (!addr || !c.address || L.normalizeAddress(c.address) === addr));
      if (match) {
        Object.keys(rec).forEach((k) => {
          if (clean[k] !== '' && clean[k] !== undefined && k !== 'status') match[k] = clean[k];
        });
        if (!toCreate.includes(match)) {
          S.upsert('companies', match, { silent: true });
          updated++;
        }
      } else {
        toCreate.push(
          Object.assign({ priority: 'B', growthSignal: 'Unknown', source: opts.source }, clean, {
            assetClass: clean.assetClass || opts.assetClass,
            status: rec.status ? clean.status : opts.status,
          })
        );
        created++;
      }
    });
    S.bulkInsert('companies', toCreate);
    return `Imported ${created} new companies, updated ${updated}${skipped ? `, skipped ${skipped} without a name` : ''}.`;
  }

  function importContacts(records, opts) {
    let created = 0;
    let skipped = 0;
    let newCompanies = 0;
    const emails = new Set(S.all('contacts').map((c) => (c.email || '').toLowerCase()).filter(Boolean));
    records.forEach((rec) => {
      const names = rec.firstName || rec.lastName ? { firstName: rec.firstName || '', lastName: rec.lastName || '' } : L.splitName(rec.fullName);
      const email = (rec.email || '').toLowerCase();
      if (!names.firstName || !rec.company || (email && emails.has(email))) return skipped++;
      let company = L.findCompanyByName(S.all('companies'), rec.company);
      if (!company) {
        company = S.upsert('companies', { name: rec.company, assetClass: opts.assetClass, status: opts.status, priority: 'B', growthSignal: 'Unknown', source: opts.source }, { silent: true });
        newCompanies++;
      }
      S.upsert('contacts', { companyId: company.id, firstName: names.firstName, lastName: names.lastName, title: rec.title || '', email: rec.email || '', phone: rec.phone || '', mobile: rec.mobile || '', linkedin: rec.linkedin || '', notes: rec.notes || '' }, { silent: true });
      if (email) emails.add(email);
      created++;
    });
    S.saveSettings({}); // persist + notify
    return `Imported ${created} contacts${newCompanies ? `, created ${newCompanies} new companies` : ''}${skipped ? `, skipped ${skipped} (missing name/company or duplicate email)` : ''}.`;
  }

  function importPortfolio(records, opts) {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let newCompanies = 0;
    records.forEach((rec) => {
      if (!rec.company) return skipped++;
      let company = L.findCompanyByName(S.all('companies'), rec.company);
      const assetClass = L.normalizeAssetClass(rec.assetClass) || opts.assetClass;
      if (!company) {
        company = S.upsert('companies', { name: rec.company, assetClass, status: opts.status, priority: 'B', growthSignal: 'Unknown', source: opts.source }, { silent: true });
        newCompanies++;
      }
      const num = (v) => (L.parseNumber(v) === null ? '' : L.parseNumber(v));
      const dealType = L.normalizeDealType(rec.dealType);
      const deal = {
        companyId: company.id,
        name: rec.name || company.name + ' – ' + (dealType || 'Lease'),
        stage: 'Closed Won',
        dealType,
        assetClass,
        closedDate: L.normalizeDate(rec.closedDate),
        actualSF: num(rec.actualSF),
        estSF: num(rec.actualSF),
        totalLeaseValue: num(rec.totalLeaseValue),
        commissionEarned: num(rec.commissionEarned),
        termMonths: L.parseTermMonths(rec.termMonths) || '',
        budgetRate: num(rec.budgetRate),
        building: rec.building || '',
        address: rec.address || '',
        targetSubmarkets: rec.submarket || '',
        leaseCommencement: L.normalizeDate(rec.leaseCommencement),
        newLeaseExpiration: L.normalizeDate(rec.newLeaseExpiration),
        notes: [rec.landlord ? 'Landlord: ' + rec.landlord : '', rec.notes || ''].filter(Boolean).join('\n'),
      };
      // Same client, closed within a month, and SF agrees (or wasn't recorded): it's the same deal, e.g. one synced from HubSpot.
      const existing = S.all('deals').find((d) => {
        if (d.companyId !== company.id || d.stage !== 'Closed Won') return false;
        const gap = d.closedDate && deal.closedDate ? Math.abs(L.daysBetween(d.closedDate, deal.closedDate)) : null;
        const sfAgrees = L.parseNumber(d.actualSF) === null || String(d.actualSF) === String(deal.actualSF);
        return gap !== null && gap <= 31 && sfAgrees;
      });
      if (existing) {
        deal.id = existing.id;
        if (!rec.name) delete deal.name; // keep the existing deal's name
      }
      S.upsert('deals', deal, { silent: true });
      existing ? updated++ : created++;
      // The new lease's expiration is the next renewal opportunity for this client.
      const patch = { id: company.id };
      if (deal.newLeaseExpiration && (!company.leaseExpiration || deal.newLeaseExpiration > company.leaseExpiration)) patch.leaseExpiration = deal.newLeaseExpiration;
      if (deal.actualSF && !company.sfOccupied) patch.sfOccupied = deal.actualSF;
      if (deal.building && !company.building) patch.building = deal.building;
      if (deal.address && !company.address) patch.address = deal.address;
      if (rec.submarket && !company.submarket) patch.submarket = rec.submarket;
      if (!['Active Client', 'Past Client'].includes(company.status)) patch.status = 'Past Client';
      S.upsert('companies', patch, { silent: true });
    });
    S.saveSettings({}); // persist + notify
    return `Imported ${created} closed deals${updated ? `, updated ${updated}` : ''}${newCompanies ? `, created ${newCompanies} clients` : ''}${skipped ? `, skipped ${skipped} without a client name` : ''}.`;
  }

  function handleFile(kind, file) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (kind === 'backup') {
        try {
          const data = JSON.parse(text);
          if (data.mergeOnly) {
            // Add-on files (e.g. a batch of researched contacts) are never allowed to replace the whole CRM.
            const n = S.COLLECTIONS.map((c) => (data[c] || []).length).reduce((a, b) => a + b, 0);
            const merges = (data.merge || []).filter((m) => S.get('companies', m.from) && S.get('companies', m.to)).length;
            const removes = S.COLLECTIONS.map((c) => ((data.remove && data.remove[c]) || []).filter((id) => S.get(c, id)).length).reduce((a, b) => a + b, 0);
            const what = [n ? `update ${n} records` : '', merges ? `merge ${merges} duplicate compan${merges > 1 ? 'ies' : 'y'}` : '', removes ? `delete ${removes} record${removes > 1 ? "s" : ""}` : ""].filter(Boolean).join(', ');
            if (!confirm(`From "${file.name}": ${what || 'nothing to change'}. Existing records with the same ID are updated; nothing else changes. Continue?`)) return;
            S.importJSON(text, 'merge');
            return toast(`Done: ${what}.`);
          }
          const replace = confirm('Restore this backup?\n\nOK = REPLACE all current data with the backup.\nCancel = MERGE the backup into current data.');
          S.importJSON(text, replace ? 'replace' : 'merge');
          toast('Backup restored.');
        } catch (e) {
          alert('That file is not a valid backup: ' + e.message);
        }
        return;
      }
      showImportPreview(kind, file.name, L.parseCSV(text));
    };
    if (kind === 'highlights') {
      if (!/\.pdf$/i.test(file.name)) return alert('Drop the Market Highlights PDF here.');
      toast('Reading ' + file.name + '…');
      readPdfLines(file, { image: true }).then(
        ({ lines, image }) => {
          const h = L.parseMarketHighlights(lines, file.name);
          const caption = L.highlightsPost(h, { firm: S.settings().myFirm });
          const rec = S.upsert('marketing', {
            title: [h.market, h.assetClass && h.assetClass.toLowerCase(), 'market highlights', h.quarter].filter(Boolean).join(' ').replace(/^(\w)/, (m) => m.toUpperCase()),
            kind: 'Social post',
            status: 'Ready',
            channel: 'LinkedIn',
            assetClass: ['Office', 'Industrial'].includes(h.assetClass) ? h.assetClass : h.assetClass === 'Flex' ? 'Office & Industrial' : '',
            dataQuarter: h.quarter,
            caption,
            image,
            sourceFile: file.name,
            notes: h.items.length ? h.items.map((it) => it.title).join(' · ') : 'No highlights found in the text; write the caption by hand.',
          });
          state.marketing.tab = 'social';
          if (!location.hash.startsWith('#/marketing')) location.hash = '#/marketing';
          else render();
          openSocialPreview(rec.id);
        },
        (e) => alert(e.message)
      );
      return;
    }
    if (/\.pdf$/i.test(file.name)) {
      if (kind !== 'marketStats') return alert('PDFs can be read on the Research page (Research reports). For this import, use an Excel or CSV file.');
      toast('Reading ' + file.name + '…');
      readPdfLines(file).then(
        (lines) => {
          importPreview = { kind: 'research', filename: file.name, report: L.parseResearchReport(lines, file.name) };
          Object.assign(state.research, { statsAsset: importPreview.report.assetClass, statsSub: '', statsQuarter: '' });
          if (!location.hash.startsWith('#/research')) location.hash = '#/research';
          else render();
          window.scrollTo(0, 0);
        },
        (e) => alert(e.message)
      );
      return;
    }
    if (kind !== 'backup' && isExcel(file)) {
      readExcelRows(file, IMPORT_ALIASES[kind]).then((rows) => showImportPreview(kind, file.name, rows), (e) => alert(e.message));
      return;
    }
    reader.readAsText(file);
  }

  const IMPORT_ALIASES = { companies: L.COMPANY_IMPORT_ALIASES, contacts: L.CONTACT_IMPORT_ALIASES, portfolio: L.PORTFOLIO_IMPORT_ALIASES, comps: L.COMP_IMPORT_ALIASES, compsAlign: L.COMP_IMPORT_ALIASES, marketStats: L.MARKET_STAT_ALIASES };
  const isExcel = (file) => /\.(xlsx|xlsm|xls)$/i.test(file.name);

  function showImportPreview(kind, filename, rows) {
    importPreview = { kind, filename, result: L.rowsToRecords(rows, IMPORT_ALIASES[kind]) };
    // Research sheets name the quarter and product in the file name or a title row.
    const title = filename + ' ' + rows.slice(0, 6).map((r) => r.join(' ')).join(' ');
    importPreview.quarter = L.normalizeQuarter(title) || L.latestDataQuarter(L.todayISO());
    importPreview.assetClass = kind === 'marketStats' && /flex|r&d/i.test(filename) ? 'Flex' : /industrial|warehouse|logistics/i.test(title) ? 'Industrial' : 'Office';
    const termHead = importPreview.result.mapping.termMonths !== undefined ? importPreview.result.headers[importPreview.result.mapping.termMonths] : '';
    importPreview.termUnit = /\bmo/i.test(termHead) ? 'months' : /\b(yr|year)/i.test(termHead) ? 'years' : '';
    if (location.hash !== '#/data') location.hash = '#/data';
    else render();
    window.scrollTo(0, 0);
  }

  // Excel files are read in the browser by SheetJS, loaded only when one is dropped. The file never leaves the computer.
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      el.onload = () => resolve(window.XLSX);
      el.onerror = () => reject(new Error('Could not load the Excel reader. Check your connection, or save the sheet as CSV and import that.'));
      document.head.appendChild(el);
    });
  }
  // PDFs are read in the browser by pdf.js (loaded only when one is dropped); the file never leaves the computer.
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  function loadPDFJS() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = PDFJS + 'pdf.min.js';
      el.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      el.onerror = () => reject(new Error('Could not load the PDF reader. Check your connection and try again.'));
      document.head.appendChild(el);
    });
  }
  // opts.image: also return the first page as a JPEG (for social posts).
  function readPdfLines(file, opts) {
    return Promise.all([loadPDFJS(), file.arrayBuffer()]).then(async ([pdfjs, buf]) => {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      const lines = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const content = await (await doc.getPage(n)).getTextContent();
        lines.push(...L.layoutLines(content.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }))));
      }
      if (!(opts && opts.image)) return lines;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return { lines, image: canvas.toDataURL('image/jpeg', 0.88) };
    });
  }

  // A social post's caption and image, ready to copy, download and post.
  function openSocialPreview(id) {
    const p = S.get('marketing', id);
    if (!p) return;
    const dlg = $('#modal');
    if (dlg.open) dlg.close();
    dlg.innerHTML = `<form method="dialog" class="social-preview" data-id="${esc(id)}">
      <header><h2>${esc(p.title)}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></header>
      <div class="social-body">
        ${p.image ? `<img src="${p.image}" alt="${esc(p.title)}" />` : ''}
        <label>Caption<textarea name="caption" rows="14">${esc(p.caption || '')}</textarea></label>
      </div>
      <footer><span class="hint">Edit the caption here; changes are saved.</span><span class="spacer"></span>
        ${p.image ? '<button type="button" class="btn" data-action="download-post-image">Download image</button>' : ''}
        <button type="button" class="btn" data-action="copy-caption">Copy caption</button>
        <button type="button" class="btn primary" data-action="mark-posted">Mark posted</button>
      </footer>
    </form>`;
    dlg.showModal();
  }

  // Rows of the sheet whose columns best match what's being imported (a workbook may hold several tabs).
  function readExcelRows(file, aliases) {
    return Promise.all([loadXLSX(), file.arrayBuffer()]).then(([XLSX, buf]) => {
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheets = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' }));
      const score = (rows) => Object.keys(L.rowsToRecords(rows, aliases).mapping).length;
      return sheets.sort((a, b) => score(b) - score(a))[0] || [];
    });
  }

  function importMarketStats(records, opts) {
    const rows = records.map((r) => L.cleanMarketStat(r, opts)).filter((x) => x.quarter && x.submarket && Object.keys(x).length > 3);
    const fresh = new Set(rows.map((x) => x.quarter + '|' + x.assetClass));
    const kept = (S.settings().marketStats || []).filter((x) => !fresh.has(x.quarter + '|' + x.assetClass));
    S.saveSettings({ marketStats: kept.concat(rows) });
    return `Market stats: ${rows.length} submarkets saved for ${opts.quarter} ${opts.assetClass}.`;
  }

  function importComps(records, opts) {
    const plan = compPlan(importPreview, opts);
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let held = 0;
    plan.forEach((x, i) => {
      const comp = x.comp;
      if (!comp.building) return skipped++;
      const choice = x.status === 'new' ? 'add' : opts.choices[i] || (x.status === 'duplicate' && x.where === 'crm' ? 'update' : 'skip');
      if (choice === 'skip') return held++;
      if (choice === 'update') {
        Object.keys(comp).forEach((k) => (comp[k] === '' || comp[k] === undefined || (comp.guessed || []).includes(k)) && delete comp[k]);
        S.upsert('comps', Object.assign({ id: x.match.id }, comp), { silent: true });
        return updated++;
      }
      S.upsert('comps', comp, { silent: true });
      added++;
    });
    S.saveSettings({});
    return `Comps: ${added} added${updated ? `, ${updated} updated` : ''}${held ? `, ${held} duplicate${held > 1 ? 's' : ''} skipped` : ''}${skipped ? `, ${skipped} rows without a building or address skipped` : ''}.`;
  }

  // ---------- Google Sheet sync ----------

  let syncing = false;

  function sheetSyncStatus() {
    const st = S.settings();
    if (!st.sheetSyncUrl) return '';
    if (syncing) return '<p class="sub sync-status">Syncing with Google Sheet…</p>';
    return `<p class="sub sync-status">${st.sheetLastSync ? 'Google Sheet synced ' + esc(new Date(st.sheetLastSync).toLocaleString()) : 'Google Sheet not synced yet'}${st.sheetLastError ? ` · <span class="red-text">${esc(st.sheetLastError)}</span>` : ''}</p>`;
  }

  async function sheetRequest(method, body) {
    const st = S.settings();
    const res =
      method === 'GET'
        ? await fetch(st.sheetSyncUrl + (st.sheetSyncUrl.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(st.sheetSyncKey))
        : // text/plain avoids a CORS preflight, which Apps Script web apps don't answer.
          await fetch(st.sheetSyncUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: st.sheetSyncKey }, body)) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Sync failed');
    return data;
  }

  function sheetValue(field, v) {
    // Dates go back in the sheet's M/D/YYYY style.
    if (/Date$|Commencement$/.test(field) && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split('-');
      return Number(m) + '/' + Number(d) + '/' + y;
    }
    return v;
  }

  function recordToHeaders(record, headers, map) {
    const out = {};
    Object.keys(record).forEach((f) => {
      if (map[f] !== undefined) out[headers[map[f]]] = sheetValue(f, record[f]);
    });
    return out;
  }

  // Pull sheet -> CRM, push CRM edits -> sheet. The sheet wins when both sides changed the same deal.
  async function syncSheet(manual) {
    const st = S.settings();
    if (!st.sheetSyncUrl || !st.sheetSyncKey || syncing) return;
    syncing = true;
    render();
    try {
      const data = await sheetRequest('GET');
      const plan = L.planSheetSync({ headers: data.headers, rows: data.rows, deals: S.all('deals'), companies: S.all('companies') });
      const now = () => new Date().toISOString();
      const changes = [];
      const touched = [];
      const companyFor = (name, assetClass) => {
        return (
          L.findCompanyByName(S.all('companies'), name) ||
          S.upsert('companies', { name, assetClass: assetClass || 'Office', status: 'Past Client', priority: 'B', growthSignal: 'Unknown', source: 'Portfolio sheet' }, { silent: true })
        );
      };
      plan.creates.forEach((c) => {
        const company = companyFor(c.rec.company, c.deal.assetClass);
        const deal = S.upsert(
          'deals',
          Object.assign({ name: company.name + ' – ' + (c.rec.notes && c.rec.notes.length <= 40 ? c.rec.notes : c.deal.dealType || 'Lease'), companyId: company.id, assetClass: company.assetClass, rateBasis: 'Full Service ($/SF/yr)' }, c.deal, { inPortfolioSheet: true, sheetHash: c.hash }),
          { silent: true }
        );
        changes.push({ crmId: deal.id, row: c.row, values: {} });
        touched.push(deal.id);
      });
      plan.updates.forEach((u) => {
        S.upsert('deals', Object.assign({ id: u.dealId }, u.patch, { inPortfolioSheet: true, sheetHash: u.hash }), { silent: true });
        if (u.needsId) changes.push({ crmId: u.dealId, row: u.row, values: {} });
        touched.push(u.dealId);
      });
      plan.pushes.forEach((p) => changes.push({ crmId: p.dealId, row: p.row, values: recordToHeaders(p.record, data.headers, plan.map) }));
      plan.appends.forEach((a) => changes.push({ crmId: a.dealId, values: recordToHeaders(a.record, data.headers, plan.map) }));

      // A closed deal tells us the client's SF and building when the company record lacks them.
      touched.forEach((id) => {
        const deal = S.get('deals', id);
        const co = deal && deal.stage === 'Closed Won' ? S.get('companies', deal.companyId) : null;
        if (!co) return;
        const patch = {};
        if (deal.actualSF && !co.sfOccupied) patch.sfOccupied = deal.actualSF;
        if (deal.building && !co.building) patch.building = deal.building;
        if (Object.keys(patch).length) S.upsert('companies', Object.assign({ id: co.id }, patch), { silent: true });
      });

      let result = { rows: data.rows, headers: data.headers };
      if (changes.length) result = await sheetRequest('POST', { changes });
      // Record what the sheet now holds so the next sync can tell which side changed.
      const map = L.mapSheetHeaders(result.headers);
      const stamp = now();
      result.rows.forEach((r) => {
        const rec = L.sheetRowToRecord(r.values, map);
        if (rec.crmId && S.get('deals', rec.crmId)) S.upsert('deals', { id: rec.crmId, sheetHash: L.recordHash(rec), sheetSyncedAt: stamp, inPortfolioSheet: true }, { silent: true, touch: false });
      });
      S.saveSettings({ sheetLastSync: stamp, sheetLastError: '' });
      const parts = [];
      if (plan.creates.length) parts.push(`${plan.creates.length} added from sheet`);
      if (plan.updates.filter((u) => Object.keys(u.patch).length).length) parts.push(`${plan.updates.filter((u) => Object.keys(u.patch).length).length} updated from sheet`);
      if (plan.pushes.length + plan.appends.length) parts.push(`${plan.pushes.length + plan.appends.length} sent to sheet`);
      if (plan.conflicts) parts.push(`${plan.conflicts} edited in both places (sheet version kept)`);
      if (manual || parts.length) toast('Google Sheet: ' + (parts.join(', ') || 'already up to date'));
    } catch (e) {
      S.saveSettings({ sheetLastError: 'Last sync failed: ' + e.message });
      if (manual) toast('Google Sheet sync failed: ' + e.message);
    } finally {
      syncing = false;
      render();
    }
  }

  // Keep the Portfolio page live: sync on open, after saving a tracked deal, and every 2 minutes while open.
  function maybeAutoSync() {
    const st = S.settings();
    if (!st.sheetSyncUrl || syncing || document.hidden) return;
    if (!st.sheetLastSync || Date.now() - new Date(st.sheetLastSync).getTime() > 60000) syncSheet(false);
  }
  setInterval(() => {
    if (parseRoute().name === 'portfolio') maybeAutoSync();
  }, 120000);

  // ---------- toast ----------

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  // ---------- routing & render ----------

  const ROUTES = {
    today: viewToday,
    dashboard: viewDashboard,
    leads: viewLeads,
    marketing: viewMarketing,
    research: viewResearch,
    comps: viewComps,
    companies: viewCompanies,
    company: viewCompany,
    contacts: viewContacts,
    pipeline: viewPipeline,
    deal: viewDeal,
    activities: viewActivities,
    expirations: viewExpirations,
    portfolio: viewPortfolio,
    data: viewData,
  };

  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    return { name: ROUTES[parts[0]] ? parts[0] : 'today', id: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  function render() {
    const route = parseRoute();
    const active = document.activeElement;
    const focusId = active && active.id && active.id.startsWith('f-') ? active.id : null;
    const caret = focusId ? active.selectionStart : null;

    $('#view').innerHTML = ROUTES[route.name](route.id);
    const nav = { company: 'companies', deal: 'pipeline' }[route.name] || route.name;
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === nav));
    const openCount = openFollowUps().filter((a) => activityDue(a) <= L.todayISO()).length;
    $('#nav-due').textContent = openCount || '';
    renderBackupNag();
    const initials = initialsOf(S.settings().brokerName);
    $('#logo').textContent = initials || 'TR';
    renderCoach();

    if (focusId && $('#' + focusId)) {
      const el = $('#' + focusId);
      el.focus();
      try {
        el.setSelectionRange(caret, caret);
      } catch (e) {
        /* not a text input */
      }
    }
  }

  function renderBackupNag() {
    const s = S.settings();
    const hasData = S.all('companies').length > 0;
    const age = s.lastBackup ? L.daysBetween(s.lastBackup, L.todayISO()) : null;
    const show = hasData && (age === null || age > 14);
    $('#backup-nag').hidden = !show;
    if (show) $('#backup-nag-text').textContent = age === null ? "You haven't backed up yet." : `Last backup was ${age} days ago.`;
  }

  // Reaching out to a company on a shared list records who did it, so your partner sees it in the sheet.
  function sharedListTouch(c) {
    if (!c || !c.sharedList || c.listRemoved) return {};
    const me = myInitials();
    const patch = {};
    if (me && c.contactedBy !== me && c.contactedBy !== 'Both') patch.contactedBy = c.contactedBy ? 'Both' : me;
    if (!c.listStatus || ['Researching', 'Ready to contact'].includes(c.listStatus)) patch.listStatus = 'Contacted';
    return patch;
  }

  function setLeadStage(id, stage) {
    S.upsert('companies', { id, leadStage: stage });
    const deal = stage === 'Secured Lead' ? createDealForLead(id) : null;
    toast(deal ? `Secured! Created deal "${deal.name}" in Intro Call.` : 'Lead stage → ' + stage);
  }

  // Securing a lead hands it to the Pipeline: a new deal in Intro Call, unless one is already open.
  function createDealForLead(companyId) {
    if (S.all('deals').some((d) => d.companyId === companyId && L.OPEN_STAGES.includes(d.stage))) return null;
    const c = S.get('companies', companyId);
    const deal = Object.assign(defaultsFor('deals', { company: companyId }), { name: c.name, assetClass: c.assetClass || 'Office' });
    return S.upsert('deals', deal);
  }

  // ---------- events ----------

  document.addEventListener('click', (e) => {
    const cell = e.target.closest && e.target.closest('.cell-edit');
    if (cell) {
      e.preventDefault();
      return openCellEdit(cell);
    }
    if (e.target.id === 'draft-open') {
      // Remember which template this email came from, so it's tagged when HubSpot logs it (or when you tap ✓ Emailed).
      const f = $('#draft-form');
      const t = S.get('templates', f.elements.template.value);
      S.upsert('companies', { id: f.dataset.company, pendingTemplate: t ? t.name : f.elements.template.value === REC_DRAFT ? 'Recommended follow-up' : f.elements.template.value === RECAP_DRAFT ? L.RECAP_TEMPLATE : f.elements.template.value === MARKET_DRAFT ? 'Market update' : '', pendingTemplateAt: L.todayISO() });
      setTimeout(() => $('#modal').close(), 300);
      return;
    }
    const actionEl = e.target.closest('[data-action]');
    if (actionEl && actionEl.tagName === 'TR' && e.target.closest('a')) return; // a link inside a clickable row
    if (actionEl) {
      const d = actionEl.dataset;
      switch (d.action) {
        case 'new':
          e.preventDefault();
          return openForm(d.col, null, { company: d.company, contact: d.contact, deal: d.deal, list: d.list, task: d.task });
        case 'edit':
          e.preventDefault();
          return openForm(d.col, d.id);
        case 'delete': {
          e.preventDefault();
          const rec = S.get(d.col, d.id);
          const what = d.col === 'companies' ? `"${rec.name}" and all of its contacts, deals and activity` : 'this ' + LABELS[d.col].toLowerCase();
          if (!confirm(`Delete ${what}? This cannot be undone.`)) return;
          const hs = d.col === 'companies' ? rec.hubspotId || (/^hs-co-(\d+)$/.exec(rec.id) || [])[1] : d.col === 'contacts' ? (/^hs-ct-(\d+)$/.exec(rec.id) || [])[1] : '';
          if (hs) S.saveSettings({ hubspotSkip: (S.settings().hubspotSkip || []).concat((d.col === 'companies' ? 'co-' : 'ct-') + hs) });
          S.remove(d.col, d.id);
          if (d.col === 'companies') location.hash = '#/companies';
          else if (d.col === 'deals') location.hash = '#/company/' + rec.companyId;
          return;
        }
        case 'show-more': {
          const scope = state[d.scope || 'companies'];
          scope.limit = (scope.limit || 100) + 200;
          return render();
        }
        case 'close-modal':
          return $('#modal').close();
        case 'toggle-done': {
          const a = S.get('activities', d.id);
          S.upsert('activities', { id: a.id, done: !a.done });
          return toast('Follow-up completed.');
        }
        case 'sort-by': {
          const f = state[d.scope];
          const col = SORT_COLUMNS[d.scope][d.key];
          const cur = f.dir || (SORT_COLUMNS[d.scope][f.sort] && SORT_COLUMNS[d.scope][f.sort].desc ? 'desc' : 'asc');
          f.dir = f.sort === d.key ? (cur === 'asc' ? 'desc' : 'asc') : col.desc ? 'desc' : 'asc';
          f.sort = d.key;
          saveUIState();
          return render();
        }
        case 'clear-company-filters':
          Object.assign(state.companies, { status: '', submarket: '', priority: '', window: '', asset: 'All', limit: 100 });
          saveUIState();
          return render();
        case 'set-filter':
          if (actionEl.tagName === 'A') e.preventDefault();
          state[d.scope][d.key] = d.value;
          if (d.scope === 'research' && d.key === 'statsAsset') Object.assign(state.research, { statsSub: '', statsQuarter: '' });
          if (d.scope === 'companies' || d.scope === 'leads') state[d.scope].limit = 100;
          saveUIState();
          if (d.scope === 'companies' && !location.hash.startsWith('#/companies')) location.hash = '#/companies';
          if (d.scope === 'marketing' && !location.hash.startsWith('#/marketing')) location.hash = '#/marketing';
          return render();
        case 'set-stage': {
          const patch = { id: d.id, stage: d.stage };
          if (d.stage === 'Closed Won' && !S.get('deals', d.id).closedDate) patch.closedDate = L.todayISO();
          if (d.stage === 'Closed Won' && S.get('deals', d.id).stage !== 'Closed Won') celebrate();
          S.upsert('deals', patch);
          return toast('Stage → ' + d.stage);
        }
        case 'copy-text':
          navigator.clipboard.writeText(d.text).then(() => toast('Copied ' + d.text + '.'));
          return;
        case 'log-touch': {
          if ($('#modal').open) $('#modal').close();
          const c = S.get('companies', d.company);
          const today = L.todayISO();
          const tpl = d.type === 'Email' && c.pendingTemplate ? c.pendingTemplate : '';
          S.upsert('activities', { type: d.type, date: today, companyId: c.id, contactId: d.contact || '', subject: d.type === 'Call' ? 'Called' : 'Emailed', template: tpl, leadStageAtSend: L.leadStage(c) }, { silent: true });
          const patch = Object.assign({ id: c.id, lastContacted: today }, sharedListTouch(c), tpl ? { pendingTemplate: '' } : {});
          if (L.leadStage(c) === 'New') patch.leadStage = 'Initial Outreach';
          S.upsert('companies', patch);
          if (c.sharedList) setTimeout(() => syncSharedList(c.sharedList, false), 300);
          runWorkflows();
          return toast(`Logged ${d.type.toLowerCase()} with ${c.name}. Add notes under Follow-ups if needed.`);
        }
        case 'move-stats': {
          // Re-file a quarter's stats (e.g. a report saved under the wrong quarter); joins any already in the new one.
          const to = String(prompt(`Move the ${d.quarter} ${d.asset} stats to which quarter? (e.g. 3Q26)`, d.quarter) || '').trim().toUpperCase();
          if (!to || to === d.quarter) return;
          if (!/^[1-4]Q\d{2}$/.test(to)) return alert('Use a quarter like 3Q26.');
          const st = S.settings();
          const from = (x) => x.quarter === d.quarter && x.assetClass === d.asset;
          const moving = (st.marketStats || []).filter(from).map((x) => Object.assign({}, x, { quarter: to }));
          const names = new Set(moving.map((x) => x.submarket));
          const stats = (st.marketStats || []).filter((x) => !from(x) && !(x.quarter === to && x.assetClass === d.asset && names.has(x.submarket))).concat(moving);
          const rep = (st.marketReports || []).find(from);
          const there = (st.marketReports || []).find((x) => x.quarter === to && x.assetClass === d.asset);
          let reports = (st.marketReports || []).filter((x) => !from(x) && x !== there);
          if (rep || there) {
            const a = there || {};
            const b = rep || {};
            reports = reports.concat([Object.assign({}, a, b, { quarter: to, assetClass: d.asset, highlights: Object.assign({}, a.highlights, b.highlights), submarkets: Object.assign({}, a.submarkets, b.submarkets), deals: Object.assign({}, a.deals, b.deals) })]);
          }
          S.saveSettings({ marketStats: stats, marketReports: reports });
          Object.assign(state.research, { statsAsset: d.asset, statsQuarter: to, statsSub: '' });
          return toast(`Moved to ${to}.`);
        }
        case 'social-preview':
          e.preventDefault();
          e.stopPropagation();
          return openSocialPreview(d.id);
        case 'copy-caption': {
          const f = actionEl.closest('form');
          S.upsert('marketing', { id: f.dataset.id, caption: f.elements.caption.value }, { silent: true });
          navigator.clipboard.writeText(f.elements.caption.value).then(() => toast('Caption copied. Paste it into LinkedIn.'));
          return;
        }
        case 'download-post-image': {
          const p = S.get('marketing', actionEl.closest('form').dataset.id);
          const a = document.createElement('a');
          a.href = p.image;
          a.download = (p.title || 'post').replace(/[^\w -]+/g, '').replace(/\s+/g, '-') + '.jpg';
          document.body.appendChild(a);
          a.click();
          a.remove();
          return;
        }
        case 'mark-posted': {
          const f = actionEl.closest('form');
          S.upsert('marketing', { id: f.dataset.id, caption: f.elements.caption.value, status: 'Sent / Posted', date: L.todayISO() });
          $('#modal').close();
          return toast('Marked posted. Add impressions and reactions later from the post.');
        }
        case 'remove-stats': {
          if (!confirm(`Remove the ${d.quarter} ${d.asset} market stats?`)) return;
          const keep = (x) => !(x.quarter === d.quarter && x.assetClass === d.asset);
          S.saveSettings({ marketStats: (S.settings().marketStats || []).filter(keep), marketReports: (S.settings().marketReports || []).filter(keep) });
          return toast('Removed.');
        }
        case 'recap-sent': {
          const deal = S.get('deals', d.deal);
          S.upsert('activities', { type: 'Email', date: L.todayISO(), companyId: deal.companyId, dealId: deal.id, contactId: d.contact || '', subject: deal.name + ' – weekly update', template: L.RECAP_TEMPLATE });
          return toast('Logged the weekly recap for ' + deal.name + '.');
        }
        case 'recap-skip': {
          const skip = Object.assign({}, S.settings().recapSkipped || {}, { [d.deal]: L.todayISO() });
          S.saveSettings({ recapSkipped: skip });
          return toast('Skipped this week.');
        }
        case 'sync-list':
          return syncSharedList(d.list, true);
        case 'add-list': {
          const lists = (S.settings().sharedLists || []).concat([{ id: 'list' + Date.now().toString(36), name: 'New shared list', url: '', key: '', lastSync: '' }]);
          S.saveSettings({ sharedLists: lists });
          return toast('Added. Name it and paste its web-app URL and sync key.');
        }
        case 'sync-hubspot':
          return syncHubSpot(true);
        case 'backfill-hubspot':
          return backfillHubSpot();
        case 'copy-link':
          e.preventDefault();
          navigator.clipboard.writeText(d.url).then(() => toast('Link copied. Paste it into your email to the client.'), () => prompt('Copy this link:', d.url));
          return;
        case 'reload-app':
          return S.flush().then(() => location.reload());
        case 'toggle-key': {
          // One main point of contact per company.
          const p = S.get('contacts', d.id);
          const on = !p.keyContact;
          S.all('contacts').filter((x) => x.companyId === p.companyId && x.keyContact && x.id !== p.id).forEach((x) => S.upsert('contacts', { id: x.id, keyContact: false }, { silent: true }));
          S.upsert('contacts', { id: p.id, keyContact: on });
          return toast(on ? `${contactName(p)} is now the main point of contact.` : `${contactName(p)} is no longer the main point of contact.`);
        }
        case 'link-contact':
          return openLinkContact(d.company);
        case 'merge-company':
          return openMerge(d.company);
        case 'call-card':
          return openCallCard(d.company, d.contact);
        case 'summarize':
          e.preventDefault();
          return openBrief(d.col, d.id);
        case 'toggle-comps-help':
          state.comps.help = !state.comps.help;
          saveUIState();
          return render();
        case 'drill':
          state.prospecting.drill = state.prospecting.drill === d.key ? '' : d.key;
          saveUIState();
          return render();
        case 'open-report':
          Object.assign(state.prospecting, { period: 'lastWeek' });
          saveUIState();
          if (!location.hash.startsWith('#/dashboard')) location.hash = '#/dashboard';
          else render();
          return setTimeout(() => $('#prospecting') && $('#prospecting').scrollIntoView({ behavior: 'smooth' }), 150);
        case 'insert-market-line': {
          const f = $('#quick-note-form');
          const line = marketLineFor(f.dataset.col, S.get(f.dataset.col, f.dataset.id));
          f.elements.note.value = (f.elements.note.value.trim() ? f.elements.note.value.trim() + ' ' : '') + line;
          return f.elements.note.focus();
        }
        case 'quick-note':
          e.preventDefault();
          return openQuickNote(d.col, d.id);
        case 'draft-email':
          e.preventDefault();
          return openDraft(d.company, d.contact, d.step, d.reply, { recommended: Boolean(d.recommended), recap: Boolean(d.recap), stats: Boolean(d.stats), dealId: d.deal });
        case 'copy-draft-to': {
          const p = S.get('contacts', $('#draft-form').elements.contact.value);
          if (p) navigator.clipboard.writeText(p.email).then(() => toast('Copied ' + p.email + '.'));
          return;
        }
        case 'copy-draft-cc': {
          const cc = $('#draft-form').elements.cc.value.trim();
          if (cc) navigator.clipboard.writeText(cc).then(() => toast('Copied ' + cc + '.'));
          return;
        }
        case 'edit-quote': {
          const r = (S.settings().buildingRates || {})[d.key];
          const form = $('#quote-form');
          if (!r || !form) return;
          const el = form.elements;
          el.key.value = d.key;
          el.building.value = r.building;
          el.rate.value = r.rate;
          el.basis.value = r.basis || 'NNN';
          el.opex.value = r.opex || '';
          el.date.value = r.date || L.todayISO();
          $('#quote-opex').hidden = el.basis.value !== 'NNN + OpEx';
          form.querySelector('[data-action="clear-quote"]').hidden = false;
          form.scrollIntoView({ block: 'nearest' });
          el.rate.focus();
          return;
        }
        case 'clear-quote':
          return render();
        case 'delete-quote': {
          const rates = Object.assign({}, S.settings().buildingRates || {});
          const r = rates[d.key];
          if (!r || !confirm('Remove the saved quote for ' + r.building + '?')) return;
          delete rates[d.key];
          S.saveSettings({ buildingRates: rates });
          return render();
        }
        case 'save-fill-in': {
          const f = $('#draft-form');
          const el = f.querySelector(`[data-fill-in="${CSS.escape(d.key)}"]`);
          const solo = d.field === 'partner' && $('#draft-fillins [data-fill-in="Solo"]');
          const v = solo && solo.checked ? 'None' : el.value.trim();
          S.upsert('companies', { id: f.dataset.company, [d.field]: d.field === 'sfOccupied' ? L.parseNumber(v) : v });
          toast('Saved to the company. It will fill in next time.');
          return;
        }
        case 'pick-day':
          return toggleMeetingDay(d.day);
        case 'copy-draft': {
          const f = $('#draft-form');
          // Copying counts like opening in Outlook: the next email logged for this company is tagged with the template.
          if (f.elements.template && [MARKET_DRAFT, RECAP_DRAFT, REC_DRAFT].includes(f.elements.template.value) || S.get('templates', f.elements.template && f.elements.template.value))
            S.upsert('companies', { id: f.dataset.company, pendingTemplate: { [MARKET_DRAFT]: 'Market update', [RECAP_DRAFT]: L.RECAP_TEMPLATE, [REC_DRAFT]: 'Recommended follow-up' }[f.elements.template.value] || (S.get('templates', f.elements.template.value) || {}).name || '', pendingTemplateAt: L.todayISO() }, { silent: true });
          navigator.clipboard.writeText('Subject: ' + f.elements.subject.value + '\n\n' + f.elements.body.value).then(() => toast('Copied. Paste it into Outlook.'));
          return;
        }
        case 'toggle-coach':
          state.coach.open = !state.coach.open;
          saveUIState();
          return renderCoach();
        case 'deal-to-comp': {
          const deal = S.get('deals', d.id);
          const c = S.get('companies', deal.companyId) || {};
          openForm('comps', null, {});
          const f = $('#record-form');
          const set = (k, v) => f.elements[k] && v !== undefined && v !== null && (f.elements[k].value = v);
          set('building', deal.building || c.building || '');
          set('address', deal.address || c.address || '');
          set('submarket', deal.submarket || c.submarket || '');
          set('assetClass', deal.assetClass);
          set('tenant', c.name);
          set('dealType', deal.dealType);
          set('sf', deal.actualSF || deal.estSF || deal.sfMax || '');
          set('signedDate', deal.closedDate);
          set('commencement', deal.leaseCommencement);
          set('termMonths', deal.finalTermMonths || deal.termMonths);
          set('startingRent', deal.finalRate || '');
          set('rateBasis', deal.finalRateBasis || deal.rateBasis);
          set('escalationPct', deal.finalEscalationPct || deal.escalationPct);
          set('freeRentMonths', deal.finalFreeRentMonths || deal.freeRentMonths);
          set('tiAllowance', deal.finalTiAllowance || deal.tiAllowance);
          set('source', 'My deal');
          return;
        }
        case 'li-connected': {
          S.upsert('contacts', { id: d.contact, linkedinConnected: true });
          return toast('Marked as connected on LinkedIn.');
        }
        case 'snooze': {
          const c = S.get('companies', d.company);
          S.upsert('companies', { id: c.id, snoozeUntil: L.addDays(L.todayISO(), 7) });
          return toast(`${c.name} hidden from Today for a week.`);
        }
        case 'export-comps':
          return download(
            'comps-' + stamp() + '.csv',
            L.toCSV(
              S.all('comps'),
              L.COMP_FIELDS.map((k) => ({ key: k, label: COMP_LABELS[k] || k })).concat([{ key: 'source', label: 'Source' }, { label: 'Confidential', value: (c) => (c.confidential ? 'Yes' : '') }])
            )
          );
        case 'export-companies':
          return exportCompanies(
            filteredCompanies().map((r) => r.c),
            'companies'
          );
        case 'export-expirations': {
          const f = state.expirations;
          const rows = S.all('companies')
            .filter((c) => {
              const m = L.monthsUntil(c.leaseExpiration);
              return m !== null && m <= Number(f.horizon) && matchesAsset(c.assetClass, f.asset) && c.status !== 'Not a Fit' && (f.includeClients || !['Active Client', 'Past Client'].includes(c.status));
            })
            .sort((a, b) => a.leaseExpiration.localeCompare(b.leaseExpiration));
          return exportCompanies(rows, 'lease-expirations');
        }
        case 'export-contacts':
          return download(
            'contacts-' + stamp() + '.csv',
            L.toCSV(S.all('contacts'), [
              { key: 'firstName', label: 'First Name' },
              { key: 'lastName', label: 'Last Name' },
              { label: 'Company', value: (c) => companyName(c.companyId) },
              { key: 'title', label: 'Title' },
              { key: 'role', label: 'Role' },
              { key: 'email', label: 'Email' },
              { key: 'phone', label: 'Phone' },
              { key: 'mobile', label: 'Mobile' },
              { label: 'Phone DNC', value: (c) => (c.phoneDNC ? 'Yes' : '') },
              { label: 'Mobile DNC', value: (c) => (c.mobileDNC ? 'Yes' : '') },
              { key: 'verification', label: 'Verification' },
              { key: 'linkedin', label: 'LinkedIn' },
              { key: 'notes', label: 'Notes' },
            ])
          );
        case 'export-deals':
          return download(
            'deals-' + stamp() + '.csv',
            L.toCSV(S.all('deals'), [
              { key: 'name', label: 'Deal' },
              { label: 'Client', value: (x) => companyName(x.companyId) },
              { key: 'dealType', label: 'Type' },
              { key: 'assetClass', label: 'Asset Class' },
              { key: 'stage', label: 'Stage' },
              { key: 'estSF', label: 'Est SF' },
              { key: 'budgetRate', label: 'Rent' },
              { key: 'rateBasis', label: 'Rent Basis' },
              { key: 'termMonths', label: 'Term (mo)' },
              { label: 'Aggregate Value', value: (x) => Math.round(L.estimatedCommission(x).aggregateValue) },
              { label: 'Commission (Mine)', value: (x) => Math.round(L.estimatedCommission(x).myShare) },
              { label: 'Probability %', value: (x) => L.dealProbability(x) },
              { label: 'Weighted', value: (x) => Math.round(L.weightedCommission(x)) },
              { key: 'targetClose', label: 'Target Close' },
              { key: 'closedDate', label: 'Closed Date' },
            ])
          );
        case 'new-closed-deal': {
          openForm('deals', null, {});
          const f = $('#record-form');
          f.elements.stage.value = 'Closed Won';
          f.elements.closedDate.value = L.todayISO();
          f.elements.inPortfolioSheet.checked = !!S.settings().sheetSyncUrl;
          f.elements.representation.value = 'TR';
          return;
        }
        case 'sync-sheet':
          return syncSheet(true);
        case 'export-portfolio':
          return download(
            'portfolio-' + stamp() + '.csv',
            L.toCSV(closedDeals(state.portfolio), [
              { label: 'Close Date', value: (x) => L.dealCloseDate(x) },
              { label: 'Client', value: (x) => companyName(x.companyId) },
              { key: 'name', label: 'Deal' },
              { key: 'dealType', label: 'Deal Type' },
              { key: 'assetClass', label: 'Asset Class' },
              { key: 'building', label: 'Building' },
              { key: 'address', label: 'Address' },
              { label: 'SF', value: (x) => Math.round(L.dealResults(x).sf) },
              { label: 'Total Rent', value: (x) => Math.round(L.dealResults(x).rent) },
              { label: 'Commission', value: (x) => Math.round(L.dealResults(x).commission) },
              { label: 'Actuals Recorded', value: (x) => (L.dealResults(x).hasActuals ? 'Yes' : 'Estimate') },
              { key: 'termMonths', label: 'Term (mo)' },
              { key: 'leaseCommencement', label: 'Commencement' },
              { key: 'newLeaseExpiration', label: 'Expiration' },
            ])
          );
        case 'export-json':
          download('tenant-rep-crm-backup-' + stamp() + '.json', S.exportJSON(), 'application/json');
          S.saveSettings({ lastBackup: L.todayISO() });
          return toast('Backup downloaded.');
        case 'download-portfolio-template':
          return download(
            'closed-deals-template.csv',
            'Client,Deal Type,Property Type,Building,Address,Submarket,SF,Term (months),Total Rent,Commission,Close Date,Commencement,Expiration\r\n'
          );
        case 'download-template':
          return download('company-import-template.csv', L.toCSV([], COMPANY_COLUMNS));
        case 'pick-file': {
          const input = $('#file-input');
          input.dataset.kind = d.kind;
          input.accept = d.kind === 'backup' ? '.json,application/json' : d.kind === 'highlights' ? '.pdf,application/pdf' : '.csv,text/csv,.xlsx,.xls,.xlsm' + (d.kind === 'marketStats' ? ',.pdf,application/pdf' : '');
          input.value = '';
          return input.click();
        }
        case 'cancel-import':
          importPreview = null;
          return render();
        case 'sample-data':
          if (S.all('companies').length && !confirm('Add demo companies alongside your existing data?')) return;
          S.loadSampleData();
          return toast('Demo data loaded.');
        case 'clear-all':
          if (!confirm('Delete ALL companies, contacts, deals and activity? Export a backup first if you might want it.')) return;
          if (prompt('Type DELETE to confirm') !== 'DELETE') return;
          S.clearAll();
          return toast('All data deleted.');
        case 'toggle-nav':
          return document.body.classList.toggle('nav-open');
      }
      return;
    }
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a, button, input, select, .cell-edit')) location.hash = row.dataset.href;
  });

  function onFilterChange(e) {
    const el = e.target;
    if (!el.dataset.filter) return;
    const [scope, key] = el.dataset.filter.split('.');
    state[scope][key] = el.type === 'checkbox' ? el.checked : el.value;
    if (key === 'sort') state[scope].dir = '';
    if (scope === 'companies' || scope === 'leads') state[scope].limit = 100;
    saveUIState();
    render();
  }
  document.addEventListener('focusin', (e) => {
    if (e.target.classList && e.target.classList.contains('ref-search')) {
      e.target.select();
      renderRefMenu(e.target);
    }
  });
  document.addEventListener('focusout', (e) => {
    if (!(e.target.classList && e.target.classList.contains('ref-search'))) return;
    const box = e.target.closest('.ref-box');
    setTimeout(() => {
      if (box.contains(document.activeElement)) return;
      box.querySelector('.ref-menu').hidden = true;
      const sel = box.querySelector('select');
      if (!e.target.value.trim() && sel.value) {
        sel.value = '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncRefText(box);
    }, 150);
  });
  document.addEventListener('mousedown', (e) => {
    const pick = e.target.closest('[data-ref-pick]');
    const create = e.target.closest('[data-ref-create]');
    const move = e.target.closest('[data-ref-move]');
    if (!pick && !create && !move) return;
    e.preventDefault();
    const box = e.target.closest('.ref-box');
    if (pick) pickRef(box, pick.dataset.refPick);
    else if (create) createRef(box, create.dataset.refCreate);
    else moveContactHere(box, move.dataset.refMove);
  });

  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('ref-search')) renderRefMenu(e.target);
    if (e.target.closest('#draft-form') && ['subject', 'body', 'cc'].includes(e.target.name)) updateDraftLink();
    if (e.target.dataset && e.target.dataset.fillIn !== undefined) refillTemplateDraft();
    if (e.target.type === 'search') onFilterChange(e);
  });
  // Inline table edits: a quiet dropdown saves on change; a text cell becomes an input when clicked.
  document.addEventListener('change', (e) => {
    const d = e.target.dataset || {};
    if (d.inlineCol) saveInline(d.inlineCol, d.inlineId, d.inlineField, e.target.value);
    // A quoted rate is remembered for its building; picking a building with a saved rate fills it in.
    if (['Rate', 'RateBasis', 'OpEx', 'CompBuilding'].includes(d.fillIn)) onRateFillIn(d.fillIn);
    if (e.target.name === 'basis' && e.target.closest('#quote-form')) $('#quote-opex').hidden = e.target.value !== 'NNN + OpEx';
    if (e.target.id === 'add-day' && e.target.value) {
      toggleMeetingDay(e.target.value, true);
      e.target.value = '';
    }
    // The rent growth behind {AnnualIncrease} is remembered for every draft.
    if (d.fillIn === 'RentGrowth' && L.parseNumber(e.target.value) !== null) S.saveSettings({ rentGrowth: L.parseNumber(e.target.value) / 100 });
  });
  function openCellEdit(cell) {
    const d = cell.dataset;
    const input = document.createElement('input');
    // Numbers go in a text box so "12,500" can be typed; they're saved as numbers.
    input.type = d.editType === 'number' ? 'text' : d.editType;
    if (d.editType === 'number') input.inputMode = 'decimal';
    input.className = 'inline cell-input';
    input.value = d.editValue;
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) saveInline(d.editCol, d.editId, d.editField, input.value.trim());
      else render();
    };
    input.addEventListener('keydown', (k) => {
      if (k.key === 'Enter') finish(true);
      if (k.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    cell.replaceWith(input);
    input.focus();
    if (input.select && input.type !== 'date') input.select();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('cell-edit')) {
      e.preventDefault();
      openCellEdit(e.target);
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.dataset.filter && e.target.type !== 'search') onFilterChange(e);
    if (e.target.closest('#draft-form') && ['template', 'contact'].includes(e.target.name)) fillDraft();
    if (e.target.name === 'caption' && e.target.closest('.social-preview')) S.upsert('marketing', { id: e.target.closest('form').dataset.id, caption: e.target.value }, { silent: true });
    if (e.target.id === 'align-asset' && importPreview) {
      importPreview.alignAsset = e.target.value;
      render();
    }
    if (e.target.dataset.leadTemp) S.upsert('companies', { id: e.target.dataset.leadTemp, leadTemp: e.target.value });
    if (e.target.dataset.leadStage) setLeadStage(e.target.dataset.leadStage, e.target.value);
    const form = e.target.closest('#record-form');
    if (form && (e.target.name === 'assetClass' || e.target.name === 'companyId')) syncFormDependencies(form);
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'quote-form') {
      e.preventDefault();
      const fd = new FormData(e.target);
      const building = String(fd.get('building') || '').trim();
      if (!building || !L.parseNumber(fd.get('rate'))) return toast('Add the building and the rate.');
      let rates = Object.assign({}, S.settings().buildingRates || {});
      // Editing a quote under a new building name moves it rather than leaving the old one behind.
      if (fd.get('key')) delete rates[fd.get('key')];
      rates = L.rememberRate(rates, building, fd.get('rate'), fd.get('date') || L.todayISO(), fd.get('basis'), fd.get('opex'));
      S.saveSettings({ buildingRates: rates });
      toast('Saved the quote for ' + building + '.');
      return render();
    }
    if (e.target.id === 'merge-form') {
      e.preventDefault();
      const to = e.target.querySelector('select[name=targetId]').value;
      if (!to) return toast('Pick the company to keep.');
      if (confirm(`Merge ${companyName(e.target.dataset.from)} into ${companyName(to)}? This can't be undone.`)) mergeCompanies(e.target.dataset.from, to);
    } else if (e.target.id === 'align-form') {
      e.preventDefault();
      const fd = new FormData(e.target);
      const a = alignPlan(importPreview);
      let fixed = 0;
      let added = 0;
      let deleted = 0;
      a.matched.forEach((m) => {
        if (!m.diffs.length || fd.get('fix-' + m.row) !== 'on') return;
        const patch = { id: m.existing.id };
        m.diffs.forEach((d) => (patch[d.field] = d.file));
        S.upsert('comps', patch, { silent: true });
        fixed++;
      });
      a.missing.forEach((m) => {
        if (fd.get('add-' + m.row) !== 'on') return;
        S.upsert('comps', m.comp, { silent: true });
        added++;
      });
      Array.from(fd.keys())
        .filter((k) => k.startsWith('del-'))
        .forEach((k) => {
          S.remove('comps', k.slice(4), true);
          deleted++;
        });
      S.saveSettings({});
      importPreview = null;
      state.comps.tab = 'comps';
      location.hash = '#/comps';
      render();
      toast(`Comps: ${fixed} fixed, ${added} added, ${deleted} deleted.`);
    } else if (e.target.id === 'research-form') {
      e.preventDefault();
      const fd = new FormData(e.target);
      const quarter = String(fd.get('quarter')).toUpperCase();
      const assetClass = fd.get('assetClass');
      const r = importPreview.report;
      const st = S.settings();
      const same = (x) => x.quarter === quarter && x.assetClass === assetClass;
      // A full market report replaces the quarter; a one-submarket snapshot adds to (or refreshes) its submarket only.
      const full = r.rows.some((x) => x.submarket === 'Market total');
      const names = new Set(r.rows.map((x) => x.submarket));
      const old = (st.marketReports || []).find(same);
      const merged = full || !old ? { highlights: r.highlights, submarkets: r.submarkets, deals: r.deals || {} } : { highlights: Object.assign({}, old.highlights, r.highlights), submarkets: Object.assign({}, old.submarkets, r.submarkets), deals: Object.assign({}, old.deals, r.deals) };
      S.saveSettings({
        marketStats: (st.marketStats || []).filter((x) => !same(x) || (!full && !names.has(x.submarket))).concat(r.rows.map((x) => Object.assign({}, x, { quarter, assetClass }))),
        marketReports: (st.marketReports || []).filter((x) => !same(x)).concat([Object.assign({ quarter, assetClass, market: r.market || (old && old.market) || '', filename: importPreview.filename, importedAt: L.todayISO() }, merged)]),
      });
      importPreview = null;
      Object.assign(state.research, { statsAsset: assetClass, statsSub: !full && r.rows.length === 1 ? r.rows[0].submarket : '', statsQuarter: quarter });
      toast(`Saved ${quarter} ${assetClass.toLowerCase()} market stats.`);
      render();
    } else if (e.target.id === 'quick-note-form') {
      e.preventDefault();
      const f = e.target;
      const note = f.elements.note.value.trim();
      if (!note) return;
      const rec = S.get(f.dataset.col, f.dataset.id);
      const entry = L.fmtDate(L.todayISO()) + ': ' + note;
      $('#modal').close();
      S.upsert(f.dataset.col, { id: rec.id, notes: rec.notes ? entry + '\n\n' + rec.notes : entry });
      toast('Note added to My notes.');
    } else if (e.target.id === 'record-form') {
      e.preventDefault();
      saveForm(e.target);
    } else if (e.target.id === 'settings-form' || e.target.id === 'settings-form-sync' || e.target.id === 'settings-form-hubspot') {
      e.preventDefault();
      const fd = new FormData(e.target);
      const patch = {};
      fd.forEach((v, k) => (patch[k] = ['brokerName', 'homeMarket', 'sheetSyncUrl', 'sheetSyncKey', 'researchTeam', 'hubspotBridgeUrl', 'hubspotBridgeKey', 'myFirm'].includes(k) ? String(v).trim() : Number(v)));
      S.saveSettings(patch);
      toast('Settings saved.');
      if (e.target.id === 'settings-form-hubspot' && patch.hubspotBridgeUrl) syncHubSpot(true);
    } else if (e.target.classList.contains('list-form')) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const id = e.target.dataset.list;
      const lists = (S.settings().sharedLists || []).map((l) =>
        l.id === id ? Object.assign({}, l, { name: String(fd.get('name')).trim() || l.name, url: String(fd.get('url')).trim(), key: String(fd.get('key')).trim() }) : l
      );
      S.saveSettings({ sharedLists: lists, myInitials: String(fd.get('initials')).trim().toUpperCase() });
      toast('Saved.');
      if (lists.find((l) => l.id === id).url) syncSharedList(id, true);
    } else if (e.target.id === 'import-form') {
      e.preventDefault();
      const fd = new FormData(e.target);
      const opts = { assetClass: fd.get('assetClass'), status: fd.get('status'), source: fd.get('source'), confidential: fd.get('confidential') === 'on', quarter: String(fd.get('quarter') || '').toUpperCase() };
      const importers = { companies: importCompanies, contacts: importContacts, portfolio: importPortfolio, comps: importComps, marketStats: importMarketStats };
      const kind = importPreview.kind;
      opts.choices = {};
      Array.from(fd.keys()).filter((k) => /^dup-\d+$/.test(k)).forEach((k) => (opts.choices[k.slice(4)] = fd.get(k)));
      const msg = importers[kind](importPreview.result.records, opts);
      importPreview = null;
      if (kind === 'comps') state.comps.tab = 'comps';
      if (kind === 'marketStats') Object.assign(state.research, { statsAsset: opts.assetClass, statsSub: '', statsQuarter: '' });
      location.hash = '#/' + (kind === 'marketStats' ? 'research' : kind);
      render();
      toast(msg);
    }
  });

  // Hover tooltip for chart marks ([data-tip]); the text lives on the mark, one line per row.
  const chartTip = document.createElement('div');
  chartTip.id = 'chart-tip';
  chartTip.hidden = true;
  document.body.appendChild(chartTip);
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) return (chartTip.hidden = true);
    chartTip.textContent = el.dataset.tip;
    chartTip.hidden = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (chartTip.hidden) return;
    chartTip.style.left = Math.min(innerWidth - chartTip.offsetWidth - 8, e.clientX + 14) + 'px';
    chartTip.style.top = e.clientY + 14 + 'px';
  });

  // Drop a comp sheet anywhere on the Comps tab, or a Research report or stats sheet on the Research page.
  const dropTarget = () =>
    location.hash.startsWith('#/comps') && state.comps.tab === 'comps' ? 'comps' : location.hash.startsWith('#/research') ? 'marketStats' : location.hash.startsWith('#/marketing') && state.marketing.tab === 'social' ? 'highlights' : '';
  document.addEventListener('dragover', (e) => {
    if (!dropTarget() || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    $$('.drop-zone').forEach((z) => z.classList.add('over'));
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) $$('.drop-zone').forEach((z) => z.classList.remove('over'));
  });
  document.addEventListener('drop', (e) => {
    const kind = dropTarget();
    if (!kind || !e.dataTransfer.files.length) return;
    e.preventDefault();
    $$('.drop-zone').forEach((z) => z.classList.remove('over'));
    handleFile(kind, e.dataTransfer.files[0]);
  });

  $('#file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(e.target.dataset.kind, file);
  });

  // Pipeline drag & drop
  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest && e.target.closest('.deal-card');
    if (card) e.dataTransfer.setData('text/plain', card.dataset.deal);
  });
  document.addEventListener('dragover', (e) => {
    const col = e.target.closest && e.target.closest('.board .col');
    if (col) {
      e.preventDefault();
      col.classList.add('drop');
    }
  });
  document.addEventListener('dragleave', (e) => {
    const col = e.target.closest && e.target.closest('.board .col');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop');
  });
  document.addEventListener('drop', (e) => {
    const col = e.target.closest && e.target.closest('.board .col');
    if (!col) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const deal = S.get('deals', id);
    if (deal && deal.stage !== col.dataset.stage) {
      const patch = { id, stage: col.dataset.stage };
      if (patch.stage === 'Closed Won' && !deal.closedDate) patch.closedDate = L.todayISO();
      if (patch.stage === 'Closed Won') celebrate();
      S.upsert('deals', patch);
      toast(deal.name + ' → ' + col.dataset.stage);
    } else render();
  });

  // Keyboard: "/" focuses the search box on list pages.
  document.addEventListener('keydown', (e) => {
    if (e.target.classList && e.target.classList.contains('ref-search')) {
      const menu = e.target.closest('.ref-box').querySelector('.ref-menu');
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = !menu.hidden && menu.querySelector('[data-ref-pick], [data-ref-create]');
        if (first) first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        return;
      }
      if (e.key === 'Escape' && !menu.hidden) {
        e.preventDefault();
        e.stopPropagation();
        menu.hidden = true;
        syncRefText(e.target.closest('.ref-box'));
        return;
      }
    }
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('#modal').open) {
      const s = $('#view input[type=search]');
      if (s) {
        e.preventDefault();
        s.focus();
      }
    }
  });

  window.addEventListener('hashchange', () => {
    document.body.classList.remove('nav-open');
    render();
    if (parseRoute().name === 'portfolio') maybeAutoSync();
    window.scrollTo(0, 0);
  });
  // Reminders and post ideas the CRM creates on its own: quarterly research/one-pager tasks and
  // move-in posts for deals you closed. Each is created once; deleting it won't bring it back.
  function ensureGenerated() {
    const s = S.settings();
    const made = new Set(s.generatedIds || []);
    const today = L.todayISO();
    const companies = {};
    S.all('companies').forEach((c) => (companies[c.id] = c));
    const fresh = [];
    L.quarterlyTasks(today).forEach((t) => {
      if (!made.has(t.id) && !S.get('activities', t.id)) fresh.push(['activities', Object.assign({ done: false }, t)]);
    });
    L.moveInPostIdeas(S.all('deals'), companies, today).forEach((m) => {
      if (!made.has(m.id) && !S.get('marketing', m.id)) fresh.push(['marketing', m]);
    });
    // Retire untouched move-in ideas for deals that turned out to be coworking memberships.
    const stale = S.all('marketing').filter((m) => /^mk-movein-/.test(m.id) && m.status === 'Idea' && S.get('deals', m.dealId) && L.isCoworking(S.get('deals', m.dealId)));
    stale.forEach((m) => S.remove('marketing', m.id, true));
    if (!fresh.length && !stale.length) return;
    fresh.forEach(([col, rec]) => {
      S.upsert(col, rec, { silent: true });
      made.add(rec.id);
    });
    S.saveSettings({ generatedIds: Array.from(made) });
  }

  // ---------- shared prospect lists ----------

  const listStatus = {};
  const listSyncing = {};
  async function listRequest(list, body) {
    const res = body
      ? await fetch(list.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: list.key }, body)) })
      : await fetch(list.url + (list.url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(list.key));
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Sync failed');
    return data;
  }

  async function syncSharedList(listId, manual) {
    const list = (S.settings().sharedLists || []).find((l) => l.id === listId);
    if (!list || !list.url || !list.key || listSyncing[listId]) return;
    listSyncing[listId] = true;
    try {
      const payload = await listRequest(list);
      const plan = L.planListSync(
        payload,
        { companies: S.all('companies'), contacts: S.all('contacts'), activities: S.all('activities') },
        { listId, listName: list.name, initials: myInitials() }
      );
      plan.companies.forEach((c) => S.upsert('companies', c, { silent: true }));
      plan.contacts.forEach((c) => S.upsert('contacts', c, { silent: true }));
      plan.companyUpdates.forEach((u) => S.upsert('companies', u, { silent: true, touch: false }));
      plan.contactUpdates.forEach((u) => S.upsert('contacts', u, { silent: true, touch: false }));
      if (plan.pushes.length) await listRequest(list, { changes: plan.pushes });
      const parts = [];
      if (plan.counts.added) parts.push(`${plan.counts.added} added from the sheet`);
      if (plan.counts.updated) parts.push(`${plan.counts.updated} updated from the sheet`);
      if (plan.counts.pushed) parts.push(`${plan.counts.pushed} sent to the sheet`);
      if (plan.removed.length) parts.push(`${plan.removed.length} removed from the sheet`);
      listStatus[listId] = 'Last synced ' + new Date().toLocaleString() + ' · ' + (parts.join(', ') || 'already in step');
      const lists = (S.settings().sharedLists || []).map((l) => (l.id === listId ? Object.assign({}, l, { lastSync: new Date().toISOString() }) : l));
      S.saveSettings({ sharedLists: lists });
      if (manual) toast(list.name + ': ' + (parts.join(', ') || 'already in step') + '.');
    } catch (err) {
      listStatus[listId] = 'Last attempt failed: ' + err.message;
      if (manual) toast(list.name + ' sync failed: ' + err.message);
      render();
    } finally {
      listSyncing[listId] = false;
    }
  }
  const syncAllLists = () => (S.settings().sharedLists || []).forEach((l) => l.url && syncSharedList(l.id, false));
  setInterval(() => {
    if (!document.hidden) syncAllLists();
  }, 2 * 60000);

  // ---------- HubSpot live sync ----------

  let hubspotSyncing = false;
  let hubspotStatus = '';
  async function syncHubSpot(manual) {
    const st = S.settings();
    if (!st.hubspotBridgeUrl || !st.hubspotBridgeKey || hubspotSyncing) return;
    hubspotSyncing = true;
    try {
      // Automatic syncs overlap the last one by 10 minutes; "Sync now" re-checks the past week. Re-applying is harmless.
      const since = st.hubspotLastSync && !manual ? st.hubspotLastSync - 600000 : Date.now() - 7 * 864e5;
      const url = st.hubspotBridgeUrl + (st.hubspotBridgeUrl.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(st.hubspotBridgeKey) + '&since=' + since;
      const data = await (await fetch(url)).json();
      if (!data.ok) throw new Error(data.error || 'Sync failed');
      // Learn your own email domain from the emails you send, so colleagues are never client contacts.
      const sent = (data.emails || []).find((e) => e.properties && e.properties.hs_email_direction === 'EMAIL' && String(e.properties.hs_email_from_email || '').includes('@'));
      if (sent && !st.myEmailDomain) S.saveSettings({ myEmailDomain: (/@([a-z0-9.-]+)/i.exec(sent.properties.hs_email_from_email) || [])[1].toLowerCase() });
      const plan = L.planHubSpotSync(data, hubspotData());
      const before = S.all('activities').length;
      plan.activities.forEach((a) => S.upsert('activities', a, { silent: true, touch: false }));
      applyHubSpotRecords(plan);
      const added = S.all('activities').length - before;
      const got = ['emails', 'meetings', 'calls'].map((k) => `${(data[k] || []).length} ${k}`).join(', ');
      hubspotStatus = `checked ${got} from HubSpot (${manual ? 'past 7 days' : 'since last sync'}): ${added} new, ${plan.activities.length - added} updated` + newRecordsNote(plan) + (plan.skipped ? `, ${plan.skipped} not matched to a CRM company` : '');
      if (!manual && (plan.created.companies || plan.created.contacts)) toast('From HubSpot: ' + newRecordsNote(plan).replace(/^, /, '') + '.');
      S.saveSettings({ hubspotLastSync: data.now || Date.now() });
      runWorkflows();
      if (manual) toast('HubSpot synced: ' + hubspotStatus + '.');
    } catch (err) {
      hubspotStatus = 'Last attempt failed: ' + err.message;
      if (manual) toast('HubSpot sync failed: ' + err.message);
      render();
    } finally {
      hubspotSyncing = false;
    }
  }
  function hubspotData() {
    return { companies: S.all('companies'), contacts: S.all('contacts'), deals: S.all('deals'), activities: S.all('activities'), hubspotSkip: S.settings().hubspotSkip, internalDomain: myEmailDomain() };
  }
  function applyHubSpotRecords(plan) {
    plan.companies.forEach((c) => S.upsert('companies', c, { silent: true, touch: false }));
    (plan.contacts || []).forEach((c) => S.upsert('contacts', c, { silent: true, touch: false }));
  }
  function newRecordsNote(plan) {
    const c = plan.created || {};
    const parts = [c.companies ? `${c.companies} new compan${c.companies > 1 ? 'ies' : 'y'}` : '', c.contacts ? `${c.contacts} new contact${c.contacts > 1 ? 's' : ''}` : ''].filter(Boolean);
    return parts.length ? ', ' + parts.join(' and ') : '';
  }
  // One-time pull of everything HubSpot holds, type by type, in pages of up to 1,000.
  async function backfillHubSpot() {
    const st = S.settings();
    if (!st.hubspotBridgeUrl || hubspotSyncing) return;
    hubspotSyncing = true;
    const totals = { added: 0, updated: 0, skipped: 0, companies: 0, contacts: 0 };
    try {
      // Companies and contacts first, so the emails that follow can find them.
      for (const type of ['companies', 'contacts', 'emails', 'notes', 'meetings', 'calls']) {
        let since = 0;
        for (let page = 0; page < 50; page++) {
          toast(`Loading HubSpot ${type}${page ? ' (page ' + (page + 1) + ')' : ''}…`);
          const url = st.hubspotBridgeUrl + (st.hubspotBridgeUrl.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(st.hubspotBridgeKey) + '&types=' + type + '&since=' + since;
          const data = await (await fetch(url)).json();
          if (!data.ok) throw new Error(data.error || 'Sync failed');
          if (data[type] === undefined) throw new Error('Update the HubSpot bridge script to the latest version first');
          const plan = L.planHubSpotSync(data, hubspotData());
          const before = S.all('activities').length;
          plan.activities.forEach((a) => S.upsert('activities', a, { silent: true, touch: false }));
          applyHubSpotRecords(plan);
          totals.companies += plan.created.companies;
          totals.contacts += plan.created.contacts;
          S.saveSettings({});
          const added = S.all('activities').length - before;
          totals.added += added;
          totals.updated += plan.activities.length - added;
          totals.skipped += plan.skipped;
          if (!(data.more && data.more[type]) || !data.next || data.next[type] <= since) break;
          since = data.next[type];
        }
      }
      runWorkflows();
      hubspotStatus = `full history loaded: ${totals.added} new, ${totals.updated} updated` + newRecordsNote({ created: totals }) + (totals.skipped ? `, ${totals.skipped} not matched to a CRM company` : '');
      toast('HubSpot ' + hubspotStatus + '.');
      render();
    } catch (err) {
      hubspotStatus = 'Full history failed: ' + err.message;
      toast(hubspotStatus);
      render();
    } finally {
      hubspotSyncing = false;
    }
  }

  setInterval(() => {
    if (!document.hidden) syncHubSpot(false);
  }, 5 * 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - (S.settings().hubspotLastSync || 0) > 5 * 60000) syncHubSpot(false);
  });

  S.onChange(() => {
    ensureGenerated();
    render();
  });
  // Data loads asynchronously from IndexedDB; start once it's in memory.
  // Ask the browser to keep the CRM's data even when the disk runs low. Chrome and Edge grant it to sites
  // you use often or have bookmarked; it doesn't protect against clearing browsing data yourself.
  let storageProtected = null;
  if (navigator.storage && navigator.storage.persist)
    navigator.storage.persist().then((ok) => (storageProtected = ok), () => {});
  // The published site carries its version; when a newer one is out, offer a reload so a cached page
  // never hides new features.
  function checkForUpdate() {
    const mine = (document.querySelector('meta[name=app-version]') || {}).content;
    if (!mine || mine === 'dev' || !/^https?:/.test(location.protocol)) return;
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (v && v.version && v.version !== mine) $('#update-nag').hidden = false;
      })
      .catch(() => {});
  }
  checkForUpdate();
  setInterval(checkForUpdate, 30 * 60000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkForUpdate());

  S.ready.then(() => {
    ensureGenerated();
    repairActivityContacts();
    runWorkflows();
    render();
    syncHubSpot(false);
    syncAllLists();
    if (parseRoute().name === 'portfolio') maybeAutoSync();
  });
})();
