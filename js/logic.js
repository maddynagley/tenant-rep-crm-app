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
  function dealBudgetLabel(d) {
    const r = rangeLabel(d.budgetRate, d.budgetRateMax, (n) => '$' + Number(n).toFixed(2).replace(/\.00$/, ''));
    return r ? r + '/SF' + (d.rateBasis ? ' ' + String(d.rateBasis).replace(/\s*\(.*\)/, '') : '') : '';
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

  // Turns a bridge payload into CRM changes: activities to add or update, and last-contacted dates.
  function planHubSpotSync(payload, data) {
    const companies = {};
    const byHubspotId = {};
    data.companies.forEach((c) => {
      companies[c.id] = c;
      if (c.hubspotId) byHubspotId[String(c.hubspotId)] = c.id;
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
        if (dom && !byDomain[dom]) byDomain[dom] = p.companyId;
      }
    });
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
      for (const a of addrs) if (byEmail[a]) return byEmail[a].companyId;
      for (const a of addrs) if (byDomain[a.split('@')[1]]) return byDomain[a.split('@')[1]];
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
      for (const id of rec.contacts || []) if (at(contactsById['hs-ct-' + id])) return 'hs-ct-' + id;
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
        submarket: p.submarket || '',
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
      if (!companyId && dom) companyId = byWebsite[dom] || byDomain[dom] || '';
      if (!companyId || !companies[companyId]) return skipped++;
      const contact = Object.assign({ id: 'hs-ct-' + rec.id, companyId }, fields, { source: 'HubSpot' });
      contactsById[contact.id] = contact;
      if (email) {
        byEmail[email] = contact;
        if (dom && !byDomain[dom]) byDomain[dom] = companyId;
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
  function fillTemplate(text, ctx) {
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
      Partner: ctx.partner,
    };
    return String(text || '').replace(/\{(\w+)\}/g, (m, key) => {
      if (!(key in values)) return m;
      const v = values[key];
      return v === undefined || v === null || String(v).trim() === '' ? '[' + key + ']' : String(v).trim();
    });
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

  function mailtoLink(to, subject, body) {
    return 'mailto:' + encodeURIComponent(to || '').replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || '');
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

  // You and your colleagues (anyone at your email domain) are never the client contact to reach.
  function isColleague(p, domain) {
    return Boolean(p && domain && String(p.email || '').toLowerCase().endsWith('@' + String(domain).toLowerCase()));
  }

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
      if (!c || openDeal.has(c.id) || e.dealId || internal.has(c.id)) return;
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
    const leads = data.companies.filter((c) => !dealCompanies.has(c.id) && !snoozed(c) && !doNotContact(c) && mine(c));

    // Opened but unanswered emails from the last 3 weeks, where nothing has happened since: follow up while it's warm.
    const opened = data.activities
      .filter((a) => a.type === 'Email' && (parseNumber(a.opens) || 0) > 0 && !responded(a) && a.date && a.date >= addDays(today, -21) && a.date <= today)
      .filter((a) => companies[a.companyId] && !doNotContact(companies[a.companyId]) && !snoozed(companies[a.companyId]) && touches[a.companyId] === a.date)
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
        if (openedIds.has(c.id)) return false;
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
    DO_NOT_CONTACT_REASONS,
    doNotContact,
    dailyPlan,
    rangeLabel,
    dealSizeLabel,
    dealBudgetLabel,
    quarterEndOf,
    quarterlyTasks,
    clientTouchpoints,
    isColleague,
    criticalDatePoints,
    CRITICAL_DATE_KINDS,
    CRITICAL_DATE_STATUSES,
    moveInPostIdeas,
    isCoworking,
    dealLXD,
    researchRequestEmail,
    coachTips,
    TEMPLATE_STEPS,
    fillTemplate,
    suggestTemplate,
    mailtoLink,
    LIST_COMPANY_COLUMNS,
    planListSync,
    guessTemplate,
    planHubSpotSync,
    COLLATERAL_UPGRADES,
    OUTCOMES,
    responded,
    outreachStats,
    quarterOf,
    latestDataQuarter,
    collateralStale,
    RATE_BASES,
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
