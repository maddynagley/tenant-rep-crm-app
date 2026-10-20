/*
 * Pure business logic for the Tenant Rep CRM.
 * No DOM access here so it can be unit tested in Node (see tests/).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CRMLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ASSET_CLASSES = ['Office', 'Industrial', 'Office & Industrial'];

  const COMPANY_STATUSES = ['Target', 'Contacted', 'Engaged', 'Active Client', 'Past Client', 'Nurture', 'Not a Fit'];

  const DEAL_TYPES = ['New Lease', 'Renewal', 'Expansion', 'Relocation', 'Blend & Extend', 'Sublease', 'Purchase', 'Build-to-Suit'];

  // Tenant rep deal stages with default win probabilities. A deal starts once a lead is secured.
  const DEAL_STAGES = [
    { name: 'Pitching', probability: 10 },
    { name: 'Market Survey', probability: 30 },
    { name: 'Touring', probability: 45 },
    { name: 'RFP', probability: 60 },
    { name: 'LOI', probability: 75 },
    { name: 'Lease Negotiation', probability: 90 },
    { name: 'Closed Won', probability: 100 },
    { name: 'Closed Lost', probability: 0 },
  ];
  const OPEN_STAGES = DEAL_STAGES.filter((s) => !s.name.startsWith('Closed')).map((s) => s.name);

  // Stages from earlier versions, folded into the current list.
  const LEGACY_DEAL_STAGES = { 'Rep Agreement Signed': 'Market Survey', 'Needs Analysis': 'Market Survey', 'RFP / Proposals': 'RFP' };
  function normalizeDealStage(stage) {
    return LEGACY_DEAL_STAGES[stage] || stage;
  }

  // Lead stages mirror the HubSpot lead pipeline. "Secured Lead" is the hand-off to a deal.
  const LEAD_STAGES = ['New', 'Initial Outreach', 'Follow Up', 'Engaged', 'Secured Lead', 'Dead Lead'];
  const LEAD_TEMPS = ['Hot', 'Warm', 'Cold'];
  const LEAD_FROM_STATUS = { Target: 'New', Contacted: 'Initial Outreach', Nurture: 'Follow Up', Engaged: 'Engaged', 'Not a Fit': 'Dead Lead' };

  // A company's lead stage: set explicitly, or inferred from its status. Clients without one aren't leads.
  function leadStage(company) {
    if (LEAD_STAGES.includes(company.leadStage)) return company.leadStage;
    return LEAD_FROM_STATUS[company.status] || '';
  }

  const RATE_BASES = ['Full Service ($/SF/yr)', 'Modified Gross ($/SF/yr)', 'NNN ($/SF/yr)', 'NNN ($/SF/mo)', 'Gross ($/SF/mo)'];

  const ACTIVITY_TYPES = ['Call', 'Email', 'Meeting', 'Tour', 'LinkedIn', 'Pitch', 'Proposal', 'Note', 'Task'];

  const PROPERTY_STATUSES = ['Identified', 'Toured', 'Proposal Requested', 'Proposal Received', 'Shortlisted', 'Selected', 'Rejected'];

  // ---------- dates ----------

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function toISODate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function parseISODate(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function addDays(iso, days) {
    const d = parseISODate(iso);
    d.setDate(d.getDate() + days);
    return toISODate(d);
  }

  function daysBetween(fromISO, toISO) {
    const a = parseISODate(fromISO);
    const b = parseISODate(toISO);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  }

  // Whole months from `fromISO` until `toISO` (negative if in the past).
  function monthsUntil(toISO, fromISO) {
    const a = parseISODate(fromISO || todayISO());
    const b = parseISODate(toISO);
    if (!a || !b) return null;
    let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (months > 0 && b.getDate() < a.getDate()) months -= 1;
    if (months < 0 && b.getDate() > a.getDate()) months += 1;
    // Any date in the past counts as expired, even if less than a whole month ago.
    if (months === 0 && b < a) months = -1;
    return months;
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // Accepts the date formats common in CoStar / Excel / broker spreadsheets and returns YYYY-MM-DD.
  function normalizeDate(input) {
    if (input === null || input === undefined) return '';
    const s = String(input).trim();
    if (!s) return '';
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) return lastDayOfMonth(Number(m[1]), Number(m[2]));
    if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) {
      let y = Number(m[3]);
      if (y < 100) y += 2000;
      return y + '-' + pad(m[1]) + '-' + pad(m[2]);
    }
    // 12/2027 or 12-2027: leases typically expire at month end
    if ((m = /^(\d{1,2})[/.-](\d{4})$/.exec(s))) return lastDayOfMonth(Number(m[2]), Number(m[1]));
    // "Dec 2027", "December 2027", "Dec-27"
    if ((m = /^([A-Za-z]{3,9})[\s,.-]+(\d{2,4})$/.exec(s))) {
      const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      if (mi >= 0) {
        let y = Number(m[2]);
        if (y < 100) y += 2000;
        return lastDayOfMonth(y, mi + 1);
      }
    }
    // "Q3 2027" -> end of quarter
    if ((m = /^Q([1-4])\s*[-/ ]?\s*(\d{4})$/i.exec(s))) return lastDayOfMonth(Number(m[2]), Number(m[1]) * 3);
    if ((m = /^(\d{4})$/.exec(s))) return m[1] + '-12-31';
    // Excel serial date
    if (/^\d{5}$/.test(s)) {
      const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    const d = new Date(s);
    return isNaN(d) ? '' : toISODate(d);
  }

  function lastDayOfMonth(year, month) {
    const d = new Date(year, month, 0);
    return toISODate(d);
  }

  function parseNumber(input) {
    if (input === null || input === undefined || input === '') return null;
    if (typeof input === 'number') return isFinite(input) ? input : null;
    const s = String(input).replace(/[$,%\s]/g, '').replace(/sf$/i, '');
    if (!s) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  // ---------- lease expiration ----------

  const EXPIRATION_WINDOWS = [
    { key: 'expired', label: 'Past / Holdover', test: (m) => m !== null && m < 0 },
    { key: '0-12', label: '0–12 mo', test: (m) => m !== null && m >= 0 && m <= 12 },
    { key: '13-18', label: '13–18 mo', test: (m) => m !== null && m > 12 && m <= 18 },
    { key: '19-24', label: '19–24 mo', test: (m) => m !== null && m > 18 && m <= 24 },
    { key: '25-36', label: '25–36 mo', test: (m) => m !== null && m > 24 && m <= 36 },
    { key: '37-60', label: '37–60 mo', test: (m) => m !== null && m > 36 && m <= 60 },
    { key: '60+', label: '60+ mo', test: (m) => m !== null && m > 60 },
    { key: 'unknown', label: 'Unknown', test: (m) => m === null },
  ];

  function expirationWindow(leaseExpiration, today) {
    const m = monthsUntil(leaseExpiration, today);
    return EXPIRATION_WINDOWS.find((w) => w.test(m));
  }

  // How early tenants of a given size typically need to start the process, in months.
  function recommendedLeadTimeMonths(sf) {
    const n = parseNumber(sf) || 0;
    if (n >= 100000) return 36;
    if (n >= 50000) return 30;
    if (n >= 20000) return 24;
    if (n >= 10000) return 18;
    return 12;
  }

  // ---------- prospect scoring ----------

  // 0-100 score used to rank who to call next.
  function prospectScore(company, opts) {
    opts = opts || {};
    const today = opts.today || todayISO();
    const breakdown = {};

    const m = monthsUntil(company.leaseExpiration, today);
    if (m === null) breakdown.timing = 8;
    else if (m < 0) breakdown.timing = 20;
    else if (m <= 6) breakdown.timing = 25;
    else if (m <= 12) breakdown.timing = 32;
    else if (m <= 24) breakdown.timing = 40;
    else if (m <= 36) breakdown.timing = 32;
    else if (m <= 48) breakdown.timing = 15;
    else breakdown.timing = 5;

    const sf = parseNumber(company.sfOccupied);
    if (sf === null) breakdown.size = 5;
    else if (sf >= 100000) breakdown.size = 25;
    else if (sf >= 50000) breakdown.size = 21;
    else if (sf >= 20000) breakdown.size = 16;
    else if (sf >= 10000) breakdown.size = 11;
    else if (sf >= 5000) breakdown.size = 7;
    else breakdown.size = 3;

    breakdown.growth = { Growing: 15, Contracting: 11, Stable: 6 }[company.growthSignal] || 4;
    breakdown.priority = { A: 10, B: 6, C: 2 }[company.priority] || 4;

    // Reward accounts nobody has touched lately – they are the gap in coverage.
    const last = opts.lastActivityDate || null;
    const sinceTouch = last ? daysBetween(last, today) : null;
    if (sinceTouch === null) breakdown.coverage = 10;
    else if (sinceTouch > 90) breakdown.coverage = 9;
    else if (sinceTouch > 45) breakdown.coverage = 6;
    else breakdown.coverage = 2;

    if (company.status === 'Not a Fit') return { score: 0, breakdown };
    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { score: Math.min(100, score), breakdown };
  }

  // ---------- commissions ----------

  function isMonthlyRate(rateBasis) {
    return /\/mo/.test(rateBasis || '');
  }

  // Total rent over the term, with annual escalations, less free rent.
  function aggregateLeaseValue({ sf, rate, rateBasis, termMonths, escalationPct, freeRentMonths }) {
    sf = parseNumber(sf) || 0;
    rate = parseNumber(rate) || 0;
    termMonths = parseNumber(termMonths) || 0;
    const esc = (parseNumber(escalationPct) || 0) / 100;
    const free = Math.min(parseNumber(freeRentMonths) || 0, termMonths);
    const annualRate = isMonthlyRate(rateBasis) ? rate * 12 : rate;
    let total = 0;
    for (let month = 0; month < termMonths; month++) {
      if (month < free) continue;
      const year = Math.floor(month / 12);
      total += (sf * annualRate * Math.pow(1 + esc, year)) / 12;
    }
    return total;
  }

  function estimatedCommission(deal) {
    const value = aggregateLeaseValue({
      sf: deal.estSF || deal.sfMax || deal.sfMin,
      rate: deal.budgetRate,
      rateBasis: deal.rateBasis,
      termMonths: deal.termMonths,
      escalationPct: deal.escalationPct,
      freeRentMonths: deal.freeRentMonths,
    });
    const override = parseNumber(deal.commissionOverride);
    const commission = override !== null ? override : value * ((parseNumber(deal.commissionPct) || 0) / 100);
    const split = parseNumber(deal.splitPct);
    const myShare = commission * (split === null ? 1 : split / 100);
    return { aggregateValue: value, commission, myShare };
  }

  function stageProbability(stage) {
    const s = DEAL_STAGES.find((x) => x.name === stage);
    return s ? s.probability : 0;
  }

  function dealProbability(deal) {
    const p = parseNumber(deal.probability);
    if (deal.stage === 'Closed Won') return 100;
    if (deal.stage === 'Closed Lost') return 0;
    return p !== null ? p : stageProbability(deal.stage);
  }

  function weightedCommission(deal) {
    return (estimatedCommission(deal).myShare * dealProbability(deal)) / 100;
  }

  function pipelineSummary(deals) {
    return DEAL_STAGES.map((s) => {
      const inStage = deals.filter((d) => d.stage === s.name);
      return {
        stage: s.name,
        count: inStage.length,
        commission: inStage.reduce((t, d) => t + estimatedCommission(d).myShare, 0),
        weighted: inStage.reduce((t, d) => t + weightedCommission(d), 0),
        sf: inStage.reduce((t, d) => t + (parseNumber(d.estSF || d.sfMax || d.sfMin) || 0), 0),
      };
    });
  }

  // ---------- daily plan ----------

  // Days to wait before the next touch, by lead stage.
  const FOLLOW_UP_DAYS = { 'Initial Outreach': 7, 'Follow Up': 14, Engaged: 10 };
  const TEMP_RANK = { Hot: 0, Warm: 1, '': 2, Cold: 3 };

  function contactRank(c) {
    const callable = (c.phone && !c.phoneDNC) || (c.mobile && !c.mobileDNC);
    return (c.role === 'Decision Maker' ? 4 : 0) + (c.email ? 2 : 0) + (callable ? 2 : 0) + (c.verification === 'Web-verified' ? 1 : 0);
  }

  // How to reach a company's best contact: call (never a Do-Not-Call number), email, or find someone first.
  function reachChannel(contact) {
    if (!contact) return 'Find a contact';
    if ((contact.phone && !contact.phoneDNC) || (contact.mobile && !contact.mobileDNC)) return 'Call';
    if (contact.email) return 'Email';
    return contact.linkedin ? 'LinkedIn' : 'Find a contact';
  }

  // Today's to-do list: due follow-ups, deals that need attention, who to reach out to,
  // records to update, and a door-knocking route when several leads share a building.
  function dailyPlan(data, opts) {
    opts = opts || {};
    const today = opts.today || todayISO();
    const goal = Math.max(1, parseNumber(opts.outreachGoal) || 10);

    const touches = {};
    data.companies.forEach((c) => {
      if (c.lastContacted && c.lastContacted <= today) touches[c.id] = c.lastContacted;
    });
    data.activities.forEach((a) => {
      if (a.date && a.date <= today && (!touches[a.companyId] || a.date > touches[a.companyId])) touches[a.companyId] = a.date;
    });
    const sinceTouch = (id) => (touches[id] ? daysBetween(touches[id], today) : null);
    const snoozed = (c) => Boolean(c && c.snoozeUntil && c.snoozeUntil > today);
    const companies = {};
    data.companies.forEach((c) => (companies[c.id] = c));
    const contactsBy = {};
    data.contacts.forEach((c) => (contactsBy[c.companyId] = contactsBy[c.companyId] || []).push(c));
    const bestContact = (id) => (contactsBy[id] || []).slice().sort((a, b) => contactRank(b) - contactRank(a))[0] || null;

    const tasks = data.activities
      .filter((a) => !a.done)
      .map((a) => ({ a, due: a.followUpDate || (a.type === 'Task' ? a.date : '') }))
      .filter((x) => x.due && x.due <= today)
      .sort((x, y) => x.due.localeCompare(y.due))
      .map(({ a, due }) => ({ kind: 'task', activityId: a.id, companyId: a.companyId, contactId: a.contactId, title: a.subject, due }));

    const openDeals = data.deals.filter((d) => OPEN_STAGES.includes(d.stage));
    const dealCompanies = new Set(data.deals.filter((d) => d.stage !== 'Closed Lost').map((d) => d.companyId));

    const deals = openDeals
      .filter((d) => !snoozed(companies[d.companyId]))
      .map((d) => {
        const why = [];
        if (d.targetClose && d.targetClose < today) why.push(`Target execution (${fmtDate(d.targetClose)}) has passed. Update the timeline or stage.`);
        if (d.repAgreementSigned && d.repAgreementExpires && d.repAgreementExpires <= addDays(today, 30))
          why.push(`Rep agreement ${d.repAgreementExpires < today ? 'expired' : 'expires'} ${fmtDate(d.repAgreementExpires)}. Renew it.`);
        const since = sinceTouch(d.companyId);
        if (since === null) why.push('No activity logged yet. Check in and log where it stands.');
        else if (since > 14) why.push(`No activity in ${since} days. Check in and update the stage.`);
        return { kind: 'deal', dealId: d.id, companyId: d.companyId, title: d.name, stage: d.stage, why: why.join(' '), prob: dealProbability(d) };
      })
      .filter((x) => x.why)
      .sort((a, b) => b.prob - a.prob);

    const leads = data.companies.filter((c) => !dealCompanies.has(c.id) && !snoozed(c));
    const expiry = (c) => c.leaseExpiration || '9999-12-31';
    const outreachItem = (c, why) => {
      const contact = bestContact(c.id);
      return { kind: 'outreach', companyId: c.id, contactId: contact ? contact.id : '', title: c.name, stage: leadStage(c), temp: c.leadTemp || '', channel: reachChannel(contact), why };
    };

    const followUps = leads
      .filter((c) => {
        const wait = FOLLOW_UP_DAYS[leadStage(c)];
        const since = sinceTouch(c.id);
        return wait && (since === null || since >= wait);
      })
      .sort(
        (a, b) =>
          TEMP_RANK[a.leadTemp || ''] - TEMP_RANK[b.leadTemp || ''] ||
          expiry(a).localeCompare(expiry(b)) ||
          (sinceTouch(b.id) === null ? 1e9 : sinceTouch(b.id)) - (sinceTouch(a.id) === null ? 1e9 : sinceTouch(a.id))
      )
      .map((c) => {
        const since = sinceTouch(c.id);
        return outreachItem(c, `${leadStage(c)} · ${since === null ? 'no touch logged' : 'last touch ' + since + ' days ago'}`);
      });

    const fresh = leads
      .filter((c) => leadStage(c) === 'New' && !(sinceTouch(c.id) !== null && sinceTouch(c.id) < 30))
      .map((c) => ({ c, score: prospectScore(c, { today, lastActivityDate: touches[c.id] }).score }))
      .sort((a, b) => b.score - a.score || expiry(a.c).localeCompare(expiry(b.c)))
      .map(({ c }) => {
        const m = monthsUntil(c.leaseExpiration, today);
        return outreachItem(c, 'First touch' + (m === null ? '' : m < 0 ? ` · lease expired ${fmtDate(c.leaseExpiration)}` : ` · lease expires in ${fmtMonths(m)}`));
      });

    // Keep about a third of the day for brand-new leads so the top of the funnel keeps filling.
    const newSlots = Math.min(fresh.length, Math.max(Math.ceil(goal / 3), goal - followUps.length));
    const outreach = followUps.slice(0, goal - newSlots).concat(fresh.slice(0, newSlots));

    const updates = [];
    data.companies.forEach((c) => {
      if (leadStage(c) === 'Secured Lead' && !dealCompanies.has(c.id))
        updates.push({ kind: 'update', action: 'create-deal', companyId: c.id, title: c.name, why: 'Secured lead with no deal. Start one so it shows in the Pipeline.' });
    });
    data.deals.forEach((d) => {
      if (d.stage === 'Closed Won' && !d.partnerDeal && (!parseNumber(d.actualSF) || !parseNumber(d.commissionEarned)))
        updates.push({ kind: 'update', dealId: d.id, companyId: d.companyId, title: d.name, why: 'Closed won. Add the final SF and commission so your portfolio is complete.' });
    });
    leads.forEach((c) => {
      const m = monthsUntil(c.leaseExpiration, today);
      if (m !== null && m < 0 && c.leaseExpiration >= addDays(today, -183) && leadStage(c) !== 'Dead Lead')
        updates.push({ kind: 'update', companyId: c.id, title: c.name, why: `Lease expired ${fmtDate(c.leaseExpiration)}. Confirm whether they renewed or moved, and update the expiration.` });
    });

    // Door knocking: un-engaged leads sharing an address, so one trip covers several.
    const knockable = leads.filter((c) => ['New', 'Initial Outreach', 'Follow Up'].includes(leadStage(c)) && c.address && !(sinceTouch(c.id) !== null && sinceTouch(c.id) < 7));
    const groups = {};
    knockable.forEach((c) => {
      const key = normalizeAddress(c.address);
      (groups[key] = groups[key] || []).push(c);
    });
    const doorKnock = Object.values(groups)
      .filter((g) => g.length >= 2)
      .map((g) => g.sort((a, b) => expiry(a).localeCompare(expiry(b))))
      .sort((a, b) => b.length - a.length || expiry(a[0]).localeCompare(expiry(b[0])))
      .slice(0, 3)
      .map((g) => ({ address: g[0].address, building: (g.find((c) => c.building) || {}).building || '', companyIds: g.map((c) => c.id) }));

    return {
      tasks,
      deals,
      outreach,
      updates: updates.slice(0, 8),
      doorKnock,
      remaining: { followUps: followUps.length, fresh: fresh.length, updates: updates.length },
    };
  }

  // ---------- closed-deal portfolio ----------

  // Results for a deal: actuals when recorded, otherwise the estimate.
  function dealResults(deal) {
    const est = estimatedCommission(deal);
    const actualSF = parseNumber(deal.actualSF);
    const actualRent = parseNumber(deal.totalLeaseValue);
    const actualComm = parseNumber(deal.commissionEarned);
    return {
      sf: actualSF !== null ? actualSF : parseNumber(deal.estSF || deal.sfMax || deal.sfMin) || 0,
      rent: actualRent !== null ? actualRent : est.aggregateValue,
      commission: actualComm !== null ? actualComm : est.myShare,
      hasActuals: actualSF !== null || actualRent !== null || actualComm !== null,
    };
  }

  function dealCloseDate(deal) {
    return deal.closedDate || deal.targetClose || '';
  }

  function summarizeDeals(deals) {
    const t = { count: deals.length, sf: 0, rent: 0, commission: 0 };
    deals.forEach((d) => {
      const r = dealResults(d);
      t.sf += r.sf;
      t.rent += r.rent;
      t.commission += r.commission;
    });
    t.avgCommission = t.count ? t.commission / t.count : 0;
    t.avgSF = t.count ? t.sf / t.count : 0;
    t.commissionPerSF = t.sf ? t.commission / t.sf : 0;
    t.effectiveRate = t.rent ? (t.commission / t.rent) * 100 : 0;
    return t;
  }

  // Groups closed deals by a key function and summarizes each group, largest commission first.
  function portfolioBreakdown(deals, keyFn) {
    const groups = {};
    deals.forEach((d) => {
      const k = keyFn(d) || 'Unspecified';
      (groups[k] = groups[k] || []).push(d);
    });
    return Object.keys(groups)
      .map((k) => Object.assign({ key: k }, summarizeDeals(groups[k])))
      .sort((a, b) => b.commission - a.commission);
  }

  // ---------- CSV ----------

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += c;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((v) => v.trim() !== ''));
  }

  function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows, columns) {
    const header = columns.map((c) => csvEscape(c.label)).join(',');
    const body = rows.map((r) => columns.map((c) => csvEscape(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
    return [header].concat(body).join('\r\n');
  }

  // Header aliases so exports from CoStar, Reonomy, ZoomInfo, Excel lists etc. map automatically.
  const COMPANY_IMPORT_ALIASES = {
    name: ['company', 'company name', 'tenant', 'tenant name', 'account', 'account name', 'name', 'organization'],
    assetClass: ['asset class', 'property type', 'building type', 'type', 'product type', 'space use'],
    industry: ['industry', 'sector', 'naics description', 'sic description', 'primary industry'],
    status: ['status', 'stage', 'prospect status'],
    priority: ['priority', 'tier', 'rank'],
    address: ['address', 'building address', 'street address', 'property address', 'location'],
    building: ['building', 'building name', 'property', 'property name'],
    city: ['city', 'market', 'metro'],
    submarket: ['submarket', 'sub market', 'submarket name', 'cluster'],
    floor: ['floor', 'suite', 'floor/suite', 'suite/floor'],
    sfOccupied: ['sf', 'sf occupied', 'square feet', 'square footage', 'rsf', 'occupied sf', 'size', 'sf leased', 'leased sf', 'rentable sf'],
    leaseExpiration: ['lease expiration', 'expiration', 'expiration date', 'lease exp', 'exp date', 'lease end', 'lease expiration date', 'expires'],
    landlord: ['landlord', 'owner', 'building owner', 'true owner', 'recorded owner'],
    currentRate: ['rent', 'current rent', 'rate', 'asking rent', 'rent/sf', 'rent per sf', 'contract rent'],
    headcount: ['employees', 'headcount', 'employee count', 'number of employees', '# employees', 'employees at location'],
    website: ['website', 'web site', 'url', 'domain'],
    growthSignal: ['growth', 'growth signal'],
    source: ['source', 'lead source'],
    tags: ['tags', 'labels'],
    notes: ['notes', 'comments', 'note'],
  };

  // Closed-deal / portfolio analysis spreadsheets.
  const PORTFOLIO_IMPORT_ALIASES = {
    company: ['client', 'tenant', 'tenant name', 'company', 'company name', 'client name', 'account'],
    name: ['deal', 'deal name', 'transaction', 'project', 'project name'],
    building: ['building', 'building name', 'property', 'property name'],
    address: ['address', 'property address', 'premises', 'location'],
    submarket: ['submarket', 'market', 'sub market'],
    assetClass: ['asset class', 'property type', 'product type', 'asset type', 'type of space', 'space type'],
    dealType: ['deal type', 'transaction type', 'lease type', 'type of transaction'],
    actualSF: ['sf', 'rsf', 'square feet', 'square footage', 'size', 'total sf', 'leased sf', 'sf leased', 'rentable sf', 'deal sf'],
    totalLeaseValue: ['total rent', 'total rent $', 'rent $', 'total lease value', 'lease value', 'aggregate rent', 'total consideration', 'consideration', 'gross lease value', 'total value', 'deal value', 'total rent obligation'],
    commissionEarned: ['commission', 'commission earned', 'total commission', 'my commission', 'net commission', 'gross commission', 'fee', 'commission $', 'commissions'],
    closedDate: ['close date', 'closed date', 'date closed', 'execution date', 'lease execution', 'executed', 'signed date', 'date', 'lease date', 'deal date'],
    termMonths: ['term', 'term (months)', 'term months', 'lease term', 'months'],
    budgetRate: ['rate', 'rent/sf', 'rent psf', 'rate psf', 'base rent', 'starting rent', '$/sf'],
    leaseCommencement: ['commencement', 'commencement date', 'lease commencement', 'start date'],
    newLeaseExpiration: ['expiration', 'lease expiration', 'expiration date', 'new expiration', 'lease end'],
    landlord: ['landlord', 'owner'],
    notes: ['notes', 'comments'],
  };

  // A term like "5 years", "5 yrs", "62 mo" or a bare number of months.
  function parseTermMonths(v) {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v).toLowerCase();
    const n = parseNumber(s.replace(/[a-z()]+/g, ''));
    if (n === null) return null;
    return /y/.test(s) ? Math.round(n * 12) : n;
  }

  function normalizeDealType(v) {
    const s = String(v || '').toLowerCase();
    if (!s) return '';
    if (/blend|extend/.test(s)) return 'Blend & Extend';
    if (/renew|extension/.test(s)) return 'Renewal';
    if (/expan/.test(s)) return 'Expansion';
    if (/reloc/.test(s)) return 'Relocation';
    if (/sublease|sub-lease/.test(s)) return 'Sublease';
    if (/purchase|sale|acqui|buy/.test(s)) return 'Purchase';
    if (/bts|build/.test(s)) return 'Build-to-Suit';
    if (/new|lease|direct/.test(s)) return 'New Lease';
    return '';
  }

  // ---------- Google Sheet portfolio sync ----------

  // Columns of the portfolio tracker sheet, matched by header text so renamed or reordered columns still work.
  const SHEET_COLUMNS = [
    { field: 'rmsDate', test: /^date.*(rms|submitted)|^rms|^submitted/ },
    { field: 'quarter', test: /^quarter$|^qtr$/ },
    { field: 'year', test: /^year$/ },
    { field: 'company', test: /tenant|client/ },
    { field: 'representation', test: /^tr\/ll|representation/ },
    { field: 'dealTypeRaw', test: /^type$|deal type|transaction type/ },
    { field: 'origination', test: /^origination/ },
    { field: 'execution', test: /^execution$/ },
    { field: 'voucher', test: /^voucher/ },
    { field: 'building', test: /^building/ },
    { field: 'submarket', test: /^submarket/ },
    { field: 'vertical', test: /^vertical|asset class|property type/ },
    { field: 'actualSF', test: /^sf$|^rsf$|square feet/ },
    { field: 'outsideBroker', test: /outside broker name/ },
    { field: 'outsideBrokerCompany', test: /outside broker comp/ },
    { field: 'totalLeaseValue', test: /total consideration|total rent/ },
    { field: 'firmCommission', test: /firm commission|gross commission.*\((firm|house|company|total)\)/ },
    { field: 'commissionEarned', test: /gross commission|my commission/ },
    { field: 'closedDate', test: /invoice #?1|execution date/ },
    { field: 'leaseCommencement', test: /invoice #?2|commencement/ },
    { field: 'bookedDate', test: /booked/ },
    { field: 'cash1Date', test: /^1st inst/ },
    { field: 'cash2Date', test: /^2nd inst/ },
    { field: 'ptNumber', test: /^pt #/ },
    { field: 'trxId', test: /trx|transaction id/ },
    { field: 'ottCheck', test: /^ott/ },
    { field: 'notes', test: /^notes?$/ },
    { field: 'crmId', test: /^crm id$/ },
  ];
  const SHEET_NUMBER_FIELDS = ['actualSF', 'totalLeaseValue', 'firmCommission', 'commissionEarned'];
  const SHEET_DATE_FIELDS = ['rmsDate', 'closedDate', 'leaseCommencement', 'bookedDate', 'cash1Date', 'cash2Date'];
  // Fields the CRM writes back to the sheet. Admin columns (PT #, booked, cash received, OTT) are left to the sheet.
  const SHEET_PUSH_FIELDS = ['company', 'representation', 'dealTypeRaw', 'voucher', 'building', 'submarket', 'vertical', 'actualSF', 'outsideBroker', 'outsideBrokerCompany', 'totalLeaseValue', 'firmCommission', 'commissionEarned', 'closedDate', 'leaseCommencement', 'notes', 'crmId'];

  function mapSheetHeaders(headers) {
    const map = {};
    const norm = headers.map((h) => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim());
    norm.forEach((n, i) => {
      if (!n) return;
      const col = SHEET_COLUMNS.find((c) => !(c.field in map) && c.test.test(n));
      if (col) map[col.field] = i;
    });
    // Trackers usually list the firm's gross commission first and the broker's own share second,
    // e.g. "Gross Commission (Firm)" then "Gross Commission (Initials)".
    const gross = norm.map((n, i) => (/gross commission/.test(n) ? i : -1)).filter((i) => i >= 0);
    if (!('firmCommission' in map) && gross.length >= 2) {
      map.firmCommission = gross[0];
      map.commissionEarned = gross[1];
    }
    return map;
  }

  const blankish = (v) => v === undefined || v === null || /^\s*(n\/?a|-|—)?\s*$/i.test(String(v));

  // One sheet row -> normalized record (strings trimmed, numbers parsed, dates ISO, "N/A" blank).
  function sheetRowToRecord(row, map) {
    const rec = {};
    Object.keys(map).forEach((field) => {
      const raw = row[map[field]];
      if (blankish(raw)) return;
      if (SHEET_NUMBER_FIELDS.includes(field)) {
        const n = parseNumber(raw);
        if (n !== null) rec[field] = n;
      } else if (SHEET_DATE_FIELDS.includes(field)) {
        const d = normalizeDate(raw);
        if (d) rec[field] = d;
      } else rec[field] = String(raw).trim();
    });
    return rec;
  }

  function isRescinded(rec) {
    return /rescind|write-?off|cancel+ed|terminated|fell through|dead deal/i.test(rec.notes || '');
  }

  function quarterEnd(year, quarter) {
    const y = parseNumber(year);
    const q = parseNumber(quarter);
    if (!y || !q || q < 1 || q > 4) return '';
    return lastDayOfMonth(y, q * 3);
  }

  // Deal fields derived from a sheet record. Closed date: execution invoice date, else RMS date, else quarter end.
  function sheetRecordToDeal(rec) {
    const hasMoney = rec.totalLeaseValue !== undefined || rec.commissionEarned !== undefined || rec.firmCommission !== undefined;
    const stage = isRescinded(rec) ? 'Closed Lost' : hasMoney ? 'Closed Won' : '';
    const deal = {
      stage,
      dealType: normalizeDealType(rec.dealTypeRaw),
      assetClass: normalizeAssetClass(rec.vertical) || '',
      closedDate: rec.closedDate || rec.rmsDate || (stage ? quarterEnd(rec.year, rec.quarter) : ''),
      lostReason: stage === 'Closed Lost' ? rec.notes || '' : '',
    };
    ['representation', 'voucher', 'building', 'submarket', 'vertical', 'actualSF', 'outsideBroker', 'outsideBrokerCompany', 'totalLeaseValue', 'firmCommission', 'commissionEarned', 'leaseCommencement', 'rmsDate', 'bookedDate', 'cash1Date', 'cash2Date', 'ptNumber', 'trxId', 'ottCheck', 'notes', 'dealTypeRaw'].forEach((k) => {
      if (rec[k] !== undefined) deal[k] = rec[k];
    });
    if (deal.actualSF !== undefined) deal.estSF = deal.actualSF;
    return deal;
  }

  // Short stable fingerprint of the synced values, used to tell which side changed since the last sync.
  function recordHash(rec) {
    const s = SHEET_PUSH_FIELDS.filter((f) => f !== 'crmId')
      .map((f) => (rec[f] === undefined ? '' : String(rec[f])))
      .join('␟');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Deal -> sheet record (the inverse of sheetRecordToDeal for the pushed fields).
  function dealToSheetRecord(deal, companyName) {
    const rec = { company: companyName, crmId: deal.id };
    ['representation', 'voucher', 'building', 'submarket', 'vertical', 'outsideBroker', 'outsideBrokerCompany', 'notes', 'leaseCommencement'].forEach((k) => {
      if (!blankish(deal[k])) rec[k] = deal[k];
    });
    rec.dealTypeRaw = deal.dealTypeRaw || (deal.dealType === 'New Lease' ? 'New' : deal.dealType || '');
    if (!rec.vertical && deal.assetClass) rec.vertical = deal.assetClass === 'Office & Industrial' ? 'Flex' : deal.assetClass;
    ['actualSF', 'totalLeaseValue', 'firmCommission', 'commissionEarned'].forEach((k) => {
      const n = parseNumber(deal[k]);
      if (n !== null) rec[k] = n;
    });
    if (deal.closedDate && deal.stage !== 'Closed Lost') rec.closedDate = deal.closedDate;
    Object.keys(rec).forEach((k) => (rec[k] === '' || rec[k] === undefined) && delete rec[k]);
    return rec;
  }

  // Plans a two-way sync between sheet rows and CRM deals without touching either.
  // Returns { creates, updates, pushes, appends, conflicts }.
  function planSheetSync({ headers, rows, deals, companies }) {
    const map = mapSheetHeaders(headers);
    const companyById = {};
    companies.forEach((c) => (companyById[c.id] = c));
    const used = new Set();
    const plan = { creates: [], updates: [], pushes: [], appends: [], conflicts: 0, map };

    rows.forEach((r) => {
      const rec = sheetRowToRecord(r.values, map);
      if (!rec.company) return;
      const hash = recordHash(rec);
      const fromSheet = sheetRecordToDeal(rec);
      let deal = rec.crmId ? deals.find((d) => d.id === rec.crmId) : null;
      if (!deal) {
        // First sync of this row: match an existing deal for the same tenant (e.g. one synced from HubSpot).
        // Tenant names also match a company's "also known as" names (e.g. a brand of the parent company).
        const key = normalizeCompanyName(rec.company);
        const candidates = deals.filter((d) => !used.has(d.id) && companyById[d.companyId] && companyNameKeys(companyById[d.companyId]).includes(key));
        const isOpen = (d) => !String(d.stage).startsWith('Closed');
        deal =
          candidates.find((d) => d.closedDate && fromSheet.closedDate && Math.abs(daysBetween(d.closedDate, fromSheet.closedDate)) <= 45) ||
          candidates.find((d) => !isOpen(d) === Boolean(fromSheet.stage)) ||
          // A row with figures closes out the company's open deal rather than starting a new one.
          (fromSheet.stage === 'Closed Won' ? candidates.find(isOpen) : null) ||
          null;
      }
      if (deal) used.add(deal.id);
      if (!deal) {
        if (!fromSheet.stage) fromSheet.stage = 'Lease Negotiation';
        plan.creates.push({ row: r.row, rec, deal: fromSheet, hash });
        return;
      }
      const sheetChanged = deal.sheetHash !== hash;
      const crmChanged = !!deal.sheetSyncedAt && deal.updatedAt > deal.sheetSyncedAt;
      if (!deal.sheetHash || sheetChanged) {
        // The sheet wins when both sides changed; the count is reported to the user.
        if (deal.sheetHash && crmChanged) plan.conflicts++;
        const patch = Object.assign({}, fromSheet);
        if (!patch.stage) delete patch.stage; // a row without figures doesn't override a pipeline stage
        if (!rec.closedDate && !rec.rmsDate && deal.closedDate) delete patch.closedDate;
        plan.updates.push({ row: r.row, rec, dealId: deal.id, patch, hash, needsId: rec.crmId !== deal.id });
      } else if (crmChanged) {
        plan.pushes.push({ row: r.row, dealId: deal.id, record: dealToSheetRecord(deal, (companyById[deal.companyId] || {}).name || rec.company) });
      } else if (rec.crmId !== deal.id) {
        plan.updates.push({ row: r.row, rec, dealId: deal.id, patch: {}, hash, needsId: true });
      }
    });

    // Deals flagged for the portfolio sheet that aren't on it yet get appended.
    deals.forEach((d) => {
      if (d.inPortfolioSheet && !used.has(d.id) && !rows.some((r) => sheetRowToRecord(r.values, map).crmId === d.id)) {
        plan.appends.push({ dealId: d.id, record: dealToSheetRecord(d, (companyById[d.companyId] || {}).name || '') });
      }
    });
    return plan;
  }

  const CONTACT_IMPORT_ALIASES = {
    company: ['company', 'company name', 'account', 'account name', 'organization', 'tenant name'],
    firstName: ['first name', 'first', 'firstname', 'given name'],
    lastName: ['last name', 'last', 'lastname', 'surname'],
    fullName: ['name', 'full name', 'contact', 'contact name'],
    title: ['title', 'job title', 'position'],
    email: ['email', 'email address', 'e-mail', 'work email'],
    phone: ['phone', 'direct phone', 'office phone', 'work phone', 'direct dial'],
    mobile: ['mobile', 'mobile phone', 'cell', 'cell phone'],
    linkedin: ['linkedin', 'linkedin url', 'linkedin profile'],
    notes: ['notes', 'comments'],
  };

  function normHeader(h) {
    return String(h).toLowerCase().replace(/[_\s]+/g, ' ').replace(/[^a-z0-9#/ ]/g, '').trim();
  }

  function mapHeaders(headers, aliases) {
    const mapping = {};
    const normalized = headers.map(normHeader);
    Object.keys(aliases).forEach((field) => {
      const candidates = [normHeader(field)].concat(aliases[field].map(normHeader));
      const idx = normalized.findIndex((h, i) => candidates.includes(h) && !Object.values(mapping).includes(i));
      if (idx >= 0) mapping[field] = idx;
    });
    return mapping;
  }

  function normalizeAssetClass(v) {
    const s = String(v || '').toLowerCase();
    const office = /office|medical|flex/.test(s);
    const industrial = /industrial|warehouse|distribution|logistics|manufactur|flex|r&d|lab/.test(s);
    if (office && industrial) return 'Office & Industrial';
    if (industrial) return 'Industrial';
    if (office) return 'Office';
    return '';
  }

  function rowsToRecords(rows, aliases) {
    if (!rows.length) return { records: [], mapping: {}, headers: [] };
    const headers = rows[0];
    const mapping = mapHeaders(headers, aliases);
    const records = rows.slice(1).map((r) => {
      const rec = {};
      Object.keys(mapping).forEach((field) => {
        const v = (r[mapping[field]] || '').trim();
        if (v !== '') rec[field] = v;
      });
      return rec;
    });
    return { records, mapping, headers };
  }

  function cleanImportedCompany(rec, defaults) {
    const out = Object.assign({}, defaults || {}, rec);
    if (rec.assetClass !== undefined) out.assetClass = normalizeAssetClass(rec.assetClass) || (defaults && defaults.assetClass) || '';
    if (rec.leaseExpiration !== undefined) out.leaseExpiration = normalizeDate(rec.leaseExpiration);
    ['sfOccupied', 'headcount', 'currentRate'].forEach((k) => {
      if (rec[k] !== undefined) {
        const n = parseNumber(rec[k]);
        out[k] = n === null ? '' : n;
      }
    });
    if (out.status && !COMPANY_STATUSES.includes(out.status)) out.status = 'Target';
    if (!out.status) out.status = 'Target';
    return out;
  }

  function splitName(full) {
    const parts = String(full || '').trim().split(/\s+/);
    if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  }

  // Every name a company goes by: its own name plus "also known as" aliases (comma or semicolon separated).
  function companyNameKeys(company) {
    return [company.name]
      .concat(String(company.aliases || '').split(/[;,]/))
      .map(normalizeCompanyName)
      .filter(Boolean);
  }

  function findCompanyByName(companies, name) {
    const key = normalizeCompanyName(name);
    return key ? companies.find((c) => normalizeCompanyName(c.name) === key) || companies.find((c) => companyNameKeys(c).includes(key)) || null : null;
  }

  function normalizeCompanyName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[.,']/g, '')
      .replace(/\b(inc|llc|ltd|corp|corporation|co|company|lp|llp|plc)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const ADDRESS_ABBREVIATIONS = {
    street: 'st', avenue: 'ave', boulevard: 'blvd', road: 'rd', drive: 'dr', parkway: 'pkwy', court: 'ct',
    place: 'pl', lane: 'ln', highway: 'hwy', north: 'n', south: 's', east: 'e', west: 'w',
  };

  // Street portion of an address for duplicate matching: "400 Market Street, Fl 12" -> "400 market st".
  function normalizeAddress(addr) {
    return String(addr || '')
      .toLowerCase()
      .replace(/[.,#]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ADDRESS_ABBREVIATIONS[w] || w)
      .join(' ')
      .replace(/\s+(fl|floor|ste|suite|unit|bldg|building|rm|room)\b.*$/, '')
      .trim();
  }

  // ---------- formatting ----------

  function fmtMoney(n, compact) {
    n = Number(n) || 0;
    if (compact && Math.abs(n) >= 1000) {
      if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M';
      return '$' + Math.round(n / 1000) + 'K';
    }
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtNumber(n) {
    const v = parseNumber(n);
    return v === null ? '' : v.toLocaleString('en-US');
  }

  function fmtDate(iso) {
    const d = parseISODate(iso);
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtMonths(m) {
    if (m === null || m === undefined) return '';
    if (m < 0) return Math.abs(m) + ' mo ago';
    if (m === 0) return 'this month';
    if (m < 24) return m + ' mo';
    const y = Math.floor(m / 12);
    const r = m % 12;
    return y + 'y' + (r ? ' ' + r + 'm' : '');
  }

  return {
    ASSET_CLASSES,
    COMPANY_STATUSES,
    DEAL_TYPES,
    DEAL_STAGES,
    OPEN_STAGES,
    normalizeDealStage,
    LEAD_STAGES,
    LEAD_TEMPS,
    leadStage,
    dailyPlan,
    RATE_BASES,
    ACTIVITY_TYPES,
    PROPERTY_STATUSES,
    EXPIRATION_WINDOWS,
    COMPANY_IMPORT_ALIASES,
    CONTACT_IMPORT_ALIASES,
    todayISO,
    toISODate,
    parseISODate,
    addDays,
    daysBetween,
    monthsUntil,
    normalizeDate,
    parseNumber,
    expirationWindow,
    recommendedLeadTimeMonths,
    prospectScore,
    aggregateLeaseValue,
    estimatedCommission,
    stageProbability,
    dealProbability,
    weightedCommission,
    pipelineSummary,
    dealResults,
    dealCloseDate,
    summarizeDeals,
    portfolioBreakdown,
    PORTFOLIO_IMPORT_ALIASES,
    parseTermMonths,
    normalizeDealType,
    SHEET_COLUMNS,
    SHEET_PUSH_FIELDS,
    mapSheetHeaders,
    sheetRowToRecord,
    sheetRecordToDeal,
    dealToSheetRecord,
    recordHash,
    planSheetSync,
    isRescinded,
    parseCSV,
    toCSV,
    mapHeaders,
    rowsToRecords,
    normalizeAssetClass,
    cleanImportedCompany,
    splitName,
    normalizeCompanyName,
    companyNameKeys,
    findCompanyByName,
    normalizeAddress,
    fmtMoney,
    fmtNumber,
    fmtDate,
    fmtMonths,
  };
});
