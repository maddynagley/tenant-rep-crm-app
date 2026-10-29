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
    { name: 'Intro Call', probability: 10 },
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
  const LEGACY_DEAL_STAGES = { Pitching: 'Intro Call', 'Rep Agreement Signed': 'Market Survey', 'Needs Analysis': 'Market Survey', 'RFP / Proposals': 'RFP' };
  function normalizeDealStage(stage) {
    return LEGACY_DEAL_STAGES[stage] || stage;
  }

  // Lead stages mirror the HubSpot lead pipeline. "Secured Lead" is the hand-off to a deal.
  const LEAD_STAGES = ['New', 'Initial Outreach', 'Follow Up', 'Engaged', 'Secured Lead', 'Dead Lead'];
  const LEAD_TEMPS = ['Hot', 'Warm', 'Cold'];
  const LEAD_FROM_STATUS = { Target: 'New', Contacted: 'Initial Outreach', Nurture: 'Follow Up', Engaged: 'Engaged', 'Not a Fit': 'Dead Lead' };

  // Companies that must not be prospected (Firm do-not-call list, asked to be left alone, working with another broker…).
  const DO_NOT_CONTACT_REASONS = ['Firm do-not-call list', 'Asked not to be contacted', 'Not interested', 'Working with another broker', 'Dead deal', 'Closed / left the market'];
  function doNotContact(company) {
    return Boolean(company && (company.doNotContact === true || company.doNotContact === 'true'));
  }

  // Who a company is to you. Only tenants are prospects; landlords, brokers, partners and vendors are kept
  // for reference (and can be tied to a deal) but never show up as leads or outreach.
  const RELATIONSHIPS = ['Tenant / prospect', 'Landlord / ownership', 'Broker', 'Referral partner', 'Vendor', 'Internal'];
  function isProspect(company) {
    return !company || !company.relationship || company.relationship === 'Tenant / prospect';
  }

  // A company's lead stage: set explicitly, or inferred from its status. Clients without one aren't leads.
  function leadStage(company) {
    if (!isProspect(company)) return '';
    if (LEAD_STAGES.includes(company.leadStage)) return company.leadStage;
    return LEAD_FROM_STATUS[company.status] || '';
  }

  // A deal's budget is a rate per RSF (the default) or a total monthly rent for the whole space.
  const BUDGET_UNITS = ['Per RSF', 'Total per month'];
  const isMonthlyTotal = (d) => d.budgetUnit === 'Total per month';
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
  // `monthlyRent` (a total for the space) takes the place of SF × rate when it's given.
  function aggregateLeaseValue({ sf, rate, rateBasis, termMonths, escalationPct, freeRentMonths, monthlyRent }) {
    monthlyRent = parseNumber(monthlyRent);
    sf = monthlyRent ? 1 : parseNumber(sf) || 0;
    rate = monthlyRent ? monthlyRent * 12 : parseNumber(rate) || 0;
    termMonths = parseNumber(termMonths) || 0;
    const esc = (parseNumber(escalationPct) || 0) / 100;
    const free = Math.min(parseNumber(freeRentMonths) || 0, termMonths);
    const annualRate = !monthlyRent && isMonthlyRate(rateBasis) ? rate * 12 : rate;
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
      monthlyRent: isMonthlyTotal(deal) ? deal.budgetRate : '',
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

  // ---------- outreach & marketing ----------

  const OUTREACH_TYPES = ['Call', 'Email', 'LinkedIn'];
  const OUTCOMES = ['No response', 'Left voicemail', 'Connected', 'Replied', 'Meeting booked', 'Not interested', 'Wrong contact'];
  const RESPONDED = ['Connected', 'Replied', 'Meeting booked', 'Not interested'];

  function responded(a) {
    return RESPONDED.includes(a.outcome) || (parseNumber(a.replies) || 0) > 0;
  }

  // Response rates for outreach, grouped by any key (channel, template, weekday…).
  function outreachStats(activities, keyFn) {
    const groups = {};
    activities
      .filter((a) => OUTREACH_TYPES.includes(a.type) && !a.inbound && !(a.dealThread && !a.template))
      .forEach((a) => {
        const key = keyFn(a) || '(none)';
        const g = (groups[key] = groups[key] || { key, sent: 0, opened: 0, responded: 0, meetings: 0 });
        g.sent += 1;
        if ((parseNumber(a.opens) || 0) > 0) g.opened += 1;
        if (responded(a)) g.responded += 1;
        if (a.outcome === 'Meeting booked') g.meetings += 1;
      });
    return Object.values(groups)
      .map((g) => Object.assign(g, { responseRate: g.sent ? g.responded / g.sent : 0, openRate: g.sent ? g.opened / g.sent : 0 }))
      .sort((a, b) => b.sent - a.sent);
  }

  // ---------- prospecting report ----------
  // Prospecting = calls, emails and LinkedIn messages to tenants/prospects you aren't already working a deal with.
  // Client and deal communication, colleagues and other relationships (landlords, brokers, vendors) are left out.
  // Each company's first touch is its initial outreach; later touches are follow-ups.
  function prospectTouches(data, opts) {
    opts = opts || {};
    const companies = {};
    (data.companies || []).forEach((c) => (companies[c.id] = c));
    const contacts = {};
    (data.contacts || []).forEach((p) => (contacts[p.id] = p));
    const dealSince = {};
    (data.deals || [])
      .filter((d) => d.stage !== 'Closed Lost')
      .forEach((d) => {
        const at = String(d.createdAt || '').slice(0, 10) || '0000';
        if (!dealSince[d.companyId] || at < dealSince[d.companyId]) dealSince[d.companyId] = at;
      });
    const isProspectCo = (c) => c && isProspect(c) && !['Active Client', 'Past Client'].includes(c.status);
    const replies = (data.activities || []).filter((a) => a.inbound && a.type === 'Email' && a.date && isProspectCo(companies[a.companyId]));
    // Once a prospect has written back, your emails over the next 30 days are a conversation, not prospecting.
    const talking = (a) => a.type === 'Email' && replies.some((r) => r.companyId === a.companyId && r.date <= a.date && r.date >= addDays(a.date, -30));
    const seen = new Set();
    const conversation = [];
    const touches = (data.activities || [])
      .filter((a) => OUTREACH_TYPES.includes(a.type) && !a.inbound && a.date && a.companyId)
      .filter((a) => isProspectCo(companies[a.companyId]) && !a.dealThread && !(dealSince[a.companyId] && dealSince[a.companyId] <= a.date))
      .filter((a) => !isColleague(contacts[a.contactId], opts.internalDomain))
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
      // The same email logged twice (e.g. once per recipient) counts once.
      .filter((a) => {
        const k = [a.companyId, a.date, a.type, String(a.subject || '').toLowerCase().replace(/^((re|fw|fwd)\s*:\s*)+/g, '').trim()].join('|');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .filter((a) => {
        if (!talking(a)) return true;
        conversation.push(a);
        return false;
      })
      .map((a) => Object.assign({}, a));
    const count = {};
    touches.forEach((a) => (a.touchNo = count[a.companyId] = (count[a.companyId] || 0) + 1));
    return { touches: touches.map((a) => Object.assign(a, { stage: a.touchNo === 1 ? 'Initial outreach' : 'Follow-up' })), replies, companies, contacts, conversation };
  }

  function periodRange(period, today) {
    today = today || todayISO();
    const d = parseISODate(today);
    const monday = (iso) => {
      const x = parseISODate(iso);
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
      return toISODate(x);
    };
    const first = (y, m) => toISODate(new Date(y, m, 1));
    switch (period) {
      case 'lastWeek':
        return { from: addDays(monday(today), -7), to: addDays(monday(today), -1), label: 'Last week' };
      case 'thisMonth':
        return { from: first(d.getFullYear(), d.getMonth()), to: today, label: d.toLocaleDateString('en-US', { month: 'long' }) + ' to date' };
      case 'lastMonth':
        return { from: first(d.getFullYear(), d.getMonth() - 1), to: addDays(first(d.getFullYear(), d.getMonth()), -1), label: new Date(d.getFullYear(), d.getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'long' }) };
      case 'last90':
        return { from: addDays(today, -89), to: today, label: 'Last 90 days' };
      default:
        return { from: monday(today), to: today, label: 'This week' };
    }
  }

  // The recap for a period: what went out, who opened, who replied, meetings, what's working (over the last 90
  // days, so the rates mean something), an 8-week trend, and who to follow up with next.
  function prospectingReport(data, opts) {
    opts = opts || {};
    const today = opts.today || todayISO();
    const range = periodRange(opts.period, today);
    const { touches, replies, companies, contacts, conversation } = prospectTouches(data, opts);
    const inRange = (iso) => iso >= range.from && iso <= range.to;
    const name = (a) => (companies[a.companyId] || {}).name || '';
    const person = (id) => {
      const p = contacts[id];
      return p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : '';
    };
    // A touch got a response if it's marked so, or the company wrote back within 21 days.
    const answered = (a) => responded(a) || replies.some((r) => r.companyId === a.companyId && r.date >= a.date && r.date <= addDays(a.date, 21));
    const period = touches.filter((a) => inRange(a.date));
    const emails = period.filter((a) => a.type === 'Email');
    const respondedCos = {};
    replies.filter((r) => inRange(r.date)).forEach((r) => (respondedCos[r.companyId] = respondedCos[r.companyId] || { companyId: r.companyId, company: name(r), contact: person(r.contactId), date: r.date, how: 'Replied: ' + String(r.subject || '').replace(/^Reply:\s*/, '') }));
    period.filter((a) => RESPONDED.includes(a.outcome)).forEach((a) => (respondedCos[a.companyId] = respondedCos[a.companyId] || { companyId: a.companyId, company: name(a), contact: person(a.contactId), date: a.date, how: a.outcome + (a.type !== 'Email' ? ' (' + a.type.toLowerCase() + ')' : '') }));
    const meetingActs = (data.activities || []).filter((a) => a.type === 'Meeting' && inRange(a.date || '') && companies[a.companyId] && isProspect(companies[a.companyId]));
    const meetings = meetingActs.length + period.filter((a) => a.outcome === 'Meeting booked').length;
    // Who's behind each number, for the drill-down lists.
    const row = (a) => ({ id: a.id, companyId: a.companyId, company: name(a), contactId: a.contactId, contact: person(a.contactId), date: a.date, type: a.type, subject: a.subject || '', opens: parseNumber(a.opens) || 0, stage: a.stage || '', answered: a.stage ? answered(a) : false, outcome: a.outcome || '' });
    const byDate = (a, b) => b.date.localeCompare(a.date);
    const opened = emails.filter((a) => (parseNumber(a.opens) || 0) > 0);
    const totals = {
      initial: period.filter((a) => a.stage === 'Initial outreach').length,
      followUp: period.filter((a) => a.stage === 'Follow-up').length,
      emails: emails.length,
      calls: period.filter((a) => a.type === 'Call').length,
      linkedin: period.filter((a) => a.type === 'LinkedIn').length,
      companies: new Set(period.map((a) => a.companyId)).size,
      opened: opened.length,
      openRate: emails.length ? opened.length / emails.length : 0,
      responses: Object.keys(respondedCos).length,
      responseRate: period.length ? period.filter(answered).length / period.length : 0,
      meetings,
      conversation: conversation.filter((a) => inRange(a.date)).length,
    };
    const lists = {
      initial: period.filter((a) => a.stage === 'Initial outreach').map(row).sort(byDate),
      followUp: period.filter((a) => a.stage === 'Follow-up').map(row).sort(byDate),
      opened: opened.map(row).sort((a, b) => b.opens - a.opens),
      meetings: meetingActs.map(row).concat(period.filter((a) => a.outcome === 'Meeting booked').map(row)).sort(byDate),
    };
    const openedNoReply = opened
      .filter((a) => !answered(a))
      .map((a) => ({ companyId: a.companyId, company: name(a), contact: person(a.contactId), date: a.date, subject: a.subject, opens: parseNumber(a.opens) || 0, stage: a.stage }))
      .sort((a, b) => b.opens - a.opens);

    // What's working, over the last 90 days.
    const recent = touches.filter((a) => a.date >= addDays(today, -89) && a.date <= today);
    const group = (keyFn) => {
      const g = {};
      recent.forEach((a) => {
        const k = keyFn(a) || '(none)';
        const r = (g[k] = g[k] || { key: k, sent: 0, opened: 0, responded: 0 });
        r.sent++;
        if ((parseNumber(a.opens) || 0) > 0) r.opened++;
        if (answered(a)) r.responded++;
      });
      return Object.values(g)
        .map((r) => Object.assign(r, { responseRate: r.sent ? r.responded / r.sent : 0, openRate: r.sent ? r.opened / r.sent : 0 }))
        .sort((a, b) => b.sent - a.sent);
    };
    const working = {
      byTemplate: group((a) => a.template),
      byTouch: group((a) => (a.touchNo >= 4 ? '4th touch or later' : ['1st touch', '2nd touch', '3rd touch'][a.touchNo - 1])).sort((a, b) => a.key.localeCompare(b.key)),
      byChannel: group((a) => a.type),
      byDay: group((a) => parseISODate(a.date).toLocaleDateString('en-US', { weekday: 'long' })),
    };

    // Eight weeks, oldest first.
    const weeks = [];
    const thisMonday = periodRange('thisWeek', today).from;
    for (let i = 7; i >= 0; i--) {
      const from = addDays(thisMonday, -7 * i);
      const to = addDays(from, 6);
      const w = touches.filter((a) => a.date >= from && a.date <= to);
      weeks.push({ from, initial: w.filter((a) => a.stage === 'Initial outreach').length, followUp: w.filter((a) => a.stage === 'Follow-up').length, responses: new Set(replies.filter((r) => r.date >= from && r.date <= to).map((r) => r.companyId).concat(w.filter((a) => RESPONDED.includes(a.outcome)).map((a) => a.companyId))).size });
    }

    // Who to follow up with next: each prospect's latest touch, unanswered, ranked by how warm the signals are.
    const last = {};
    touches.forEach((a) => (last[a.companyId] = a));
    const replied = (cid, since) => replies.some((r) => r.companyId === cid && r.date >= since);
    const followUps = Object.values(last)
      .filter((a) => !answered(a) && !replied(a.companyId, a.date) && a.date <= addDays(today, -3) && a.date >= addDays(today, -60))
      .map((a) => {
        const c = companies[a.companyId];
        const opens = parseNumber(a.opens) || 0;
        const months = c.leaseExpiration ? monthsUntil(c.leaseExpiration, today) : null;
        const why = [];
        let score = 0;
        if (opens) {
          score += Math.min(opens, 10) * 3;
          why.push('opened ' + opens + (opens === 1 ? ' time' : ' times'));
        }
        if (c.leadTemp === 'Hot' || c.leadTemp === 'Warm') {
          score += c.leadTemp === 'Hot' ? 12 : 6;
          why.push(c.leadTemp.toLowerCase() + ' lead');
        }
        if (months !== null && months >= 0 && months <= 24) {
          score += 24 - months;
          why.push('lease expires in ' + months + ' mo');
        }
        const days = daysBetween(a.date, today);
        if (days >= 7 && days <= 21) score += 4;
        why.push(a.type.toLowerCase() + ' ' + days + ' days ago, touch ' + a.touchNo);
        return { companyId: a.companyId, contactId: a.contactId, company: c.name, contact: person(a.contactId), lastTouch: a.date, lastType: a.type, subject: a.subject, touchNo: a.touchNo, opens, score, why: why.join(' · ') };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    return { range, totals, lists, responded: Object.values(respondedCos).sort((a, b) => b.date.localeCompare(a.date)), openedNoReply, working, weeks, followUps };
  }

  // The report as plain text, to paste into an email or notes.
  function prospectingRecapText(r) {
    const pct = (x) => Math.round(x * 100) + '%';
    const t = r.totals;
    const lines = [
      'Prospecting recap: ' + r.range.label + ' (' + fmtDate(r.range.from) + ' – ' + fmtDate(r.range.to) + ')',
      '',
      '- ' + t.initial + ' initial outreach and ' + t.followUp + ' follow-ups to ' + t.companies + ' companies (' + t.emails + ' emails, ' + t.calls + ' calls, ' + t.linkedin + ' LinkedIn)',
      '- ' + t.opened + ' emails opened (' + pct(t.openRate) + ' open rate)',
      '- ' + t.responses + ' responded (' + pct(t.responseRate) + ' response rate), ' + t.meetings + ' meetings',
    ];
    if (r.responded.length) lines.push('', 'Responded:', ...r.responded.map((x) => '- ' + x.company + (x.contact ? ' (' + x.contact + ')' : '') + ': ' + x.how));
    if (r.openedNoReply.length) lines.push('', 'Opened, no reply yet:', ...r.openedNoReply.slice(0, 10).map((x) => '- ' + x.company + (x.contact ? ' (' + x.contact + ')' : '') + ': opened ' + x.opens + 'x'));
    if (r.followUps.length) lines.push('', 'Follow up next:', ...r.followUps.slice(0, 10).map((x) => '- ' + x.company + (x.contact ? ' (' + x.contact + ')' : '') + ': ' + x.why));
    const best = r.working.byTemplate.filter((x) => x.sent >= 5 && x.key !== '(none)').sort((a, b) => b.responseRate - a.responseRate)[0];
    if (best) lines.push('', 'Best template (90 days): ' + best.key + ', ' + pct(best.responseRate) + ' response on ' + best.sent + ' sent');
    return lines.join('\n');
  }

  // "3Q26" for the quarter a date falls in; the latest finished quarter is what market data covers.
  function quarterOf(iso) {
    const d = parseISODate(iso);
    return Math.floor(d.getMonth() / 3) + 1 + 'Q' + String(d.getFullYear()).slice(2);
  }
  function latestDataQuarter(today) {
    const d = parseISODate(today || todayISO());
    d.setMonth(d.getMonth() - 3);
    return quarterOf(toISODate(d));
  }
  const compareQuarters = (a, b) => (quarterKey(a) || 0) - (quarterKey(b) || 0);
  function quarterKey(q) {
    const m = /^([1-4])Q(\d{2})$/i.exec(String(q || '').trim());
    return m ? Number(m[2]) * 4 + Number(m[1]) : null;
  }
  // Collateral built on market stats goes stale once a newer quarter's data is out.
  function collateralStale(item, today) {
    const k = quarterKey(item.dataQuarter);
    return k !== null && k < quarterKey(latestDataQuarter(today)) && item.status !== 'Retired';
  }

  // ---------- ranges, recurring reminders, client care ----------

  // "3,500–4,000 RSF", "20,000 RSF" or '' — a range when the tenant gave one.
  function rangeLabel(min, max, fmt) {
    const a = parseNumber(min);
    const b = parseNumber(max);
    if (a !== null && b !== null && a !== b) return fmt(Math.min(a, b)) + '–' + fmt(Math.max(a, b));
    const one = a !== null ? a : b;
    return one !== null ? fmt(one) : '';
  }
  function dealSizeLabel(d) {
    // With only a ceiling given, the estimate is the low end (e.g. ~20,000 up to a 25,000 cap).
    const low = parseNumber(d.sfMin) !== null ? d.sfMin : d.estSF;
    const r = rangeLabel(low, d.sfMax, fmtNumber) || (parseNumber(d.actualSF) !== null ? fmtNumber(d.actualSF) : '');
    return r ? r + ' RSF' : '';
  }
  // The office portion of an industrial requirement (part warehouse, part office).
  function dealOfficeLabel(d) {
    const r = rangeLabel(d.officeSfMin, d.officeSfMax, fmtNumber);
    return r ? r + ' SF office' : '';
  }
  function dealBudgetLabel(d) {
    const monthly = isMonthlyTotal(d);
    const r = rangeLabel(d.budgetRate, d.budgetRateMax, (n) => (monthly ? '$' + fmtNumber(n) : '$' + Number(n).toFixed(2).replace(/\.00$/, '')));
    return r ? r + (monthly ? '/mo total' : '/SF') + (d.rateBasis ? ' ' + String(d.rateBasis).replace(/\s*\(.*\)/, '') : '') : '';
  }

  function quarterEndOf(iso) {
    const d = parseISODate(iso);
    return toISODate(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0));
  }

  // Each quarter: ask Research for numbers ~15 days after it closes, then refresh and send the submarket one-pagers at ~1 month.
  function quarterlyTasks(today) {
    today = today || todayISO();
    const t = parseISODate(today);
    const quarterStart = toISODate(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1));
    const lastClose = quarterEndOf(today) === today ? today : addDays(quarterStart, -1);
    const nextClose = quarterEndOf(addDays(lastClose, 1));
    const out = [];
    [lastClose, nextClose].forEach((close) => {
      const q = quarterOf(close);
      out.push({
        id: 'q-research-' + q,
        type: 'Task',
        date: addDays(close, 15),
        followUpDate: addDays(close, 15),
        subject: `Ping Research for ${q} submarket stats`,
        notes: `Ask the research team for ${q} vacancy, asking rent, absorption, construction and notable deals for each submarket one-pager.`,
      });
      out.push({
        id: 'q-flyers-' + q,
        type: 'Task',
        date: addDays(close, 30),
        followUpDate: addDays(close, 30),
        subject: `Update the submarket one-pagers with ${q} data and send them to prospects`,
        notes: 'Refresh every one-pager in Marketing, then send each to the prospects in its submarket and asset class.',
      });
    });
    return out;
  }

  // Lease rights and options you track for any tenant, client or prospect.
  const CRITICAL_DATE_KINDS = ['Renewal option', 'Termination option', 'Expansion option', 'Contraction option', 'ROFO', 'ROFR', 'Purchase option', 'Landlord relocation right', 'Rent abatement / step', 'Lease expiration', 'Other'];
  const CRITICAL_DATE_STATUSES = ['Open', 'Exercised', 'Waived', 'Expired'];

  // Reminder and deadline points for tracked lease rights. A reminder is due from `remindDays` before the
  // notice deadline until the deadline passes, unless the right was exercised or waived.
  function criticalDatePoints(items, opts) {
    opts = opts || {};
    const today = opts.today || todayISO();
    const points = [];
    (items || []).forEach((r) => {
      if (!r.date || !r.companyId) return;
      const closed = ['Exercised', 'Waived', 'Expired'].includes(r.status) || r.date < today;
      const what = r.kind === 'Other' ? r.label || 'Critical date' : r.kind + (r.label ? ' (' + r.label + ')' : '');
      const base = { dealId: r.dealId || '', companyId: r.companyId, criticalDateId: r.id, terms: r.terms || '' };
      const lead = parseNumber(r.remindDays);
      const remind = addDays(r.date, -(lead === null ? 90 : lead));
      if (remind < r.date) points.push(Object.assign({ date: remind, kind: 'notice', label: `${what}: deadline ${fmtDate(r.date)}`, done: closed }, base));
      points.push(Object.assign({ date: r.date, kind: r.kind === 'Lease expiration' ? 'expiration' : 'notice', label: `${what} deadline`, done: closed }, base));
    });
    return points;
  }

  // For deals you closed yourself: check in after move-in, then keep up with the lease's critical dates.
  function clientTouchpoints(deals, opts) {
    opts = opts || {};
    const today = opts.today || todayISO();
    const touches = opts.touches || {};
    const points = [];
    deals
      .filter((d) => d.stage === 'Closed Won' && !d.partnerDeal)
      .forEach((d) => {
        const add = (date, kind, label, checkIn) => date && points.push({ dealId: d.id, companyId: d.companyId, date, kind, label, checkIn: Boolean(checkIn) });
        const start = d.leaseCommencement;
        if (start) {
          add(start, 'commencement', 'Lease commencement / move-in');
          add(addDays(start, 30), 'check-in', 'Check in: how is the new space working out?', true);
          add(addDays(start, 182), 'check-in', '6-month check-in with the client', true);
          for (let y = 1; y <= 10; y++) {
            const anniv = toISODate(new Date(parseISODate(start).getFullYear() + y, parseISODate(start).getMonth(), parseISODate(start).getDate()));
            if (dealLXD(d) && anniv >= dealLXD(d)) break;
            add(anniv, 'check-in', `${y}-year anniversary check-in`, true);
          }
        }
        const lxd = dealLXD(d);
        if (lxd) {
          add(addDays(lxd, -548), 'planning', 'Start renewal / relocation planning (18 months out)');
          add(lxd, 'expiration', 'Lease expiration');
        }
        if (d.renewalNoticeDate) {
          add(addDays(d.renewalNoticeDate, -90), 'notice', 'Renewal option notice due in 90 days');
          add(d.renewalNoticeDate, 'notice', 'Renewal option notice deadline');
        }
        if (d.terminationOptionDate) {
          add(addDays(d.terminationOptionDate, -90), 'notice', 'Termination option notice due in 90 days');
          add(d.terminationOptionDate, 'notice', 'Termination option deadline');
        }
        if (d.otherCriticalDate) add(d.otherCriticalDate, 'other', d.otherCriticalDateLabel || 'Critical date');
      });
    // A check-in counts as done once you've touched the client since two weeks before it was due.
    points.forEach((p) => {
      const last = touches[p.companyId];
      p.done = p.checkIn ? Boolean(last && last >= addDays(p.date, -14)) : p.date < today;
    });
    criticalDatePoints(opts.criticalDates, { today }).forEach((p) => points.push(p));
    points.sort((a, b) => a.date.localeCompare(b.date));
    return {
      due: points.filter((p) => !p.done && p.date <= today && (p.criticalDateId || p.date >= addDays(today, -120)) && (p.checkIn || p.kind === 'notice' || p.kind === 'planning')),
      upcoming: points.filter((p) => p.date > today && p.date <= addDays(today, opts.horizonDays || 365)),
      all: points,
    };
  }

  // Coworking memberships aren't a space delivery, so they get no move-in post.
  function isCoworking(d) {
    return /cowork|regus|wework|industrious|spaces\b/i.test([d.name, d.notes, d.outsideBrokerCompany, d.dealType, d.building].join(' '));
  }

  // Lease expiration: as recorded, or commencement + term.
  function dealLXD(d) {
    if (d.newLeaseExpiration) return d.newLeaseExpiration;
    const start = parseISODate(d.leaseCommencement);
    const term = parseNumber(d.finalTermMonths) || (d.stage === 'Closed Won' ? parseNumber(d.termMonths) : null);
    if (!start || !term) return '';
    return addDays(toISODate(new Date(start.getFullYear(), start.getMonth() + term, start.getDate())), -1);
  }

  // When a comp's lease likely ends: the entered expiration, else commencement + term, else the signing date
  // plus about two months to commencement + term (an estimate, good to the year).
  function compLXD(c) {
    if (c.leaseExpiration) return { date: c.leaseExpiration, estimated: false };
    const term = parseNumber(c.termMonths);
    const start = parseISODate(c.commencement) || parseISODate(c.signedDate);
    if (!start || !term) return null;
    const lead = c.commencement ? 0 : 2;
    const end = addDays(toISODate(new Date(start.getFullYear(), start.getMonth() + lead + term, start.getDate())), -1);
    return { date: end, estimated: !c.commencement };
  }

  // Research request for a quarter's one-pager stats, listing every piece that needs numbers.
  function researchRequestEmail(quarter, marketing, opts) {
    opts = opts || {};
    const pieces = (marketing || []).filter((m) => m.kind === 'One-pager / flyer' && m.status !== 'Retired');
    const lines = Array.from(new Set(pieces.map((m) => [m.submarket || 'Submarket', m.assetClass === 'Industrial' ? 'Flex/Industrial' : m.assetClass || 'Office'].join(' – ')))).map((x) => '• ' + x);
    const names = (opts.to || []).map((a) => a.split('@')[0].split('.')[0]).map((n) => n.charAt(0).toUpperCase() + n.slice(1));
    const hello = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0] || 'team';
    return {
      subject: `${quarter} submarket stats for tenant one-pagers`,
      body: [
        `Hi ${hello},`,
        '',
        `I'm refreshing my tenant one-pagers with ${quarter} numbers and would appreciate the latest stats for these submarkets when they're ready:`,
        '',
        ...(lines.length ? lines : ['• (list the submarkets)']),
        '',
        'For each: total vacancy, average asking rent (full service for office, NNN for flex/industrial), quarterly and YTD net absorption, deliveries and SF under construction, sublease availability, and notable lease transactions and sales. Annual history back to 2020 for the charts would be great too.',
        '',
        'Thank you!',
        opts.signature || '',
      ].join('\n'),
    };
  }

  // A LinkedIn post idea for every deal you closed, timed a week after the space delivers.
  function moveInPostIdeas(deals, companiesById, today) {
    today = today || todayISO();
    return deals
      .filter((d) => d.stage === 'Closed Won' && !d.partnerDeal && !isCoworking(d) && d.leaseCommencement && d.leaseCommencement >= addDays(today, -60))
      .map((d) => {
        const c = companiesById[d.companyId] || {};
        return {
          id: 'mk-movein-' + d.id,
          title: `LinkedIn: welcome ${c.name || d.name} to their new space`,
          kind: 'Social post',
          status: 'Idea',
          channel: 'LinkedIn',
          date: addDays(d.leaseCommencement, 7),
          dealId: d.id,
          submarket: d.submarket || c.submarket || '',
          assetClass: d.assetClass || '',
          notes: `Space delivers ${fmtDate(d.leaseCommencement)}. A fun move-in post: photo of the team in the space, size and submarket, what they needed and how you found it. Get the client's OK (and firm marketing approval) first.`,
        };
      });
  }

  // ---------- HubSpot live sync ----------

  // Subject-line patterns of your outreach templates.
  function guessTemplate(subject) {
    const s = String(subject || '');
    if (/^(re|fw|fwd):/i.test(s)) return '';
    if (/quick insight/i.test(s)) return 'Quick insight';
    if (/lease expiration/i.test(s)) return 'Lease expiration';
    if (/^(following up|follow up|office lease follow up)/i.test(s)) return 'Following up';
    if (/atlanta office introduction/i.test(s)) return 'Office introduction';
    if (/\|.+–\s*atlanta office/i.test(s)) return 'Building intro';
    if (/neighbor|next door|activity in your building|lease activity/i.test(s)) return 'Building activity';
    if (/market (update|report|snapshot)|moving on rent/i.test(s)) return 'Market data';
    return '';
  }

  // HubSpot's default call outcomes.
  const CALL_DISPOSITIONS = {
    'f240bbac-87c9-4f6e-bf70-924b57d47db7': 'Connected',
    'a4c4c377-d246-4b32-a13b-75a56a4cd0ff': 'Connected',
    'b2cf5968-551e-4856-9783-52b3da59a7d0': 'Left voicemail',
    '73a0d17f-1163-4015-bdd5-ec830791da20': 'No response',
    '9d9162e7-6cf3-4944-bf63-4dff82258764': 'No response',
    '17b47fee-58de-441e-a44c-c6300d46f273': 'Wrong contact',
  };

  function hsDate(v) {
    if (!v) return '';
    const d = new Date(/^\d+$/.test(String(v)) ? Number(v) : v);
    return isNaN(d) ? '' : toISODate(d);
  }
  const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  // ---------- submarkets ----------
  // The Research submarkets (office and industrial use different maps), and the local names that fall in each.
  // A name is matched on its words, so "Doraville / NE I-85" and "Duluth / Gwinnett" both find their area.
  // Office labels are short (DT, MT, BH, CP, NF, NE, NW, AP); industrial uses the Research industrial map's names.; SHORT_SUBMARKETS spells them out to find Research stats.
  const BH_FULL = 'buck' + 'head';
  const SHORT_SUBMARKETS = { dt: 'downtown', mt: 'midtown', ap: 'airport', bh: BH_FULL, cp: 'central perimeter', ne: 'northeast', nf: 'north fulton', nw: 'northwest' };
  const RESEARCH_SUBMARKETS = {
    Office: [
      ['DT', ['downtown', 'dt', 'cbd', 'centennial', 'castleberry']],
      ['MT', ['midtown', 'mt', 'west midtown', 'westside', 'atlantic station', 'old fourth ward', 'o4w', 'poncey', 'inman park', 'virginia highland']],
      ['BH', [BH_FULL, 'bh', 'lenox', 'piedmont', 'brookhaven', 'peachtree heights']],
      ['CP', ['central perimeter', 'cp', 'perimeter', 'dunwoody', 'sandy springs', 'perimeter center']],
      ['NF', ['north fulton/forsyth', 'north fulton', 'nf', 'alpharetta', 'roswell', 'forsyth', 'cumming', 'windward', 'johns creek', 'milton', 'avalon']],
      ['NE', ['northeast', 'ne', 'duluth', 'gwinnett', 'norcross', 'peachtree corners', 'northlake', 'tucker', 'doraville', 'lawrenceville', 'chamblee', 'suwanee', 'buford', 'i-85', 'ne i-85', 'decatur', 'emory', 'druid hills', 'stone mountain', 'lilburn', 'snellville']],
      ['NW', ['northwest', 'nw', 'cumberland', 'galleria', 'marietta', 'kennesaw', 'town center', 'vinings', 'smyrna', 'acworth', 'austell', 'six flags', 'powder springs', 'cartersville', 'woodstock', 'canton']],
      ['AP', ['airport/south atlanta', 'airport', 'ap', 'south atlanta', 'college park', 'hapeville', 'east point', 'mcdonough', 'henry', 'fayetteville', 'peachtree city', 'union city', 'camp creek', 'i-20 west', 'fulton industrial', 'douglasville', 'lithia springs']],
    ],
    Industrial: [
      ['AP', ['airport/south atlanta', 'airport', 'ap', 'south atlanta', 'college park', 'hapeville', 'east point', 'mcdonough', 'henry', 'fayetteville', 'union city', 'palmetto', 'fairburn', 'camp creek', 'i-75 south', 'jonesboro', 'forest park', 'stockbridge', 'locust grove']],
      ['Carrollton/I-20W', ['carrollton', 'villa rica', 'bremen', 'temple']],
      ['Central Atlanta', ['central', 'central atlanta', 'west midtown', 'midtown', 'downtown', 'westside', 'atlanta']],
      ['Chamblee/Doraville/Norcross', ['chamblee', 'doraville', 'norcross', 'peachtree corners', 'ne i-85', 'doraville / ne i-85', 'doraville / i-85']],
      ['Chattahoochee Industrial', ['chattahoochee', 'marietta blvd', 'bolton', 'atlanta industrial']],
      ['Fulton Industrial/I-20W', ['fulton industrial', 'i-20 west', 'i20w', 'austell', 'six flags', 'douglasville', 'lithia springs', 'douglas']],
      ['North Central/GA 400 Corridor', ['north central', 'ga 400', 'north fulton', 'alpharetta', 'roswell', 'forsyth', 'cumming', 'sandy springs', 'dunwoody', 'central perimeter', 'cp']],
      ['Northeast/I-85 Corridor', ['northeast', 'ne', 'i-85', 'duluth', 'gwinnett', 'lawrenceville', 'suwanee', 'buford', 'braselton', 'jefferson', 'commerce', 'hall county', 'gainesville']],
      ['Northwest/I-75 Corridor', ['northwest', 'nw', 'i-75', 'kennesaw', 'marietta', 'cumberland', 'galleria', 'town center', 'acworth', 'cartersville', 'smyrna', 'canton', 'woodstock']],
      ['Snapfinger/I-20E', ['snapfinger', 'i-20 east', 'i-20e', 'conyers', 'lithonia', 'covington']],
      ['Stone Mountain', ['stone mountain', 'tucker', 'northlake', 'lilburn', 'snellville']],
    ],
  };
  const SUBMARKET_STOP = /^(and|of|the|area|corridor)$/;
  // The Research submarket a local name belongs to, for an asset class ('' when nothing fits).
  function suggestSubmarket(name, assetClass) {
    const list = RESEARCH_SUBMARKETS[assetClass === 'Industrial' ? 'Industrial' : 'Office'];
    const raw = String(name || '').trim().toLowerCase();
    if (!raw) return '';
    const exact = list.find(([target]) => target.toLowerCase() === raw);
    if (exact) return exact[0];
    // Try the whole name, then each part split on "/", "-", "&" or ",", in order.
    const parts = [raw].concat(raw.split(/\s*(?:\/|\s-\s|&|,)\s*/)).map((x) => x.trim()).filter((x) => x && !SUBMARKET_STOP.test(x));
    for (const part of parts) {
      const hit = list.find(([, words]) => words.includes(part));
      if (hit) return hit[0];
    }
    for (const part of parts) {
      const hit = list.find(([, words]) => words.some((w) => w.length > 3 && part.includes(w)));
      if (hit) return hit[0];
    }
    return '';
  }
  // Applies a saved mapping ({ 'cp': 'Central Perimeter', 'industrial|northeast': 'Northeast/I-85 Corridor' }, keys
  // lowercased) to a submarket name; industrial companies use their own entry when there is one.
  function mapSubmarket(name, map, assetClass) {
    const k = String(name || '').trim().toLowerCase();
    if (!map || !k) return name || '';
    return (assetClass === 'Industrial' && map['industrial|' + k]) || map[k] || name || '';
  }

  // ---------- LinkedIn ----------
  // A pasted profile link, tidied: https added, tracking query dropped ('' when it isn't a LinkedIn link).
  function normalizeLinkedIn(raw) {
    let v = String(raw || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
    const m = v.match(/^https?:\/\/([a-z0-9-]+\.)?linkedin\.com(\/[^?#\s]*)?/i);
    if (!m) return '';
    return 'https://www.linkedin.com' + (m[2] || '/').replace(/\/+$/, '');
  }
  // A LinkedIn people search for a contact without a saved profile: name plus company.
  function linkedInSearchUrl(contact, companyName) {
    const words = [contact && contact.firstName, contact && contact.lastName, companyName].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
    return 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(words);
  }

  // Personal mailboxes: their domain says nothing about the company.
  const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|comcast|att|bellsouth|protonmail|proton|mail|gmx|zoho)\.(com|net|me)$/i;
  const isFreeMail = (dom) => FREE_MAIL.test(String(dom || ''));

  // Turns a bridge payload into CRM changes: activities to add or update, and last-contacted dates.
  function planHubSpotSync(payload, data) {
    const companies = {};
    const byHubspotId = {};
    data.companies.forEach((c) => {
      companies[c.id] = c;
      if (c.hubspotId) byHubspotId[String(c.hubspotId)] = c.id;
      (c.mergedHubspotIds || []).forEach((id) => (byHubspotId[String(id)] = c.id));
    });
    const contactsById = {};
    const byEmail = {};
    const byDomain = {};
    data.contacts.forEach((p) => {
      contactsById[p.id] = p;
      const email = String(p.email || '').toLowerCase();
      if (email) {
        byEmail[email] = p;
        const dom = email.split('@')[1];
        if (dom && !isFreeMail(dom) && !byDomain[dom]) byDomain[dom] = p.companyId;
      }
    });
    // A personal address named for the firm ("acmelawgroup@<personal mail>") points to the company of that name.
    const firmKeys = data.companies.map((c) => [tenantKey(c.name), c.id]).filter(([k]) => k.length >= 6);
    const companyFromMailbox = (addr) => {
      const [local, dom] = String(addr || '').toLowerCase().split('@');
      if (!isFreeMail(dom)) return '';
      const k = String(local || '').replace(/[^a-z0-9]/g, '');
      if (k.length < 6) return '';
      const hits = firmKeys.filter(([key]) => key === k || k.startsWith(key) || key.startsWith(k));
      return hits.length === 1 ? hits[0][1] : '';
    };
    // The same person already in the CRM (same first and last name) at one company.
    const companyFromName = (first, last) => {
      const n = (v) => String(v || '').toLowerCase().replace(/[^a-z]/g, '');
      if (!n(first) || !n(last)) return '';
      const ids = Array.from(new Set(data.contacts.filter((c) => n(c.firstName) === n(first) && n(c.lastName) === n(last) && c.companyId).map((c) => c.companyId)));
      return ids.length === 1 ? ids[0] : '';
    };
    const existing = {};
    data.activities.forEach((a) => (existing[a.id] = a));
    const inPlay = new Set(data.deals.filter((d) => d.stage !== 'Closed Lost').map((d) => d.companyId));
    // A company with exactly one open deal: its emails, meetings and calls belong to that deal.
    const openDealOf = {};
    data.deals
      .filter((d) => OPEN_STAGES.includes(d.stage))
      .forEach((d) => (openDealOf[d.companyId] = openDealOf[d.companyId] === undefined ? d.id : null));
    const dealIds = new Set(data.deals.map((d) => d.id));
    const dealFor = (companyId, rec) => {
      const linked = ((rec && rec.deals) || []).map((id) => 'hs-dl-' + id).find((id) => dealIds.has(id));
      return linked || openDealOf[companyId] || '';
    };
    const emails = (s) => String(s || '').toLowerCase().split(/[;,\s]+/).filter((x) => x.includes('@'));

    const resolve = (rec, addrs) => {
      for (const id of rec.companies || []) {
        const cid = companies['hs-co-' + id] ? 'hs-co-' + id : byHubspotId[String(id)];
        if (cid) return cid;
      }
      for (const id of rec.contacts || []) if (contactsById['hs-ct-' + id]) return contactsById['hs-ct-' + id].companyId;
      for (const a of addrs) if (byEmail[a] && byEmail[a].companyId) return byEmail[a].companyId;
      for (const a of addrs) if (!isFreeMail(a.split('@')[1]) && byDomain[a.split('@')[1]]) return byDomain[a.split('@')[1]];
      for (const a of addrs) if (companyFromMailbox(a)) return companyFromMailbox(a);
      return '';
    };
    // Only a contact at the email's company counts: colleagues you cc are associated in HubSpot too.
    const ownDomains = new Set(data.internalDomain ? [String(data.internalDomain).toLowerCase()] : []);
    (payload.emails || []).forEach((r) => {
      const p = r.properties || {};
      if (p.hs_email_direction === 'EMAIL') emails(p.hs_email_from_email).forEach((a) => ownDomains.add(a.split('@')[1]));
    });
    const contactFor = (rec, addrs, companyId) => {
      const at = (p) => p && (!companyId || p.companyId === companyId) && !ownDomains.has(String(p.email || '').toLowerCase().split('@')[1]);
      for (const id of rec.contacts || []) if (at(contactsById['hs-ct-' + id])) return contactsById['hs-ct-' + id].id;
      for (const a of addrs) if (at(byEmail[a])) return byEmail[a].id;
      return '';
    };

    // New and updated companies and contacts in HubSpot (e.g. sent there by the ZoomInfo extension). New ones
    // are added; ones already in the CRM only get blanks filled, so your edits here always win. A company
    // matches by HubSpot ID, then website domain, then name; a contact by HubSpot ID, then email.
    const skip = new Set((data.hubspotSkip || []).map(String));
    const portal = (data.companies.map((c) => /\/contacts\/(\d+)\//.exec(c.hubspotUrl || '')).find(Boolean) || [])[1];
    const hsUrl = (type, id) => (portal ? `https://app.hubspot.com/contacts/${portal}/record/${type}/${id}` : '');
    const domainOf = (url) => String(url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
    const nameKey = (n) => String(n || '').toLowerCase().replace(/[.,]/g, '').replace(/\b(inc|llc|lp|llp|ltd|corp|corporation|company|co|pc|pllc)\b/g, '').replace(/\s+/g, ' ').trim();
    const byWebsite = {};
    const byName = {};
    data.companies.forEach((c) => {
      if (domainOf(c.website)) byWebsite[domainOf(c.website)] = c.id;
      if (nameKey(c.name)) byName[nameKey(c.name)] = c.id;
    });
    let skipped = 0;
    const recordPatches = { companies: [], contacts: [] };
    const created = { companies: 0, contacts: 0 };
    const fillBlanks = (col, current, fields) => {
      const patch = { id: current.id };
      Object.keys(fields).forEach((k) => {
        if (fields[k] !== '' && fields[k] !== undefined && fields[k] !== null && (current[k] === undefined || current[k] === null || current[k] === '')) patch[k] = fields[k];
      });
      if (Object.keys(patch).length > 1) recordPatches[col].push(patch);
    };
    (payload.companies || []).forEach((rec) => {
      const p = rec.properties || {};
      if (!p.name || skip.has('co-' + rec.id)) return;
      const website = p.website || (p.domain ? 'https://' + p.domain : '');
      const fields = {
        name: String(p.name).trim(),
        website,
        industry: String(p.industry || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()),
        address: p.address || '',
        city: [p.city, p.state].filter(Boolean).join(', '),
        submarket: mapSubmarket(p.submarket || '', data.submarketMap),
        sfOccupied: parseNumber(p.square_footage) || '',
        headcount: parseNumber(p.numberofemployees) || '',
        leaseExpiration: hsDate(p.lease_expiration),
        hubspotId: String(rec.id),
        hubspotUrl: hsUrl('0-2', rec.id),
      };
      const cid = companies['hs-co-' + rec.id] ? 'hs-co-' + rec.id : byHubspotId[String(rec.id)] || byWebsite[domainOf(website)] || byName[nameKey(p.name)];
      if (cid && companies[cid]) {
        fillBlanks('companies', companies[cid], fields);
        byHubspotId[String(rec.id)] = cid;
        return;
      }
      const fresh = hsDate(p.createdate) >= addDays(todayISO(), -30);
      const c = Object.assign({ id: 'hs-co-' + rec.id }, fields, { status: 'Target', priority: 'B', growthSignal: 'Unknown', source: 'HubSpot', leadStage: fresh ? 'New' : undefined });
      if (!c.leadStage) delete c.leadStage;
      companies[c.id] = c;
      byHubspotId[String(rec.id)] = c.id;
      if (domainOf(website)) byWebsite[domainOf(website)] = c.id;
      byName[nameKey(c.name)] = c.id;
      recordPatches.companies.push(c);
      created.companies++;
    });
    (payload.contacts || []).forEach((rec) => {
      const p = rec.properties || {};
      const email = String(p.email || '').trim().toLowerCase();
      if ((!p.firstname && !p.lastname) || skip.has('ct-' + rec.id)) return;
      const fields = {
        firstName: String(p.firstname || '').trim() || String(p.lastname || '').trim(),
        lastName: p.firstname ? String(p.lastname || '').trim() : '',
        title: p.jobtitle || '',
        email,
        phone: p.phone || '',
        mobile: p.mobilephone || '',
        linkedin: p.hs_linkedin_url || '',
        hubspotUrl: hsUrl('0-1', rec.id),
      };
      const current = contactsById['hs-ct-' + rec.id] || (email && byEmail[email]);
      if (current) return fillBlanks('contacts', current, fields);
      let companyId = '';
      for (const id of rec.companies || []) if (!companyId) companyId = companies['hs-co-' + id] ? 'hs-co-' + id : byHubspotId[String(id)] || '';
      const dom = email.split('@')[1];
      if (!companyId && dom && !isFreeMail(dom)) companyId = byWebsite[dom] || byDomain[dom] || '';
      // No company in HubSpot (common for Gmail-type addresses): the same person in the CRM, or a mailbox named for the firm.
      if (!companyId) companyId = companyFromName(p.firstname, p.lastname) || companyFromMailbox(email);
      if (!companyId || !companies[companyId]) return skipped++;
      // HubSpot often holds the same person twice (one record with the email, one without): fill in the CRM's copy.
      const n = (v) => String(v || '').toLowerCase().replace(/[^a-z]/g, '');
      const twin = data.contacts.find((c) => c.companyId === companyId && n(c.firstName) === n(p.firstname) && n(c.lastName) === n(p.lastname) && (!c.email || String(c.email).toLowerCase() === email));
      if (twin) {
        fillBlanks('contacts', twin, fields);
        contactsById['hs-ct-' + rec.id] = Object.assign({}, twin, { email: twin.email || email });
        if (email) byEmail[email] = contactsById['hs-ct-' + rec.id];
        return;
      }
      const contact = Object.assign({ id: 'hs-ct-' + rec.id, companyId }, fields, { source: 'HubSpot' });
      contactsById[contact.id] = contact;
      if (email) {
        byEmail[email] = contact;
        if (dom && !isFreeMail(dom) && !byDomain[dom]) byDomain[dom] = companyId;
      }
      recordPatches.contacts.push(contact);
      created.contacts++;
    });

    // A template drafted from the CRM in the last two weeks names the next email sent to that company.
    const usedTemplate = new Set();
    const pendingTemplate = (companyId, date) => {
      const c = companies[companyId];
      if (!c || !c.pendingTemplate || !c.pendingTemplateAt || (date && date < c.pendingTemplateAt) || (date && c.pendingTemplateAt < addDays(date, -14))) return '';
      usedTemplate.add(companyId);
      return c.pendingTemplate;
    };
    const upserts = [];
    const lastTouch = {};
    const touch = (cid, date) => {
      if (date && (!lastTouch[cid] || date > lastTouch[cid])) lastTouch[cid] = date;
    };
    const replies = [];

    (payload.emails || []).forEach((rec) => {
      const p = rec.properties || {};
      const inbound = p.hs_email_direction === 'INCOMING_EMAIL';
      const addrs = emails(inbound ? p.hs_email_from_email : p.hs_email_to_email);
      const id = 'hs-em-' + rec.id;
      // An email already in the CRM keeps its company even if HubSpot has no association for it.
      const companyId = resolve(rec, addrs) || (existing[id] && existing[id].companyId) || '';
      if (!companyId) return skipped++;
      const date = hsDate(p.hs_timestamp);
      const opens = parseNumber(p.hs_email_open_count) || 0;
      const replied = (parseNumber(p.hs_email_reply_count) || 0) > 0;
      const body = String(p.hs_email_text || '').replace(/\r\n/g, '\n').trim().slice(0, 20000);
      if (existing[id]) {
        const patch = { id, opens };
        if (body && existing[id].body !== body) patch.body = body;
        if (!existing[id].dealId && dealFor(existing[id].companyId, rec)) patch.dealId = dealFor(existing[id].companyId, rec);
        if (replied && !RESPONDED.includes(existing[id].outcome)) patch.outcome = 'Replied';
        const was = contactsById[existing[id].contactId];
        if (existing[id].contactId && (!was || was.companyId !== existing[id].companyId || ownDomains.has(String(was.email || '').toLowerCase().split('@')[1]))) patch.contactId = contactFor(rec, addrs, existing[id].companyId);
        upserts.push(patch);
      } else {
        upserts.push({
          id,
          type: 'Email',
          date,
          companyId,
          dealId: dealFor(companyId, rec),
          contactId: contactFor(rec, addrs, companyId),
          subject: (inbound ? 'Reply: ' : '') + (p.hs_email_subject || '(no subject)'),
          template: inbound ? '' : pendingTemplate(companyId, date) || guessTemplate(p.hs_email_subject),
          opens: inbound ? '' : opens,
          outcome: inbound ? '' : replied ? 'Replied' : 'No response',
          inbound: inbound || undefined,
          dealThread: inPlay.has(companyId) || undefined,
          notes: stripHtml(p.hs_email_text).slice(0, 180),
          body: body || undefined,
          source: 'HubSpot',
          done: true,
        });
      }
      if (inbound) replies.push({ companyId, date });
      else touch(companyId, date);
    });

    // A reply from a company marks your latest unanswered email to them as answered.
    replies.forEach((r) => {
      const sent = data.activities
        .concat(upserts.filter((u) => u.type))
        .filter((a) => a.companyId === r.companyId && a.type === 'Email' && !a.inbound && a.date && a.date <= r.date && a.date >= addDays(r.date, -45))
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (sent && !RESPONDED.includes(sent.outcome)) {
        const u = upserts.find((x) => x.id === sent.id);
        if (u) u.outcome = 'Replied';
        else upserts.push({ id: sent.id, outcome: 'Replied' });
      }
    });

    // Notes you log in HubSpot. They're a record, not a touch, so they don't change last-contacted dates.
    (payload.notes || []).forEach((rec) => {
      const p = rec.properties || {};
      const id = 'hs-nt-' + rec.id;
      const companyId = resolve(rec, []) || (existing[id] && existing[id].companyId) || '';
      if (!companyId) return skipped++;
      const body = stripHtml(p.hs_note_body);
      if (!body) return;
      const fields = { type: 'Note', date: hsDate(p.hs_timestamp), companyId, dealId: dealFor(companyId, rec), contactId: contactFor(rec, [], companyId), subject: body.length > 80 ? body.slice(0, 77).replace(/\s+\S*$/, '') + '…' : body, notes: body.slice(0, 600), source: 'HubSpot', done: true };
      if (!existing[id]) upserts.push(Object.assign({ id }, fields));
      else if (existing[id].notes !== fields.notes) upserts.push({ id, subject: fields.subject, notes: fields.notes });
    });

    (payload.meetings || []).forEach((rec) => {
      const p = rec.properties || {};
      const companyId = resolve(rec, []);
      if (!companyId) return skipped++;
      const date = hsDate(p.hs_meeting_start_time || p.hs_timestamp);
      const id = 'hs-mt-' + rec.id;
      if (!existing[id]) upserts.push({ id, type: 'Meeting', date, companyId, dealId: dealFor(companyId, rec), contactId: contactFor(rec, [], companyId), subject: p.hs_meeting_title || 'Meeting', notes: stripHtml(p.hs_meeting_body).slice(0, 400), source: 'HubSpot', done: true });
      if (date <= todayISO()) touch(companyId, date);
    });

    (payload.calls || []).forEach((rec) => {
      const p = rec.properties || {};
      const companyId = resolve(rec, []);
      if (!companyId) return skipped++;
      const date = hsDate(p.hs_timestamp);
      const id = 'hs-cl-' + rec.id;
      const outcome = CALL_DISPOSITIONS[p.hs_call_disposition] || '';
      if (existing[id]) upserts.push({ id, outcome: existing[id].outcome || outcome });
      else upserts.push({ id, type: 'Call', date, companyId, dealId: dealFor(companyId, rec), contactId: contactFor(rec, [], companyId), subject: p.hs_call_title || 'Call', outcome, notes: stripHtml(p.hs_call_body).slice(0, 400), source: 'HubSpot', done: true });
      touch(companyId, date);
    });

    const companyPatches = Object.keys(lastTouch)
      .filter((cid) => !companies[cid].lastContacted || lastTouch[cid] > companies[cid].lastContacted)
      .map((cid) => ({ id: cid, lastContacted: lastTouch[cid] }));
    usedTemplate.forEach((cid) => {
      const patch = companyPatches.find((x) => x.id === cid);
      if (patch) Object.assign(patch, { pendingTemplate: '' });
      else companyPatches.push({ id: cid, pendingTemplate: '' });
    });
    return { activities: upserts, companies: recordPatches.companies.concat(companyPatches), contacts: recordPatches.contacts, created, skipped };
  }

  // ---------- shared prospect lists (two-way Google Sheet) ----------

  // Shared columns on the list's main tab, and the CRM company field each one maps to.
  const LIST_COMPANY_COLUMNS = {
    'Company Name': 'name',
    Website: 'website',
    Industry: 'industry',
    'Space Need': 'spaceNeed',
    FOE: 'foe',
    'HQ City': 'hqCity',
    'HQ State': 'hqState',
    'HQ Country': 'hqCountry',
    'US HQ': 'usHQ',
    Presence: 'localPresence', // matches any heading ending in "Presence"
    'Intro Via': 'introVia',
    Lead: 'listLead',
    Status: 'listStatus',
    'Contacted By': 'contactedBy',
    'Last Touch': 'lastContacted',
    'Next Step': 'nextStep',
    'Next Step Date': 'nextStepDate',
    Notes: 'listNotes',
  };
  // The main tab's primary-contact columns, mapped to CRM contact fields.
  const LIST_PRIMARY_COLUMNS = { 'Contact Name': 'fullName', Title: 'title', Email: 'email', Phone: 'phone', LinkedIn: 'linkedin' };
  const LIST_CONTACT_COLUMNS = { 'Contact Name': 'fullName', Title: 'title', Email: 'email', Phone: 'phone', LinkedIn: 'linkedin', Role: 'listRole', Notes: 'listNotes' };
  const LIST_RESEARCH_COLUMNS = {
    Rank: 'rank',
    Score: 'score',
    Confidence: 'confidence',
    'Likely Metro Atlanta Operation': 'operation',
    'Outreach Approach': 'approach',
    Evidence: 'evidence',
    'Atlanta Fit': 'fit',
    'Submarkets to Screen': 'submarkets',
    Risk: 'risk',
    'Recruitment Angle': 'angle',
  };
  const LIST_DATE_FIELDS = ['lastContacted', 'nextStepDate'];
  const SPACE_TO_ASSET = { Office: 'Office', Industrial: 'Industrial', 'Office & Industrial': 'Office & Industrial' };

  const listNorm = (field, v) => {
    const s = v === null || v === undefined ? '' : String(v).trim();
    return LIST_DATE_FIELDS.includes(field) ? normalizeDate(s) || s : s;
  };
  const sheetDate = (iso) => {
    const d = parseISODate(iso);
    return d ? d.getMonth() + 1 + '/' + d.getDate() + '/' + d.getFullYear() : iso;
  };
  const contactFull = (p) => [p.firstName, p.lastName].filter(Boolean).join(' ');
  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

  // Per field, each side "changed" if it differs from what that side held after the last sync.
  // Only the sheet changed: copy it to the CRM. Only the CRM changed: push it to the sheet. Both: the sheet wins.
  // Neither: leave both alone, even if they differ, so private CRM details (e.g. a ZoomInfo email) are never
  // pushed to a shared sheet and a blank sheet cell never erases them. First link: the sheet's filled cells win.
  function mergeFields(fields, sheetRec, crmRec, last) {
    const toCrm = {};
    const toSheet = {};
    fields.forEach((f) => {
      const s = sheetRec[f] || '';
      const c = crmRec[f] || '';
      if (s === c) return;
      if (!last) {
        if (s) toCrm[f] = s;
        return;
      }
      const sheetChanged = s !== ((last.sheet || {})[f] || '');
      const crmChanged = c !== ((last.crm || {})[f] || '');
      if (sheetChanged) toCrm[f] = s;
      else if (crmChanged) toSheet[f] = c;
    });
    const sheet = Object.assign({}, sheetRec, toSheet);
    const crm = Object.assign({}, crmRec, toCrm);
    return { toCrm, toSheet, snapshot: { sheet, crm } };
  }

  // Plans one sync of a shared list. Returns CRM changes to apply and sheet changes to push.
  function planListSync(payload, data, opts) {
    const listId = opts.listId;
    const mainTab = opts.mainTab || 'Target List';
    const contactsTab = opts.contactsTab || 'Contacts';
    const researchTab = opts.researchTab || 'Prospect Research';
    const initials = opts.initials || '';
    const tabs = payload.tabs || {};
    const out = { companies: [], contacts: [], pushes: [], removed: [], counts: { added: 0, updated: 0, pushed: 0 } };
    const now = opts.now || new Date().toISOString();

    const companies = data.companies.slice();
    const contacts = data.contacts.slice();
    const companyPatch = {};
    const patchCompany = (id, patch) => {
      companyPatch[id] = Object.assign(companyPatch[id] || { id }, patch);
    };
    const contactPatch = {};
    const patchContact = (id, patch) => {
      contactPatch[id] = Object.assign(contactPatch[id] || { id }, patch);
    };
    const crmCompany = (id) => Object.assign({}, companies.find((c) => c.id === id) || {}, companyPatch[id] || {});
    const crmContact = (id) => Object.assign({}, contacts.find((p) => p.id === id) || {}, contactPatch[id] || {});
    let seq = 0;
    const newId = (prefix) => prefix + '-' + listId + '-' + Date.now().toString(36) + (seq++).toString(36);

    const tabRows = (name) => {
      const t = tabs[name];
      if (!t) return { headers: [], rows: [] };
      const idx = {};
      t.headers.forEach((h, i) => {
        idx[h] = i;
        if (/\bpresence$/i.test(h) && idx.Presence === undefined) idx.Presence = i;
      });
      return { headers: t.headers, idx, rows: t.rows.map((r) => ({ row: r.row, get: (h) => (idx[h] === undefined ? undefined : r.values[idx[h]]) })) };
    };

    // ---- main tab: companies + primary contact ----
    const main = tabRows(mainTab);
    // The sheet's own heading for a column (the presence column may be named for the region).
    const realHeader = (h) => (main.headers.includes(h) ? h : h === 'Presence' ? main.headers.find((x) => /\bpresence$/i.test(x)) || h : h);
    const companyFields = Object.values(LIST_COMPANY_COLUMNS);
    const seenCompanies = new Set();
    const primaryFields = ['fullName', 'title', 'email', 'phone', 'linkedin'];
    const findContact = (companyId, fullName) =>
      contacts.find((p) => p.companyId === companyId && sameName(contactFull(p), fullName)) ||
      (out.contacts.find((p) => p.companyId === companyId && sameName(contactFull(p), fullName)) || null);

    main.rows.forEach((r) => {
      const name = String(r.get('Company Name') || '').trim();
      if (!name) return;
      const sheetRec = {};
      Object.entries(LIST_COMPANY_COLUMNS).forEach(([h, f]) => {
        if (main.idx[h] !== undefined) sheetRec[f] = listNorm(f, r.get(h));
      });
      const crmIdCell = String(r.get('CRM ID') || '').trim();
      let company = (crmIdCell && companies.find((c) => c.id === crmIdCell)) || companies.find((c) => c.sharedList === listId && sameName(c.name, name)) || findCompanyByName(companies, name);
      if (!company) {
        company = {
          id: newId('ls'),
          name,
          assetClass: SPACE_TO_ASSET[sheetRec.spaceNeed] || 'Office & Industrial',
          status: 'Target',
          priority: 'B',
          source: opts.listName || 'Shared list',
          sharedList: listId,
          listSync: {},
          createdAt: now,
          updatedAt: now,
        };
        companies.push(company);
        out.companies.push(company);
        out.counts.added++;
      }
      seenCompanies.add(company.id);
      const current = crmCompany(company.id);
      const last = (current.listSync || {})[listId];
      const crmRec = {};
      companyFields.forEach((f) => (crmRec[f] = listNorm(f, current[f])));
      const { toCrm, toSheet, snapshot: companySnap } = mergeFields(Object.keys(sheetRec), sheetRec, crmRec, last && last.company);
      const patch = Object.assign({}, toCrm);
      if (toCrm.spaceNeed && SPACE_TO_ASSET[toCrm.spaceNeed]) patch.assetClass = SPACE_TO_ASSET[toCrm.spaceNeed];
      if (Object.keys(toCrm).length && !out.companies.includes(company)) out.counts.updated++;

      // Primary contact on the same row.
      const sheetPrimary = {};
      Object.entries(LIST_PRIMARY_COLUMNS).forEach(([h, f]) => {
        if (main.idx[h] !== undefined) sheetPrimary[f] = listNorm(f, r.get(h));
      });
      // Which person is the primary contact: the sheet decides unless only the CRM changed it since the last sync.
      const lastPrimary = last && last.primary;
      const sheetName = sheetPrimary.fullName || '';
      let primary = current.listPrimaryContact ? crmContact(current.listPrimaryContact) : null;
      if (primary && !primary.id) primary = out.contacts.find((x) => x.id === current.listPrimaryContact) || null;
      const crmName = primary ? contactFull(primary) : '';
      let pushName = '';
      if (!sameName(sheetName, crmName)) {
        const sheetUnchanged = lastPrimary && sameName((lastPrimary.sheet || {}).fullName, sheetName);
        if (sheetUnchanged && crmName) pushName = crmName;
        else if (sheetName) {
          primary = findContact(company.id, sheetName);
          if (!primary && !/^through\b/i.test(sheetName)) {
            primary = Object.assign({ id: newId('lc'), companyId: company.id, sharedList: listId, source: opts.listName || 'Shared list', createdAt: now, updatedAt: now }, splitName(sheetName));
            out.contacts.push(primary);
          }
        } else primary = null;
      }
      let primaryPush = {};
      let primaryRecord = { sheet: sheetPrimary, crm: {} };
      if (primary) {
        const isNewContact = out.contacts.includes(primary);
        const p = isNewContact ? primary : crmContact(primary.id);
        const crmP = { fullName: contactFull(p), title: listNorm('', p.title), email: listNorm('', p.email), phone: listNorm('', p.phone), linkedin: listNorm('', p.linkedin) };
        const samePerson = lastPrimary && sameName((lastPrimary.crm || {}).fullName, crmP.fullName);
        const fields = primaryFields.filter((f) => f !== 'fullName');
        // When the CRM switched to a different person, the sheet's details belong to the old one: send the new person's.
        const m = pushName
          ? mergeFields(fields, sheetPrimary, crmP, { sheet: sheetPrimary, crm: {} })
          : mergeFields(fields, sheetPrimary, crmP, samePerson ? lastPrimary : null);
        if (Object.keys(m.toCrm).length) {
          if (isNewContact) Object.assign(primary, m.toCrm);
          else patchContact(primary.id, m.toCrm);
        }
        primaryPush = m.toSheet;
        if (pushName) primaryPush.fullName = pushName;
        patch.listPrimaryContact = primary.id;
        primaryRecord = {
          sheet: Object.assign({}, m.snapshot.sheet, { fullName: pushName || sheetName }),
          crm: Object.assign({}, m.snapshot.crm, { fullName: crmP.fullName }),
        };
      } else patch.listPrimaryContact = '';

      patch.sharedList = listId;
      patch.listRemoved = '';
      patch.listSync = Object.assign({}, current.listSync || {}, { [listId]: { company: companySnap, primary: primaryRecord, row: r.row, at: now } });
      if (out.companies.includes(company)) Object.assign(company, patch);
      else patchCompany(company.id, patch);

      const values = {};
      Object.entries(toSheet).forEach(([f, v]) => {
        const h = realHeader(Object.keys(LIST_COMPANY_COLUMNS).find((k) => LIST_COMPANY_COLUMNS[k] === f));
        values[h] = LIST_DATE_FIELDS.includes(f) ? sheetDate(v) : v;
      });
      Object.entries(primaryPush).forEach(([f, v]) => {
        const h = Object.keys(LIST_PRIMARY_COLUMNS).find((k) => LIST_PRIMARY_COLUMNS[k] === f);
        values[h] = v;
      });
      const needsId = crmIdCell !== company.id;
      if (Object.keys(values).length || needsId) {
        if (Object.keys(values).length && initials) values['Last Updated By'] = initials;
        out.pushes.push({ tab: mainTab, crmId: company.id, row: r.row, match: { 'Company Name': name }, values });
        if (Object.keys(values).length) out.counts.pushed++;
      }
    });

    // Companies added to the list in the CRM get a new row; ones that left the sheet are marked, not deleted.
    companies
      .filter((c) => c.sharedList === listId && !seenCompanies.has(c.id) && !out.companies.includes(c))
      .forEach((c0) => {
        const c = crmCompany(c0.id);
        if (c.listSync && c.listSync[listId]) {
          if (!c.listRemoved) out.removed.push(c.id);
          return;
        }
        const values = {};
        Object.entries(LIST_COMPANY_COLUMNS).forEach(([h, f]) => {
          const v = listNorm(f, c[f]);
          if (v) values[realHeader(h)] = LIST_DATE_FIELDS.includes(f) ? sheetDate(v) : v;
        });
        const p = c.listPrimaryContact ? crmContact(c.listPrimaryContact) : null;
        if (p && p.id) {
          Object.entries(LIST_PRIMARY_COLUMNS).forEach(([h, f]) => {
            const v = f === 'fullName' ? contactFull(p) : listNorm(f, p[f]);
            if (v) values[h] = v;
          });
        }
        if (!values.Status) values.Status = 'Researching';
        if (initials) values['Last Updated By'] = initials;
        out.pushes.push({ tab: mainTab, crmId: c.id, values });
        out.counts.pushed++;
        const rec = {};
        Object.values(LIST_COMPANY_COLUMNS).forEach((f) => (rec[f] = listNorm(f, c[f])));
        if (!rec.listStatus) rec.listStatus = 'Researching';
        const prim = {};
        if (p && p.id) Object.values(LIST_PRIMARY_COLUMNS).forEach((f) => (prim[f] = f === 'fullName' ? contactFull(p) : listNorm(f, p[f])));
        patchCompany(c.id, { listStatus: rec.listStatus, listSync: Object.assign({}, c.listSync || {}, { [listId]: { company: { sheet: rec, crm: rec }, primary: { sheet: prim, crm: prim }, at: now } }) });
      });
    out.removed.forEach((id) => patchCompany(id, { listRemoved: 'true' }));

    // ---- Contacts tab ----
    const ct = tabRows(contactsTab);
    const contactFields = Object.values(LIST_CONTACT_COLUMNS);
    const listCompanies = () => companies.filter((c) => (crmCompany(c.id).sharedList || c.sharedList) === listId);
    ct.rows.forEach((r) => {
      const companyName = String(r.get('Company Name') || '').trim();
      const fullName = String(r.get('Contact Name') || '').trim();
      if (!companyName || !fullName) return;
      const company = findCompanyByName(listCompanies(), companyName) || findCompanyByName(companies, companyName);
      if (!company) return;
      const sheetRec = {};
      Object.entries(LIST_CONTACT_COLUMNS).forEach(([h, f]) => {
        if (ct.idx[h] !== undefined) sheetRec[f] = listNorm(f, r.get(h));
      });
      const crmIdCell = String(r.get('CRM ID') || '').trim();
      let p = (crmIdCell && (contacts.find((x) => x.id === crmIdCell) || out.contacts.find((x) => x.id === crmIdCell))) || findContact(company.id, fullName);
      if (!p) {
        p = Object.assign({ id: newId('lc'), companyId: company.id, sharedList: listId, source: opts.listName || 'Shared list', createdAt: now, updatedAt: now }, splitName(fullName));
        out.contacts.push(p);
      }
      const isNew = out.contacts.includes(p);
      const cur = isNew ? p : crmContact(p.id);
      const crmRec = { fullName: contactFull(cur) };
      contactFields.forEach((f) => f !== 'fullName' && (crmRec[f] = listNorm(f, cur[f])));
      const last = (cur.listSync || {})[listId];
      const { toCrm, toSheet, snapshot } = mergeFields(contactFields, sheetRec, crmRec, last);
      const patch = {};
      Object.entries(toCrm).forEach(([f, v]) => (f === 'fullName' ? Object.assign(patch, splitName(v)) : (patch[f] = v)));
      patch.sharedList = listId;
      patch.listSync = Object.assign({}, cur.listSync || {}, { [listId]: snapshot });
      if (isNew) Object.assign(p, patch);
      else patchContact(p.id, patch);
      const values = {};
      Object.entries(toSheet).forEach(([f, v]) => (values[Object.keys(LIST_CONTACT_COLUMNS).find((k) => LIST_CONTACT_COLUMNS[k] === f)] = v));
      if (Object.keys(values).length || crmIdCell !== p.id) out.pushes.push({ tab: contactsTab, crmId: p.id, row: r.row, match: { 'Company Name': companyName, 'Contact Name': fullName }, values });
    });

    // Contacts shared from the CRM that the Contacts tab doesn't have yet.
    const onTab = new Set(out.pushes.filter((x) => x.tab === contactsTab).map((x) => x.crmId));
    contacts
      .filter((p) => crmContact(p.id).sharedList === listId && !onTab.has(p.id) && !((crmContact(p.id).listSync || {})[listId]))
      .forEach((p0) => {
        const p = crmContact(p0.id);
        const company = crmCompany(p.companyId);
        if (!company.name) return;
        const rec = { fullName: contactFull(p) };
        contactFields.forEach((f) => f !== 'fullName' && (rec[f] = listNorm(f, p[f])));
        const values = { 'Company Name': company.name };
        Object.entries(LIST_CONTACT_COLUMNS).forEach(([h, f]) => rec[f] && (values[h] = rec[f]));
        out.pushes.push({ tab: contactsTab, crmId: p.id, values });
        patchContact(p.id, { listSync: Object.assign({}, p.listSync || {}, { [listId]: { sheet: rec, crm: rec } }) });
      });

    // ---- research tab (read-only) ----
    const rs = tabRows(researchTab);
    rs.rows.forEach((r) => {
      const name = String(r.get('Company Name') || '').trim();
      const company = name && (findCompanyByName(listCompanies(), name) || findCompanyByName(out.companies, name));
      if (!company) return;
      const research = {};
      Object.entries(LIST_RESEARCH_COLUMNS).forEach(([h, f]) => {
        const v = r.get(h);
        if (v !== undefined && String(v).trim()) research[f] = String(v).trim();
      });
      const cur = crmCompany(company.id);
      if (JSON.stringify(cur.research || {}) !== JSON.stringify(research)) {
        if (out.companies.includes(company)) company.research = research;
        else patchCompany(company.id, { research });
      }
    });

    out.companyUpdates = Object.values(companyPatch);
    out.contactUpdates = Object.values(contactPatch);
    return out;
  }

  // ---------- email templates ----------

  const TEMPLATE_STEPS = ['Intro', 'Lease expiration', 'Follow-up', 'Drop-by', 'Market update', 'Other'];

  // Fills {Placeholders} from the company, contact and your settings. A missing value becomes "[Name]" so it
  // stands out in the draft.
  // Working a deal alone: the partner wording in a template switches to first person. A partner of "None" (or
  // "Solo") on the deal or company, or the "Working this alone" box in the draft, means solo.
  const SOLO_PARTNER = /^\s*(none|solo|n\/a|-+)\s*$/i;
  const SOLO_REWRITES = [
    [/\bMy partner (?:\{Partner\}|[A-Z][\w'-]+ [A-Z][\w'-]+) and I are tenant rep brokers\b/g, "I'm a tenant rep broker"],
    [/\bMy partner and I are tenant rep brokers\b/g, "I'm a tenant rep broker"],
    [/\b[Mm]y partner (?:\{Partner\} |[A-Z][\w'-]+ [A-Z][\w'-]+ )?and I\b/g, 'I'],
    [/\{Partner\} and I are\b/g, "I'm"],
    [/\{Partner\} and I\b/g, 'I'],
    [/\bWe're tenant rep brokers\b/g, "I'm a tenant rep broker"],
    [/\b(W|w)e (represent|advocate|work with)\b/g, (m, w, verb) => 'I ' + verb],
    [/\blet us know\b/g, 'let me know'],
    [/\bWe'd love\b/g, "I'd love"],
    [/\b(W|w)e can help\b/g, (m, w) => 'I can help'],
    [/\ba brief call with our team\b/g, 'a brief call'],
    [/\b(C|c)ould we\b/g, (m, c) => c + 'ould I'],
    [/\bwe'd be glad\b/g, "I'd be glad"],
    [/\bvalue we can add\b/g, 'value I can add'],
    [/\bintroduce ourselves\b/g, 'introduce myself'],
    [/\bour goal\b/g, 'my goal'],
  ];
  function isSolo(ctx) {
    const c = ctx.company || {};
    const inputs = ctx.inputs || {};
    if (inputs.Solo !== undefined && inputs.Solo !== '') return Boolean(inputs.Solo) && inputs.Solo !== 'no';
    return SOLO_PARTNER.test(String(inputs.Partner || ctx.partner || c.partner || ''));
  }
  function soloText(text) {
    return SOLO_REWRITES.reduce((t, [re, to]) => t.replace(re, to), String(text || ''));
  }

  function fillTemplate(text, ctx) {
    if (isSolo(ctx)) text = soloText(text);
    const c = ctx.company || {};
    const p = ctx.contact || {};
    const me = ctx.me || {};
    const exp = parseISODate(c.leaseExpiration);
    const months = c.leaseExpiration ? monthsUntil(c.leaseExpiration, ctx.today) : null;
    const values = {
      FirstName: p.firstName,
      LastName: p.lastName,
      FullName: [p.firstName, p.lastName].filter(Boolean).join(' '),
      Title: p.title,
      Company: c.name,
      Building: c.building || c.address,
      Address: c.address,
      Suite: c.floor,
      Submarket: c.submarket || c.city,
      City: c.city,
      Industry: c.industry,
      SF: parseNumber(c.sfOccupied) ? fmtNumber(c.sfOccupied) + ' SF' : '',
      LeaseExpiration: exp ? exp.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '',
      MonthsToExpiration: months !== null && months >= 0 ? String(months) : '',
      MyFirstName: String(me.name || '').split(' ')[0],
      MyName: me.name,
      MyFirm: me.firm,
      Partner: ctx.partner || c.partner,
    };
    Object.assign(values, marketValues(ctx.market, c));
    const inputs = ctx.inputs || {};
    Object.keys(inputs).forEach((k) => {
      if (/^\w+$/.test(k) && String(inputs[k] == null ? '' : inputs[k]).trim()) values[k] = inputs[k];
    });
    // Fill-ins that only exist in the Draft email dialog, and the rent math worked out from them.
    const sf = parseNumber(inputs.SF) || parseNumber(c.sfOccupied);
    if (parseNumber(inputs.SF)) values.SF = fmtNumber(parseNumber(inputs.SF)) + ' SF';
    const rate = parseNumber(inputs.Rate);
    const basis = QUOTE_BASES.includes(inputs.RateBasis) ? inputs.RateBasis : 'NNN';
    const opex = basis === 'NNN + OpEx' ? parseNumber(inputs.OpEx) : null;
    const growth = parseNumber(inputs.RentGrowth);
    const rent = rentMath(sf, rate, growth === null ? ctx.rentGrowth : growth / 100, opex);
    // "{Rate} NNN" in older templates: the rate now says its own basis.
    if (rate) text = String(text || '').replace(/\{Rate\}\s+NNN\b/g, '{Rate}');
    const days = meetingDays(inputs.MeetingDay);
    Object.assign(values, {
      Rate: rate ? rateText(rate, basis, opex) : '',
      CompBuilding: String(inputs.CompBuilding || '').trim() || values.Building,
      MeetingDay: days,
      MonthlyRent: rent.monthly,
      AnnualRent: rent.annual,
      AnnualIncrease: rent.increase,
    });
    // A [bracketed note] in the template is replaced by what was typed for it.
    const slotted = bracketSlots(text).reduceRight((t, b) => {
      const v = String(inputs[b.raw] == null ? '' : inputs[b.raw]).trim();
      return v ? t.slice(0, b.start) + v + t.slice(b.end) : t;
    }, String(text || ''));
    return slotted.replace(/\{(\w+)\}/g, (m, key) => {
      if (!(key in values)) return m;
      const v = values[key];
      return v === undefined || v === null || String(v).trim() === '' ? '[' + key + ']' : String(v).trim();
    });
  }

  // Rent at a quoted rate, and how much more that is than 5 years ago given the market's rent growth
  // (0.6 = rents up 60%, so the old rate was rate / 1.6). Dollar amounts come back rounded and formatted.
  const RENT_GROWTH = 0.6;
  // With opex (an NNN rate plus operating expenses), monthly and annual rent are all-in; the increase is on the
  // rent alone, since the rent growth figure is for asking rents.
  function rentMath(sf, rate, growth, opex) {
    sf = parseNumber(sf);
    rate = parseNumber(rate);
    if (!sf || !rate) return { monthly: '', annual: '', increase: '' };
    const g = parseNumber(growth) === null ? RENT_GROWTH : parseNumber(growth);
    const annual = sf * (rate + (parseNumber(opex) || 0));
    const money = (n, step) => '$' + fmtNumber(Math.round(n / step) * step);
    const increase = sf * rate * (1 - 1 / (1 + g));
    return {
      monthly: money(annual / 12, annual / 12 < 10000 ? 100 : 1000),
      annual: money(annual, 1000),
      increase: money(increase, increase < 50000 ? 1000 : 5000),
    };
  }

  // How a quoted rate reads in an email: "$12.75 NNN", "$12.75 NNN plus $3.50 OpEx" or "$28.00 full service".
  const QUOTE_BASES = ['NNN', 'NNN + OpEx', 'Full service'];
  function rateText(rate, basis, opex) {
    const $ = (n) => '$' + Number(n).toFixed(2);
    if (basis === 'Full service') return $(rate) + ' full service';
    if (basis === 'NNN + OpEx') return $(rate) + ' NNN plus ' + (parseNumber(opex) ? $(parseNumber(opex)) : '[OpEx]') + ' OpEx';
    return $(rate) + ' NNN';
  }

  // Quoted rates remembered by building, so the next tenant there starts with the last rate typed. Names match
  // loosely ("Royal Woods" finds "5238 Royal Woods Pkwy"). A rate 6 months old or more is flagged to re-confirm.
  const RATE_STALE_MONTHS = 6;
  function buildingKey(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function rememberRate(rates, building, rate, today, basis, opex) {
    const out = Object.assign({}, rates);
    const key = buildingKey(building);
    const r = parseNumber(rate);
    if (!key || !r) return out;
    out[key] = { building: String(building).trim(), rate: r, date: today || todayISO() };
    if (basis && basis !== 'NNN') out[key].basis = basis;
    if (basis === 'NNN + OpEx' && parseNumber(opex)) out[key].opex = parseNumber(opex);
    return out;
  }
  function rememberedRate(rates, building, today) {
    rates = rates || {};
    const key = buildingKey(building);
    if (!key) return null;
    const near = key.length >= 6 && Object.keys(rates).find((k) => k.length >= 6 && (key.includes(k) || k.includes(key)));
    const hit = rates[key] || (near && rates[near]);
    if (!hit) return null;
    const age = Math.max(0, monthsUntil(today || todayISO(), hit.date) || 0);
    const stale = age >= RATE_STALE_MONTHS;
    return Object.assign({}, hit, {
      ageMonths: age,
      stale,
      note: stale
        ? 'Quoted ' + fmtDate(hit.date) + ' (' + rateText(hit.rate, hit.basis || 'NNN', hit.opex) + '), ' + age + ' months ago. Re-confirm the rate at ' + hit.building + ' before sending.'
        : 'Saved for ' + hit.building + ' on ' + fmtDate(hit.date) + ': ' + rateText(hit.rate, hit.basis || 'NNN', hit.opex) + '.',
    });
  }

  // Every saved building quote for the Quoted rates list, matching a search, by building name.
  function quotedRateList(rates, q, today) {
    q = String(q || '').trim().toLowerCase();
    return Object.keys(rates || {})
      .map((key) => Object.assign({ key, text: rateText(rates[key].rate, rates[key].basis || 'NNN', rates[key].opex) }, rememberedRate(rates, rates[key].building, today), rates[key]))
      .filter((r) => !q || (r.building + ' ' + r.text).toLowerCase().includes(q))
      .sort((a, b) => a.building.localeCompare(b.building));
  }

  // The outermost [bracketed notes] in a template, e.g. "[specific day]" or "[fact, e.g. "[tenant] renewed"]".
  function bracketSlots(text) {
    const out = [];
    let depth = 0;
    let start = -1;
    String(text || '').split('').forEach((ch, i) => {
      if (ch === '[') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === ']' && depth > 0) {
        depth--;
        if (depth === 0) out.push({ start, end: i + 1, raw: text.slice(start, i + 1), label: text.slice(start + 1, i) });
      }
    });
    return out;
  }

  // What the Draft email dialog asks for before a template reads right: the rate and meeting day for templates
  // that use them, SF and partner (which can be saved back to the company), CRM details that are blank, and each
  // [bracketed note]. In order of first appearance; `value` is the starting value.
  const FILL_IN_FIELDS = {
    Rate: { label: 'Quoted rate ($/SF/yr)', type: 'number' },
    RateBasis: { label: 'Rate type', type: 'select', options: QUOTE_BASES },
    OpEx: { label: 'OpEx ($/SF/yr)', type: 'number' },
    CompBuilding: { label: 'Comp building' },
    MeetingDay: { label: 'Meeting day(s)', type: 'date' },
    SF: { label: 'SF', type: 'number', saveTo: 'sfOccupied' },
    Partner: { label: 'Partner', saveTo: 'partner', solo: true },
    RentGrowth: { label: 'Rent growth over 5 years (%)', type: 'number' },
  };
  const RENT_KEYS = ['MonthlyRent', 'AnnualRent', 'AnnualIncrease'];
  function templateFillIns(text, ctx) {
    text = String(text || '');
    const c = ctx.company || {};
    const crm = fillTemplate(text.replace(/\[|\]/g, ' '), Object.assign({}, ctx, { inputs: {} }));
    const found = [];
    const add = (key, at, extra) => {
      if (found.some((f) => f.key === key)) return;
      found.push(Object.assign({ key, at }, extra));
      // A rate always comes with its type (NNN, NNN + OpEx, full service) and the OpEx box.
      if (key === 'Rate') ['RateBasis', 'OpEx'].forEach((k) => add(k, at));
    };
    const slots = bracketSlots(text);
    const re = /\{(\w+)\}/g;
    let m;
    while ((m = re.exec(text))) {
      const key = m[1];
      if (slots.some((b) => m.index > b.start && m.index < b.end)) continue; // part of a [bracketed note]
      if (RENT_KEYS.includes(key)) {
        add('Rate', m.index);
        add('SF', m.index);
        if (key === 'AnnualIncrease') add('RentGrowth', m.index);
      } else if (FILL_IN_FIELDS[key]) add(key, m.index);
      else if (crm.includes('[' + key + ']')) add(key, m.index, { label: key });
    }
    slots.forEach((b) => add(b.raw, b.start, { label: b.label, bracket: true }));
    const start = {
      SF: parseNumber(c.sfOccupied) || '',
      Partner: ctx.partner || c.partner || '',
      CompBuilding: c.building || c.address || '',
      RentGrowth: Math.round((parseNumber(ctx.rentGrowth) === null ? RENT_GROWTH : parseNumber(ctx.rentGrowth)) * 100),
    };
    const saved = rememberedRate(ctx.buildingRates, start.CompBuilding || c.building || c.address, ctx.today);
    start.RateBasis = 'NNN';
    if (saved) Object.assign(start, { Rate: saved.rate, RateBasis: saved.basis || 'NNN', OpEx: saved.opex || '' });
    return found
      .sort((a, b) => a.at - b.at)
      .map((f) =>
        Object.assign({ type: 'text' }, FILL_IN_FIELDS[f.key] || {}, f, {
          value: start[f.key] === undefined ? '' : String(start[f.key]),
          note: f.key === 'Rate' && saved ? saved.note : '',
          checked: f.key === 'Partner' ? isSolo(ctx) : undefined,
          stale: f.key === 'Rate' && saved ? saved.stale : false,
        })
      );
  }

  // One or more meeting days (ISO dates, comma separated) as words: "Tuesday, Nov 3",
  // "Tuesday, Nov 3 or Wednesday, Nov 4", "Tuesday, Nov 3, Wednesday, Nov 4 or Thursday, Nov 5".
  function meetingDays(value) {
    const list = Array.from(new Set(String(value || '').split(/[,\s]+/).filter((d) => parseISODate(d)))).sort();
    const words = list.map((d) => parseISODate(d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }));
    return words.length > 1 ? words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1] : words[0] || '';
  }

  // The next few weekdays after today, for picking a meeting day.
  function nextBusinessDays(today, n) {
    const out = [];
    let d = today;
    while (out.length < n) {
      d = addDays(d, 1);
      const wd = parseISODate(d).getDay();
      if (wd !== 0 && wd !== 6) out.push(d);
    }
    return out;
  }

  // Picks the template that fits where the company is: a follow-up after an unanswered touch, the lease-expiration
  // note inside 30 months of expiration, otherwise an intro.
  function suggestTemplate(templates, company, opts) {
    opts = opts || {};
    const active = templates.filter((t) => t.active !== false && t.active !== 'false');
    const byStep = (step) => active.find((t) => t.step === step);
    // A template written for specific buildings wins for first touches to their tenants.
    const where = [company.building, company.address].join(' ').toLowerCase();
    const forBuilding = active.find((t) => String(t.buildings || '').split(',').some((b) => b.trim() && where.includes(b.trim().toLowerCase())));
    const stage = leadStage(company);
    if (forBuilding && !(opts.lastTouch && ['Initial Outreach', 'Follow Up', 'Engaged'].includes(stage))) return forBuilding;
    const months = company.leaseExpiration ? monthsUntil(company.leaseExpiration, opts.today) : null;
    if (opts.lastTouch && ['Initial Outreach', 'Follow Up', 'Engaged'].includes(stage)) return byStep('Follow-up') || active[0] || null;
    if (months !== null && months >= 0 && months <= 30) return byStep('Lease expiration') || byStep('Intro') || active[0] || null;
    return byStep('Intro') || active[0] || null;
  }

  // A ready-to-send follow-up for a company, written from where things stand: the open deal's stage, or the last
  // email you sent and the lease timing. ctx: { company, contact, me, deal, lastEmail, today, partner }.
  // Returns { subject, body, why }. Missing details show as [brackets], like templates.
  function followUpDraft(ctx) {
    const c = ctx.company || {};
    const deal = ctx.deal && OPEN_STAGES.includes(normalizeDealStage(ctx.deal.stage)) ? ctx.deal : null;
    const last = ctx.lastEmail;
    const months = c.leaseExpiration ? monthsUntil(c.leaseExpiration, ctx.today) : null;
    const sign = '\n\nBest,\n{MyFirstName}';
    const fill = (t) => fillTemplate(t, ctx);
    const reSubject = (subj) => 'RE: ' + String(subj || '').replace(/^\s*((re|fw|fwd|reply)\s*:\s*)+/gi, '').trim();
    if (deal) {
      const stage = normalizeDealStage(deal.stage);
      const lines = {
        'Intro Call': 'Thanks again for the time to talk through your space plans. As a next step, I\'ll pull together a survey of options that fit what you described. Is there anything you\'d add to the requirement (size, location, budget or timing) before I send it over?',
        'Market Survey': 'Following up on the market survey. Did any of the buildings stand out? I\'m happy to set up tours for the ones you like, or widen the search if nothing fits yet.',
        Touring: 'Thanks for making the time to tour. I\'d love your take on the buildings we saw. If one or two rose to the top, I can request proposals from the landlords so we can compare real numbers.',
        RFP: 'Quick update on the proposals: I\'m putting the landlord responses side by side so we can compare rent, concessions and total cost. Do you have time this week to walk through them together?',
        LOI: 'Checking in on the LOI. Let me know if you have any questions on the terms, or anything you\'d like me to push back on before we respond to the landlord.',
        'Lease Negotiation': 'Checking in on the lease. I\'m tracking the open points with the landlord and will keep things moving. Anything you\'d like me to raise in the next round?',
      };
      return {
        subject: fill(deal.name ? deal.name + ' – next steps' : '{Company} – next steps'),
        body: fill('Hi {FirstName},\n\n' + (lines[stage] || lines['Intro Call']) + sign),
        why: 'Follow-up for the ' + stage + ' stage of ' + (deal.name || 'the deal') + '.',
      };
    }
    const lease =
      months !== null && months >= 0 && months <= 9
        ? 'With your lease at {Building} coming up in {LeaseExpiration}, there\'s still time to line up good options, and the sooner we start, the more leverage you\'ll have with the landlord.'
        : months !== null && months > 9 && months <= 18
        ? 'With your lease at {Building} coming up in {LeaseExpiration}, you\'re inside the window when most tenants start planning, and starting early keeps your options and leverage open.'
        : months !== null && months > 18 && months <= 36
          ? 'Your lease at {Building} runs to {LeaseExpiration}. That\'s still a way out, but a quick look at the market now makes it easier to plan budget and timing.'
          : 'I\'d love to hear how the space at {Building} is working for your team.';
    const ask = (ctx.market ? '{MarketStat} ' : '') + 'Would you have 15 minutes next week for a quick call? I can share what we\'re seeing in {Submarket} (recent deals, rents and concessions), whether or not a move is on the table.';
    if (last) {
      return {
        subject: reSubject(last.subject),
        body: fill('Hi {FirstName},\n\nFollowing up on my note from ' + fmtDate(last.date) + '. ' + lease + '\n\n' + ask + sign),
        why: 'Follow-up to your ' + fmtDate(last.date) + ' email' + (parseNumber(last.opens) ? ', opened ' + parseNumber(last.opens) + (parseNumber(last.opens) === 1 ? ' time' : ' times') : '') + '.',
      };
    }
    return {
      subject: fill('{Company} – checking in'),
      body: fill('Hi {FirstName},\n\n' + lease + '\n\n' + ask + sign),
      why: 'A check-in; no earlier email to follow up on.',
    };
  }

  // The useful first lines of an email: no greeting, no quoted thread, no signature-length tail.
  function emailSnippet(a, max) {
    max = max || 180;
    let t = String(a.body || a.notes || '').replace(/\r\n/g, '\n');
    t = t.split(/\n\s*(?:On .{0,200}wrote:|From:|-{2,}\s*Original Message|>)/i)[0];
    t = t.split(/\n\s*(?:best|best regards|kind regards|regards|thanks|thank you|cheers|sincerely)[,!.]?\s*(?:\n|$)/i)[0];
    t = t.replace(/^\s*(hi|hello|hey|good (morning|afternoon))\b[^\n,]*,?\s*/i, '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
  }

  // "Where things stand" on a deal or company, from its emails, notes, tasks and survey properties.
  // data: { company, deal?, activities (this company's), properties (this deal's), contacts }. Returns
  // { title, sections: [{ label, items: [text] }] } with empty sections left out.
  function dealBrief(data, opts) {
    const today = (opts && opts.today) || todayISO();
    const c = data.company || {};
    const d = data.deal || null;
    const people = {};
    (data.contacts || []).forEach((p) => (people[p.id] = p));
    const who = (a) => {
      const p = people[a.contactId];
      return p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : '';
    };
    const acts = (data.activities || []).filter((a) => a.date && (!d || !a.dealId || a.dealId === d.id));
    const past = acts.filter((a) => a.type !== 'Task' && a.date <= today).sort((a, b) => b.date.localeCompare(a.date));
    const emails = past.filter((a) => a.type === 'Email');
    const sections = [];
    const add = (label, items) => {
      items = items.filter(Boolean);
      if (items.length) sections.push({ label, items });
    };

    const status = [];
    if (d) status.push(d.stage + (d.stageChangedAt ? ' since ' + fmtDate(String(d.stageChangedAt).slice(0, 10)) : ''));
    else status.push([leadStage(c) && 'Lead: ' + leadStage(c), c.status].filter(Boolean).join(' · '));
    const last = emails[0];
    const subj = (a) => '"' + String(a.subject || '').replace(/^Reply:\s*/, '') + '"';
    if (last && last.inbound) status.push((who(last) || 'They') + ' replied ' + fmtDate(last.date) + ' (' + subj(last) + '). Your move.');
    else if (last && responded(last)) status.push('They replied to your ' + fmtDate(last.date) + ' email ' + subj(last) + '.');
    else if (last) status.push('Waiting on them: you emailed ' + fmtDate(last.date) + ' ' + subj(last) + (parseNumber(last.opens) ? ', opened ' + parseNumber(last.opens) + 'x' : '') + ', no reply yet.');
    if (past[0] && past[0] !== last) status.push('Last touch: ' + fmtDate(past[0].date) + ' · ' + past[0].type + ' · ' + (past[0].subject || ''));
    if (!past.length) status.push('No activity logged yet.');
    add('Where it stands', status);

    add(
      'Latest emails',
      emails.slice(0, 3).map((a) => fmtDate(a.date) + (a.inbound ? ' · from ' + (who(a) || 'them') : ' · you') + ' · ' + subj(a) + (emailSnippet(a) ? ': ' + emailSnippet(a) : ''))
    );

    const myNotes = String((d || c).notes || '')
      .split(/\n\s*\n/)
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 3);
    const added = past.filter((a) => a.type === 'Note' || a.type === 'Meeting' || a.type === 'Call').slice(0, 3).map((a) => fmtDate(a.date) + ' · ' + a.type + ' · ' + (a.subject || '') + (a.notes && a.notes !== a.subject ? ': ' + emailSnippet({ notes: a.notes }, 160) : ''));
    add('Latest notes', myNotes.concat(added));

    add(
      'Open tasks',
      acts
        .filter((a) => a.type === 'Task' && !a.done)
        .sort((a, b) => (a.followUpDate || a.date).localeCompare(b.followUpDate || b.date))
        .slice(0, 4)
        .map((a) => (a.followUpDate || a.date) + ' ' + ((a.followUpDate || a.date) < today ? '(overdue) ' : '') + '· ' + a.subject)
        .map((t) => t.replace(/^(\d{4}-\d{2}-\d{2})/, (m) => fmtDate(m)))
    );

    if (d) {
      const props = data.properties || [];
      const counts = {};
      props.forEach((p) => (counts[p.status || 'Identified'] = (counts[p.status || 'Identified'] || 0) + 1));
      add('Requirement', [
        [dealSizeLabel(d), dealBudgetLabel(d), d.targetSubmarkets].filter(Boolean).join(' · '),
        props.length ? props.length + ' buildings on the survey: ' + PROPERTY_STATUSES.filter((st) => counts[st]).map((st) => counts[st] + ' ' + st.toLowerCase()).join(', ') : '',
      ]);
      add('Key dates', [
        d.targetOccupancy ? 'Target occupancy ' + fmtDate(d.targetOccupancy) : '',
        d.targetClose ? 'Target execution ' + fmtDate(d.targetClose) : '',
        d.repAgreementSigned ? (d.repAgreementExpires ? 'Rep agreement expires ' + fmtDate(d.repAgreementExpires) : '') : 'Rep agreement not signed',
        c.leaseExpiration ? 'Current lease expires ' + fmtDate(c.leaseExpiration) : '',
      ]);
    } else {
      add('Key dates', [c.leaseExpiration ? 'Lease expires ' + fmtDate(c.leaseExpiration) : '']);
    }
    return { title: d ? d.name : c.name, sections };
  }

  function briefText(brief) {
    return [brief.title].concat(brief.sections.map((sec) => '\n' + sec.label + '\n' + sec.items.map((t) => '- ' + t).join('\n'))).join('\n');
  }

  const RECAP_TEMPLATE = 'Weekly recap';
  function mondayOf(iso) {
    const d = parseISODate(iso);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return toISODate(d);
  }
  // The Friday a recap is due for: today if it's Friday, else the last one (a missed recap carries over to the next Friday).
  function recapFriday(today) {
    const d = parseISODate(today);
    d.setDate(d.getDate() - ((d.getDay() + 2) % 7));
    return toISODate(d);
  }
  // A deal needs a recap when it was open by that Friday and none has gone out since that week's Monday.
  function recapDue(deal, activities, today) {
    const friday = recapFriday(today);
    return OPEN_STAGES.includes(normalizeDealStage(deal.stage)) && (!deal.createdAt || String(deal.createdAt).slice(0, 10) <= friday) && !recapSent(deal, activities, today);
  }
  // Already recapped for that Friday: an email tagged as the weekly recap (or titled like one) on this deal, sent
  // from the day before that Friday up to the next one.
  function recapSent(deal, activities, today) {
    const friday = recapFriday(today);
    const from = addDays(friday, -1);
    const to = addDays(friday, 6);
    return activities.some(
      (a) => a.type === 'Email' && !a.inbound && a.date >= from && a.date <= to && (a.dealId === deal.id || (!a.dealId && a.companyId === deal.companyId)) && (a.template === RECAP_TEMPLATE || /weekly (update|recap)/i.test(a.subject || ''))
    );
  }

  // Friday status email to the client on an open deal: what got done this week (even if nothing) and what's next.
  // ctx: { company, contact, me, deal, activities (company's), properties (deal's), today }. Returns { subject, body, done, next }.
  function weeklyRecap(ctx) {
    const d = ctx.deal;
    const today = ctx.today || todayISO();
    const from = mondayOf(recapFriday(today));
    const weekend = parseISODate(today).getDay() >= 5 || parseISODate(today).getDay() === 0;
    const inWeek = (iso) => Boolean(iso) && String(iso).slice(0, 10) >= from && String(iso).slice(0, 10) <= today;
    const props = ctx.properties || [];
    const acts = (ctx.activities || []).filter((a) => !a.dealId || a.dealId === d.id);
    const names = (list) => list.map((p) => p.building || p.name).filter(Boolean);
    const join = (list) => (list.length <= 2 ? list.join(' and ') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]);
    const done = [];
    const stage = normalizeDealStage(d.stage);
    if (inWeek(d.stageChangedAt) && stage !== 'Intro Call') done.push('Moved the search to the ' + stage + ' stage.');
    const added = names(props.filter((p) => inWeek(p.createdAt)));
    if (added.length) done.push('Added ' + (added.length === 1 ? added[0] : added.length + ' buildings (' + join(added) + ')') + ' to the survey.');
    const toured = names(props.filter((p) => inWeek(p.tourDate) && p.tourDate <= today));
    if (toured.length) done.push('Toured ' + join(toured) + '.');
    const changed = (st) => names(props.filter((p) => p.status === st && inWeek(p.updatedAt)));
    if (changed('Proposal Requested').length) done.push('Requested proposals from ' + join(changed('Proposal Requested')) + '.');
    if (changed('Proposal Received').length) done.push('Received proposals from ' + join(changed('Proposal Received')) + '.');
    if (changed('Shortlisted').length) done.push('Shortlisted ' + join(changed('Shortlisted')) + '.');
    if (changed('Selected').length) done.push('Selected ' + join(changed('Selected')) + '.');
    acts
      .filter((a) => inWeek(a.date) && ['Meeting', 'Call', 'Tour', 'Proposal'].includes(a.type) && !(a.type === 'Tour' && toured.length))
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((a) => done.push((a.type === 'Meeting' ? 'Met: ' : a.type === 'Call' ? 'Call: ' : a.type + ': ') + (a.subject || '').replace(/[.\s]+$/, '') + '.'));
    const next = acts
      .filter((a) => a.type === 'Task' && !a.done && (a.followUpDate || a.date) <= addDays(today, 14))
      .sort((a, b) => (a.followUpDate || a.date).localeCompare(b.followUpDate || b.date))
      .slice(0, 4)
      .map((a) => String(a.subject || '').replace(/[.\s]+$/, '') + '.');
    const DEFAULT_NEXT = {
      'Intro Call': 'Pull together a survey of options that fit your requirement.',
      'Market Survey': 'Narrow the survey with you and line up tours of the best fits.',
      Touring: 'Get your feedback on the tours and request proposals on the front-runners.',
      RFP: 'Compare the landlord proposals side by side and pick the ones to negotiate.',
      LOI: 'Work through the LOI terms with the landlord.',
      'Lease Negotiation': 'Keep the lease moving and close out the open points.',
    };
    if (!next.length) next.push(DEFAULT_NEXT[stage] || DEFAULT_NEXT['Intro Call']);
    const bullets = (list) => list.map((t) => '- ' + t).join('\n');
    const week = parseISODate(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const body =
      'Hi {FirstName},\n\nHere\'s a quick update on ' + (d.name || 'your search') + ' for the week.\n\n' +
      (done.length ? 'This week:\n' + bullets(done) : 'It was a quieter week on this one. I\'m keeping an eye on the market and will flag anything new that fits.') +
      '\n\nNext steps:\n' + bullets(next) +
      '\n\nLet me know if anything has changed on your end or if you have any questions.\n\n' + (weekend ? 'Have a great weekend' : 'Best') + ',\n{MyFirstName}';
    return { subject: (d.name || ctx.company.name) + ' – weekly update (week of ' + week + ')', body: fillTemplate(body, ctx), done, next };
  }

  // Research's social-media "Market Highlights" card: numbered highlights laid out two to a row.
  // Returns { quarter, assetClass, market, items: [{ title, text }] }.
  function parseMarketHighlights(lines, filename) {
    lines = (lines || []).map((l) => String(l).replace(/\t/g, '    '));
    const text = lines.join('\n');
    const head = /\b(OFFICE|INDUSTRIAL|FLEX|R&D\/FLEX|RETAIL|MULTIFAMILY|LIFE SCIENCE)\s+MARKET\s*\|\s*([1-4]\s?Q\s?\d\s?\d)/i.exec(text);
    const quarter = normalizeQuarter(filename) || (head ? head[2].replace(/\s/g, '') : '') || normalizeQuarter(text.slice(0, 4000));
    const kind = head ? head[1] : /industrial/i.test(filename) ? 'Industrial' : /flex/i.test(filename) ? 'Flex' : 'Office';
    const assetClass = /flex/i.test(kind) ? 'Flex' : kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
    // The market's name sits beside or near "MARKET HIGHLIGHTS"; the highlights follow it.
    const hi = lines.findIndex((l) => /HIGHLIGHTS/.test(l));
    const top = lines.slice(0, hi + 2).flatMap((l) => l.trim().split(/\s{3,}/)).map((t) => t.trim()).filter((t) => t && !/^(MARKET|HIGHLIGHTS)$/i.test(t) && !/\|/.test(t) && !/^\d+$/.test(t));
    const market = top.find((t) => /^[A-Z][A-Za-z .'-]{2,30}$/.test(t)) || '';
    const body = lines.slice(hi + 1).filter((l) => l.trim() && l.trim() !== market && !/^\s*\d{1,2}(\s+\d{1,2})?\s*$/.test(l) && !/^\s*(Source|N E W M|©)/i.test(l));
    // Two columns: the right one starts where a second run of text begins on most two-part lines.
    const starts = body.map((l) => (/^(\s*\S.*?\S?)\s{3,}\S/.exec(l) ? l.search(/\S\s{3,}\S/) + l.slice(l.search(/\S\s{3,}\S/)).search(/\s\S/) + 1 : -1)).filter((x) => x > 0);
    const col = starts.length ? starts.sort((x, y) => x - y)[Math.floor(starts.length / 2)] : 0;
    // A heading is in Title Case ("Rents Reach A New Record High"); the text under it is ordinary sentences.
    const titleCase = (t) => {
      const words = t.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(a|an|and|of|to|in|the|for|on|at|by|vs\.?)$/i.test(w));
      return words.length > 0 && words.filter((w) => /^[A-Z]/.test(w)).length / words.length >= 0.75;
    };
    const columns = col ? [body.map((l) => l.slice(0, col - 1)), body.map((l) => l.slice(col - 1))] : [body];
    const found = [];
    columns.forEach((colLines, ci) => {
      let cur = null;
      colLines
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .forEach((t) => {
          const heading = titleCase(t);
          if (heading && (!cur || cur.text.length)) {
            if (cur) found.push(cur);
            cur = { col: ci, title: t, text: '' };
          } else if (heading && cur && !cur.text) cur.title += ' ' + t;
          else if (cur) cur.text += (cur.text ? ' ' : '') + t;
        });
      if (cur) found.push(cur);
    });
    // Read across each row: left, right, then the next row.
    const left = found.filter((x) => x.col === 0);
    const right = found.filter((x) => x.col === 1);
    const items = [];
    for (let i = 0; i < Math.max(left.length, right.length); i++) [left[i], right[i]].forEach((x) => x && x.text && items.push({ title: x.title.replace(/\s+/g, ' ').trim(), text: x.text.replace(/([a-z])- ([a-z])/g, '$1-$2').trim() }));
    return { quarter, assetClass, market, items };
  }

  // A LinkedIn caption from the highlights.
  function highlightsPost(h, opts) {
    opts = opts || {};
    const asset = String(h.assetClass || '').toLowerCase();
    const tags = ['#' + String(h.market || 'Atlanta').replace(/[^A-Za-z]/g, ''), '#CommercialRealEstate', asset === 'industrial' ? '#IndustrialRealEstate' : asset === 'flex' ? '#FlexSpace' : '#OfficeSpace', '#CRE'];
    return [
      (h.market ? h.market + ' ' : '') + asset + ' market, ' + h.quarter + ': ' + (h.items.length === 4 ? 'four' : h.items.length) + ' things to know',
      '',
      ...h.items.map((it, i) => i + 1 + '. ' + it.title + ': ' + it.text),
      '',
      'Thinking about what this means for your space? Happy to talk it through.',
      '',
      (opts.firm ? 'Source: ' + opts.firm + ' Research' : 'Source: [Research team]'),
      tags.join(' '),
    ].join('\n');
  }

  // A short market update for a prospect you've reached before, built from the latest stats for their submarket.
  // ctx as for fillTemplate, with ctx.market from marketStatFor. Returns { subject, body, why }.
  function marketUpdateDraft(ctx) {
    const m = ctx.market;
    const c = ctx.company || {};
    if (!m) return { subject: fillTemplate('{Company} – market update', ctx), body: fillTemplate('Hi {FirstName},\n\n[Market stats aren\'t loaded for this submarket yet.]\n\nBest,\n{MyFirstName}', ctx), why: 'No market stats on file for this company yet.' };
    const v = marketValues(m, c);
    const months = c.leaseExpiration ? monthsUntil(c.leaseExpiration, ctx.today) : null;
    const lease =
      months !== null && months >= 0 && months <= 24
        ? ' With your lease at {Building} up in {LeaseExpiration}, this is a good time to see how the market lines up with your plans.'
        : '';
    // One line from Research that adds something the stat sentence doesn't (absorption, construction, sublease…).
    const extra = (m.notes || []).find((b) => !/vacancy rate|asking (rent|rate)|average asking/i.test(b) && b.length < 260);
    const note = extra ? ' ' + extra : '';
    const body =
      'Hi {FirstName},\n\nThe ' + v.Quarter + ' numbers are out, and I thought you\'d want the latest on ' + v.StatsArea + '. ' + v.MarketStat + note + lease +
      '\n\nHappy to walk you through what this means for your space. Would 15 minutes next week work?\n\nBest,\n{MyFirstName}';
    return {
      subject: fillTemplate(v.StatsArea + ' ' + v.Quarter + ' market update', ctx),
      body: fillTemplate(body, ctx),
      why: 'Built from the ' + v.Quarter + ' ' + v.StatsArea + ' stats on the Research page' + (m.current.submarket === 'Market total' ? " (market-wide: this company's submarket isn't in the report)" : '') + '.',
    };
  }

  function mailtoLink(to, subject, body, cc) {
    const addr = (v) => encodeURIComponent(v || '').replace(/%40/g, '@').replace(/%2C/g, ',');
    return 'mailto:' + addr(to) + '?' + (cc ? 'cc=' + addr(cc) + '&' : '') + 'subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || '');
  }

  // Emails for a deal's partner brokers (the names in partnerBrokers), from your contacts. Names with no saved
  // email come back in `missing`, so nothing is guessed.
  function partnerEmails(deal, contacts) {
    const names = String((deal && deal.partnerBrokers) || '')
      .split(/\s*(?:,|;|&|\/|\band\b)\s*/i)
      .map((n) => n.trim())
      .filter(Boolean);
    const key = (n) => String(n || '').toLowerCase().replace(/[^a-z]/g, '');
    const found = [];
    const missing = [];
    names.forEach((n) => {
      const p = (contacts || []).find((c) => c.email && key([c.firstName, c.lastName].join(' ')) === key(n));
      if (p) found.push(p.email);
      else missing.push(n);
    });
    return { found, missing };
  }

  // ---------- coach ----------

  // Templates that earned replies in your own outreach history (Apr–Oct 2026).
  const STRONG_TEMPLATES = ['Building intro', 'Following up', 'Lease expiration'];
  const COLLATERAL_UPGRADES = [
    { key: 'upTakeaway', label: '"What this means for you" box for tenants' },
    { key: 'upCompare', label: 'Comparison with neighboring submarkets and the metro' },
    { key: 'upAvailability', label: 'Top available blocks or spec suites' },
    { key: 'upTombstones', label: 'Closed-deal tombstones on page 1' },
    { key: 'upPersonalized', label: 'Per-building version with a trackable link' },
  ];

  // Live checklist of habits to build; each tip re-checks itself against the CRM on every render.
  function coachTips(data, opts) {
    opts = opts || {};
    const today = opts.today || todayISO();
    const outreach = data.activities.filter((a) => OUTREACH_TYPES.includes(a.type) && a.date && a.date <= today).sort((a, b) => b.date.localeCompare(a.date));
    const recentEmails = outreach.filter((a) => a.type === 'Email' && a.template).slice(0, 20);
    const strong = recentEmails.filter((a) => STRONG_TEMPLATES.includes(a.template)).length;
    const last30 = outreach.filter((a) => a.date >= addDays(today, -30));
    const withOutcome = last30.filter((a) => a.outcome || parseNumber(a.replies) !== null).length;
    const calls14 = outreach.filter((a) => a.type === 'Call' && a.date >= addDays(today, -14)).length;
    const plan = dailyPlan(data, { today });
    const staleOpened = plan.opened.filter((o) => {
      const a = data.activities.find((x) => x.id === o.activityId);
      return a && a.date <= addDays(today, -3);
    }).length;
    const firstTouches = outreach.filter((a) => a.type === 'Email' && a.template && a.template !== 'Following up' && !responded(a) && a.date <= addDays(today, -7) && a.date >= addDays(today, -35));
    const followedUp = firstTouches.filter((a) => outreach.some((b) => b.companyId === a.companyId && b.date > a.date)).length;
    const marketing = data.marketing || [];
    const flyers = marketing.filter((m) => m.kind === 'One-pager / flyer' && m.status !== 'Retired');
    const stale = flyers.filter((m) => collateralStale(m, today)).length;
    const upgradesDone = flyers.reduce((t, m) => t + COLLATERAL_UPGRADES.filter((u) => m[u.key] === true || m[u.key] === 'true').length, 0);
    const upgradesTotal = flyers.length * COLLATERAL_UPGRADES.length;
    const d = parseISODate(today);
    const monday = addDays(today, -((d.getDay() + 6) % 7));
    const posts = marketing.filter((m) => m.kind === 'Social post' && m.status === 'Sent / Posted' && m.date >= monday && m.date <= today).length;
    const goal = parseNumber(opts.postsPerWeek) || 0;
    const noSize = data.deals.filter((x) => OPEN_STAGES.includes(x.stage) && !dealSizeLabel(x)).length;
    const ratio = (n, of) => (of ? Math.round((n / of) * 100) + '%' : '—');

    return [
      {
        id: 'subjects',
        title: 'Lead with their building in the subject line',
        detail: '"{Company} | {Building} – Atlanta Office" got 35% replies and "Lease Expiration – {Company}" 33%, against 10% for "Quick insight on your office lease costs". Name the building or a neighbor in the first line.',
        status: recentEmails.length ? `${strong} of your last ${recentEmails.length} emails used a strong template` : 'Pick a template when you log an email to track this',
        done: recentEmails.length >= 5 && strong / recentEmails.length >= 0.6,
      },
      {
        id: 'follow-up',
        title: 'Always send the follow-up',
        detail: '"Following up – {Company}" notes earned 53% replies, your best result. Send one 7–10 days after any first touch that gets no answer.',
        status: firstTouches.length ? `${followedUp} of ${firstTouches.length} unanswered first touches from the last month got a follow-up` : 'No unanswered first touches from the last month',
        done: !firstTouches.length || followedUp / firstTouches.length >= 0.8,
      },
      {
        id: 'opened',
        title: 'Act on opens within 3 days',
        detail: "When someone opens your email but doesn't reply, call or send a short note within 3 days, and connect on LinkedIn.",
        status: staleOpened ? `${staleOpened} opened email${staleOpened > 1 ? 's' : ''} waiting more than 3 days` : 'All caught up',
        done: staleOpened === 0,
      },
      {
        id: 'outcomes',
        title: 'Record an outcome on every touch',
        detail: 'Results by template and channel are only as good as the outcomes logged. Pick one each time you log a call or email.',
        status: last30.length ? `${ratio(withOutcome, last30.length)} of the last 30 days' touches have an outcome` : 'No touches logged in the last 30 days',
        done: last30.length > 0 && withOutcome / last30.length >= 0.9,
      },
      {
        id: 'calls',
        title: 'Log your calls',
        detail: 'Only one real call is in HubSpot, so call results can\'t be measured yet. Tap ✓ Called on Today, then set the outcome.',
        status: `${calls14} call${calls14 === 1 ? '' : 's'} logged in the last 2 weeks`,
        done: calls14 >= 5,
      },
      {
        id: 'greeting',
        title: 'Open with their name and one small ask',
        detail: 'Most emails opened 3+ times with no reply opened with "Good afternoon," and no name, then a list of market stats. Replies came from notes that used a first name and ended with one easy ask ("a quick 10-minute call", "I\'ll be in the area Thursday").',
        status: 'Habit to keep in mind',
        done: null,
      },
      {
        id: 'drop-by',
        title: 'Pair a drop-by with an email the same day',
        detail: '"I stopped by your office this morning…" notes got replies. Use the door-knock list on Today, then send the email that afternoon.',
        status: 'Habit to keep in mind',
        done: null,
      },
      {
        id: 'timing',
        title: 'Send early in the week, around midday',
        detail: 'Monday (28%) and Tuesday (26%) emails got the most replies, and 12–2pm sends did best (28%). Thursday was weakest (17%).',
        status: 'Habit to keep in mind',
        done: null,
      },
      {
        id: 'flyers',
        title: 'Keep one-pagers on the latest quarter',
        detail: 'Ping Research ~15 days after a quarter closes and send the refreshed one-pagers at ~1 month. Both reminders are on your Follow-ups list.',
        status: flyers.length ? (stale ? `${stale} of ${flyers.length} one-pagers still on old data` : 'All current') : 'Add your one-pagers in Marketing',
        done: flyers.length > 0 && stale === 0,
      },
      {
        id: 'upgrades',
        title: 'Upgrade your one-pagers',
        detail: COLLATERAL_UPGRADES.map((u) => u.label).join(' · ') + '. Tick each one off on the piece in Marketing once it\'s done.',
        status: upgradesTotal ? `${upgradesDone} of ${upgradesTotal} upgrades done across ${flyers.length} one-pagers` : 'Add your one-pagers in Marketing',
        done: upgradesTotal > 0 && upgradesDone === upgradesTotal,
      },
      {
        id: 'posting',
        title: `Post on LinkedIn ${goal || 2}× a week`,
        detail: 'Market takeaways from your one-pagers, closed-deal spotlights and move-in posts for clients whose space just delivered.',
        status: `${posts} posted this week`,
        done: goal ? posts >= goal : null,
      },
      {
        id: 'rsf',
        title: 'Every deal has its RSF',
        detail: 'Size drives commission estimates and which spaces fit. A range is fine.',
        status: noSize ? `${noSize} open deal${noSize > 1 ? 's' : ''} missing RSF` : 'All open deals have a size',
        done: noSize === 0,
      },
    ];
  }

  // ---------- daily plan ----------

  // Days to wait before the next touch, by lead stage.
  const FOLLOW_UP_DAYS = { 'Initial Outreach': 7, 'Follow Up': 14, Engaged: 10 };
  const TEMP_RANK = { Hot: 0, Warm: 1, '': 2, Cold: 3 };

  // Merging a duplicate company into another: everything tied to it moves over, the kept company gains any
  // details it was missing plus the duplicate's name as an alias, and the duplicate's HubSpot ID points here.
  function planCompanyMerge(data, fromId, toId) {
    const from = data.companies.find((c) => c.id === fromId);
    const to = data.companies.find((c) => c.id === toId);
    if (!from || !to || fromId === toId) return null;
    const patch = { id: to.id };
    Object.keys(from).forEach((k) => {
      if (['id', 'name', 'createdAt', 'updatedAt', 'aliases', 'mergedHubspotIds', 'hubspotId', 'hubspotUrl'].includes(k)) return;
      const v = from[k];
      if (v !== '' && v !== null && v !== undefined && (to[k] === '' || to[k] === null || to[k] === undefined)) patch[k] = v;
    });
    const aliases = String(to.aliases || '').split(/\s*,\s*/).filter(Boolean);
    [from.name].concat(String(from.aliases || '').split(/\s*,\s*/)).forEach((n) => n && !aliases.includes(n) && n !== to.name && aliases.push(n));
    patch.aliases = aliases.join(', ');
    const ids = (to.mergedHubspotIds || []).concat(from.mergedHubspotIds || []);
    if (from.hubspotId && !to.hubspotId) Object.assign(patch, { hubspotId: String(from.hubspotId), hubspotUrl: from.hubspotUrl || '' });
    else if (from.hubspotId) ids.push(String(from.hubspotId));
    if (ids.length) patch.mergedHubspotIds = ids.filter((x, i) => ids.indexOf(x) === i);
    const moves = {};
    ['contacts', 'deals', 'activities', 'documents', 'criticalDates'].forEach((col) => {
      moves[col] = (data[col] || []).filter((r) => r.companyId === fromId).map((r) => ({ id: r.id, companyId: toId }));
    });
    return { company: patch, moves, remove: fromId };
  }

  // You and your colleagues (anyone at your email domain) are never the client contact to reach.
  function isColleague(p, domain) {
    return Boolean(p && domain && String(p.email || '').toLowerCase().endsWith('@' + String(domain).toLowerCase()));
  }

  function contactRank(c) {
    const callable = (c.phone && !c.phoneDNC) || (c.mobile && !c.mobileDNC);
    return (c.keyContact ? 10 : 0) + (c.role === 'Decision Maker' ? 4 : 0) + (c.email ? 2 : 0) + (callable ? 2 : 0) + (c.verification === 'Web-verified' ? 1 : 0);
  }

  // How to reach a company's best contact: call (never a Do-Not-Call number), email, or find someone first.
  function reachChannel(contact) {
    if (!contact) return 'Find a contact';
    if ((contact.phone && !contact.phoneDNC) || (contact.mobile && !contact.mobileDNC)) return 'Call';
    if (contact.email) return 'Email';
    return contact.linkedin ? 'LinkedIn' : 'Find a contact';
  }

  // Follow-up workflow: an initial email (no email, call or meeting with the company in the 60 days
  // before it) to a lead with no open deal creates a "send a follow-up" task `days` later. The task closes
  // itself once they reply or you reach out again. Only emails on or after `since` count, so loading old
  // history doesn't flood the list; `created` holds task ids already made, so deleted tasks stay deleted.
  function planFollowUpTasks(data, opts) {
    opts = opts || {};
    const today = opts.today || todayISO();
    const days = Math.max(1, parseNumber(opts.days) || 7);
    const since = opts.since || today;
    const created = new Set(opts.created || []);
    const companies = {};
    data.companies.forEach((c) => (companies[c.id] = c));
    const contacts = {};
    (data.contacts || []).forEach((p) => (contacts[p.id] = p));
    const openDeal = new Set(data.deals.filter((d) => OPEN_STAGES.includes(d.stage)).map((d) => d.companyId));
    // The email's contact if they work there, else the company's best contact.
    const own = opts.internalDomain;
    const contactAt = (id, companyId) =>
      (contacts[id] && contacts[id].companyId === companyId && !isColleague(contacts[id], own) && contacts[id]) ||
      (data.contacts || []).filter((p) => p.companyId === companyId && !isColleague(p, own)).sort((a, b) => contactRank(b) - contactRank(a))[0] ||
      null;
    // Emails among colleagues (a company of two or more people at your email domain and nobody else) aren't prospecting.
    const people = {};
    (data.contacts || []).forEach((p) => {
      const k = (people[p.companyId] = people[p.companyId] || { us: 0, them: 0 });
      if (isColleague(p, own)) k.us++;
      else if (p.email) k.them++;
    });
    const internal = new Set(Object.keys(people).filter((id) => people[id].us >= 2 && !people[id].them));
    const byCompany = {};
    data.activities.forEach((a) => {
      if (a.companyId && a.date && ['Email', 'Call', 'Meeting'].includes(a.type)) (byCompany[a.companyId] = byCompany[a.companyId] || []).push(a);
    });
    // The first later touch after an email: their reply (any later or same-day inbound email), or yours.
    const nextTouch = (e) =>
      (byCompany[e.companyId] || [])
        .filter((a) => a.id !== e.id && a.date <= today && (a.date > e.date || (a.date === e.date && a.inbound)))
        .sort((a, b) => a.date.localeCompare(b.date))[0];
    const add = [];
    const seen = new Set();
    data.activities.forEach((e) => {
      if (e.type !== 'Email' || e.inbound || !e.companyId || !e.date || e.date < since || e.date > today) return;
      const c = companies[e.companyId];
      if (!c || openDeal.has(c.id) || e.dealId || internal.has(c.id) || !isProspect(c)) return;
      const id = 'wf-fu-' + c.id + '-' + e.date;
      if (seen.has(id) || created.has(id)) return;
      const prior = (byCompany[c.id] || []).some((a) => a.id !== e.id && a.date < e.date && a.date >= addDays(e.date, -60));
      if (prior || RESPONDED.includes(e.outcome) || nextTouch(e)) return;
      seen.add(id);
      const p = contactAt(e.contactId, c.id);
      const due = addDays(e.date, days);
      add.push({
        id,
        type: 'Task',
        date: due,
        followUpDate: due,
        companyId: c.id,
        contactId: p ? p.id : '',
        subject: 'Send follow-up email to ' + (p && p.firstName ? p.firstName + ' at ' : '') + c.name,
        notes: `Automatic: no reply yet to "${String(e.subject || '').replace(/^Reply: /, '')}" sent ${fmtDate(e.date)}.`,
        workflow: 'follow-up',
        workflowEmailId: e.id,
        done: false,
      });
    });
    const emails = {};
    data.activities.forEach((a) => (emails[a.id] = a));
    const complete = [];
    data.activities.forEach((t) => {
      if (t.workflow !== 'follow-up' || t.done) return;
      const e = emails[t.workflowEmailId] || { id: t.workflowEmailId, companyId: t.companyId, date: addDays(t.followUpDate, -days) };
      const next = nextTouch(e);
      if (!next) {
        const p = contactAt(t.contactId, t.companyId);
        const c = companies[t.companyId];
        const subject = c && 'Send follow-up email to ' + (p && p.firstName ? p.firstName + ' at ' : '') + c.name;
        if (c && ((p ? p.id : '') !== (t.contactId || '') || (/^Send follow-up email to /.test(t.subject || '') && t.subject !== subject)))
          complete.push({ id: t.id, contactId: p ? p.id : '', subject });
        return;
      }
      const how = next.inbound ? 'they replied' : next.type === 'Email' ? 'you followed up' : 'you ' + (next.type === 'Call' ? 'called' : 'met');
      complete.push({ id: t.id, done: true, notes: (t.notes ? t.notes + '\n' : '') + `Closed automatically: ${how} on ${fmtDate(next.date)}.` });
    });
    return { add, complete };
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
    data.contacts.forEach((c) => !isColleague(c, opts.internalDomain) && (contactsBy[c.companyId] = contactsBy[c.companyId] || []).push(c));
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

    // Shared-list companies are yours to work only when you lead them (or share the lead).
    const mine = (c) => !c.sharedList || (!c.listRemoved && (c.listLead === 'Both' || (Boolean(opts.initials) && c.listLead === opts.initials)));
    const leads = data.companies.filter((c) => !dealCompanies.has(c.id) && !snoozed(c) && !doNotContact(c) && isProspect(c) && mine(c));
    // Prospecting one submarket at a time: outreach and stats lists can be narrowed to it (with a longer list).
    const subKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    // Office and industrial use different maps, so the filter is "Office|CP" or "Industrial|Stone Mountain".
    const subAsset = (c) => (c.assetClass === 'Industrial' ? 'Industrial' : 'Office');
    const [wantAsset, wantName] = String(opts.submarket || '').includes('|') ? opts.submarket.split('|') : ['', opts.submarket];
    // Grouped under the clean names (saved clean-up first, then the suggestion) even before the companies are renamed.
    const subName = (c) => {
      const mapped = mapSubmarket(c.submarket, opts.submarketMap, subAsset(c));
      return mapped !== c.submarket ? mapped : suggestSubmarket(mapped, subAsset(c)) || mapped;
    };
    const inSub = (c) => !opts.submarket || (subKey(subName(c)) === subKey(wantName) && (!wantAsset || subAsset(c) === wantAsset));
    const subCounts = {};
    leads.forEach((c) => c.submarket && (subCounts[subAsset(c) + '|' + subName(c)] = (subCounts[subAsset(c) + '|' + subName(c)] || 0) + 1));
    const submarkets = Object.keys(subCounts)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, asset: value.split('|')[0], name: value.split('|').slice(1).join('|'), n: subCounts[value] }));
    const dayGoal = opts.submarket ? Math.max(goal, 25) : goal;
    // Leases expiring within two years come first: those tenants need to start planning.
    const soon = (c) => {
      const m = c.leaseExpiration ? monthsUntil(c.leaseExpiration, today) : null;
      return m !== null && m >= 0 && m <= 24 ? 0 : 1;
    };
    const leaseNote = (c) => {
      const m = c.leaseExpiration ? monthsUntil(c.leaseExpiration, today) : null;
      return m === null ? '' : m < 0 ? ` · lease expired ${fmtDate(c.leaseExpiration)}` : ` · lease expires in ${fmtMonths(m)}`;
    };

    // Opened but unanswered emails from the last 3 weeks, where nothing has happened since: follow up while it's warm.
    const opened = data.activities
      .filter((a) => a.type === 'Email' && (parseNumber(a.opens) || 0) > 0 && !responded(a) && a.date && a.date >= addDays(today, -21) && a.date <= today)
      .filter((a) => companies[a.companyId] && !doNotContact(companies[a.companyId]) && isProspect(companies[a.companyId]) && !snoozed(companies[a.companyId]) && touches[a.companyId] === a.date)
      .sort((a, b) => (parseNumber(b.opens) || 0) - (parseNumber(a.opens) || 0) || b.date.localeCompare(a.date))
      .map((a) => {
        const contact = data.contacts.find((p) => p.id === a.contactId && p.companyId === a.companyId && !isColleague(p, opts.internalDomain)) || bestContact(a.companyId);
        const n = parseNumber(a.opens);
        return {
          kind: 'opened',
          activityId: a.id,
          companyId: a.companyId,
          contactId: contact ? contact.id : '',
          title: companies[a.companyId].name,
          channel: reachChannel(contact),
          linkedin: contact && contact.linkedin && !contact.linkedinConnected ? contact.linkedin : '',
          why: `Opened "${a.subject}" ${n === 1 ? 'once' : n + ' times'} (sent ${fmtDate(a.date)}), no reply yet.`,
        };
      });
    const openedIds = new Set(opened.map((o) => o.companyId));
    const expiry = (c) => c.leaseExpiration || '9999-12-31';
    const outreachItem = (c, why) => {
      const contact = bestContact(c.id);
      return { kind: 'outreach', companyId: c.id, contactId: contact ? contact.id : '', title: c.name, stage: leadStage(c), temp: c.leadTemp || '', channel: reachChannel(contact), why };
    };

    const followUps = leads
      .filter((c) => {
        if (openedIds.has(c.id) || !inSub(c)) return false;
        const wait = FOLLOW_UP_DAYS[leadStage(c)];
        const since = sinceTouch(c.id);
        return wait && (since === null || since >= wait);
      })
      .sort(
        (a, b) =>
          soon(a) - soon(b) ||
          TEMP_RANK[a.leadTemp || ''] - TEMP_RANK[b.leadTemp || ''] ||
          expiry(a).localeCompare(expiry(b)) ||
          (sinceTouch(b.id) === null ? 1e9 : sinceTouch(b.id)) - (sinceTouch(a.id) === null ? 1e9 : sinceTouch(a.id))
      )
      .map((c) => {
        const since = sinceTouch(c.id);
        return outreachItem(c, `${leadStage(c)} · ${since === null ? 'no touch logged' : 'last touch ' + since + ' days ago'}${leaseNote(c)}`);
      });

    const fresh = leads
      .filter((c) => leadStage(c) === 'New' && inSub(c) && !(sinceTouch(c.id) !== null && sinceTouch(c.id) < 30))
      .map((c) => ({ c, score: prospectScore(c, { today, lastActivityDate: touches[c.id] }).score }))
      .sort((a, b) => soon(a.c) - soon(b.c) || b.score - a.score || expiry(a.c).localeCompare(expiry(b.c)))
      .map(({ c }) => {
        const m = monthsUntil(c.leaseExpiration, today);
        return outreachItem(c, 'First touch' + (m === null ? '' : m < 0 ? ` · lease expired ${fmtDate(c.leaseExpiration)}` : ` · lease expires in ${fmtMonths(m)}`));
      });

    // Keep about a third of the day for brand-new leads so the top of the funnel keeps filling.
    const newSlots = Math.min(fresh.length, Math.max(Math.ceil(dayGoal / 3), dayGoal - followUps.length));
    const outreach = followUps.slice(0, dayGoal - newSlots).concat(fresh.slice(0, newSlots));

    // Prospects you've reached before who haven't had the latest quarter's stats: a ready reason to get back in touch.
    const statsShare = [];
    if ((opts.marketStats || []).length) {
      const inToday = new Set(outreach.map((o) => o.companyId));
      const qEnd = (q) => {
        const m = /^([1-4])Q(\d{2})$/.exec(q || '');
        return m ? toISODate(new Date(2000 + Number(m[2]), Number(m[1]) * 3, 0)) : '';
      };
      leads
        .filter((c) => inSub(c) && touches[c.id] && sinceTouch(c.id) >= 14 && !openedIds.has(c.id) && !inToday.has(c.id) && leadStage(c) !== 'Dead Lead')
        .forEach((c) => {
          const m = marketStatFor(opts.marketStats, c, opts.marketReports);
          if (!m) return;
          const end = qEnd(m.current.quarter);
          const sent = data.activities.some((a) => a.companyId === c.id && a.date > end && (a.template === 'Market update' || /market update|\b[1-4]Q\d{2}\b/i.test(a.subject || '')));
          if (sent) return;
          const v = marketValues(m, c);
          const contact = bestContact(c.id);
          statsShare.push({
            kind: 'stats',
            companyId: c.id,
            contactId: contact ? contact.id : '',
            title: c.name,
            quarter: m.current.quarter,
            area: v.StatsArea,
            exact: m.current.submarket !== 'Market total',
            why: `${m.current.quarter} ${v.StatsArea} ${String(m.current.assetClass || '').toLowerCase()}: vacancy ${v.Vacancy}${v.VacancyChange ? ' (' + v.VacancyChange + ')' : ''}${v.AskingRent ? ', ' + v.AskingRent : ''} · last touch ${sinceTouch(c.id)} days ago${leaseNote(c)}`,
            sortSoon: soon(c),
            sortExp: expiry(c),
          });
        });
      statsShare.sort((a, b) => a.sortSoon - b.sortSoon || b.exact - a.exact || a.sortExp.localeCompare(b.sortExp));
    }

    const care = clientTouchpoints(data.deals, { today, touches, criticalDates: data.criticalDates }).due.filter((p) => !snoozed(companies[p.companyId]));

    const updates = [];
    openDeals.forEach((d) => {
      if (!dealSizeLabel(d))
        updates.push({ kind: 'update', dealId: d.id, companyId: d.companyId, title: d.name, why: 'No RSF on this deal yet. Add the size (a range is fine).' });
    });
    data.companies.forEach((c) => {
      if (leadStage(c) === 'Secured Lead' && !dealCompanies.has(c.id) && !doNotContact(c))
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
      opened,
      care,
      deals,
      outreach,
      statsShare: statsShare.slice(0, opts.submarket ? 25 : 10),
      submarkets,
      updates: updates.slice(0, 8),
      doorKnock,
      remaining: { followUps: followUps.length, fresh: fresh.length, updates: updates.length, statsShare: statsShare.length },
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

  // Quarterly market stats from Research (one row per submarket, plus a market total row).
  const MARKET_STAT_ALIASES = {
    submarket: ['submarket', 'sub market', 'market', 'submarket name', 'area', 'geography', 'cluster'],
    assetClass: ['asset class', 'property type', 'product type', 'type', 'sector'],
    quarter: ['quarter', 'period', 'qtr'],
    inventory: ['inventory', 'total inventory', 'inventory sf', 'rba', 'total rba', 'existing inventory', 'total sf', 'building sf'],
    vacancy: ['vacancy', 'vacancy rate', 'total vacancy', 'total vacancy rate', 'vacancy %', 'vac rate', 'direct vacancy', 'direct vacancy rate', 'vacant %'],
    availability: ['availability', 'availability rate', 'total availability', 'available %'],
    netAbsorption: ['net absorption', 'qtr net absorption', 'current qtr net absorption', 'quarterly net absorption', 'net absorption sf', 'absorption', 'current quarter net absorption'],
    ytdAbsorption: ['ytd net absorption', 'ytd absorption', 'net absorption ytd', 'year to date net absorption'],
    underConstruction: ['under construction', 'under construction sf', 'construction', 'uc sf', 'u/c'],
    deliveries: ['deliveries', 'qtr deliveries', 'deliveries sf', 'completions', 'ytd deliveries'],
    askingRent: ['asking rent', 'avg asking rent', 'average asking rent', 'gross asking rent', 'asking rent /sf', 'avg asking rent /sf', 'direct asking rent', 'asking rate', 'average asking rate', 'rent', 'avg rent'],
    leasingActivity: ['leasing activity', 'total leasing', 'leasing volume', 'gross leasing', 'qtr leasing activity'],
  };

  // "3Q26" from "3Q 2026", "Q3 2026", "2026 Q3", "3Q26" or a date, or ''.
  function normalizeQuarter(v) {
    const s = String(v || '').toUpperCase();
    let m;
    if ((m = /\b([1-4])\s*Q\s*'?(\d{4}|\d{2})\b/.exec(s))) return m[1] + 'Q' + m[2].slice(-2);
    if ((m = /\bQ\s*([1-4])\s*[-' ]?\s*(\d{4}|\d{2})\b/.exec(s))) return m[1] + 'Q' + m[2].slice(-2);
    if ((m = /\b(\d{4})\s*[-_ ]?\s*Q([1-4])\b/.exec(s))) return m[2] + 'Q' + m[1].slice(-2);
    const d = normalizeDate(v);
    return d ? quarterOf(d) : '';
  }

  // Research covers three product types; flex/R&D reports are their own niche series.
  const RESEARCH_ASSETS = ['Office', 'Industrial', 'Flex'];
  const researchAsset = (v) => (/flex|r&d/i.test(String(v || '')) ? 'Flex' : normalizeAssetClass(v) === 'Industrial' ? 'Industrial' : normalizeAssetClass(v) ? 'Office' : '');
  const isMarketTotal = (sub) => !sub || /^(total|market|market total|metro|overall|atlanta( total| metro)?|all submarkets|grand total)$/i.test(String(sub).trim());

  // ---------- Research PDF reports ----------
  // Quarterly brokerage research reports, as text lines laid out like the page (columns kept apart by runs of spaces).
  // Reads the "Submarket Statistics" table, the Market Observations bullets and each submarket's Current Conditions.
  const STAT_COLUMNS = [
    ['inventory', /Inventory/i],
    ['underConstruction', /\bUnder\b/i],
    ['vacancy', /Vacancy|\bTotal\b(?!\s+Inventory)/i],
    ['netAbsorption', /Qtr\.?\s+(Net\s+)?Absorption/i],
    ['ytdAbsorption', /YTD\s+(Net\s+)?Absorption/i],
    ['classARent', /Class\s+A\b/i],
    ['classBRent', /Class\s+B\b/i],
    ['whRent', /WH\s*\/\s*Dist/i],
    ['flexRent', /R&D\s*\/\s*Flex/i],
    ['askingRent', /Average\s+Direct\s+Asking|Direct\s+Asking\s+Rent|Average\s+Asking/i],
  ];
  const DEFAULT_STAT_ORDER = {
    Office: ['inventory', 'underConstruction', 'vacancy', 'netAbsorption', 'ytdAbsorption', 'classARent', 'classBRent', 'askingRent'],
    Industrial: ['inventory', 'underConstruction', 'vacancy', 'netAbsorption', 'ytdAbsorption', 'whRent', 'flexRent', 'askingRent'],
    Flex: ['inventory', 'underConstruction', 'vacancy', 'netAbsorption', 'ytdAbsorption', 'askingRent'],
  };
  // A page footer: a letter-spaced firm name and a page number ("F I R M   16").
  const PAGE_FOOTER = /^\s*(?:[A-Z]{1,2}\s){3,}[A-Z]{0,2}\s+\d{1,3}\s*$/;
  const QUARTER_WORDS = { first: 1, second: 2, third: 3, fourth: 4 };

  // A table row: the name runs to the last word with a letter in it; the rest are values ("-" = none).
  function statRow(line) {
    const tokens = String(line).trim().replace(/(\d)\s+%/g, '$1%').split(/\s+/);
    let i = tokens.length - 1;
    while (i >= 0 && !/[a-z]/i.test(tokens[i])) i--;
    const values = tokens.slice(i + 1);
    if (i < 0 || values.length < 5 || !values.every((v) => /^(-?\$?[\d,]+(\.\d+)?%?|-)$/.test(v))) return null;
    return { name: tokens.slice(0, i + 1).join(' '), values: values.map((v) => (v === '-' ? null : v)) };
  }

  // Bullets in a block of lines: "•" or "–" starts one, indented lines continue it. `slice` picks the column.
  function bulletsIn(lines, slice) {
    const out = [];
    let cur = null;
    lines.forEach((raw) => {
      const line = slice ? slice(raw) : raw;
      const start = line.search(/\S/);
      if (start < 0) return;
      const m = /^\s*[•●▪–]\s+(.*)$/.exec(line);
      const text = (m ? m[1] : line.trim()).split(/\s{3,}/)[0].trim();
      if (m) {
        if (cur) out.push(cur);
        cur = text;
      } else if (cur !== null && start <= 12 && text) cur += ' ' + text;
      else if (cur !== null && start > 12) return;
    });
    if (cur) out.push(cur);
    return out.map((b) => b.replace(/\s+/g, ' ').replace(/(\w)- (\w)/g, '$1-$2').trim()).filter((b) => b.length > 20);
  }

  // Positioned text from a PDF page ({ str, x, y, w }) → lines laid out like the page: items on the same baseline
  // join into one line, placed at a column proportional to x, so table columns and page columns stay apart.
  function layoutLines(items) {
    items = (items || []).filter((it) => it && String(it.str || '').trim());
    if (!items.length) return [];
    const widths = items.filter((it) => String(it.str).trim().length >= 3 && it.w > 0).map((it) => it.w / String(it.str).length).sort((a, b) => a - b);
    const cw = (widths[Math.floor(widths.length / 2)] || 5) * 0.9;
    const rows = [];
    items
      .slice()
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .forEach((it) => {
        const row = rows.find((r) => Math.abs(r.y - it.y) <= 2);
        if (row) row.items.push(it);
        else rows.push({ y: it.y, items: [it] });
      });
    const minX = Math.min(...items.map((it) => it.x));
    return rows.map((r) => {
      let line = '';
      let end = -Infinity;
      r.items
        .sort((a, b) => a.x - b.x)
        .forEach((it) => {
          const col = Math.max(0, Math.round((it.x - minX) / cw));
          const str = String(it.str);
          if (it.x - end < cw * 0.6 && line) line += str;
          else line = (line + ' '.repeat(Math.max(line ? 1 : 0, col - line.length))) + str;
          end = it.x + (it.w || str.length * cw);
        });
      return line.replace(/\s+$/, '');
    });
  }

  // "Custom I-85 NE Corridor" → "I-85 NE Corridor".
  const cleanSubmarketName = (n) => String(n || '').replace(/^\s*custom\s+/i, '').trim();

  // Headline tiles: a line of values over a line of labels ("4.2 MSF   23.3%" / "Total Inventory   Total Vacancy Rate").
  function snapshotTiles(lines) {
    const at = lines.findIndex((l) => /Total Inventory|Vacancy Rate/i.test(l) && /\s{3,}/.test(l));
    if (at < 1) return {};
    const cells = (l) => {
      const out = [];
      const re = /\S+(?: \S+)*/g;
      let m;
      while ((m = re.exec(l))) out.push({ text: m[0], at: m.index + m[0].length / 2 });
      return out;
    };
    const labels = cells(lines[at]);
    const values = cells(lines.slice(0, at).reverse().find((l) => /\d/.test(l)) || '');
    const field = (t) =>
      /inventory/i.test(t) ? 'inventory' : /vacancy/i.test(t) ? 'vacancy' : /asking/i.test(t) ? 'askingRent' : /ytd.*absorption/i.test(t) ? 'ytdAbsorption' : /absorption/i.test(t) ? 'netAbsorption' : /under construction/i.test(t) ? 'underConstruction' : /availability/i.test(t) ? 'availability' : '';
    const out = {};
    labels.forEach((lab) => {
      const k = field(lab.text);
      if (!k || !values.length) return;
      const v = values.slice().sort((a, b) => Math.abs(a.at - lab.at) - Math.abs(b.at - lab.at))[0];
      if (v && /\d/.test(v.text)) out[k] = v.text;
    });
    return out;
  }

  // What Research's bullets say in numbers: this quarter's net absorption and the change from last quarter.
  function bulletFacts(bullets) {
    const out = {};
    (bullets || []).forEach((b) => {
      let m;
      if (out.netAbsorption === undefined && (m = /net absorption (?:totaled|was|of|reached|came in at|amounted to)\s+(negative |positive )?(-?[\d,.]+)\s*(MSF|SF)[^.]*?(?:quarter|quarterly)/i.exec(b))) {
        const n = parseNumber(m[2]) * (/MSF/i.test(m[3]) ? 1e6 : 1);
        out.netAbsorption = /negative/i.test(m[1] || '') ? -Math.abs(n) : n;
      }
      if (out.vacancyBps === undefined) {
        if ((m = /vacancy(?: rate)?[^.]*?\b(rose|increased|ticked up|edged up|climbed|grew|jumped|up|declined|decreased|fell|dropped|edged down|ticked down|compressed|down)\b[^.]*?(\d+)[- ]basis[- ]points?[^.]*?quarter[- ]over[- ]quarter/i.exec(b)))
          out.vacancyBps = (/rose|increased|up|climbed|grew|jumped/i.test(m[1]) ? 1 : -1) * Number(m[2]);
        else if (/vacancy rate[^.]*?(essentially )?unchanged/i.test(b)) out.vacancyBps = 0;
      }
      if (out.rentPct === undefined && (m = /asking (?:rent|rate)s?[^.]*?\b(increased|rose|climbed|edged up|grew|declined|decreased|fell|dropped|edged down)\b\s+(?:by\s+)?([\d.]+)%\s+quarter[- ]over[- ]quarter/i.exec(b)))
        out.rentPct = (/increased|rose|climbed|up|grew/i.test(m[1]) ? 1 : -1) * Number(m[2]);
    });
    return out;
  }

  // The "Notable Lease Transactions" table on a submarket page: building, tenant, type and size.
  function notableLeases(lines) {
    const at = lines.findIndex((l) => /Notable Lease Transactions/i.test(l));
    if (at < 0) return [];
    const from = Math.max(0, lines[at].search(/Notable Lease Transactions/i) - 4);
    const sale = lines[at].search(/Notable Sale/i);
    const to = sale > from ? sale - 2 : undefined;
    const out = [];
    lines.slice(at + 1, at + 30).forEach((l) => {
      if (/Source:/i.test(l) || PAGE_FOOTER.test(l)) return;
      const seg = l.slice(from, to).trim();
      // Tenant and type can sit just one space apart, so the type is found by its wording.
      // A tenant name that wraps onto another line leaves the tenant blank here.
      const m = /^(.+?)\s{2,}(?:(.+?)\s+)?((?:Direct |Sublease )?(?:New|Renewal|Expansion|Extension|Relocation|Sublease|Direct|Pre-?lease)(?: ?[&/-]? ?(?:New|Renewal|Expansion|Extension|Relocation))*(?: Lease)?)\s{2,}([\d,]{3,})\s*$/i.exec(seg);
      if (!m || /Building Name/i.test(m[1])) return;
      let tenant = (m[2] || '').trim();
      let type = m[3].trim();
      // "Direct New" with no tenant on the line reads as tenant "Direct", type "New".
      if (/^(direct|sublease)$/i.test(tenant)) {
        type = tenant + ' ' + type;
        tenant = '';
      }
      out.push({ building: m[1].trim(), tenant, type, sf: parseNumber(m[4]) });
    });
    return out;
  }

  // The quarter before ("3Q26" → "2Q26").
  function previousQuarter(q) {
    const k = quarterKey(q);
    if (!k) return '';
    const p = k - 1;
    const n = ((p - 1) % 4) + 1;
    return n + 'Q' + String((p - n) / 4).padStart(2, '0');
  }
  // Last quarter's numbers for a row: the real row when on file, else worked back from Research's stated changes.
  function previousStat(row, stats) {
    const pq = previousQuarter(row.quarter);
    const real = (stats || []).find((x) => x.quarter === pq && x.assetClass === row.assetClass && x.submarket === row.submarket);
    if (real) return real;
    if (!row.qoq) return null;
    const out = { quarter: pq, assetClass: row.assetClass, submarket: row.submarket, derived: true };
    if (row.qoq.vacancyBps !== undefined && row.vacancy !== undefined) out.vacancy = Math.round((row.vacancy - row.qoq.vacancyBps / 100) * 100) / 100;
    if (row.qoq.rentPct !== undefined && row.askingRent) out.askingRent = Math.round((row.askingRent / (1 + row.qoq.rentPct / 100)) * 100) / 100;
    return out;
  }

  function parseResearchReport(lines, filename) {
    lines = (lines || []).map((l) => String(l).replace(/\t/g, '    '));
    const text = lines.join('\n');
    // The report's quarter: from the file name, else the "2Q26" stamped on its pages (also letter-spaced, as in
    // "3 Q 2 6 SUBMARKET SNAPSHOT"), else the latest quarter the text talks about ("the third quarter of 2026");
    // reports mention earlier quarters too, but never later ones.
    let quarter = normalizeQuarter(filename);
    if (!quarter) {
      const counts = {};
      (text.match(/\b[1-4] ?Q ?\d ?\d\b/g) || []).forEach((q) => {
        const k = q.replace(/ /g, '');
        counts[k] = (counts[k] || 0) + 1;
      });
      quarter = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || quarterKey(b) - quarterKey(a))[0] || '';
    }
    if (!quarter) {
      const said = (text.match(/\b(first|second|third|fourth) quarter of \d{4}/gi) || []).map((w) => {
        const m = /(\w+) quarter of (\d{4})/i.exec(w);
        return QUARTER_WORDS[m[1].toLowerCase()] + 'Q' + m[2].slice(2);
      });
      quarter = said.sort((a, b) => quarterKey(b) - quarterKey(a))[0] || '';
    }
    // Flex reports mention "R&D/Flex" columns like industrial ones do, so Flex is read from the file name or title.
    const assetClass = /flex/i.test(String(filename)) || /\bFlex\s+(Market|Submarket)/i.test(text)
      ? 'Flex'
      : /industrial/i.test(String(filename)) || /Industrial\s+(Market|Submarket)/i.test(text)
        ? 'Industrial'
        : 'Office';
    // The market's name is the title over the all-submarkets statistics table ("Atlanta Office Submarket Overview").
    const statsAt = lines.findIndex((l) => /Submarket Statistics/i.test(l));
    const titleLine = statsAt > 0 ? lines.slice(Math.max(0, statsAt - 3), statsAt).reverse().find((l) => /Submarket Overview/i.test(l)) : '';
    const market = (/^\s*(.+?)\s+(?:Office|Industrial|Flex|R&D\/Flex)\s+Submarket Overview/.exec(titleLine || '') || [])[1] || '';

    // Submarket Statistics table
    const rows = [];
    const at = lines.findIndex((l) => /Submarket Statistics/i.test(l));
    if (at >= 0) {
      let first = -1;
      for (let i = at + 1; i < Math.min(lines.length, at + 12); i++) if (statRow(lines[i])) { first = i; break; }
      if (first > 0) {
        const head = lines.slice(at + 1, first).find((l) => /Inventory/i.test(l)) || '';
        const order = STAT_COLUMNS.map(([k, re]) => [k, head.search(re)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([k]) => k);
        for (let i = first; i < lines.length; i++) {
          if (/Source:/i.test(lines[i]) || PAGE_FOOTER.test(lines[i])) break;
          const r = statRow(lines[i]);
          if (!r) continue;
          const keys = order.length === r.values.length ? order : DEFAULT_STAT_ORDER[assetClass];
          const rec = { submarket: r.name };
          keys.forEach((k, j) => r.values[j] !== null && r.values[j] !== undefined && (rec[k] = r.values[j]));
          const clean = cleanMarketStat(rec, { quarter, assetClass });
          ['classARent', 'classBRent', 'whRent', 'flexRent'].forEach((k) => rec[k] !== undefined && (clean[k] = firstNumber(rec[k])));
          // The table's rent is the direct asking rent; the report's text quotes the total (with sublease), which differs.
          if (/Direct\s+Asking/i.test(head)) clean.rentType = 'direct';
          rows.push(clean);
          if (clean.submarket === 'Market total') break;
        }
      }
    }

    // Market Observations: two columns of bulleted sections.
    const highlights = {};
    const obs = lines.findIndex((l) => /Market Observations/i.test(l));
    if (obs >= 0) {
      let end = lines.findIndex((l, i) => i > obs && /Table of Contents|^\s*Economy\s*$/i.test(l) && i > obs + 3);
      if (end < 0) end = Math.min(lines.length, obs + 80);
      const block = lines.slice(obs + 1, end);
      const rightStarts = block.map((l) => l.search(/\S\s*$/) > 40 ? (/^(.{40,}?\s{2,})[–•]\s/.exec(l) || [])[1] : null).filter(Boolean).map((p) => p.length);
      const col = rightStarts.length ? Math.min(...rightStarts) : 0;
      const halves = col ? [(l) => l.slice(0, col), (l) => ' '.repeat(0) + l.slice(col)] : [(l) => l];
      halves.forEach((half) => {
        let name = null;
        let chunk = [];
        const flush = () => name && chunk.length && (highlights[name] = (highlights[name] || []).concat(bulletsIn(chunk)));
        block.forEach((l) => {
          const h = half(l).trim();
          const hm = /^(Economy|Major Transactions|Leasing Market Fundamentals|Market Fundamentals|Outlook|Key Takeaways)$/i.exec(h);
          if (hm) {
            flush();
            name = hm[1];
            chunk = [];
          } else chunk.push(half(l));
        });
        flush();
      });
    }

    // Each submarket page: "<Name> Office Submarket Overview", then Current Conditions bullets in the left column.
    const submarkets = {};
    lines.forEach((l, i) => {
      const m = /^\s*(.+?)\s+(?:Office|Industrial|Flex|R&D\/Flex)\s+Submarket Overview\s*$/.exec(l);
      if (!m || m[1] === market) return;
      const cc = lines.findIndex((x, j) => j > i && j < i + 45 && /Current Conditions/i.test(x));
      if (cc < 0) return;
      let end = lines.findIndex((x, j) => j > cc && (/Submarket Overview|Source:/i.test(x) || PAGE_FOOTER.test(x)));
      if (end < 0) end = lines.length;
      const b = bulletsIn(lines.slice(cc + 1, end), (x) => (x.search(/\S/) > 12 ? '' : x));
      if (b.length) submarkets[m[1].trim()] = b;
    });
    // Single-submarket snapshot reports (e.g. a custom corridor) have no statistics table: read the headline tiles.
    const deals = {};
    lines.forEach((l, i) => {
      const m = /^\s*(.+?)\s+(?:Office|Industrial|Flex|R&D\/Flex)\s+Submarket Overview\s*$/.exec(l);
      if (!m || m[1] === market) return;
      const name = cleanSubmarketName(m[1]);
      if (!rows.some((x) => x.submarket === name)) {
        const tiles = snapshotTiles(lines.slice(i + 1, i + 12));
        if (Object.keys(tiles).length >= 2) rows.push(Object.assign(cleanMarketStat(Object.assign({ submarket: name }, tiles), { quarter, assetClass }), tiles.askingRent ? { rentType: 'total' } : {}));
      }
      let end = lines.findIndex((x, j) => j > i && /Submarket Overview/i.test(x));
      if (end < 0) end = lines.length;
      const leases = notableLeases(lines.slice(i, end));
      if (leases.length) deals[name] = leases;
    });
    // Rename bullet keys the same way, and read this quarter's absorption and the changes from last quarter.
    Object.keys(submarkets).forEach((k) => {
      const name = cleanSubmarketName(k);
      if (name !== k) {
        submarkets[name] = submarkets[k];
        delete submarkets[k];
      }
    });
    rows.forEach((row) => {
      const bullets = row.submarket === 'Market total' ? [].concat(highlights['Leasing Market Fundamentals'] || [], highlights['Market Fundamentals'] || []) : submarkets[row.submarket] || [];
      const facts = bulletFacts(bullets);
      if (row.netAbsorption === undefined && facts.netAbsorption !== undefined) row.netAbsorption = facts.netAbsorption;
      if (facts.vacancyBps !== undefined || facts.rentPct !== undefined) row.qoq = Object.assign({}, facts.vacancyBps !== undefined ? { vacancyBps: facts.vacancyBps } : {}, facts.rentPct !== undefined ? { rentPct: facts.rentPct } : {});
    });
    return { quarter, assetClass, market, rows, highlights, submarkets, deals };
  }

  // One row from a Research stats table → { quarter, assetClass, submarket, vacancy (%), askingRent ($/SF/yr), … }.
  function cleanMarketStat(rec, defaults) {
    defaults = defaults || {};
    const out = { quarter: normalizeQuarter(rec.quarter) || defaults.quarter || '', assetClass: researchAsset(rec.assetClass) || defaults.assetClass || '', submarket: String(rec.submarket || '').trim() };
    if (isMarketTotal(out.submarket)) out.submarket = 'Market total';
    const pct = (v) => {
      const n = firstNumber(v);
      if (n === null) return null;
      return !/%/.test(String(v)) && Math.abs(n) < 1 && n !== 0 ? Math.round(n * 1000) / 10 : n;
    };
    ['vacancy', 'availability'].forEach((k) => {
      const n = pct(rec[k]);
      if (n !== null) out[k] = n;
    });
    ['inventory', 'netAbsorption', 'ytdAbsorption', 'underConstruction', 'deliveries', 'leasingActivity'].forEach((k) => {
      if (rec[k] === undefined) return;
      const raw = String(rec[k]).trim();
      // (45,000) is accounting for -45,000; "1.2M" or "1.2 MSF" is millions.
      let n = firstNumber(raw.replace(/^\((.*)\)$/, '-$1'));
      if (n === null) return;
      if (/\d\s*(m|msf|mil)/i.test(raw)) n = Math.round(n * 1e6);
      else if (/\d\s*k\b/i.test(raw)) n = Math.round(n * 1e3);
      out[k] = n;
    });
    const rent = firstNumber(rec.askingRent);
    if (rent !== null) out.askingRent = /\/\s*mo|monthly/i.test(String(rec.askingRent)) ? Math.round(rent * 1200) / 100 : rent;
    return out;
  }

  // The stats that apply to a company: its submarket in the latest quarter on file (else the market total), with
  // the quarter before for comparison.
  // The report's name for a submarket the CRM spells its own way: "Midtown - West" → "Midtown",
  // "Northeast - I-85 Outside I-285" → "Northeast", "Northwest/I-75" → "Northwest/I-75 Corridor".
  function matchSubmarket(names, sub) {
    const key = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const k = key(SHORT_SUBMARKETS[String(sub || '').trim().toLowerCase()] || sub);
    if (!k) return '';
    const real = names.filter((n) => n !== 'Market total' && !/\btotal\b/i.test(n));
    const exact = real.find((n) => key(n) === k);
    if (exact) return exact;
    const head = key(String(sub).split(/\s+-\s+|\s*\(/)[0]);
    return real.find((n) => key(n) === head) || real.find((n) => key(n).startsWith(head) || head.startsWith(key(n))) || real.find((n) => key(n).startsWith(k) || k.startsWith(key(n))) || '';
  }

  // reports: imported Research PDFs ({ quarter, assetClass, highlights, submarkets }), for talking points.
  function marketStatFor(stats, company, reports) {
    // Office & Industrial (flex-type) companies use Flex numbers when they're on file.
    const has = (a) => (stats || []).some((x) => x.assetClass === a);
    const asset = company.assetClass === 'Industrial' ? 'Industrial' : company.assetClass === 'Office & Industrial' && has('Flex') ? 'Flex' : 'Office';
    const mine = (stats || []).filter((x) => x.assetClass === asset);
    if (!mine.length) return null;
    const qs = Array.from(new Set(mine.map((x) => x.quarter))).sort((a, b) => quarterKey(b) - quarterKey(a));
    const find = (q, sub) => mine.find((x) => x.quarter === q && x.submarket === sub);
    const sub = matchSubmarket(mine.filter((x) => x.quarter === qs[0]).map((x) => x.submarket), company.submarket) || 'Market total';
    const cur = find(qs[0], sub);
    if (!cur) return null;
    const report = (reports || []).find((r) => r.quarter === qs[0] && r.assetClass === asset);
    const noteName = report ? matchSubmarket(Object.keys(report.submarkets || {}), sub === 'Market total' ? '' : sub) : '';
    return {
      current: cur,
      previous: (qs[1] ? find(qs[1], sub) : null) || previousStat(cur, mine),
      market: sub === 'Market total' ? null : find(qs[0], 'Market total') || null,
      notes: noteName ? report.submarkets[noteName] : [],
      highlights: report ? report.highlights || {} : {},
    };
  }

  // Template placeholders from market stats ({Vacancy}, {VacancyChange}, {AskingRent}, {MarketStat}…).
  const MARKET_PLACEHOLDERS = ['Quarter', 'StatsArea', 'Vacancy', 'VacancyChange', 'Availability', 'AskingRent', 'RentChange', 'NetAbsorption', 'YTDAbsorption', 'UnderConstruction', 'Deliveries', 'MarketVacancy', 'MarketStat', 'ResearchNote', 'MarketTrend'];
  function marketValues(m, company) {
    if (!m) return MARKET_PLACEHOLDERS.reduce((o, k) => Object.assign(o, { [k]: '' }), {});
    const c = m.current;
    const p = m.previous;
    const pctFmt = (n) => (n === undefined || n === null ? '' : Number(n).toFixed(1) + '%');
    const sfFmt = (n) => (n === undefined || n === null ? '' : (n < 0 ? '-' : '') + fmtNumber(Math.abs(Math.round(n))) + ' SF');
    const area = c.submarket === 'Market total' ? 'Atlanta' : c.submarket;
    const asset = String(c.assetClass || company.assetClass || '').toLowerCase().replace(' & ', '/');
    let vacChange = '';
    if (p && c.vacancy !== undefined && p.vacancy !== undefined) {
      const bps = Math.round((c.vacancy - p.vacancy) * 100);
      vacChange = bps === 0 ? 'flat from ' + p.quarter : (bps < 0 ? 'down ' : 'up ') + Math.abs(bps) + ' bps from ' + p.quarter;
    }
    let rentChange = '';
    if (p && c.askingRent && p.askingRent) {
      const ch = ((c.askingRent - p.askingRent) / p.askingRent) * 100;
      rentChange = Math.abs(ch) < 0.05 ? 'flat from ' + p.quarter : (ch < 0 ? 'down ' : 'up ') + Math.abs(ch).toFixed(1) + '% from ' + p.quarter;
    }
    const parts = [];
    if (c.vacancy !== undefined) parts.push(area + ' ' + asset + ' vacancy was ' + pctFmt(c.vacancy) + ' in ' + c.quarter + (vacChange ? ', ' + vacChange : ''));
    if (c.askingRent) parts.push((c.rentType === 'direct' ? 'direct ' : '') + 'asking rents averaged $' + Number(c.askingRent).toFixed(2) + '/SF' + (rentChange ? ' (' + rentChange + ')' : ''));
    if (c.netAbsorption !== undefined) parts.push('net absorption was ' + sfFmt(c.netAbsorption));
    let sentence = parts.length ? parts.slice(0, -1).join(', ') + (parts.length > 1 ? ' and ' : '') + parts[parts.length - 1] + '.' : '';
    sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
    return {
      Quarter: c.quarter,
      StatsArea: area,
      Vacancy: pctFmt(c.vacancy),
      VacancyChange: vacChange,
      Availability: pctFmt(c.availability),
      AskingRent: c.askingRent ? '$' + Number(c.askingRent).toFixed(2) + '/SF' : '',
      RentChange: rentChange,
      NetAbsorption: sfFmt(c.netAbsorption),
      YTDAbsorption: sfFmt(c.ytdAbsorption),
      UnderConstruction: sfFmt(c.underConstruction),
      Deliveries: sfFmt(c.deliveries),
      MarketVacancy: m.market ? pctFmt(m.market.vacancy) : pctFmt(c.vacancy),
      MarketStat: sentence,
      // Research's own words on the submarket (the vacancy line when there is one) and on the market.
      ResearchNote: (m.notes || []).find((b) => /vacancy/i.test(b)) || (m.notes || [])[0] || '',
      MarketTrend: ((m.highlights || {})['Leasing Market Fundamentals'] || [])[0] || '',
    };
  }

  // One submarket boiled down: plain-English points comparing it with the market and its own last quarter, and a
  // short paragraph to send a client. stats: all rows; picks the latest quarter on file for the asset class.
  function submarketBrief(stats, assetClass, submarket, quarter) {
    const mine = (stats || []).filter((x) => x.assetClass === assetClass);
    const qs = Array.from(new Set(mine.map((x) => x.quarter))).sort((a, b) => quarterKey(b) - quarterKey(a));
    const q = quarter || qs[0];
    const prevQ = qs[qs.indexOf(q) + 1];
    const row = mine.find((x) => x.quarter === q && x.submarket === submarket);
    if (!row) return null;
    const market = mine.find((x) => x.quarter === q && x.submarket === 'Market total');
    const prevReal = prevQ ? mine.find((x) => x.quarter === prevQ && x.submarket === submarket) : null;
    const prev = prevReal || previousStat(row, mine);
    const peers = mine.filter((x) => x.quarter === q && x.submarket !== 'Market total' && !/\btotal\b/i.test(x.submarket));
    const kind = assetClass.toLowerCase();
    const sf = (n) => fmtNumber(Math.abs(Math.round(n))) + ' SF';
    const msf = (n) => (Math.abs(n) >= 1e6 ? (Math.abs(n) / 1e6).toFixed(1) + ' MSF' : sf(n));
    const ord = (n) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th');
    const isTotal = submarket === 'Market total';
    const name = isTotal ? 'The market' : submarket;
    const points = [];
    if (row.vacancy !== undefined) {
      let t = name + "'s " + kind + ' vacancy is ' + row.vacancy.toFixed(1) + '%';
      if (prev && prev.vacancy !== undefined) {
        const bps = Math.round((row.vacancy - prev.vacancy) * 100);
        t += bps === 0 ? ', unchanged from ' + prev.quarter : ', ' + (bps < 0 ? 'down ' : 'up ') + Math.abs(bps) + ' bps from ' + prev.quarter;
      }
      if (!isTotal && market && market.vacancy !== undefined) {
        const gap = Math.round((row.vacancy - market.vacancy) * 10) / 10;
        t += gap === 0 ? ', in line with the market average' : ', ' + Math.abs(gap).toFixed(1) + ' points ' + (gap > 0 ? 'above' : 'below') + ' the market average of ' + market.vacancy.toFixed(1) + '%';
      }
      if (!isTotal && peers.length > 2) {
        const rank = peers.slice().sort((a, b) => b.vacancy - a.vacancy).findIndex((x) => x === row) + 1;
        if (rank) t += ' (' + (rank === 1 ? 'the highest' : rank === peers.length ? 'the lowest' : ord(rank) + ' highest') + ' of ' + peers.length + ' submarkets)';
      }
      points.push(t + '.');
    }
    if (row.askingRent) {
      const label = (row.rentType === 'direct' ? 'Direct asking rent' : 'Asking rent') + (assetClass === 'Industrial' || assetClass === 'Flex' ? ' (NNN)' : '');
      let t = label + ' averages $' + row.askingRent.toFixed(2) + '/SF';
      if (prev && prev.askingRent) {
        const ch = ((row.askingRent - prev.askingRent) / prev.askingRent) * 100;
        t += Math.abs(ch) < 0.05 ? ', flat from ' + prev.quarter : ', ' + (ch < 0 ? 'down ' : 'up ') + Math.abs(ch).toFixed(1) + '% from ' + prev.quarter;
      }
      if (!isTotal && market && market.askingRent) {
        const d = ((row.askingRent - market.askingRent) / market.askingRent) * 100;
        t += Math.abs(d) < 0.5 ? ', about the market average' : ', ' + Math.abs(d).toFixed(0) + '% ' + (d > 0 ? 'above' : 'below') + ' the market average of $' + market.askingRent.toFixed(2);
      }
      points.push(t + '.');
    }
    const tiers = [['classARent', 'Class A'], ['classBRent', 'Class B'], ['whRent', 'Warehouse/distribution'], ['flexRent', 'R&D/flex']].filter(([k]) => row[k]);
    if (tiers.length) points.push(tiers.map(([k, l]) => l + ' at $' + row[k].toFixed(2)).join(', ') + ' per SF.');
    if (row.netAbsorption !== undefined) {
      let t = row.netAbsorption >= 0 ? 'Tenants absorbed a net ' + msf(row.netAbsorption) + ' in ' + q + ' (more move-ins than move-outs)' : 'Net absorption was negative ' + msf(row.netAbsorption) + ' in ' + q + ' (more move-outs than move-ins)';
      if (row.ytdAbsorption !== undefined) t += ', ' + (row.ytdAbsorption >= 0 ? '' : 'negative ') + msf(row.ytdAbsorption) + ' year to date';
      points.push(t + '.');
    }
    if (row.underConstruction !== undefined) points.push(row.underConstruction > 0 ? msf(row.underConstruction) + ' is under construction' + (row.inventory ? ' (' + ((row.underConstruction / row.inventory) * 100).toFixed(1) + '% of existing inventory)' : '') + '.' : 'Nothing is under construction, so no new supply is coming to compete with existing buildings.');
    if (!isTotal && row.inventory && market && market.inventory) points.push(name + ' has ' + msf(row.inventory) + ' of ' + kind + ' space, ' + ((row.inventory / market.inventory) * 100).toFixed(0) + '% of the market.');
    // A short read for a client: where it stands, and which way it's leaning.
    const lean = [];
    if (row.vacancy !== undefined && market && market.vacancy !== undefined && !isTotal) lean.push(row.vacancy > market.vacancy + 1 ? 'more availability than the market overall, which gives tenants options and leverage' : row.vacancy < market.vacancy - 1 ? 'tighter than the market overall, so quality space and landlord concessions are harder to come by' : 'about as available as the market overall');
    if (row.netAbsorption !== undefined) lean.push(row.netAbsorption >= 0 ? 'demand was positive this quarter' : 'more tenants moved out than in this quarter');
    const paragraph = points.slice(0, 2).join(' ') + (lean.length ? ' In short, ' + (isTotal ? 'the market' : submarket) + ' is ' + lean.join(', and ') + '.' : '');
    return { quarter: q, previousQuarter: prev ? prev.quarter : '', row, market: market || null, previous: prev || null, points, paragraph };
  }

  // Comp spreadsheets (CoStar exports, broker comp sheets, research tables).
  const COMP_IMPORT_ALIASES = {
    building: ['building', 'building name', 'property', 'property name', 'project', 'bldg'],
    address: ['address', 'property address', 'street address', 'building address', 'location'],
    city: ['city'],
    submarket: ['submarket', 'sub market', 'market', 'submarket name'],
    assetClass: ['asset class', 'property type', 'product type', 'asset type', 'space type', 'type of space', 'use'],
    landlord: ['landlord', 'owner', 'ownership', 'landlord name'],
    yearBuilt: ['year built', 'yr built', 'built', 'year blt'],
    clearHeight: ['clear height', 'clear ht', 'ceiling height', 'clear'],
    tenant: ['tenant', 'tenant name', 'company', 'lessee', 'occupant'],
    dealType: ['deal type', 'transaction type', 'lease type', 'type'],
    sf: ['sf', 'rsf', 'square feet', 'sq ft', 'size', 'size sf', 'leased sf', 'sf leased', 'rentable sf', 'area', 'size rsf', 'total sf'],
    signedDate: ['signed', 'signed date', 'sign date', 'lease signed', 'execution date', 'date signed', 'deal date', 'transaction date', 'date'],
    commencement: ['commencement', 'commencement date', 'lease commencement', 'start date', 'move in', 'move in date'],
    termMonths: ['term', 'term months', 'term mos', 'lease term', 'term mo', 'term yrs', 'term years'],
    leaseExpiration: ['expiration', 'expiration date', 'lease expiration', 'lxd', 'exp date', 'lease end', 'end date'],
    startingRent: ['starting rent', 'lease rate', 'rent', 'rate', 'base rent', 'contract rent', 'lease rent', 'rent/sf', 'rent psf', 'rate psf', '/sf', 'asking rent', 'initial rent', 'face rent', 'start rent', 'rental rate', 'net effective'],
    rateBasis: ['rent basis', 'rate basis', 'rate type', 'basis', 'service type', 'lease structure', 'expense structure', 'rent type'],
    escalationPct: ['escalation', 'escalations', 'annual escalation', 'bumps', 'annual increase', 'esc', 'rent escalation', 'increases'],
    freeRentMonths: ['free rent', 'free rent months', 'free rent mos', 'abatement', 'free', 'rent abatement', 'abated rent'],
    opex: ['opex', 'op ex', 'op exp', 'opex/sf', 'opex psf', 'operating expenses', 'operating expense', 'operating expenses/sf', 'expenses', 'est opex', 'estimated opex', 'nnn charges', 'nnns', 'nnn expenses', 'cam', 'cam charges', 'additional rent', 'pass throughs', 'pass-throughs'],
    tiAllowance: ['ti', 'ti allowance', 'tis', 'ti/sf', 'ti psf', 'tenant improvements', 'tia', 'improvement allowance', 'work letter'],
    source: ['source'],
    notes: ['notes', 'comments', 'remarks', 'note'],
  };

  // The first number in text like "$32.50 FS", "3 months", "$45.00 PSF" or "3.0%".
  function firstNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const m = /-?\d[\d,]*\.?\d*/.exec(String(v || '').replace(/\$\s+/g, '$'));
    return m ? parseNumber(m[0]) : null;
  }

  function normalizeRateBasis(v, fallback) {
    const s = String(v || '').toLowerCase();
    const monthly = /\/\s*mo|per month|monthly|psf\/mo|\/sf\/mo/.test(s);
    if (/nnn|triple|net net|\bnet\b|\bnn\b/.test(s)) return monthly ? 'NNN ($/SF/mo)' : 'NNN ($/SF/yr)';
    if (/\bmg\b|modified/.test(s)) return 'Modified Gross ($/SF/yr)';
    if (/\bfs\b|full service|full-service|\bfsg\b/.test(s)) return 'Full Service ($/SF/yr)';
    if (/gross/.test(s)) return monthly ? 'Gross ($/SF/mo)' : 'Full Service ($/SF/yr)';
    if (monthly) return 'NNN ($/SF/mo)';
    return fallback || '';
  }

  // One spreadsheet row → a comp record. defaults: { assetClass, source, confidential }.
  function cleanImportedComp(rec, defaults) {
    defaults = defaults || {};
    const out = {};
    ['building', 'address', 'city', 'submarket', 'landlord', 'tenant', 'source', 'notes'].forEach((k) => {
      if (rec[k] !== undefined && String(rec[k]).trim()) out[k] = String(rec[k]).trim();
    });
    if (!out.building && out.address) out.building = out.address;
    out.assetClass = normalizeAssetClass(rec.assetClass) || defaults.assetClass || '';
    // "Lease type" columns often hold the rent basis (Full Service, NNN) rather than the deal type.
    const basisInType = rec.dealType && normalizeRateBasis(rec.dealType, '') && !normalizeDealType(String(rec.dealType).replace(/lease/i, ''));
    if (rec.dealType && !basisInType && normalizeDealType(rec.dealType)) out.dealType = normalizeDealType(rec.dealType);
    ['sf', 'yearBuilt', 'clearHeight', 'tiAllowance', 'freeRentMonths', 'escalationPct', 'opex'].forEach((k) => {
      const n = firstNumber(rec[k]);
      if (n !== null) out[k] = n;
    });
    // Escalations written as a fraction (0.03) mean 3%; fixed-dollar bumps ("$0.50") aren't a percentage.
    if (out.escalationPct !== undefined && /\$/.test(String(rec.escalationPct))) {
      out.notes = [out.notes, 'Escalations: ' + String(rec.escalationPct).trim()].filter(Boolean).join(' · ');
      delete out.escalationPct;
    } else if (out.escalationPct !== undefined && out.escalationPct > 0 && out.escalationPct < 0.2 && !/%/.test(String(rec.escalationPct))) out.escalationPct = Math.round(out.escalationPct * 10000) / 100;
    // "5 yrs" and "62 mo" are clear, as is a column headed in months or years; otherwise a bare number under 12
    // is years (5 = 60 months).
    const rawTerm = String(rec.termMonths || '').trim();
    const term = parseTermMonths(rawTerm.replace(/[^0-9.a-z ]/gi, ' ').trim());
    if (term) out.termMonths = /^[\d.]+$/.test(rawTerm) && (defaults.termUnit === 'years' || (!defaults.termUnit && term < 12)) ? Math.round(term * 12) : term;
    if (rec.dealType && !basisInType && !DEAL_TYPES.includes(String(rec.dealType).trim())) out.notes = [out.notes, 'Type: ' + String(rec.dealType).trim()].filter(Boolean).join(' · ');
    if (/\d\s*-\s*\$?\d/.test(String(rec.tiAllowance || ''))) out.notes = [out.notes, 'TI: ' + String(rec.tiAllowance).trim()].filter(Boolean).join(' · ');
    const rent = firstNumber(rec.startingRent);
    if (rent !== null) out.startingRent = rent;
    out.rateBasis = normalizeRateBasis(rec.rateBasis, '') || normalizeRateBasis(rec.startingRent, '') || (basisInType ? normalizeRateBasis(rec.dealType, '') : '') || (out.assetClass === 'Industrial' ? 'NNN ($/SF/yr)' : 'Full Service ($/SF/yr)');
    ['signedDate', 'commencement', 'leaseExpiration'].forEach((k) => {
      const d = normalizeDate(rec[k]);
      if (d) out[k] = d;
    });
    if (!out.source) out.source = defaults.source || '';
    if (defaults.confidential) out.confidential = true;
    // Values filled from the import's defaults rather than the sheet, so an update leaves the existing comp's alone.
    const guessed = [];
    if (!rec.source) guessed.push('source');
    if (!normalizeAssetClass(rec.assetClass)) guessed.push('assetClass');
    if (!normalizeRateBasis(rec.rateBasis, '') && !normalizeRateBasis(rec.startingRent, '') && !basisInType) guessed.push('rateBasis');
    Object.defineProperty(out, 'guessed', { value: guessed, enumerable: false });
    return out;
  }

  const keyOf = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // "Possible Now, Inc." and "Possible Now" are the same tenant.
  const tenantKey = (v) =>
    String(v || '')
      .toLowerCase()
      .replace(/[^a-z0-9& ]/g, ' ')
      .replace(/\b(inc|llc|l l c|corp|corporation|co|company|ltd|lp|llp|pc|pllc|the)\b/g, ' ')
      .replace(/[^a-z0-9]/g, '');
  // Same building, tenant, date (signed, else commencement) and SF means the same comp.
  function compKey(c) {
    return [keyOf(c.building), tenantKey(c.tenant), c.signedDate || c.commencement || '', Math.round(parseNumber(c.sf) || 0)].join('|');
  }
  // Terms agree when every term both comps have is the same (a blank on either side doesn't count against it).
  function sameTerms(a, b) {
    return ['startingRent', 'termMonths', 'escalationPct', 'freeRentMonths', 'tiAllowance', 'opex', 'sf'].every((k) => {
      const x = parseNumber(a[k]);
      const y = parseNumber(b[k]);
      return x === null || y === null || Math.abs(x - y) < 0.005;
    });
  }

  // Sorts comps from a sheet into new ones and ones that need Maddy's call, against the CRM and earlier rows.
  //   duplicate: the same deal with the same terms (default: update the existing comp, or skip a repeat row)
  //   possible:  same tenant at the same building or size, but a different date or terms; could be an
  //              expansion, extension or a second deal, or a repeat (default: skip until approved)
  function planCompImport(comps, existing) {
    const seen = [];
    return comps.map((c, i) => {
      const t = tenantKey(c.tenant);
      const near = (o) => t && tenantKey(o.tenant) && (tenantKey(o.tenant).startsWith(t) || t.startsWith(tenantKey(o.tenant)));
      const sameSpace = (o) => keyOf(o.building) === keyOf(c.building) || (keyOf(o.address) && keyOf(o.address) === keyOf(c.address)) || Math.abs((parseNumber(o.sf) || 0) - (parseNumber(c.sf) || -1)) <= 0.02 * (parseNumber(c.sf) || 0);
      const check = (list, where) => {
        const exact = list.find((o) => compKey(o) === compKey(c));
        if (exact && sameTerms(exact, c)) return { status: 'duplicate', where, match: exact, reason: 'Same tenant, building, size and terms' };
        // The same deal saved earlier without its rent (e.g. from an older import): fill it in rather than hold it.
        if (exact && where === 'crm' && parseNumber(exact.startingRent) === null && parseNumber(c.startingRent) !== null)
          return { status: 'duplicate', where, match: exact, reason: 'Same deal; the CRM copy is missing its rent and terms' };
        const close = exact || list.find((o) => near(o) && sameSpace(o));
        if (close) {
          const diffs = [];
          if ((close.signedDate || '') !== (c.signedDate || '')) diffs.push('date');
          if (Math.round(parseNumber(close.sf) || 0) !== Math.round(parseNumber(c.sf) || 0)) diffs.push('size');
          if (!sameTerms(close, c)) diffs.push('terms');
          return { status: 'possible', where, match: close, reason: 'Same tenant' + (keyOf(close.building) === keyOf(c.building) ? ' and building' : '') + (diffs.length ? '; different ' + diffs.join(', ') : '') };
        }
        return null;
      };
      // A clash inside the sheet comes first, so a second row can't quietly overwrite what the first one set.
      const res = check(seen, 'file') || check(existing, 'crm') || { status: 'new' };
      seen.push(Object.assign({ row: i }, c));
      return Object.assign({ comp: c }, res);
    });
  }

  // Lines up the comps in a sheet with the CRM's, so the CRM can be made to match the sheet exactly.
  // Each sheet row is paired with the CRM comp for the same tenant at the same building/address (or size), whatever
  // its terms say, since earlier imports may have saved them wrong. Returns:
  //   matched: [{ row, comp, existing, diffs: [{ field, crm, file }] }]   (diffs empty = already aligned)
  //   missing: [{ row, comp, repeatOf }]   sheet rows not in the CRM (repeatOf: an earlier row for the same deal)
  //   extras:  [{ existing, leftover }]    CRM comps of the sheet's asset classes that aren't in it; leftover = a
  //                                         second copy of a tenant that is in the sheet (likely from an old import)
  const COMP_FIELDS = ['building', 'address', 'city', 'submarket', 'assetClass', 'landlord', 'tenant', 'dealType', 'sf', 'signedDate', 'commencement', 'termMonths', 'leaseExpiration', 'startingRent', 'rateBasis', 'escalationPct', 'freeRentMonths', 'tiAllowance', 'opex', 'yearBuilt', 'clearHeight', 'notes'];
  function alignComps(comps, existing) {
    const t = (c) => tenantKey(c.tenant);
    const near = (a, b) => t(a) && t(b) && (t(a) === t(b) || t(a).startsWith(t(b)) || t(b).startsWith(t(a)));
    const place = (a, b) => (keyOf(a.building) && keyOf(a.building) === keyOf(b.building)) || (keyOf(a.address) && keyOf(a.address) === keyOf(b.address)) || (keyOf(a.address) && keyOf(a.address) === keyOf(b.building)) || (keyOf(a.building) && keyOf(a.building) === keyOf(b.address));
    const size = (a, b) => parseNumber(a.sf) && Math.abs(parseNumber(a.sf) - (parseNumber(b.sf) || 0)) <= 0.02 * parseNumber(a.sf);
    const assets = new Set(comps.map((c) => c.assetClass).filter(Boolean));
    const pool = (existing || []).filter((e) => !assets.size || assets.has(e.assetClass) || !e.assetClass);
    const used = new Set();
    const same = (a, b) => {
      const x = a === undefined || a === null ? '' : a;
      const y = b === undefined || b === null ? '' : b;
      if (parseNumber(x) !== null && parseNumber(y) !== null && typeof x !== 'boolean') return Math.abs(parseNumber(x) - parseNumber(y)) < 0.005;
      return String(x).trim().toLowerCase() === String(y).trim().toLowerCase();
    };
    const matched = [];
    const missing = [];
    comps.forEach((c, i) => {
      // Closest match first; between equal copies, keep the fuller record (it carries your own edits).
      const score = (e) => (t(e) === t(c) ? 4 : 3) + (place(c, e) ? 2 : 0) + (size(c, e) ? 1 : 0);
      const filled = (e) => Object.keys(e).filter((k) => e[k] !== '' && e[k] !== null && e[k] !== undefined).length;
      const best = pool.filter((e) => !used.has(e.id) && near(c, e) && (place(c, e) || size(c, e))).sort((a, b) => score(b) - score(a) || filled(b) - filled(a))[0];
      if (best) {
        used.add(best.id);
        const diffs = COMP_FIELDS.filter((f) => c[f] !== undefined && c[f] !== '' && !(c.guessed || []).includes(f) && !same(c[f], best[f])).map((f) => ({ field: f, crm: best[f] === undefined ? '' : best[f], file: c[f] }));
        matched.push({ row: i, comp: c, existing: best, diffs });
      } else {
        const repeatOf = comps.findIndex((o, j) => j < i && compKey(o) === compKey(c));
        missing.push({ row: i, comp: c, repeatOf });
      }
    });
    const extras = pool.filter((e) => !used.has(e.id)).map((e) => ({ existing: e, leftover: comps.some((c) => near(c, e)) }));
    return { matched, missing, extras };
  }

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
    return String(h).toLowerCase().replace(/[_\s]+/g, ' ').replace(/[^a-z0-9#/ ]/g, '').replace(/\s*\/\s*/g, '/').trim();
  }

  function mapHeaders(headers, aliases) {
    const mapping = {};
    const normalized = headers.map(normHeader);
    const candidates = (field) => [normHeader(field)].concat(aliases[field].map(normHeader));
    Object.keys(aliases).forEach((field) => {
      const idx = normalized.findIndex((h, i) => candidates(field).includes(h) && !Object.values(mapping).includes(i));
      if (idx >= 0) mapping[field] = idx;
    });
    // Then headers with a unit tacked on, like "Total Inventory (SF)" or "Vacancy (%)".
    const bare = normalized.map((h) => h.replace(/\s*(\/?sf|psf|rsf|%|\/sf\/yr|\/sf\/mo|mos?|months|yrs?|years)$/, '').trim());
    Object.keys(aliases).forEach((field) => {
      if (mapping[field] !== undefined) return;
      const idx = bare.findIndex((h, i) => h && candidates(field).includes(h) && !Object.values(mapping).includes(i));
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

  // The header row is the one (among the first 15) that matches the most known columns, so title rows above a
  // table in a spreadsheet are skipped.
  function rowsToRecords(rows, aliases) {
    if (!rows.length) return { records: [], mapping: {}, headers: [] };
    let at = 0;
    let best = -1;
    rows.slice(0, 15).forEach((r, i) => {
      const n = Object.keys(mapHeaders(r, aliases)).length;
      if (n > best) {
        best = n;
        at = i;
      }
    });
    let headers = rows[at].map((h) => String(h === null || h === undefined ? '' : h));
    // A second header row (units like "(Mos.)", or a label missing above) is folded into the first.
    const next = (rows[at + 1] || []).map((v) => String(v === null || v === undefined ? '' : v).trim());
    const subHeader = next.some(Boolean) && next.every((v) => !v || !/\d/.test(v) || /^\(.*\)$/.test(v));
    if (subHeader) headers = headers.map((h, i) => [h.trim(), next[i] || ''].filter(Boolean).join(' ')).concat(next.slice(headers.length).filter(Boolean));
    const mapping = mapHeaders(headers, aliases);
    const records = rows.slice(at + (subHeader ? 2 : 1)).filter((r) => r.some((v) => String(v || '').trim())).map((r) => {
      const rec = {};
      Object.keys(mapping).forEach((field) => {
        const v = String(r[mapping[field]] === undefined || r[mapping[field]] === null ? '' : r[mapping[field]]).trim();
        if (v !== '') rec[field] = v;
      });
      return rec;
    });
    return { records, mapping, headers };
  }

  // submarketMap: the clean-up mapping from Companies → Submarkets.
  function cleanImportedCompany(rec, defaults, submarketMap) {
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
    if (out.submarket && submarketMap) out.submarket = mapSubmarket(out.submarket, submarketMap, out.assetClass);
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

  // Sort table rows by a column. Each column is { get(row), desc?: true, group?(row) }:
  // `desc` makes descending the column's first click, `group` ranks rows before values
  // (e.g. stale dates after current ones). Blank values always sort last.
  function sortRows(rows, columns, key, dir, tieBreak) {
    const col = columns[key];
    if (!col) return rows.slice();
    const sign = (dir || (col.desc ? 'desc' : 'asc')) === 'desc' ? -1 : 1;
    const blank = (v) => v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v));
    return rows.slice().sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      if (blank(va) !== blank(vb)) return blank(va) ? 1 : -1;
      const ga = col.group ? col.group(a) : 0;
      const gb = col.group ? col.group(b) : 0;
      if (ga !== gb) return ga - gb;
      if (!blank(va)) {
        const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
        if (d) return sign * d;
      }
      return tieBreak ? tieBreak(a, b) : 0;
    });
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
    sortRows,
    ASSET_CLASSES,
    COMPANY_STATUSES,
    DEAL_TYPES,
    DEAL_STAGES,
    OPEN_STAGES,
    normalizeDealStage,
    LEAD_STAGES,
    LEAD_TEMPS,
    leadStage,
    DO_NOT_CONTACT_REASONS,
    doNotContact,
    dailyPlan,
    rangeLabel,
    dealSizeLabel,
    dealOfficeLabel,
    dealBudgetLabel,
    quarterEndOf,
    quarterlyTasks,
    clientTouchpoints,
    RELATIONSHIPS,
    isProspect,
    planCompanyMerge,
    isColleague,
    criticalDatePoints,
    CRITICAL_DATE_KINDS,
    CRITICAL_DATE_STATUSES,
    moveInPostIdeas,
    isCoworking,
    dealLXD,
    compLXD,
    researchRequestEmail,
    coachTips,
    TEMPLATE_STEPS,
    fillTemplate,
    rentMath,
    rateText,
    quotedRateList,
    QUOTE_BASES,
    soloText,
    isSolo,
    rememberRate,
    rememberedRate,
    bracketSlots,
    templateFillIns,
    nextBusinessDays,
    meetingDays,
    suggestTemplate,
    followUpDraft,
    parseMarketHighlights,
    highlightsPost,
    marketUpdateDraft,
    RECAP_TEMPLATE,
    recapSent,
    weeklyRecap,
    recapFriday,
    recapDue,
    partnerEmails,
    emailSnippet,
    dealBrief,
    briefText,
    mailtoLink,
    LIST_COMPANY_COLUMNS,
    planListSync,
    guessTemplate,
    planHubSpotSync,
    COLLATERAL_UPGRADES,
    OUTCOMES,
    responded,
    outreachStats,
    prospectTouches,
    periodRange,
    prospectingReport,
    prospectingRecapText,
    quarterOf,
    latestDataQuarter,
    collateralStale,
    RATE_BASES,
    BUDGET_UNITS,
    RESEARCH_ASSETS,
    researchAsset,
    isMonthlyTotal,
    ACTIVITY_TYPES,
    planFollowUpTasks,
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
    COMP_IMPORT_ALIASES,
    MARKET_STAT_ALIASES,
    parseResearchReport,
    RESEARCH_SUBMARKETS,
    suggestSubmarket,
    mapSubmarket,
    previousQuarter,
    previousStat,
    bulletFacts,
    layoutLines,
    compareQuarters,
    submarketBrief,
    matchSubmarket,
    normalizeLinkedIn,
    linkedInSearchUrl,
    MARKET_PLACEHOLDERS,
    normalizeQuarter,
    cleanMarketStat,
    marketStatFor,
    marketValues,
    cleanImportedComp,
    compKey,
    planCompImport,
    alignComps,
    COMP_FIELDS,
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
