const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

test('monthsUntil counts whole months', () => {
  assert.equal(L.monthsUntil('2027-01-15', '2026-01-15'), 12);
  assert.equal(L.monthsUntil('2027-01-14', '2026-01-15'), 11);
  assert.equal(L.monthsUntil('2025-12-15', '2026-01-15'), -1);
  assert.equal(L.monthsUntil('2026-09-30', '2026-10-20'), -1);
  assert.equal(L.monthsUntil('', '2026-01-15'), null);
});

test('normalizeDate handles common broker spreadsheet formats', () => {
  assert.equal(L.normalizeDate('2027-03-31'), '2027-03-31');
  assert.equal(L.normalizeDate('3/31/2027'), '2027-03-31');
  assert.equal(L.normalizeDate('3/31/27'), '2027-03-31');
  assert.equal(L.normalizeDate('12/2027'), '2027-12-31');
  assert.equal(L.normalizeDate('Feb 2028'), '2028-02-29');
  assert.equal(L.normalizeDate('December 2027'), '2027-12-31');
  assert.equal(L.normalizeDate('Q2 2027'), '2027-06-30');
  assert.equal(L.normalizeDate('2027'), '2027-12-31');
  assert.equal(L.normalizeDate('46387'), '2026-12-31'); // Excel serial
  assert.equal(L.normalizeDate(''), '');
  assert.equal(L.normalizeDate('n/a'), '');
});

test('parseNumber strips currency, commas and SF suffix', () => {
  assert.equal(L.parseNumber('$1,250.50'), 1250.5);
  assert.equal(L.parseNumber('25,000 SF'), 25000);
  assert.equal(L.parseNumber(''), null);
  assert.equal(L.parseNumber('abc'), null);
});

test('expirationWindow buckets', () => {
  const today = '2026-01-01';
  assert.equal(L.expirationWindow('2026-06-30', today).key, '0-12');
  assert.equal(L.expirationWindow('2027-06-30', today).key, '13-18');
  assert.equal(L.expirationWindow('2028-06-30', today).key, '25-36');
  assert.equal(L.expirationWindow('2025-06-30', today).key, 'expired');
  assert.equal(L.expirationWindow('', today).key, 'unknown');
});

test('prospectScore favors 13-24 month expirations, size and growth', () => {
  const today = '2026-01-01';
  const hot = L.prospectScore({ leaseExpiration: '2027-06-30', sfOccupied: 120000, growthSignal: 'Growing', priority: 'A' }, { today });
  const cold = L.prospectScore({ leaseExpiration: '2032-06-30', sfOccupied: 3000, growthSignal: 'Stable', priority: 'C' }, { today, lastActivityDate: '2025-12-20' });
  assert.equal(hot.score, 100);
  assert.ok(cold.score < 25, 'cold score ' + cold.score);
  assert.equal(L.prospectScore({ status: 'Not a Fit', sfOccupied: 100000 }, { today }).score, 0);
});

test('aggregateLeaseValue applies escalations and free rent', () => {
  // 10,000 SF @ $30/yr, 24 months, no escalations = $600,000
  assert.equal(L.aggregateLeaseValue({ sf: 10000, rate: 30, termMonths: 24 }), 600000);
  // with 3% escalation: 300,000 + 309,000
  assert.equal(Math.round(L.aggregateLeaseValue({ sf: 10000, rate: 30, termMonths: 24, escalationPct: 3 })), 609000);
  // 2 months free rent removes 2/12 of year 1
  assert.equal(Math.round(L.aggregateLeaseValue({ sf: 10000, rate: 30, termMonths: 24, freeRentMonths: 2 })), 550000);
  // monthly industrial rate is annualised
  assert.equal(L.aggregateLeaseValue({ sf: 50000, rate: 1, rateBasis: 'NNN ($/SF/mo)', termMonths: 12 }), 600000);
});

test('estimatedCommission honours percentage, split and override', () => {
  const deal = { estSF: 10000, budgetRate: 30, termMonths: 60, commissionPct: 4, splitPct: 50 };
  const est = L.estimatedCommission(deal);
  assert.equal(est.aggregateValue, 1500000);
  assert.equal(est.commission, 60000);
  assert.equal(est.myShare, 30000);
  assert.equal(L.estimatedCommission(Object.assign({}, deal, { commissionOverride: 80000 })).myShare, 40000);
});

test('deal probability defaults to stage and closed stages are fixed', () => {
  assert.equal(L.dealProbability({ stage: 'LOI' }), 75);
  assert.equal(L.dealProbability({ stage: 'LOI', probability: 50 }), 50);
  assert.equal(L.dealProbability({ stage: 'Closed Won', probability: 10 }), 100);
  assert.equal(L.dealProbability({ stage: 'Closed Lost', probability: 80 }), 0);
  const w = L.weightedCommission({ stage: 'LOI', estSF: 10000, budgetRate: 30, termMonths: 60, commissionPct: 4 });
  assert.equal(w, 45000);
});

test('parseCSV handles quotes, embedded commas/newlines and CRLF', () => {
  const rows = L.parseCSV('﻿Name,Notes\r\n"Acme, Inc.","line1\nline2"\r\n"Say ""hi""",x\r\n\r\n');
  assert.deepEqual(rows, [
    ['Name', 'Notes'],
    ['Acme, Inc.', 'line1\nline2'],
    ['Say "hi"', 'x'],
  ]);
});

test('toCSV round-trips through parseCSV', () => {
  const csv = L.toCSV([{ a: 'x, y', b: 'he said "no"' }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]);
  assert.deepEqual(L.parseCSV(csv), [['A', 'B'], ['x, y', 'he said "no"']]);
});

test('CoStar-style tenant export maps to company records', () => {
  const csv = [
    'Tenant Name,Address,Submarket,SF Occupied,Expiration Date,Industry,Employees,Property Type,Landlord',
    'Acme Robotics Inc.,100 Main St,Airport,"45,000",06/30/2028,Manufacturing,120,Industrial,Big REIT',
    'Blue Law LLP,1 Tower Pl,CBD,"12,500",Dec 2027,Legal,40,Office,Tower LLC',
  ].join('\n');
  const { records, mapping } = L.rowsToRecords(L.parseCSV(csv), L.COMPANY_IMPORT_ALIASES);
  assert.ok(['name', 'address', 'submarket', 'sfOccupied', 'leaseExpiration', 'industry', 'headcount', 'assetClass', 'landlord'].every((k) => k in mapping));
  const a = L.cleanImportedCompany(records[0]);
  assert.equal(a.name, 'Acme Robotics Inc.');
  assert.equal(a.sfOccupied, 45000);
  assert.equal(a.leaseExpiration, '2028-06-30');
  assert.equal(a.assetClass, 'Industrial');
  assert.equal(a.status, 'Target');
  const b = L.cleanImportedCompany(records[1]);
  assert.equal(b.leaseExpiration, '2027-12-31');
  assert.equal(b.assetClass, 'Office');
});

test('normalizeAssetClass recognises property types', () => {
  assert.equal(L.normalizeAssetClass('Warehouse/Distribution'), 'Industrial');
  assert.equal(L.normalizeAssetClass('Medical Office'), 'Office');
  assert.equal(L.normalizeAssetClass('Flex'), 'Office & Industrial');
  assert.equal(L.normalizeAssetClass('Retail'), '');
});

test('normalizeCompanyName ignores suffixes and punctuation', () => {
  assert.equal(L.normalizeCompanyName('Acme, Inc.'), L.normalizeCompanyName('ACME'));
  assert.equal(L.normalizeCompanyName('Blue Law LLP'), 'blue law');
});

test('recommendedLeadTimeMonths scales with size', () => {
  assert.equal(L.recommendedLeadTimeMonths(5000), 12);
  assert.equal(L.recommendedLeadTimeMonths(25000), 24);
  assert.equal(L.recommendedLeadTimeMonths(150000), 36);
});

test('normalizeAddress matches the same street address written differently', () => {
  assert.equal(L.normalizeAddress('400 Market Street, Fl 12'), '400 market st');
  assert.equal(L.normalizeAddress('400 Market St Fl 12'), '400 market st');
  assert.equal(L.normalizeAddress('1500 Oak Ave., Suite 300'), '1500 oak ave');
  assert.notEqual(L.normalizeAddress('100 Main St'), L.normalizeAddress('200 Main St'));
});

test('dealResults prefers recorded actuals over estimates', () => {
  const deal = { estSF: 10000, budgetRate: 30, termMonths: 60, commissionPct: 4 };
  assert.deepEqual(L.dealResults(deal), { sf: 10000, rent: 1500000, commission: 60000, hasActuals: false });
  const closed = Object.assign({}, deal, { actualSF: 9500, totalLeaseValue: 1400000, commissionEarned: 52000 });
  assert.deepEqual(L.dealResults(closed), { sf: 9500, rent: 1400000, commission: 52000, hasActuals: true });
});

test('summarizeDeals and portfolioBreakdown total closed-deal metrics', () => {
  const deals = [
    { assetClass: 'Office', actualSF: 5000, totalLeaseValue: 1000000, commissionEarned: 40000 },
    { assetClass: 'Office', actualSF: 3000, totalLeaseValue: 600000, commissionEarned: 20000 },
    { assetClass: 'Industrial', actualSF: 100000, totalLeaseValue: 5000000, commissionEarned: 150000 },
  ];
  const t = L.summarizeDeals(deals);
  assert.equal(t.count, 3);
  assert.equal(t.sf, 108000);
  assert.equal(t.rent, 6600000);
  assert.equal(t.commission, 210000);
  assert.equal(t.avgCommission, 70000);
  const byAsset = L.portfolioBreakdown(deals, (d) => d.assetClass);
  assert.deepEqual(byAsset.map((r) => [r.key, r.count, r.commission]), [['Industrial', 1, 150000], ['Office', 2, 60000]]);
});

test('portfolio spreadsheet columns map to closed-deal fields', () => {
  const csv = 'Client,Transaction Type,Property Type,RSF,Term,Total Consideration,Commission,Lease Execution,Expiration\nAcme,Renewal,Office,"4,250",5 years,"$1,402,500","$56,100",5/15/2026,7/31/2031';
  const { records } = L.rowsToRecords(L.parseCSV(csv), L.PORTFOLIO_IMPORT_ALIASES);
  const r = records[0];
  assert.equal(r.company, 'Acme');
  assert.equal(L.normalizeDealType(r.dealType), 'Renewal');
  assert.equal(L.parseNumber(r.actualSF), 4250);
  assert.equal(L.parseNumber(r.totalLeaseValue), 1402500);
  assert.equal(L.parseNumber(r.commissionEarned), 56100);
  assert.equal(L.normalizeDate(r.closedDate), '2026-05-15');
  assert.equal(L.normalizeDate(r.newLeaseExpiration), '2031-07-31');
  assert.equal(L.parseTermMonths(r.termMonths), 60);
});

test('parseTermMonths and normalizeDealType handle common wording', () => {
  assert.equal(L.parseTermMonths('62 months'), 62);
  assert.equal(L.parseTermMonths('7.5 yrs'), 90);
  assert.equal(L.parseTermMonths('84'), 84);
  assert.equal(L.normalizeDealType('Lease Extension'), 'Renewal');
  assert.equal(L.normalizeDealType('Blend and Extend'), 'Blend & Extend');
  assert.equal(L.normalizeDealType('Direct Lease'), 'New Lease');
  assert.equal(L.normalizeDealType('Sublease'), 'Sublease');
});

const SHEET_HEADERS = ['Date Submitted', 'Quarter', 'Year', 'Tenant Name', 'TR/LL/Other', 'Type', 'Origination', 'Execution', 'Voucher', 'Building', 'Submarket', 'Vertical', 'SF', 'Outside Broker Name', 'Outside Broker Company', 'Total Consideration (Total Rent)', 'Gross Commission (Firm)', 'Gross Commission (Mine)', 'Invoice #1 Date (Lease Execution Date)', 'Invoice #2 Date (Lease Commencement Date)', 'Booked Date', '1st Inst. Cash Received', '2nd Inst. Cash Received', 'PT #', 'TRX # (Transaction ID)', 'OTT Check', 'Notes'];
const row = (o) => SHEET_HEADERS.map((h) => (o[h] === undefined ? '' : o[h]));

test('mapSheetHeaders recognises every portfolio tracker column', () => {
  const m = L.mapSheetHeaders(SHEET_HEADERS.concat(['CRM ID']));
  assert.equal(m.firmCommission, 16);
  assert.equal(m.commissionEarned, 17);
  assert.equal(m.closedDate, 18);
  assert.equal(m.leaseCommencement, 19);
  assert.equal(m.bookedDate, 20);
  assert.equal(m.trxId, 24);
  assert.equal(m.execution, 7);
  assert.equal(m.dealTypeRaw, 5);
  assert.equal(m.crmId, 27);
  assert.equal(Object.keys(m).length, 28);
});

test('two unlabeled gross commission columns: first is the firm, second is mine', () => {
  const m = L.mapSheetHeaders(['Tenant Name', 'SF', 'Gross Commission (ABC Realty)', 'Gross Commission (JD)']);
  assert.equal(m.firmCommission, 2);
  assert.equal(m.commissionEarned, 3);
  const one = L.mapSheetHeaders(['Tenant Name', 'Gross Commission']);
  assert.equal(one.commissionEarned, 1);
  assert.equal(one.firmCommission, undefined);
});

test('sheet rows become closed, rescinded or pending deals', () => {
  const m = L.mapSheetHeaders(SHEET_HEADERS);
  const won = L.sheetRecordToDeal(L.sheetRowToRecord(row({ 'Tenant Name': 'Acme', Type: 'New', Vertical: 'Flex', SF: '2,293.00', 'Total Consideration (Total Rent)': '$221,366.16', 'Gross Commission (Firm)': '$14,541.28', 'Gross Commission (Mine)': '$2,908.26', 'Invoice #1 Date (Lease Execution Date)': '5/6/2026', 'Invoice #2 Date (Lease Commencement Date)': '7/1/2026', 'OTT Check': 'N/A' }), m));
  assert.equal(won.stage, 'Closed Won');
  assert.equal(won.dealType, 'New Lease');
  assert.equal(won.assetClass, 'Office & Industrial');
  assert.equal(won.actualSF, 2293);
  assert.equal(won.totalLeaseValue, 221366.16);
  assert.equal(won.firmCommission, 14541.28);
  assert.equal(won.commissionEarned, 2908.26);
  assert.equal(won.closedDate, '2026-05-06');
  assert.equal(won.leaseCommencement, '2026-07-01');
  assert.equal(won.ottCheck, undefined);
  const lost = L.sheetRecordToDeal(L.sheetRowToRecord(row({ 'Tenant Name': 'Beta', 'Date Submitted': '8/10/2026', 'Total Consideration (Total Rent)': '$97,239.26', 'Invoice #1 Date (Lease Execution Date)': 'N/A', Notes: 'Lease has been rescinded' }), m));
  assert.equal(lost.stage, 'Closed Lost');
  assert.equal(lost.closedDate, '2026-08-10');
  const pending = L.sheetRecordToDeal(L.sheetRowToRecord(row({ 'Tenant Name': 'Gamma', Quarter: '4', Year: '2026', Vertical: 'Office' }), m));
  assert.equal(pending.stage, '');
  assert.equal(pending.closedDate, '');
  const noDate = L.sheetRecordToDeal(L.sheetRowToRecord(row({ 'Tenant Name': 'Delta', Quarter: '3', Year: '2026', 'Gross Commission (Mine)': '$100' }), m));
  assert.equal(noDate.closedDate, '2026-09-30');
});

test('planSheetSync matches existing deals, creates new ones and tracks which side changed', () => {
  const companies = [{ id: 'c1', name: 'Acme, Inc.' }, { id: 'c2', name: 'Zeta' }];
  const deals = [
    { id: 'd1', companyId: 'c1', stage: 'Closed Won', closedDate: '2026-05-15', updatedAt: '2026-01-01' },
    { id: 'd2', companyId: 'c2', stage: 'Closed Won', closedDate: '2026-03-01', inPortfolioSheet: true, updatedAt: '2026-01-01' },
  ];
  const rows = [
    { row: 2, values: row({ 'Tenant Name': 'Acme', 'Gross Commission (Mine)': '$500', 'Invoice #1 Date (Lease Execution Date)': '5/6/2026' }) },
    { row: 3, values: row({ 'Tenant Name': 'NewCo', Quarter: '4', Year: '2026' }) },
  ];
  const plan = L.planSheetSync({ headers: SHEET_HEADERS, rows, deals, companies });
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].dealId, 'd1');
  assert.equal(plan.updates[0].patch.commissionEarned, 500);
  assert.equal(plan.updates[0].needsId, true);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].deal.stage, 'Lease Negotiation');
  assert.equal(plan.appends.length, 1);
  assert.equal(plan.appends[0].record.company, 'Zeta');

  // After a sync: an unchanged row does nothing; a CRM-side edit is pushed back.
  const synced = Object.assign({}, deals[0], { sheetHash: plan.updates[0].hash, sheetSyncedAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' });
  const idRows = [{ row: 2, values: rows[0].values.concat(['d1']) }];
  const headers2 = SHEET_HEADERS.concat(['CRM ID']);
  let p2 = L.planSheetSync({ headers: headers2, rows: idRows, deals: [synced], companies });
  assert.deepEqual([p2.updates.length, p2.pushes.length], [0, 0]);
  p2 = L.planSheetSync({ headers: headers2, rows: idRows, deals: [Object.assign({}, synced, { commissionEarned: 650, updatedAt: '2026-07-01T00:00:00Z' })], companies });
  assert.equal(p2.pushes.length, 1);
  assert.equal(p2.pushes[0].record.commissionEarned, 650);
  assert.equal(p2.pushes[0].record.crmId, 'd1');
});

test('companies match on "also known as" names', () => {
  const companies = [{ id: 'a', name: 'Parent Media Inc', aliases: 'Brand Shop; Other Brand' }, { id: 'b', name: 'Brand Shop Holdings' }];
  assert.equal(L.findCompanyByName(companies, 'brand shop').id, 'a');
  assert.equal(L.findCompanyByName(companies, 'Brand Shop Holdings').id, 'b'); // an exact name beats an alias
  assert.equal(L.findCompanyByName(companies, 'Nobody'), null);
  assert.deepEqual(L.companyNameKeys(companies[0]), ['parent media', 'brand shop', 'other brand']);
});

test('a sheet row with figures closes the open deal of the aliased company', () => {
  const companies = [{ id: 'c1', name: 'Parent Media', aliases: 'Brand Shop' }];
  const deals = [{ id: 'd1', companyId: 'c1', stage: 'Lease Negotiation', updatedAt: '2026-01-01' }];
  const rows = [
    { row: 2, values: row({ 'Tenant Name': 'Brand Shop', SF: '2,449', 'Gross Commission (Mine)': '$3,613.97', Quarter: '4', Year: '2026' }) },
    { row: 3, values: row({ 'Tenant Name': 'Brand Shop', Notes: 'Coworking deal' }) },
  ];
  const plan = L.planSheetSync({ headers: SHEET_HEADERS, rows, deals, companies });
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].dealId, 'd1');
  assert.equal(plan.updates[0].patch.stage, 'Closed Won');
  assert.equal(plan.creates.length, 1, 'second row is a separate deal');
});

test('old deal stages fold into the current pipeline', () => {
  assert.deepEqual(
    L.DEAL_STAGES.map((s) => s.name),
    ['Intro Call', 'Market Survey', 'Touring', 'RFP', 'LOI', 'Lease Negotiation', 'Closed Won', 'Closed Lost']
  );
  assert.equal(L.normalizeDealStage('Rep Agreement Signed'), 'Market Survey');
  assert.equal(L.normalizeDealStage('Needs Analysis'), 'Market Survey');
  assert.equal(L.normalizeDealStage('RFP / Proposals'), 'RFP');
  assert.equal(L.normalizeDealStage('Pitching'), 'Intro Call');
  assert.equal(L.normalizeDealStage('Touring'), 'Touring');
});

test('leadStage uses the explicit stage, else infers it from status', () => {
  assert.equal(L.leadStage({ leadStage: 'Follow Up', status: 'Target' }), 'Follow Up');
  assert.equal(L.leadStage({ status: 'Target' }), 'New');
  assert.equal(L.leadStage({ status: 'Contacted' }), 'Initial Outreach');
  assert.equal(L.leadStage({ status: 'Active Client' }), '');
});

test('dailyPlan prioritizes due follow-ups, skips Do-Not-Call numbers and finds door-knock buildings', () => {
  const today = '2026-10-20';
  const data = {
    companies: [
      { id: 'a', name: 'Alpha', leadStage: 'Initial Outreach', lastContacted: '2026-10-01', address: '100 Main St, Ste 200' },
      { id: 'b', name: 'Bravo', leadStage: 'Initial Outreach', lastContacted: '2026-10-18', address: '100 Main Street Suite 900' },
      { id: 'c', name: 'Charlie', leadStage: 'New', leaseExpiration: '2027-06-30', address: '100 Main St' },
      { id: 'd', name: 'Delta', leadStage: 'Engaged', leadTemp: 'Hot', lastContacted: '2026-09-01' },
      { id: 'e', name: 'Echo', leadStage: 'Secured Lead' },
      { id: 'f', name: 'Foxtrot', leadStage: 'Follow Up', snoozeUntil: '2026-10-25' },
      { id: 'g', name: 'Golf', status: 'Active Client' },
      { id: 'h', name: 'Hotel', leadStage: 'Engaged', leadTemp: 'Hot', doNotContact: true, address: '100 Main St' },
    ],
    contacts: [
      { id: 'p1', companyId: 'a', firstName: 'Ann', mobile: '555', mobileDNC: true, email: 'ann@a.com' },
      { id: 'p2', companyId: 'd', firstName: 'Dan', phone: '777', role: 'Decision Maker' },
    ],
    deals: [
      { id: 'x', companyId: 'g', name: 'Golf renewal', stage: 'Touring', targetClose: '2026-09-30', sfMin: 3000, sfMax: 4000 },
      { id: 'y', companyId: 'g', name: 'Golf HQ', stage: 'Closed Won', actualSF: 5000 },
    ],
    activities: [{ id: 't1', companyId: 'g', date: '2026-10-19', followUpDate: '2026-10-19', subject: 'Send survey', done: false }],
  };
  const plan = L.dailyPlan(data, { today, outreachGoal: 4 });
  assert.deepEqual(plan.tasks.map((t) => t.activityId), ['t1']);
  assert.deepEqual(plan.outreach.map((o) => o.companyId), ['d', 'a', 'c'], 'hot follow-up first, Bravo was touched 2 days ago, Foxtrot is snoozed');
  assert.equal(plan.outreach[0].channel, 'Call');
  assert.equal(plan.outreach[1].channel, 'Email', 'DNC mobile is never suggested as a call');
  assert.equal(plan.outreach[2].channel, 'Find a contact');
  assert.equal(plan.deals.length, 1);
  assert.match(plan.deals[0].why, /has passed/);
  assert.deepEqual(plan.updates.map((u) => u.action || u.dealId), ['create-deal', 'y']);
  assert.deepEqual(plan.doorKnock[0].companyIds, ['c', 'a'], 'Bravo was touched this week');
});

test('outreachStats measures response rates per group', () => {
  const acts = [
    { type: 'Email', template: 'Market update', opens: 3, outcome: 'Replied' },
    { type: 'Email', template: 'Market update', opens: 1 },
    { type: 'Email', template: 'Following up', opens: 0, replies: 0 },
    { type: 'Call', outcome: 'Meeting booked' },
    { type: 'Note', outcome: 'Replied' },
  ];
  const byTemplate = L.outreachStats(acts, (a) => a.template);
  const mu = byTemplate.find((g) => g.key === 'Market update');
  assert.equal(mu.sent, 2);
  assert.equal(mu.responseRate, 0.5);
  assert.equal(mu.openRate, 1);
  const call = L.outreachStats(acts, (a) => a.type).find((g) => g.key === 'Call');
  assert.equal(call.meetings, 1);
  assert.equal(L.outreachStats(acts, (a) => a.type).reduce((t, g) => t + g.sent, 0), 4, 'notes are not outreach');
});

test('collateral is stale once a newer quarter of market data is out', () => {
  assert.equal(L.latestDataQuarter('2026-10-20'), '3Q26');
  assert.equal(L.latestDataQuarter('2027-01-05'), '4Q26');
  assert.equal(L.collateralStale({ dataQuarter: '2Q26' }, '2026-10-20'), true);
  assert.equal(L.collateralStale({ dataQuarter: '3Q26' }, '2026-10-20'), false);
  assert.equal(L.collateralStale({ dataQuarter: '2Q26', status: 'Retired' }, '2026-10-20'), false);
});

test('dailyPlan surfaces opened-but-unanswered emails ahead of routine follow-ups', () => {
  const data = {
    companies: [
      { id: 'a', name: 'Alpha', leadStage: 'Initial Outreach' },
      { id: 'b', name: 'Bravo', leadStage: 'Initial Outreach', doNotContact: true },
    ],
    contacts: [{ id: 'p', companyId: 'a', firstName: 'Ann', email: 'a@a.com', linkedin: 'https://linkedin.com/in/ann' }],
    deals: [],
    activities: [
      { id: 'e1', type: 'Email', companyId: 'a', contactId: 'p', date: '2026-10-10', subject: 'Q3 market update', opens: 4 },
      { id: 'e2', type: 'Email', companyId: 'b', date: '2026-10-10', subject: 'Hi', opens: 2 },
    ],
  };
  const plan = L.dailyPlan(data, { today: '2026-10-20' });
  assert.deepEqual(plan.opened.map((o) => o.companyId), ['a']);
  assert.match(plan.opened[0].why, /4 times/);
  assert.equal(plan.opened[0].linkedin, 'https://linkedin.com/in/ann');
  assert.ok(!plan.outreach.some((o) => o.companyId === 'a'), 'not listed twice');
});

test('sizes and budgets show as ranges when the tenant gave one', () => {
  assert.equal(L.dealSizeLabel({ sfMin: 3500, sfMax: 4000, estSF: 3800 }), '3,500–4,000 RSF');
  assert.equal(L.dealSizeLabel({ estSF: 20000 }), '20,000 RSF');
  assert.equal(L.dealSizeLabel({}), '');
  assert.equal(L.dealBudgetLabel({ budgetRate: 25, budgetRateMax: 29, rateBasis: 'Full Service ($/SF/yr)' }), '$25–$29/SF Full Service');
});

test('quarterly reminders land 15 and 30 days after each quarter closes', () => {
  const t = L.quarterlyTasks('2026-10-20');
  assert.deepEqual(t.map((x) => [x.id, x.date]), [
    ['q-research-3Q26', '2026-10-15'],
    ['q-flyers-3Q26', '2026-10-30'],
    ['q-research-4Q26', '2027-01-15'],
    ['q-flyers-4Q26', '2027-01-30'],
  ]);
});

test('clientTouchpoints schedules check-ins for your own closed deals only', () => {
  const deals = [
    { id: 'a', companyId: 'ca', stage: 'Closed Won', leaseCommencement: '2026-09-01', newLeaseExpiration: '2031-08-31', renewalNoticeDate: '2031-02-28' },
    { id: 'b', companyId: 'cb', stage: 'Closed Won', partnerDeal: true, leaseCommencement: '2026-09-01' },
  ];
  const tp = L.clientTouchpoints(deals, { today: '2026-10-20', touches: {} });
  assert.deepEqual(tp.due.map((p) => [p.companyId, p.date]), [['ca', '2026-10-01']]);
  assert.equal(L.clientTouchpoints(deals, { today: '2026-10-20', touches: { ca: '2026-10-05' } }).due.length, 0, 'a touch clears it');
  assert.ok(tp.all.some((p) => p.label === 'Renewal option notice due in 90 days' && p.date === '2030-11-30'));
  assert.equal(L.moveInPostIdeas(deals, { ca: { name: 'Acme' } }, '2026-10-20')[0].date, '2026-09-08');
});

test('coach tips re-check themselves against the data', () => {
  const data = { companies: [], contacts: [], deals: [{ id: 'd', stage: 'Touring', name: 'X', companyId: 'c' }], activities: [], marketing: [] };
  const rsf = () => L.coachTips(data, { today: '2026-10-20' }).find((t) => t.id === 'rsf');
  assert.equal(rsf().done, false);
  data.deals[0].estSF = 5000;
  assert.equal(rsf().done, true);
});

test('planHubSpotSync logs new emails, updates opens and marks replies', () => {
  const data = {
    companies: [{ id: 'hs-co-1', name: 'Acme' }, { id: 'c2', name: 'Beta', hubspotId: 2 }],
    contacts: [{ id: 'hs-ct-9', companyId: 'hs-co-1', email: 'ann@acme.com' }],
    deals: [],
    activities: [{ id: 'hs-em-5', type: 'Email', companyId: 'hs-co-1', date: '2026-10-10', subject: 'Hi', opens: 1, outcome: 'No response' }],
  };
  const payload = {
    emails: [
      { id: '5', properties: { hs_email_direction: 'EMAIL', hs_email_open_count: '4', hs_timestamp: '2026-10-10T15:00:00Z' }, companies: ['1'] },
      { id: '6', properties: { hs_email_direction: 'EMAIL', hs_email_subject: 'Beta | Tower Place – Atlanta Office', hs_email_to_email: 'x@beta.com', hs_timestamp: '2026-10-19T15:00:00Z' }, companies: ['2'] },
      { id: '7', properties: { hs_email_direction: 'INCOMING_EMAIL', hs_email_subject: 'RE: Hi', hs_email_from_email: 'ann@acme.com', hs_timestamp: '2026-10-12T15:00:00Z' }, companies: [], contacts: [] },
      { id: '8', properties: { hs_email_direction: 'EMAIL', hs_email_to_email: 'nobody@nowhere.com' }, companies: [] },
    ],
    calls: [{ id: '3', properties: { hs_call_disposition: 'f240bbac-87c9-4f6e-bf70-924b57d47db7', hs_timestamp: '2026-10-18T15:00:00Z' }, contacts: ['9'] }],
  };
  const plan = L.planHubSpotSync(payload, data);
  const byId = Object.fromEntries(plan.activities.map((a) => [a.id, a]));
  assert.equal(byId['hs-em-5'].opens, 4);
  assert.equal(byId['hs-em-5'].outcome, 'Replied', 'the inbound reply answers the earlier email');
  assert.equal(byId['hs-em-6'].companyId, 'c2');
  assert.equal(byId['hs-em-6'].template, 'Building intro');
  assert.equal(byId['hs-em-7'].inbound, true);
  assert.equal(byId['hs-cl-3'].outcome, 'Connected');
  assert.equal(plan.skipped, 1);
  assert.deepEqual(plan.companies.map((c) => c.id).sort(), ['c2', 'hs-co-1']);
});

test('dealLXD calculates the expiration from commencement and term', () => {
  assert.equal(L.dealLXD({ newLeaseExpiration: '2031-12-31' }), '2031-12-31');
  assert.equal(L.dealLXD({ leaseCommencement: '2026-11-01', finalTermMonths: 63 }), '2032-01-31');
  assert.equal(L.dealLXD({ leaseCommencement: '2026-11-01' }), '');
  assert.ok(L.isCoworking({ name: 'Acme', outsideBrokerCompany: 'Regus - Coworking' }));
  assert.equal(L.moveInPostIdeas([{ id: 'm', stage: 'Closed Won', leaseCommencement: '2026-10-15', notes: 'Coworking Deal - REGUS' }], {}, '2026-10-20').length, 0);
});

test('researchRequestEmail greets the team and lists each one-pager submarket', () => {
  const mail = L.researchRequestEmail('3Q26', [
    { kind: 'One-pager / flyer', submarket: 'Northeast', assetClass: 'Office' },
    { kind: 'One-pager / flyer', submarket: 'Northeast / I-85 Corridor', assetClass: 'Industrial' },
  ], { to: ['ann.lee@x.com', 'bo.kim@x.com', 'cy.ng@x.com'], signature: 'Sam' });
  assert.equal(mail.subject, '3Q26 submarket stats for tenant one-pagers');
  assert.match(mail.body, /^Hi Ann, Bo and Cy,/);
  assert.match(mail.body, /• Northeast – Office\n• Northeast \/ I-85 Corridor – Flex\/Industrial/);
});
