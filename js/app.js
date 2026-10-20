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
  const GROWTH = ['Growing', 'Stable', 'Contracting', 'Unknown'];
  const SOURCES = ['CoStar', 'Referral', 'Cold Call', 'LinkedIn', 'ZoomInfo', 'Drive-by', 'Existing client', 'Event', 'Landlord tip'];

  // ---------- UI state (remembered per browser) ----------

  const UI_KEY = 'tenant-rep-crm.ui';
  const state = mergeUIState(
    {
      companies: { q: '', asset: 'All', status: '', submarket: '', window: '', priority: '', sort: 'score', limit: 100 },
      contacts: { q: '' },
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

  const distinct = (col, key) => Array.from(new Set(S.all(col).map((r) => r[key]).filter(Boolean))).sort();

  const FIELDS = {
    companies: [
      { section: 'Company' },
      { key: 'name', label: 'Company name', required: true, wide: true },
      { key: 'aliases', label: 'Also known as (brands, subsidiaries; comma separated)', wide: true },
      { key: 'assetClass', label: 'Asset class', type: 'select', options: L.ASSET_CLASSES, required: true },
      { key: 'industry', label: 'Industry', list: () => distinct('companies', 'industry') },
      { key: 'status', label: 'Status', type: 'select', options: L.COMPANY_STATUSES },
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
      { key: 'headcount', label: 'Headcount', type: 'number' },
      { key: 'leaseExpiration', label: 'Lease expiration', type: 'date' },
      { key: 'landlord', label: 'Landlord / owner' },
      { key: 'currentRate', label: 'Current rent ($/SF)', type: 'number', step: '0.01' },
      { key: 'rateBasis', label: 'Rent basis', type: 'select', options: L.RATE_BASES },
      { key: 'clearHeight', label: 'Clear height (ft)', type: 'number', asset: 'Industrial' },
      { key: 'dockDoors', label: 'Dock doors', type: 'number', asset: 'Industrial' },
      { key: 'leaseOptions', label: 'Renewal / termination / ROFR options', wide: true },
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
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Office phone', type: 'tel' },
      { key: 'mobile', label: 'Mobile', type: 'tel' },
      { key: 'phoneDNC', label: 'Office phone is Do-Not-Call', type: 'checkbox' },
      { key: 'mobileDNC', label: 'Mobile is Do-Not-Call', type: 'checkbox' },
      { key: 'verification', label: 'Verification', type: 'select', options: ['Web-verified', 'ZoomInfo only', 'Unverified'] },
      { key: 'linkedin', label: 'LinkedIn URL', type: 'url', wide: true },
      { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
    deals: [
      { section: 'Requirement' },
      { key: 'name', label: 'Deal name', required: true, wide: true },
      { key: 'companyId', label: 'Client', type: 'ref', ref: 'companies', required: true },
      { key: 'dealType', label: 'Deal type', type: 'select', options: L.DEAL_TYPES },
      { key: 'assetClass', label: 'Asset class', type: 'select', options: L.ASSET_CLASSES, required: true },
      { key: 'stage', label: 'Stage', type: 'select', options: L.DEAL_STAGES.map((s) => s.name) },
      { key: 'sfMin', label: 'SF min', type: 'number' },
      { key: 'sfMax', label: 'SF max', type: 'number' },
      { key: 'estSF', label: 'Est. deal SF (for commission)', type: 'number' },
      { key: 'targetSubmarkets', label: 'Target submarkets' },
      { key: 'targetOccupancy', label: 'Target occupancy', type: 'date' },
      { key: 'headcountTarget', label: 'Planned headcount', type: 'number', asset: 'Office' },
      { key: 'parkingRatio', label: 'Parking (/1,000 SF)', type: 'number', step: '0.1' },
      { key: 'clearHeightMin', label: 'Min clear height (ft)', type: 'number', asset: 'Industrial' },
      { key: 'dockDoors', label: 'Dock doors', type: 'number', asset: 'Industrial' },
      { key: 'driveIns', label: 'Drive-in doors', type: 'number', asset: 'Industrial' },
      { key: 'power', label: 'Power (amps / volts)', asset: 'Industrial' },
      { key: 'requirements', label: 'Other requirements', type: 'textarea', wide: true },
      { section: 'Economics' },
      { key: 'budgetRate', label: 'Target rent ($/SF)', type: 'number', step: '0.01' },
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
      { section: 'Closed deal results (for your portfolio metrics)' },
      { key: 'actualSF', label: 'Final SF', type: 'number' },
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
      { key: 'building', label: 'Building' },
      { key: 'address', label: 'Address' },
      { key: 'leaseCommencement', label: 'Lease commencement', type: 'date' },
      { key: 'newLeaseExpiration', label: 'New lease expiration', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
    activities: [
      { key: 'type', label: 'Type', type: 'select', options: L.ACTIVITY_TYPES },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'companyId', label: 'Company', type: 'ref', ref: 'companies', required: true },
      { key: 'contactId', label: 'Contact', type: 'ref', ref: 'contacts', filterBy: 'companyId' },
      { key: 'dealId', label: 'Deal', type: 'ref', ref: 'deals', filterBy: 'companyId' },
      { key: 'subject', label: 'Subject', required: true, wide: true },
      { key: 'notes', label: 'Notes / outcome', type: 'textarea', wide: true },
      { key: 'followUpDate', label: 'Follow-up date', type: 'date' },
      { key: 'done', label: 'Follow-up complete', type: 'checkbox' },
    ],
    properties: [
      { key: 'building', label: 'Building', required: true },
      { key: 'address', label: 'Address' },
      { key: 'submarket', label: 'Submarket', list: () => distinct('companies', 'submarket').concat(distinct('properties', 'submarket')) },
      { key: 'status', label: 'Status', type: 'select', options: L.PROPERTY_STATUSES },
      { key: 'availableSF', label: 'Available SF', type: 'number' },
      { key: 'askingRate', label: 'Asking rent ($/SF)', type: 'number', step: '0.01' },
      { key: 'rateBasis', label: 'Rent basis', type: 'select', options: L.RATE_BASES },
      { key: 'landlord', label: 'Landlord / listing broker' },
      { key: 'tiAllowance', label: 'TI offered ($/SF)', type: 'number', step: '0.01' },
      { key: 'freeRentMonths', label: 'Free rent (months)', type: 'number' },
      { key: 'parkingRatio', label: 'Parking (/1,000 SF)', type: 'number', step: '0.1' },
      { key: 'clearHeight', label: 'Clear height (ft)', type: 'number', asset: 'Industrial' },
      { key: 'dockDoors', label: 'Dock doors', type: 'number', asset: 'Industrial' },
      { key: 'tourDate', label: 'Tour date', type: 'date' },
      { key: 'notes', label: 'Notes / pros & cons', type: 'textarea', wide: true },
    ],
  };

  const LABELS = { companies: 'Company', contacts: 'Contact', deals: 'Deal', activities: 'Activity', properties: 'Survey Property' };

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

  function activityDue(a) {
    return a.followUpDate || (a.type === 'Task' ? a.date : '');
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
      .filter((d) => d.stage === 'Closed Won' && (d.closedDate || d.targetClose || '').slice(0, 4) === year)
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

    const repExpiring = deals.filter(
      (d) => d.repAgreementSigned && d.repAgreementExpires && L.OPEN_STAGES.includes(d.stage) && L.daysBetween(today, d.repAgreementExpires) <= 60
    );

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

      <div class="grid2">
        <section class="card">
          <h2>Going stale</h2>
          <p class="hint">Prospects with no logged touch in ${esc(s.staleDays)}+ days.</p>
          ${stale.length ? companyMiniTable(stale, touches) : emptyState('Every prospect has been touched recently.')}
        </section>
        <section class="card">
          <h2>Rep agreements expiring ≤ 60 days</h2>
          ${
            repExpiring.length
              ? `<table class="tbl compact"><tbody>${repExpiring
                  .map((d) => `<tr data-href="#/deal/${esc(d.id)}"><td><strong>${esc(d.name)}</strong><div class="sub">${esc(companyName(d.companyId))}</div></td><td class="right">${esc(L.fmtDate(d.repAgreementExpires))}</td></tr>`)
                  .join('')}</tbody></table>`
              : emptyState('None.')
          }
        </section>
      </div>`;
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
          <button class="icon-btn" data-action="edit" data-col="activities" data-id="${esc(a.id)}" title="Edit">✎</button>
        </li>`;
      })
      .join('')}</ul>`;
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
    const sorters = {
      score: (a, b) => b.score - a.score,
      expiration: (a, b) => (a.c.leaseExpiration || '9999').localeCompare(b.c.leaseExpiration || '9999'),
      sf: (a, b) => (L.parseNumber(b.c.sfOccupied) || 0) - (L.parseNumber(a.c.sfOccupied) || 0),
      name: (a, b) => a.c.name.localeCompare(b.c.name),
      lastTouch: (a, b) => (a.last || '0000').localeCompare(b.last || '0000'),
    };
    withScore.sort(sorters[f.sort] || sorters.score);
    return withScore;
  }

  function viewCompanies() {
    const f = state.companies;
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
          ],
          f.sort
        )}</select>
      </div>
      <p class="count">${rows.length} companies · ${L.fmtNumber(totalSF)} SF</p>
      ${
        rows.length
          ? `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>Score</th><th>Company</th><th>Asset</th><th>Status</th><th>Submarket</th><th class="right">SF</th><th>Lease expiration</th><th>Last touch</th></tr></thead>
          <tbody>${shown
            .map(
              ({ c, score, last }) => `<tr data-href="#/company/${esc(c.id)}">
              <td>${scoreChip(score)}</td>
              <td><strong>${esc(c.name)}</strong> ${c.priority ? badge(c.priority, 'prio') : ''}<div class="sub">${esc([c.industry, c.building || c.address].filter(Boolean).join(' · '))}</div></td>
              <td>${assetBadge(c.assetClass)}</td>
              <td>${statusBadge(c.status)}</td>
              <td>${esc(c.submarket)}</td>
              <td class="right">${esc(L.fmtNumber(c.sfOccupied))}</td>
              <td>${expirationBadge(c.leaseExpiration)}${shouldBeInMarket(c) ? ' <span class="flag" title="Inside typical lead time and not engaged">⚑</span>' : ''}</td>
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
    const contacts = S.all('contacts').filter((x) => x.companyId === id);
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
        <div><h1>${esc(c.name)}</h1>
          <div class="head-badges">${assetBadge(c.assetClass)} ${statusBadge(c.status)} ${c.priority ? badge('Priority ' + c.priority, 'prio') : ''} ${scoreChip(score)}</div>
        </div>
        <div class="actions">
          <button class="btn" data-action="new" data-col="activities" data-company="${esc(id)}">Log activity</button>
          <button class="btn" data-action="new" data-col="contacts" data-company="${esc(id)}">+ Contact</button>
          <button class="btn" data-action="new" data-col="deals" data-company="${esc(id)}">+ Deal</button>
          <button class="btn" data-action="edit" data-col="companies" data-id="${esc(id)}">Edit</button>
          <button class="btn danger" data-action="delete" data-col="companies" data-id="${esc(id)}">Delete</button>
        </div>
      </div>

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
      ${c.notes ? `<section class="card"><h2>Notes</h2><p class="pre">${esc(c.notes)}</p></section>` : ''}

      <div class="grid2">
        <section class="card">
          <h2>Contacts <button class="link more" data-action="new" data-col="contacts" data-company="${esc(id)}">+ Add</button></h2>
          ${
            contacts.length
              ? `<table class="tbl compact"><tbody>${contacts
                  .map(
                    (p) => `<tr><td><strong>${esc(contactName(p))}</strong> ${p.role ? badge(p.role, p.role === 'Decision Maker' ? 'green' : 'gray') : ''} ${verificationBadge(p.verification)}<div class="sub">${esc(p.title)}</div>${p.notes ? `<div class="sub clamp" title="${esc(p.notes)}">${esc(p.notes)}</div>` : ''}</td>
                    <td>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}<div class="sub">${phoneLink(p.phone, p.phoneDNC)}${p.mobile ? ' · ' + phoneLink(p.mobile, p.mobileDNC, '(m)') : ''}</div>${p.linkedin ? `<div class="sub"><a href="${esc(p.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a></div>` : ''}</td>
                    <td class="right nowrap"><button class="icon-btn" data-action="new" data-col="activities" data-company="${esc(id)}" data-contact="${esc(p.id)}" title="Log activity">☎</button><button class="icon-btn" data-action="edit" data-col="contacts" data-id="${esc(p.id)}" title="Edit">✎</button></td></tr>`
                  )
                  .join('')}</tbody></table>`
              : emptyState('No contacts yet.')
          }
        </section>
        <section class="card">
          <h2>Deals <button class="link more" data-action="new" data-col="deals" data-company="${esc(id)}">+ Add</button></h2>
          ${deals.length ? dealMiniTable(deals) : emptyState('No deals yet.')}
        </section>
      </div>

      <section class="card">
        <h2>Activity <button class="link more" data-action="new" data-col="activities" data-company="${esc(id)}">+ Log</button></h2>
        ${acts.length ? activityTimeline(acts) : emptyState('No activity logged yet.')}
      </section>`;
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
              <td>${c.role ? badge(c.role, c.role === 'Decision Maker' ? 'green' : 'gray') : ''}</td>
              <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}</td>
              <td class="nowrap">${phoneLink(c.phone, c.phoneDNC)}${c.mobile ? `<div class="sub">${phoneLink(c.mobile, c.mobileDNC, '(m)')}</div>` : ''}</td>
              <td>${touches[c.id] ? esc(L.fmtDate(touches[c.id])) : '<span class="muted">Never</span>'}</td>
              <td class="right nowrap">${c.linkedin ? `<a class="icon-btn" href="${esc(c.linkedin)}" target="_blank" rel="noopener" title="LinkedIn">in</a>` : ''}
                <button class="icon-btn" data-action="new" data-col="activities" data-company="${esc(c.companyId)}" data-contact="${esc(c.id)}" title="Log activity">☎</button>
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
          const inStage = deals.filter((d) => d.stage === stage);
          const total = inStage.reduce((t, d) => t + L.estimatedCommission(d).myShare, 0);
          return `<div class="col" data-stage="${esc(stage)}">
            <div class="col-head"><strong>${esc(stage)}</strong><span class="muted">${inStage.length} · ${L.fmtMoney(total, true)}</span></div>
            ${inStage
              .map((d) => {
                const est = L.estimatedCommission(d);
                return `<a class="deal-card" draggable="true" data-deal="${esc(d.id)}" href="#/deal/${esc(d.id)}">
                  <div class="dc-title">${esc(d.name)}</div>
                  <div class="sub">${esc(companyName(d.companyId))}</div>
                  <div class="dc-meta">${assetBadge(d.assetClass)} ${d.estSF ? `<span>${L.fmtNumber(d.estSF)} SF</span>` : ''}</div>
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
            return `<tr data-href="#/deal/${esc(d.id)}"><td><strong>${esc(d.name)}</strong><div class="sub">${esc(companyName(d.companyId))}</div></td>
              <td>${esc(d.dealType)}</td><td>${assetBadge(d.assetClass)}</td><td>${esc(d.stage)}</td>
              <td class="right">${esc(L.fmtNumber(d.estSF || d.sfMax || d.sfMin))}</td>
              <td class="right">${L.fmtMoney(est.aggregateValue, true)}</td>
              <td class="right">${L.fmtMoney(est.myShare)}</td>
              <td class="right">${L.dealProbability(d)}%</td>
              <td>${esc(L.fmtDate(d.targetClose))}</td></tr>`;
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
    const isInd = d.assetClass !== 'Office';
    const isOff = d.assetClass !== 'Industrial';
    const sizeRange = [d.sfMin, d.sfMax].filter(Boolean).map(L.fmtNumber).join(' – ');

    const reqs = [
      ['Deal type', d.dealType],
      ['Size range', sizeRange ? sizeRange + ' SF' : ''],
      ['Est. deal SF', L.fmtNumber(d.estSF)],
      ['Target submarkets', d.targetSubmarkets],
      ['Target occupancy', L.fmtDate(d.targetOccupancy)],
      ['Planned headcount', isOff ? L.fmtNumber(d.headcountTarget) : ''],
      ['Parking', d.parkingRatio ? d.parkingRatio + ' / 1,000 SF' : ''],
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
        <div><h1>${esc(d.name)}</h1><div class="head-badges">${assetBadge(d.assetClass)} ${badge(d.dealType, 'gray')} ${badge(d.stage, 'blue')}</div></div>
        <div class="actions">
          <button class="btn" data-action="new" data-col="activities" data-company="${esc(d.companyId)}" data-deal="${esc(id)}">Log activity</button>
          <button class="btn" data-action="edit" data-col="deals" data-id="${esc(id)}">Edit</button>
          <button class="btn danger" data-action="delete" data-col="deals" data-id="${esc(id)}">Delete</button>
        </div>
      </div>
      <div class="stepper">${L.DEAL_STAGES.map(
        (s) => `<button class="${s.name === d.stage ? 'on' : ''} ${s.name === 'Closed Lost' ? 'lost' : ''}" data-action="set-stage" data-id="${esc(id)}" data-stage="${esc(s.name)}">${esc(s.name)}</button>`
      ).join('')}</div>

      <div class="grid3">
        <section class="card">
          <h2>Commission estimate</h2>
          <div class="big">${L.fmtMoney(est.myShare)}</div>
          <p class="sub">my share · ${L.fmtMoney((est.myShare * prob) / 100)} weighted at ${prob}%</p>
          <table class="tbl compact"><tbody>
            <tr><td>Deal SF</td><td class="right">${esc(L.fmtNumber(d.estSF || d.sfMax || d.sfMin) || '—')}</td></tr>
            <tr><td>Rent</td><td class="right">${d.budgetRate ? '$' + esc(d.budgetRate) + esc(rateUnit(d.rateBasis)) : '—'}</td></tr>
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
          <dl class="info">${reqs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
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
              : '<h2>Notes</h2>'
          }
          ${d.notes ? `<p class="pre">${esc(d.notes)}</p>` : d.stage === 'Closed Won' ? '' : '<p class="muted">No notes.</p>'}
          ${d.hubspotUrl ? `<p><a href="${esc(d.hubspotUrl)}" target="_blank" rel="noopener">Open in HubSpot ↗</a></p>` : ''}
        </section>
      </div>

      <section class="card">
        <h2>Market survey & tours <button class="link more" data-action="new" data-col="properties" data-deal="${esc(id)}">+ Add property</button></h2>
        ${
          props.length
            ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Building</th><th>Status</th><th class="right">Avail. SF</th><th class="right">Asking</th><th class="right">Est. yr-1 rent</th><th class="right">TI</th><th class="right">Free rent</th>${isInd ? '<th class="right">Clear</th><th class="right">Docks</th>' : ''}<th>Tour</th><th></th></tr></thead><tbody>
          ${props
            .map((p) => {
              const sf = L.parseNumber(d.estSF) || L.parseNumber(p.availableSF) || 0;
              const yr1 = sf * (L.parseNumber(p.askingRate) || 0) * (/\/mo/.test(p.rateBasis || '') ? 12 : 1);
              const cls = { Selected: 'green', Shortlisted: 'green', Rejected: 'red', 'Proposal Received': 'blue', Toured: 'amber' }[p.status] || 'gray';
              return `<tr class="${p.status === 'Rejected' ? 'dim' : ''}"><td><strong>${esc(p.building)}</strong><div class="sub">${esc([p.address, p.submarket].filter(Boolean).join(' · '))}</div>${p.notes ? `<div class="sub pre">${esc(p.notes)}</div>` : ''}</td>
                <td>${badge(p.status, cls)}</td>
                <td class="right">${esc(L.fmtNumber(p.availableSF))}</td>
                <td class="right nowrap">${p.askingRate ? '$' + esc(p.askingRate) + '<span class="sub"> ' + esc(rateUnit(p.rateBasis)) + '</span>' : ''}</td>
                <td class="right">${yr1 ? L.fmtMoney(yr1) : ''}</td>
                <td class="right">${p.tiAllowance ? '$' + esc(p.tiAllowance) : ''}</td>
                <td class="right">${p.freeRentMonths ? esc(p.freeRentMonths) + ' mo' : ''}</td>
                ${isInd ? `<td class="right">${p.clearHeight ? esc(p.clearHeight) + "'" : ''}</td><td class="right">${esc(p.dockDoors)}</td>` : ''}
                <td>${esc(L.fmtDate(p.tourDate))}</td>
                <td class="right nowrap"><button class="icon-btn" data-action="edit" data-col="properties" data-id="${esc(p.id)}" title="Edit">✎</button><button class="icon-btn" data-action="delete" data-col="properties" data-id="${esc(p.id)}" title="Delete">✕</button></td></tr>`;
            })
            .join('')}</tbody></table></div>
            <p class="hint">Est. yr-1 rent uses the deal SF when set, otherwise the space's available SF.</p>`
            : emptyState('No properties on the survey yet.')
        }
      </section>

      <section class="card">
        <h2>Activity</h2>
        ${acts.length ? activityTimeline(acts) : emptyState('No activity logged against this deal.')}
      </section>`;
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
    const all = S.all('deals').filter((d) => d.stage === 'Closed Won');
    const years = Array.from(new Set(all.map((d) => L.dealCloseDate(d).slice(0, 4)).filter(Boolean))).sort().reverse();
    const deals = closedDeals(f).sort((a, b) => L.dealCloseDate(b).localeCompare(L.dealCloseDate(a)));
    const t = L.summarizeDeals(deals);
    const estimated = deals.filter((d) => !L.dealResults(d).hasActuals).length;
    const firm = deals.reduce((s, d) => s + (L.parseNumber(d.firmCommission) || 0), 0);
    const split = L.parseNumber(S.settings().houseSplitPct) === null ? 50 : L.parseNumber(S.settings().houseSplitPct);
    const rescinded = S.all('deals').filter((d) => d.stage === 'Closed Lost' && d.inPortfolioSheet && L.isRescinded(d) && (f.year === 'All' || L.dealCloseDate(d).slice(0, 4) === String(f.year)));

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
      ${rescinded.length ? `<p class="hint">Not counted: ${rescinded.map((d) => `<a href="#/deal/${esc(d.id)}">${esc(companyName(d.companyId))}</a> (rescinded)`).join(', ')}.</p>` : ''}
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
      ${importPreview ? importPreviewCard() : ''}
      <div class="grid2">
        <section class="card">
          <h2>Import from CSV</h2>
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
          <p class="sub">${counts}<br/>Last backup: ${s.lastBackup ? esc(L.fmtDate(s.lastBackup)) : '<strong>never</strong>'}</p>
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
            <div class="wide"><button class="btn primary" type="submit">Save settings</button></div>
          </form>
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

  function importPreviewCard() {
    const p = importPreview;
    const mapped = Object.keys(p.result.mapping);
    const required = { companies: 'name', contacts: 'company', portfolio: 'company' }[p.kind];
    const unmapped = p.result.headers.filter((h, i) => !Object.values(p.result.mapping).includes(i));
    const sample = p.result.records.slice(0, 5);
    return `<section class="card import-preview">
      <h2>Review import: ${esc(p.filename)}</h2>
      <p>${p.result.records.length} rows found. Matched columns:</p>
      <div class="mapping">${mapped.map((k) => `<span class="badge green">${esc(p.result.headers[p.result.mapping[k]])} → ${esc(k)}</span>`).join(' ')}
        ${unmapped.map((h) => `<span class="badge gray" title="Will be ignored">${esc(h)} (ignored)</span>`).join(' ')}</div>
      ${!mapped.includes(required) ? `<p class="red-text">No ${p.kind === 'companies' ? 'company/tenant name' : 'client/company'} column was recognized. Rename that column to "Company" and try again.</p>` : ''}
      <div class="table-wrap"><table class="tbl compact"><thead><tr>${mapped.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead>
        <tbody>${sample.map((r) => `<tr>${mapped.map((k) => `<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <form id="import-form" class="form-grid">
        <label>Asset class when not in file<select name="assetClass">${options(L.ASSET_CLASSES, state.companies.asset !== 'All' ? state.companies.asset : 'Office')}</select></label>
        <label>Status for new companies<select name="status">${options(L.COMPANY_STATUSES, p.kind === 'portfolio' ? 'Past Client' : 'Target')}</select></label>
        <label>Lead source<input name="source" value="${esc(p.kind === 'contacts' ? '' : p.kind === 'portfolio' ? 'Portfolio import' : 'CSV import')}" /></label>
        <div class="wide actions">
          <button class="btn primary" type="submit">Import ${p.result.records.length} rows</button>
          <button class="btn" type="button" data-action="cancel-import">Cancel</button>
        </div>
        <p class="hint wide">Companies whose name (and address, when given) already exist are updated rather than duplicated. ${p.kind === 'contacts' ? 'Contacts with an email already in the CRM are skipped; companies that do not exist yet are created.' : ''}${p.kind === 'portfolio' ? 'Each row becomes a Closed Won deal under its client (clients are created if needed). Re-importing the same client, close date and SF updates the deal instead of duplicating it.' : ''}</p>
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
        input = `<select id="${id}" name="${f.key}"${req}>${options(f.options, v, '')}</select>`;
        break;
      case 'ref': {
        const opts = refOptions(f, rec);
        input = `<select id="${id}" name="${f.key}"${req} ${f.filterBy ? `data-filter-by="${f.filterBy}"` : ''}><option value=""></option>${opts
          .map((o) => `<option value="${esc(o.value)}" ${o.company ? `data-company="${esc(o.company)}"` : ''} ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`)
          .join('')}</select>`;
        break;
      }
      case 'textarea':
        input = `<textarea id="${id}" name="${f.key}" rows="3"${req}>${esc(v)}</textarea>`;
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
        return { status: 'Target', priority: 'B', growthSignal: 'Unknown', assetClass: state.companies.asset !== 'All' ? state.companies.asset : '' };
      case 'contacts':
        return { companyId: ctx.company || '' };
      case 'deals': {
        const c = S.get('companies', ctx.company);
        return {
          companyId: ctx.company || '',
          name: c ? c.name + ' – ' : '',
          stage: 'Pitching',
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
        return { type: 'Call', date: today, companyId: ctx.company || '', contactId: ctx.contact || '', dealId: ctx.deal || '', done: false };
      case 'properties': {
        const d = S.get('deals', ctx.deal);
        return { dealId: ctx.deal, status: 'Identified', rateBasis: d ? d.rateBasis : '' };
      }
    }
    return {};
  }

  function openForm(col, id, ctx) {
    ctx = ctx || {};
    const existing = id ? S.get(col, id) : null;
    const rec = existing ? Object.assign({}, existing) : defaultsFor(col, ctx);
    const dlg = $('#modal');
    const fields = FIELDS[col];
    const contextAsset = col === 'properties' ? (S.get('deals', rec.dealId) || {}).assetClass : '';
    dlg.innerHTML = `<form method="dialog" id="record-form" data-col="${col}" data-id="${esc(existing ? existing.id : '')}" data-context-asset="${esc(contextAsset || '')}">
      <header><h2>${existing ? 'Edit' : 'New'} ${LABELS[col]}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></header>
      <div class="form-grid">${fields.map((f) => fieldHTML(f, rec)).join('')}</div>
      <footer>
        ${col === 'activities' && !existing ? '<label class="check"><input type="checkbox" name="__another" /> Save & schedule next touch</label>' : ''}
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
  }

  function readForm(form, col) {
    const rec = {};
    FIELDS[col].forEach((f) => {
      if (f.section) return;
      const el = form.elements[f.key];
      if (!el) return;
      if (f.type === 'checkbox') rec[f.key] = el.checked;
      else if (f.type === 'number') rec[f.key] = el.value === '' ? '' : Number(el.value);
      else rec[f.key] = el.value.trim();
    });
    if (form.elements.dealId && col === 'properties') rec.dealId = form.elements.dealId.value;
    return rec;
  }

  function saveForm(form) {
    const col = form.dataset.col;
    const rec = readForm(form, col);
    if (form.dataset.id) rec.id = form.dataset.id;
    if (col === 'deals' && rec.stage === 'Closed Won' && !rec.closedDate) rec.closedDate = L.todayISO();
    const saved = S.upsert(col, rec);
    if (col === 'deals' && saved.inPortfolioSheet && S.settings().sheetSyncUrl) setTimeout(() => syncSheet(false), 0);
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
            if (!confirm(`Add ${n} records from "${file.name}" to your CRM? Existing records with the same ID are updated; nothing else changes.`)) return;
            S.importJSON(text, 'merge');
            return toast(`Added ${n} records.`);
          }
          const replace = confirm('Restore this backup?\n\nOK = REPLACE all current data with the backup.\nCancel = MERGE the backup into current data.');
          S.importJSON(text, replace ? 'replace' : 'merge');
          toast('Backup restored.');
        } catch (e) {
          alert('That file is not a valid backup: ' + e.message);
        }
        return;
      }
      const rows = L.parseCSV(text);
      const aliases = { companies: L.COMPANY_IMPORT_ALIASES, contacts: L.CONTACT_IMPORT_ALIASES, portfolio: L.PORTFOLIO_IMPORT_ALIASES }[kind];
      importPreview = { kind, filename: file.name, result: L.rowsToRecords(rows, aliases) };
      if (location.hash !== '#/data') location.hash = '#/data';
      else render();
      window.scrollTo(0, 0);
    };
    reader.readAsText(file);
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
    dashboard: viewDashboard,
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
    return { name: ROUTES[parts[0]] ? parts[0] : 'dashboard', id: parts[1] ? decodeURIComponent(parts[1]) : null };
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

  // ---------- events ----------

  document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const d = actionEl.dataset;
      switch (d.action) {
        case 'new':
          e.preventDefault();
          return openForm(d.col, null, { company: d.company, contact: d.contact, deal: d.deal });
        case 'edit':
          e.preventDefault();
          return openForm(d.col, d.id);
        case 'delete': {
          e.preventDefault();
          const rec = S.get(d.col, d.id);
          const what = d.col === 'companies' ? `"${rec.name}" and all of its contacts, deals and activity` : 'this ' + LABELS[d.col].toLowerCase();
          if (!confirm(`Delete ${what}? This cannot be undone.`)) return;
          S.remove(d.col, d.id);
          if (d.col === 'companies') location.hash = '#/companies';
          else if (d.col === 'deals') location.hash = '#/company/' + rec.companyId;
          return;
        }
        case 'show-more':
          state.companies.limit = (state.companies.limit || 100) + 200;
          return render();
        case 'close-modal':
          return $('#modal').close();
        case 'toggle-done': {
          const a = S.get('activities', d.id);
          S.upsert('activities', { id: a.id, done: !a.done });
          return toast('Follow-up completed.');
        }
        case 'set-filter':
          if (actionEl.tagName === 'A') e.preventDefault();
          state[d.scope][d.key] = d.value;
          if (d.scope === 'companies') state.companies.limit = 100;
          saveUIState();
          if (d.scope === 'companies' && !location.hash.startsWith('#/companies')) location.hash = '#/companies';
          return render();
        case 'set-stage': {
          const patch = { id: d.id, stage: d.stage };
          if (d.stage === 'Closed Won' && !S.get('deals', d.id).closedDate) patch.closedDate = L.todayISO();
          S.upsert('deals', patch);
          return toast('Stage → ' + d.stage);
        }
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
          input.accept = d.kind === 'backup' ? '.json,application/json' : '.csv,text/csv';
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
    if (row && !e.target.closest('a, button, input')) location.hash = row.dataset.href;
  });

  function onFilterChange(e) {
    const el = e.target;
    if (!el.dataset.filter) return;
    const [scope, key] = el.dataset.filter.split('.');
    state[scope][key] = el.type === 'checkbox' ? el.checked : el.value;
    if (scope === 'companies') state.companies.limit = 100;
    saveUIState();
    render();
  }
  document.addEventListener('input', (e) => {
    if (e.target.type === 'search') onFilterChange(e);
  });
  document.addEventListener('change', (e) => {
    if (e.target.dataset.filter && e.target.type !== 'search') onFilterChange(e);
    const form = e.target.closest('#record-form');
    if (form && (e.target.name === 'assetClass' || e.target.name === 'companyId')) syncFormDependencies(form);
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'record-form') {
      e.preventDefault();
      saveForm(e.target);
    } else if (e.target.id === 'settings-form' || e.target.id === 'settings-form-sync') {
      e.preventDefault();
      const fd = new FormData(e.target);
      const patch = {};
      fd.forEach((v, k) => (patch[k] = ['brokerName', 'homeMarket', 'sheetSyncUrl', 'sheetSyncKey'].includes(k) ? String(v).trim() : Number(v)));
      S.saveSettings(patch);
      toast('Settings saved.');
    } else if (e.target.id === 'import-form') {
      e.preventDefault();
      const fd = new FormData(e.target);
      const opts = { assetClass: fd.get('assetClass'), status: fd.get('status'), source: fd.get('source') };
      const importers = { companies: importCompanies, contacts: importContacts, portfolio: importPortfolio };
      const kind = importPreview.kind;
      const msg = importers[kind](importPreview.result.records, opts);
      importPreview = null;
      location.hash = '#/' + kind;
      render();
      toast(msg);
    }
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
      S.upsert('deals', patch);
      toast(deal.name + ' → ' + col.dataset.stage);
    } else render();
  });

  // Keyboard: "/" focuses the search box on list pages.
  document.addEventListener('keydown', (e) => {
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
  S.onChange(render);
  render();
  if (parseRoute().name === 'portfolio') maybeAutoSync();
})();
