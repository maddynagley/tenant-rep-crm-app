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
  assert.equal(L.dealSizeLabel({ estSF: 20000, sfMax: 25000 }), '20,000–25,000 RSF');
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

test('planListSync links sheet rows, merges both ways and never leaks private CRM details', () => {
  const headers = ['Company Name', 'Industry', 'Space Need', 'Contact Name', 'Title', 'Email', 'Lead', 'Status', 'Contacted By', 'Last Touch', 'Notes', 'Last Updated By', 'CRM ID'];
  const row = (n, vals) => ({ row: n, values: headers.map((h) => vals[h] || '') });
  const payload = (rows, contactRows, research) => ({
    tabs: {
      'Target List': { headers, rows },
      Contacts: { headers: ['Company Name', 'Contact Name', 'Title', 'Email', 'Role', 'Notes', 'CRM ID'], rows: contactRows || [] },
      'Prospect Research': { headers: ['Rank', 'Company Name', 'Score', 'Recruitment Angle'], rows: research || [] },
    },
  });
  const data = {
    companies: [{ id: 'c-acme', name: 'Acme Robotics', assetClass: 'Office', industry: 'Robots (ZoomInfo)' }],
    contacts: [{ id: 'p-ann', companyId: 'c-acme', firstName: 'Ann', lastName: 'Lee', email: 'ann@acme.com' }],
    activities: [],
  };
  const opts = { listId: 'mac', listName: 'Metro Chamber', initials: 'MN', now: '2026-10-20T00:00:00Z' };

  // First sync: Acme matches by name, Beta is new.
  let plan = L.planListSync(
    payload(
      [row(2, { 'Company Name': 'Acme Robotics', 'Contact Name': 'Ann Lee', Status: 'Researching', 'Space Need': 'Industrial' }), row(3, { 'Company Name': 'Beta Labs', 'Contact Name': 'Bo Kim', Title: 'COO', 'Last Touch': '10/5/2026' })],
      [],
      [{ row: 2, values: ['1', 'Beta Labs', '93', 'Site screen'] }]
    ),
    data,
    opts
  );
  assert.equal(plan.companies.length, 1);
  const beta = plan.companies[0];
  assert.equal(beta.name, 'Beta Labs');
  assert.equal(beta.lastContacted, '2026-10-05');
  assert.equal(beta.research.score, '93');
  assert.equal(plan.contacts.find((p) => p.firstName === 'Bo').title, 'COO');
  const acmePatch = plan.companyUpdates.find((u) => u.id === 'c-acme');
  assert.equal(acmePatch.assetClass, 'Industrial');
  assert.equal(acmePatch.listPrimaryContact, 'p-ann');
  assert.equal(acmePatch.industry, undefined, 'a blank sheet cell does not erase the CRM value');
  assert.ok(plan.pushes.every((p) => !p.values.Email && !p.values.Industry), 'private CRM details are not pushed on first link');
  assert.ok(plan.pushes.some((p) => p.crmId === 'c-acme' && p.row === 2), 'CRM IDs are stamped on the rows');

  // Apply the plan, then: MN updates Acme's status in the CRM, KB changes Beta's notes in the sheet.
  const apply = (d, pl) => {
    pl.companyUpdates.forEach((u) => Object.assign(d.companies.find((c) => c.id === u.id), u));
    pl.contactUpdates.forEach((u) => Object.assign(d.contacts.find((c) => c.id === u.id), u));
    d.companies.push(...pl.companies);
    d.contacts.push(...pl.contacts);
  };
  apply(data, plan);
  data.companies.find((c) => c.id === 'c-acme').listStatus = 'Contacted';
  data.companies.find((c) => c.id === 'c-acme').contactedBy = 'MN';
  plan = L.planListSync(
    payload([
      row(2, { 'Company Name': 'Acme Robotics', 'Contact Name': 'Ann Lee', Status: 'Researching', 'Space Need': 'Industrial', 'CRM ID': 'c-acme' }),
      row(3, { 'Company Name': 'Beta Labs', 'Contact Name': 'Bo Kim', Title: 'COO', 'Last Touch': '10/5/2026', Notes: 'KB called', 'CRM ID': beta.id }),
    ]),
    data,
    opts
  );
  const acmePush = plan.pushes.find((p) => p.crmId === 'c-acme');
  assert.deepEqual(acmePush.values, { Status: 'Contacted', 'Contacted By': 'MN', 'Last Updated By': 'MN' });
  assert.equal(plan.companyUpdates.find((u) => u.id === beta.id).listNotes, 'KB called');
  assert.ok(!plan.pushes.some((p) => p.values && p.values.Email), 'still no private email pushed');

  // A company added to the list in the CRM gets a new row; a row deleted from the sheet is flagged, not removed.
  apply(data, plan);
  data.companies.push({ id: 'c-new', name: 'Gamma Air', sharedList: 'mac', industry: 'Aerospace' });
  plan = L.planListSync(payload([row(2, { 'Company Name': 'Acme Robotics', 'Contact Name': 'Ann Lee', Status: 'Contacted', 'Contacted By': 'MN', 'Space Need': 'Industrial', 'CRM ID': 'c-acme' })]), data, opts);
  const add = plan.pushes.find((p) => p.crmId === 'c-new');
  assert.equal(add.values['Company Name'], 'Gamma Air');
  assert.equal(add.values.Status, 'Researching');
  assert.deepEqual(plan.removed, [beta.id]);
});

test('dailyPlan leaves shared-list companies your partner leads off your outreach list', () => {
  const data = {
    companies: [
      { id: 'kb', name: 'KB Co', leadStage: 'New', sharedList: 'mac', listLead: 'KB' },
      { id: 'mn', name: 'MN Co', leadStage: 'New', sharedList: 'mac', listLead: 'MN' },
      { id: 'own', name: 'Own Co', leadStage: 'New' },
    ],
    contacts: [],
    deals: [],
    activities: [],
  };
  const ids = L.dailyPlan(data, { today: '2026-10-20', initials: 'MN' }).outreach.map((o) => o.companyId).sort();
  assert.deepEqual(ids, ['mn', 'own']);
});

test('planListSync reads and writes a presence column named for the region', () => {
  const headers = ['Company Name', 'Local Area Presence', 'CRM ID'];
  const data = { companies: [{ id: 'c1', name: 'Acme', sharedList: 'l' }], contacts: [], activities: [] };
  let plan = L.planListSync({ tabs: { 'Target List': { headers, rows: [{ row: 2, values: ['Acme', 'None', ''] }] } } }, data, { listId: 'l' });
  assert.equal(plan.companyUpdates[0].localPresence, 'None');
  Object.assign(data.companies[0], plan.companyUpdates[0], { localPresence: 'Sales rep' });
  plan = L.planListSync({ tabs: { 'Target List': { headers, rows: [{ row: 2, values: ['Acme', 'None', 'c1'] }] } } }, data, { listId: 'l' });
  assert.deepEqual(plan.pushes[0].values, { 'Local Area Presence': 'Sales rep' });
});

test('planHubSpotSync files emails under the company\'s one open deal', () => {
  const data = {
    companies: [{ id: 'hs-co-1', name: 'Acme' }, { id: 'hs-co-2', name: 'Beta' }],
    contacts: [],
    deals: [
      { id: 'd1', companyId: 'hs-co-1', stage: 'Touring' },
      { id: 'd2', companyId: 'hs-co-2', stage: 'Touring' },
      { id: 'd3', companyId: 'hs-co-2', stage: 'LOI' },
    ],
    activities: [{ id: 'hs-em-9', type: 'Email', companyId: 'hs-co-1', date: '2026-10-10' }],
  };
  const plan = L.planHubSpotSync(
    {
      emails: [
        { id: '5', properties: { hs_email_direction: 'EMAIL', hs_timestamp: '2026-10-19T15:00:00Z' }, companies: ['1'] },
        { id: '6', properties: { hs_email_direction: 'EMAIL', hs_timestamp: '2026-10-19T15:00:00Z' }, companies: ['2'] },
        { id: '9', properties: { hs_email_direction: 'EMAIL', hs_email_open_count: '1' }, companies: ['1'] },
      ],
    },
    data
  );
  const by = Object.fromEntries(plan.activities.map((a) => [a.id, a]));
  assert.equal(by['hs-em-5'].dealId, 'd1');
  assert.equal(by['hs-em-6'].dealId, '', 'two open deals: left for you to file');
  assert.equal(by['hs-em-9'].dealId, 'd1', 'earlier synced emails get filed too');
});

test('planHubSpotSync brings in HubSpot notes and honors deal links', () => {
  const data = {
    companies: [{ id: 'hs-co-1', name: 'Acme', lastContacted: '2026-10-01' }],
    contacts: [],
    deals: [{ id: 'hs-dl-7', companyId: 'hs-co-1', stage: 'Closed Won' }, { id: 'hs-dl-8', companyId: 'hs-co-1', stage: 'Touring' }],
    activities: [],
  };
  const plan = L.planHubSpotSync(
    {
      notes: [{ id: '4', properties: { hs_note_body: '<p>Follow up week of June 5th</p>', hs_timestamp: '2026-05-20T15:00:00Z' }, companies: ['1'], deals: ['7'] }],
      emails: [{ id: '5', properties: { hs_email_direction: 'EMAIL', hs_timestamp: '2026-10-19T15:00:00Z' }, companies: ['1'] }],
    },
    data
  );
  const by = Object.fromEntries(plan.activities.map((a) => [a.id, a]));
  assert.equal(by['hs-nt-4'].type, 'Note');
  assert.equal(by['hs-nt-4'].notes, 'Follow up week of June 5th');
  assert.equal(by['hs-nt-4'].dealId, 'hs-dl-7', 'a note linked to a deal in HubSpot stays with that deal');
  assert.equal(by['hs-em-5'].dealId, 'hs-dl-8');
  assert.deepEqual(plan.companies, [{ id: 'hs-co-1', lastContacted: '2026-10-19' }], 'notes are not touches');
});

test('planHubSpotSync fills in the full text of emails already in the CRM', () => {
  const data = {
    companies: [{ id: 'hs-co-1', name: 'Acme' }],
    contacts: [],
    deals: [],
    activities: [{ id: 'hs-em-5', type: 'Email', companyId: 'hs-co-1', date: '2026-05-01', notes: 'Summary', opens: 2 }],
  };
  const plan = L.planHubSpotSync({ emails: [{ id: '5', properties: { hs_email_direction: 'EMAIL', hs_email_text: 'Hi Ann,\r\n\r\nFull email.', hs_email_open_count: '2' }, companies: [] }] }, data);
  assert.equal(plan.skipped, 0);
  assert.equal(plan.activities[0].body, 'Hi Ann,\n\nFull email.');
  assert.equal(plan.activities[0].notes, undefined, 'the summary is kept');
});

test('fillTemplate fills placeholders and flags missing values', () => {
  const out = L.fillTemplate('Hi {FirstName}, {Company} at {Building} expires {LeaseExpiration} ({MonthsToExpiration} mo). {Suite} {Unknown} -{MyFirstName}, {MyFirm}', {
    company: { name: 'Acme', building: 'Tower Place 100', leaseExpiration: '2027-03-31' },
    contact: { firstName: 'Ann' },
    me: { name: 'Sam Lee', firm: 'Firm Co' },
    today: '2026-10-20',
  });
  assert.equal(out, 'Hi Ann, Acme at Tower Place 100 expires March 2027 (5 mo). [Suite] {Unknown} -Sam, Firm Co');
});

test('suggestTemplate picks follow-up, lease expiration or intro', () => {
  const t = [
    { id: 'i', step: 'Intro' },
    { id: 'l', step: 'Lease expiration' },
    { id: 'f', step: 'Follow-up' },
  ];
  const today = '2026-10-20';
  assert.equal(L.suggestTemplate(t, { leadStage: 'New' }, { today }).id, 'i');
  assert.equal(L.suggestTemplate(t, { leadStage: 'New', leaseExpiration: '2027-06-30' }, { today }).id, 'l');
  assert.equal(L.suggestTemplate(t, { leadStage: 'Initial Outreach' }, { today, lastTouch: '2026-10-01' }).id, 'f');
  assert.equal(L.mailtoLink('a@b.com', 'Hi & bye', 'Line 1\nLine 2'), 'mailto:a@b.com?subject=Hi%20%26%20bye&body=Line%201%0ALine%202');
});

test('an email sent after drafting from a template is tagged with it', () => {
  const data = {
    companies: [{ id: 'hs-co-1', name: 'Acme', pendingTemplate: 'Lease expiration', pendingTemplateAt: '2026-10-19' }],
    contacts: [],
    deals: [],
    activities: [],
  };
  const plan = L.planHubSpotSync({ emails: [{ id: '5', properties: { hs_email_direction: 'EMAIL', hs_email_subject: 'Quick question', hs_timestamp: '2026-10-20T15:00:00Z' }, companies: ['1'] }] }, data);
  assert.equal(plan.activities[0].template, 'Lease expiration');
  assert.equal(plan.companies[0].pendingTemplate, '');
});

test('an initial email creates a follow-up task a week later, which closes itself on a reply', () => {
  const data = {
    companies: [{ id: 'a', name: 'Acme' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Cove' }, { id: 'd', name: 'Dune' }],
    contacts: [{ id: 'p', companyId: 'a', firstName: 'Ann' }],
    deals: [{ id: 'x', companyId: 'd', stage: 'Touring' }],
    activities: [
      { id: 'e1', type: 'Email', date: '2026-10-14', companyId: 'a', contactId: 'p', subject: 'Tower Place' },
      { id: 'e0', type: 'Email', date: '2026-09-30', companyId: 'b', subject: 'Earlier' },
      { id: 'e2', type: 'Email', date: '2026-10-15', companyId: 'b', subject: 'Second touch' },
      { id: 'e3', type: 'Email', date: '2026-10-01', companyId: 'c', subject: 'Before the workflow started' },
      { id: 'e4', type: 'Email', date: '2026-10-16', companyId: 'd', subject: 'Deal email' },
    ],
  };
  const opts = { today: '2026-10-20', since: '2026-10-10' };
  const plan = L.planFollowUpTasks(data, opts);
  assert.deepEqual(plan.add.map((t) => [t.id, t.followUpDate, t.subject]), [['wf-fu-a-2026-10-14', '2026-10-21', 'Send follow-up email to Ann at Acme']]);
  assert.deepEqual(L.planFollowUpTasks(data, Object.assign({ created: ['wf-fu-a-2026-10-14'] }, opts)).add, []);

  data.activities.push(plan.add[0], { id: 'r1', type: 'Email', inbound: true, date: '2026-10-18', companyId: 'a', subject: 'Reply: Tower Place' });
  const next = L.planFollowUpTasks(data, opts);
  assert.deepEqual(next.add, []);
  assert.equal(next.complete.length, 1);
  assert.match(next.complete[0].notes, /Closed automatically: they replied on/);
});

test('tracked lease rights remind ahead of the notice deadline until exercised or past', () => {
  const items = [
    { id: 'r', companyId: 'a', kind: 'Renewal option', date: '2027-03-31', remindDays: 180, terms: 'One 5-yr renewal at 95% FMV' },
    { id: 't', companyId: 'b', kind: 'Termination option', date: '2026-12-01' },
    { id: 'x', companyId: 'c', kind: 'Expansion option', date: '2026-11-15', status: 'Exercised' },
    { id: 'n', companyId: 'd', kind: 'ROFO' },
  ];
  const tp = L.clientTouchpoints([], { today: '2026-10-20', criticalDates: items });
  assert.deepEqual(tp.due.map((p) => [p.criticalDateId, p.date]), [['r', '2026-10-02'], ['t', '2026-09-02']].sort((x, y) => x[1].localeCompare(y[1])));
  assert.ok(tp.upcoming.some((p) => p.criticalDateId === 'r' && p.label === 'Renewal option deadline'));
  assert.ok(!tp.due.some((p) => p.criticalDateId === 'x'));
});

test('a template written for a building is suggested first for its tenants', () => {
  const t = [{ id: 'i', step: 'Intro' }, { id: 'p', step: 'Intro', buildings: 'Piedmont Center, 3525 Piedmont' }, { id: 'f', step: 'Follow-up' }];
  assert.equal(L.suggestTemplate(t, { leadStage: 'New', building: 'Piedmont Center 5' }, { today: '2026-10-20' }).id, 'p');
  assert.equal(L.suggestTemplate(t, { leadStage: 'New', address: '3525 Piedmont Rd NE' }, { today: '2026-10-20' }).id, 'p');
  assert.equal(L.suggestTemplate(t, { leadStage: 'New', building: 'Tower Place' }, { today: '2026-10-20' }).id, 'i');
  assert.equal(L.suggestTemplate(t, { leadStage: 'Initial Outreach', building: 'Piedmont Center' }, { today: '2026-10-20', lastTouch: '2026-10-01' }).id, 'f');
});

test('companies and contacts new in HubSpot are added; existing ones only get blanks filled', () => {
  const data = {
    companies: [{ id: 'hs-co-1', name: 'Acme', hubspotId: '1', industry: 'Legal', hubspotUrl: 'https://app.hubspot.com/contacts/999/record/0-2/1' }, { id: 'c2', name: 'Beta Labs, Inc.', website: 'https://www.betalabs.com' }],
    contacts: [{ id: 'p1', companyId: 'hs-co-1', firstName: 'Ann', email: 'ann@acme.com', title: '' }],
    deals: [],
    activities: [],
    hubspotSkip: ['co-9'],
  };
  const today = new Date().toISOString().slice(0, 10);
  const plan = L.planHubSpotSync(
    {
      companies: [
        { id: '1', properties: { name: 'Acme', industry: 'COMPUTER_SOFTWARE', submarket: 'Uptown' } },
        { id: '2', properties: { name: 'Beta Labs', domain: 'betalabs.com', lease_expiration: '2027-06-30' } },
        { id: '3', properties: { name: 'Zipline', domain: 'flyzipline.com', city: 'Atlanta', state: 'GA', createdate: today + 'T12:00:00Z' } },
        { id: '9', properties: { name: 'Deleted Co' } },
      ],
      contacts: [
        { id: '11', properties: { firstname: 'Ann', email: 'ANN@acme.com', jobtitle: 'COO' } },
        { id: '12', properties: { firstname: 'Raj', lastname: 'Patel', email: 'raj@flyzipline.com', hs_linkedin_url: 'https://linkedin.com/in/raj' }, companies: ['3'] },
        { id: '13', properties: { firstname: 'Bo', email: 'bo@betalabs.com' } },
        { id: '14', properties: { firstname: 'No', email: 'no@nowhere.com' } },
      ],
    },
    data
  );
  const co = (id) => plan.companies.find((c) => c.id === id);
  assert.deepEqual(co('hs-co-1'), { id: 'hs-co-1', submarket: 'Uptown' });
  assert.equal(co('c2').hubspotId, '2');
  assert.equal(co('c2').leaseExpiration, '2027-06-30');
  assert.equal(co('c2').name, undefined);
  assert.equal(co('hs-co-3').leadStage, 'New');
  assert.equal(co('hs-co-3').city, 'Atlanta, GA');
  assert.equal(co('hs-co-3').hubspotUrl, 'https://app.hubspot.com/contacts/999/record/0-2/3');
  assert.equal(co('hs-co-9'), undefined);
  assert.deepEqual(plan.created, { companies: 1, contacts: 2 });
  const ct = (id) => plan.contacts.find((c) => c.id === id);
  assert.equal(ct('p1').title, 'COO');
  assert.equal(ct('hs-ct-12').companyId, 'hs-co-3');
  assert.equal(ct('hs-ct-13').companyId, 'c2');
  assert.equal(ct('hs-ct-14'), undefined);
  assert.equal(plan.skipped, 1);
});

test('follow-up tasks name a contact at the company, never a colleague on cc', () => {
  const data = {
    companies: [{ id: 'a', name: 'Acme' }, { id: 'us', name: 'Our firm' }],
    contacts: [
      { id: 'me', companyId: 'us', firstName: 'Sam', email: 'sam@ourfirm.com' },
      { id: 'pat', companyId: 'us', firstName: 'Pat', email: 'pat@ourfirm.com' },
      { id: 'ann', companyId: 'a', firstName: 'Ann', email: 'ann@acme.com' },
      { id: 'me2', companyId: 'b', firstName: 'Sam', email: 'sam@ourfirm.com' },
    ],
    deals: [],
    activities: [
      { id: 'e1', type: 'Email', date: '2026-10-14', companyId: 'a', contactId: 'me', subject: 'Hello' },
      { id: 'e2', type: 'Email', date: '2026-10-14', companyId: 'us', contactId: 'me', subject: 'Internal' },
      { id: 'old', type: 'Task', workflow: 'follow-up', workflowEmailId: 'x', followUpDate: '2026-10-25', companyId: 'a', contactId: 'me', subject: 'Send follow-up email to Sam at Acme' },
      { id: 'old2', type: 'Task', workflow: 'follow-up', workflowEmailId: 'y', followUpDate: '2026-10-25', companyId: 'b', contactId: 'me2', subject: 'Send follow-up email to Sam at Beta' },
    ],
  };
  data.companies.push({ id: 'b', name: 'Beta' });
  const plan = L.planFollowUpTasks(data, { today: '2026-10-20', since: '2026-10-10', internalDomain: 'ourfirm.com' });
  assert.deepEqual(plan.add.map((t) => [t.companyId, t.contactId, t.subject]), [['a', 'ann', 'Send follow-up email to Ann at Acme']]);
  assert.deepEqual(plan.complete, [
    { id: 'old', contactId: 'ann', subject: 'Send follow-up email to Ann at Acme' },
    { id: 'old2', contactId: '', subject: 'Send follow-up email to Beta' },
  ]);
});

test('merging a duplicate company moves its records and keeps its HubSpot ID pointing at the kept one', () => {
  const data = {
    companies: [
      { id: 'keep', name: 'Marnic (Raymond James)', hubspotId: '1', website: '' },
      { id: 'dup', name: 'raymondjames.com', hubspotId: '2', website: 'https://raymondjames.com', industry: 'Finance' },
    ],
    contacts: [{ id: 'jay', companyId: 'dup', firstName: 'Jay' }],
    deals: [],
    activities: [{ id: 'e', companyId: 'dup', date: '2026-10-14' }, { id: 'f', companyId: 'keep', date: '2026-10-15' }],
    criticalDates: [],
  };
  const m = L.planCompanyMerge(data, 'dup', 'keep');
  assert.deepEqual(m.company, { id: 'keep', website: 'https://raymondjames.com', industry: 'Finance', aliases: 'raymondjames.com', mergedHubspotIds: ['2'] });
  assert.deepEqual(m.moves.contacts, [{ id: 'jay', companyId: 'keep' }]);
  assert.deepEqual(m.moves.activities, [{ id: 'e', companyId: 'keep' }]);
  data.companies[0] = Object.assign({}, data.companies[0], m.company);
  data.companies.splice(1, 1);
  const plan = L.planHubSpotSync({ emails: [{ id: '9', properties: { hs_email_direction: 'EMAIL', hs_email_subject: 'Hi', hs_timestamp: '2026-10-20T15:00:00Z' }, companies: ['2'] }] }, data);
  assert.equal(plan.activities[0].companyId, 'keep');
});

test('a comp lease expiration comes from the entered date, commencement + term, or an estimate from signing', () => {
  assert.deepEqual(L.compLXD({ leaseExpiration: '2031-05-31' }), { date: '2031-05-31', estimated: false });
  assert.deepEqual(L.compLXD({ commencement: '2026-03-01', termMonths: 64 }), { date: '2031-06-30', estimated: false });
  assert.deepEqual(L.compLXD({ signedDate: '2026-01-01', termMonths: 87 }), { date: '2033-05-31', estimated: true });
  assert.equal(L.compLXD({ signedDate: '2026-01-01' }), null);
});

test('sortRows: column sort in either direction, blanks last', () => {
  const rows = [
    { name: 'Acme', exp: '2028-06-30', sf: 5000 },
    { name: 'Uptown', exp: '', sf: 12000 },
    { name: 'Birch', exp: '2027-01-31', sf: null },
  ];
  const cols = { exp: { get: (r) => r.exp }, sf: { get: (r) => r.sf, desc: true } };
  const names = (list) => list.map((r) => r.name);
  assert.deepEqual(names(L.sortRows(rows, cols, 'exp', 'asc')), ['Birch', 'Acme', 'Uptown']);
  assert.deepEqual(names(L.sortRows(rows, cols, 'exp', 'desc')), ['Acme', 'Birch', 'Uptown']);
  assert.deepEqual(names(L.sortRows(rows, cols, 'sf')), ['Uptown', 'Acme', 'Birch']);
  assert.deepEqual(names(L.sortRows(rows, cols, 'sf', 'asc')), ['Acme', 'Uptown', 'Birch']);
  const grouped = { exp: { get: (r) => r.exp, group: (r) => (r.name === 'Acme' ? 1 : 0) } };
  assert.deepEqual(names(L.sortRows(rows, grouped, 'exp', 'desc')), ['Birch', 'Acme', 'Uptown']);
  assert.equal(rows[0].name, 'Acme', 'input not mutated');
});

test('followUpDraft: deal stage, prior email, or a plain check-in', () => {
  const company = { name: 'Acme', building: 'Uptown Tower', submarket: 'Midtown', leaseExpiration: '2027-06-30' };
  const contact = { firstName: 'Pat' };
  const me = { name: 'Jordan Lee', firm: 'Firm' };
  const today = '2026-10-26';
  const viaEmail = L.followUpDraft({ company, contact, me, today, lastEmail: { subject: 'Re: Fw: Uptown Tower options', date: '2026-10-09', opens: 5 } });
  assert.equal(viaEmail.subject, 'RE: Uptown Tower options');
  assert.match(viaEmail.body, /^Hi Pat,/);
  assert.match(viaEmail.body, /Following up on my note from Oct 9, 2026/);
  assert.match(viaEmail.body, /Uptown Tower coming up in June 2027, there's still time/);
  assert.match(viaEmail.body, /Best,\nJordan$/);
  assert.match(viaEmail.why, /opened 5 times/);
  const viaDeal = L.followUpDraft({ company, contact, me, today, deal: { name: 'Acme relocation', stage: 'Touring' } });
  assert.equal(viaDeal.subject, 'Acme relocation – next steps');
  assert.match(viaDeal.body, /Thanks for making the time to tour/);
  const closed = L.followUpDraft({ company, contact: {}, me, today, deal: { name: 'Old', stage: 'Closed Won' } });
  assert.equal(closed.subject, 'Acme – checking in');
  assert.match(closed.body, /^Hi \[FirstName\],/);
});

test('budget as a total monthly rent', () => {
  const d = { budgetUnit: 'Total per month', budgetRate: 5000, rateBasis: 'Full Service ($/SF/yr)', sfMax: 4000, termMonths: 36, escalationPct: 3, commissionPct: 4 };
  const est = L.estimatedCommission(d);
  assert.equal(Math.round(est.aggregateValue), Math.round(5000 * 12 * (1 + 1.03 + 1.0609)));
  assert.equal(L.dealBudgetLabel(d), '$5,000/mo total Full Service');
  const perSF = Object.assign({}, d, { budgetUnit: '', budgetRate: 30 });
  assert.equal(Math.round(L.estimatedCommission(perSF).aggregateValue), Math.round(4000 * 30 * (1 + 1.03 + 1.0609)));
  assert.equal(L.dealBudgetLabel(perSF), '$30/SF Full Service');
});

test('dealBrief: where things stand from emails, notes, tasks and survey', () => {
  const company = { id: 'co1', name: 'Acme', leaseExpiration: '2027-06-30' };
  const deal = { id: 'd1', companyId: 'co1', name: 'Acme HQ', stage: 'Touring', stageChangedAt: '2026-10-01T10:00:00Z', sfMin: 3000, sfMax: 4000, notes: 'Oct 20, 2026: Wants drive-in\n\nOct 1, 2026: Kickoff' };
  const contacts = [{ id: 'p1', firstName: 'Pat', lastName: 'Lee' }];
  const activities = [
    { id: 'a1', type: 'Email', date: '2026-10-10', subject: 'Survey', opens: 2, outcome: 'Replied' },
    { id: 'a2', type: 'Email', date: '2026-10-12', subject: 'Reply: Survey', inbound: true, contactId: 'p1', body: 'Hi Jordan,\nLet\'s tour the top two next week.\nThanks,\nPat\n\nOn Oct 10 you wrote:\n> old' },
    { id: 'a3', type: 'Task', date: '2026-10-20', subject: 'Book tours' },
    { id: 'a4', type: 'Note', date: '2026-10-05', subject: 'Call recap', notes: 'Needs 3 privates' },
  ];
  const properties = [{ status: 'Toured' }, { status: 'Toured' }, { status: 'Identified' }];
  const b = L.dealBrief({ company, deal, activities, properties, contacts }, { today: '2026-10-26' });
  const sec = (label) => (b.sections.find((s) => s.label === label) || { items: [] }).items.join(' | ');
  assert.equal(b.title, 'Acme HQ');
  assert.match(sec('Where it stands'), /Touring since Oct 1, 2026/);
  assert.match(sec('Where it stands'), /Pat Lee replied Oct 12, 2026 \("Survey"\)\. Your move\./);
  assert.match(sec('Latest emails'), /from Pat Lee · "Survey": Let's tour the top two next week\./);
  assert.doesNotMatch(sec('Latest emails'), /old/);
  assert.match(sec('Latest notes'), /^Oct 20, 2026: Wants drive-in/);
  assert.match(sec('Latest notes'), /Note · Call recap: Needs 3 privates/);
  assert.match(sec('Open tasks'), /Oct 20, 2026 \(overdue\) · Book tours/);
  assert.match(sec('Requirement'), /3 buildings on the survey: 1 identified, 2 toured/);
  assert.match(sec('Key dates'), /Rep agreement not signed/);
  assert.match(L.briefText(b), /^Acme HQ\n\nWhere it stands\n- Touring/);
});

test('weeklyRecap: this week on the deal, or a quiet-week note, plus next steps', () => {
  const company = { id: 'co1', name: 'Acme' };
  const deal = { id: 'd1', companyId: 'co1', name: 'Acme HQ', stage: 'Touring', stageChangedAt: '2026-10-27T15:00:00Z' };
  const ctx = { company, deal, contact: { firstName: 'Pat' }, me: { name: 'Jordan Lee' }, today: '2026-10-30' };
  const properties = [
    { building: 'One Midtown', tourDate: '2026-10-28', createdAt: '2026-10-10T00:00:00Z', status: 'Toured', updatedAt: '2026-10-28T00:00:00Z' },
    { building: 'Two Uptown', status: 'Proposal Received', createdAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z' },
  ];
  const activities = [
    { type: 'Meeting', date: '2026-10-27', dealId: 'd1', subject: 'Kickoff with leadership' },
    { type: 'Task', date: '2026-11-03', dealId: 'd1', subject: 'Send proposal comparison' },
    { type: 'Call', date: '2026-10-20', dealId: 'd1', subject: 'Last week call' },
  ];
  const r = L.weeklyRecap(Object.assign({ properties, activities }, ctx));
  assert.equal(r.subject, 'Acme HQ – weekly update (week of Oct 26)');
  assert.deepEqual(r.done, ['Moved the search to the Touring stage.', 'Added Two Uptown to the survey.', 'Toured One Midtown.', 'Received proposals from Two Uptown.', 'Met: Kickoff with leadership.']);
  assert.deepEqual(r.next, ['Send proposal comparison.']);
  assert.match(r.body, /^Hi Pat,/);
  assert.match(r.body, /Have a great weekend,\nJordan$/);
  const quiet = L.weeklyRecap(Object.assign({ properties: [], activities: [] }, ctx, { deal: Object.assign({}, deal, { stageChangedAt: '2026-09-01' }) }));
  assert.match(quiet.body, /quieter week/);
  assert.deepEqual(quiet.next, ['Get your feedback on the tours and request proposals on the front-runners.']);
  assert.equal(L.recapSent(deal, [{ type: 'Email', date: '2026-10-30', dealId: 'd1', template: 'Weekly recap' }], '2026-10-30'), true);
  assert.equal(L.recapSent(deal, [{ type: 'Email', date: '2026-10-23', dealId: 'd1', template: 'Weekly recap' }], '2026-10-30'), false);
});

test('recaps carry over to the next Friday; partner brokers are cc\'d from contacts', () => {
  assert.equal(L.recapFriday('2026-10-30'), '2026-10-30');
  assert.equal(L.recapFriday('2026-11-02'), '2026-10-30');
  assert.equal(L.recapFriday('2026-11-05'), '2026-10-30');
  const deal = { id: 'd1', companyId: 'co1', name: 'Acme HQ', stage: 'RFP', createdAt: '2026-10-01T00:00:00Z' };
  assert.equal(L.recapDue(deal, [], '2026-10-29'), true, 'Thursday: last Friday\'s recap still owed');
  const sentMonday = [{ type: 'Email', date: '2026-11-02', dealId: 'd1', template: 'Weekly recap' }];
  assert.equal(L.recapDue(deal, sentMonday, '2026-11-03'), false, 'a late recap covers the missed Friday');
  assert.equal(L.recapDue(deal, sentMonday, '2026-11-06'), true, 'and the next Friday is due again');
  assert.equal(L.recapDue(deal, [{ type: 'Email', date: '2026-11-02', dealId: 'd1', template: 'Weekly recap' }], '2026-11-02'), false);
  assert.equal(L.recapDue(Object.assign({}, deal, { createdAt: '2026-11-03T00:00:00Z' }), [], '2026-11-04'), false, 'new deal waits for its first Friday');
  assert.equal(L.recapDue(Object.assign({}, deal, { stage: 'Closed Won' }), [], '2026-10-30'), false);
  const monday = L.weeklyRecap({ company: { name: 'Acme' }, deal, contact: {}, me: { name: 'Jordan' }, activities: [{ type: 'Call', date: '2026-10-29', dealId: 'd1', subject: 'Check-in' }], today: '2026-11-02' });
  assert.match(monday.subject, /week of Oct 26/);
  assert.deepEqual(monday.done, ['Call: Check-in.']);
  assert.match(monday.body, /Best,\nJordan$/);
  const contacts = [{ firstName: 'Mitchell', lastName: 'Karrh', email: 'mk@firm.test' }, { firstName: 'RJ', lastName: 'Zurak' }];
  assert.deepEqual(L.partnerEmails({ partnerBrokers: 'Mitchell Karrh & RJ Zurak' }, contacts), { found: ['mk@firm.test'], missing: ['RJ Zurak'] });
  assert.equal(L.mailtoLink('a@x.test', 'S', 'B', 'mk@firm.test,b@y.test'), 'mailto:a@x.test?cc=mk@firm.test,b@y.test&subject=S&body=B');
});

test('comp sheets: header row found below titles, values cleaned, duplicates keyed', () => {
  const rows = [
    ['Q3 2026 Office Lease Comps'],
    [''],
    ['Building', 'Tenant', 'Property Type', 'RSF', 'Sign Date', 'Term', 'Rent ($/SF)', 'Lease Type', 'Escalations', 'Free Rent', 'TI ($/SF)'],
    ['One Midtown', 'Acme', 'Office', '12,500', '3/15/2026', '7', '$38.50', 'Full Service', '3.0%', '6 months', '$65.00 PSF'],
    ['Uptown Park', 'Birch', 'Warehouse', '85,000', '2026-05-01', '62 mo', '$7.25 NNN', '', '$0.25', '3', '5'],
    ['', '', '', '', '', '', '', '', '', '', ''],
  ];
  const res = L.rowsToRecords(rows, L.COMP_IMPORT_ALIASES);
  assert.equal(res.records.length, 2);
  assert.equal(res.headers[0], 'Building');
  const a = L.cleanImportedComp(res.records[0], { source: 'CoStar' });
  assert.deepEqual(
    [a.building, a.tenant, a.assetClass, a.sf, a.signedDate, a.termMonths, a.startingRent, a.rateBasis, a.escalationPct, a.freeRentMonths, a.tiAllowance, a.source],
    ['One Midtown', 'Acme', 'Office', 12500, '2026-03-15', 84, 38.5, 'Full Service ($/SF/yr)', 3, 6, 65, 'CoStar']
  );
  const b = L.cleanImportedComp(res.records[1], { source: 'CoStar', confidential: true });
  assert.deepEqual([b.assetClass, b.termMonths, b.startingRent, b.rateBasis, b.escalationPct, b.confidential], ['Industrial', 62, 7.25, 'NNN ($/SF/yr)', undefined, true]);
  assert.match(b.notes, /Escalations: \$0\.25/);
  assert.equal(L.compKey(a), L.compKey(Object.assign({}, a, { tenant: 'ACME ', startingRent: 40 })));
  assert.equal(L.cleanImportedComp({ escalationPct: '0.03', building: 'X' }).escalationPct, 3);
  const typed = L.cleanImportedComp({ building: 'X', assetClass: 'Office', dealType: 'NNN' });
  assert.deepEqual([typed.dealType, typed.rateBasis], [undefined, 'NNN ($/SF/yr)']);
  assert.equal(L.cleanImportedComp({ building: 'X', dealType: 'Renewal' }).dealType, 'Renewal');
  assert.equal(L.cleanImportedComp({ building: 'X', dealType: 'New Lease' }).dealType, 'New Lease');
});

test('market stats: Research table rows, latest quarter per submarket, template placeholders', () => {
  assert.equal(L.normalizeQuarter('Atlanta Office 3Q26.xlsx'), '3Q26');
  assert.equal(L.normalizeQuarter('Q2 2026'), '2Q26');
  assert.equal(L.normalizeQuarter('2026 Q1'), '1Q26');
  const rows = [
    ['Atlanta Office Market – 3Q26'],
    ['Submarket', 'Total Inventory (SF)', 'Total Vacancy Rate', 'Qtr Net Absorption', 'Under Construction', 'Avg Asking Rent ($/SF)'],
    ['Northside', '22,000,000', '24.1%', '(45,000)', '0', '$43.10'],
    ['Midtown', '25.5M', '0.215', '120,000', '1,200,000', '$46.50'],
    ['Atlanta Total', '150,000,000', '23.0%', '50,000', '2,000,000', '$37.25'],
  ];
  const res = L.rowsToRecords(rows, L.MARKET_STAT_ALIASES);
  const now = res.records.map((r) => L.cleanMarketStat(r, { quarter: '3Q26', assetClass: 'Office' }));
  assert.deepEqual(now[0], { quarter: '3Q26', assetClass: 'Office', submarket: 'Northside', vacancy: 24.1, inventory: 22000000, netAbsorption: -45000, underConstruction: 0, askingRent: 43.1 });
  assert.equal(now[1].vacancy, 21.5);
  assert.equal(now[1].inventory, 25500000);
  assert.equal(now[2].submarket, 'Market total');
  const prev = [{ quarter: '2Q26', assetClass: 'Office', submarket: 'Northside', vacancy: 24.5, askingRent: 42.5 }];
  const company = { name: 'Acme', assetClass: 'Office', submarket: 'Northside' };
  const m = L.marketStatFor(now.concat(prev), company);
  assert.equal(m.current.submarket, 'Northside');
  assert.equal(m.previous.quarter, '2Q26');
  assert.equal(m.market.vacancy, 23);
  const v = L.marketValues(m, company);
  assert.equal(v.VacancyChange, 'down 40 bps from 2Q26');
  assert.equal(v.RentChange, 'up 1.4% from 2Q26');
  assert.equal(v.MarketStat, 'Northside office vacancy was 24.1% in 3Q26, down 40 bps from 2Q26, asking rents averaged $43.10/SF (up 1.4% from 2Q26) and net absorption was -45,000 SF.');
  assert.equal(L.fillTemplate('{Submarket} vacancy is {Vacancy} ({VacancyChange}); metro {MarketVacancy}.', { company, market: m }), 'Northside vacancy is 24.1% (down 40 bps from 2Q26); metro 23.0%.');
  // A submarket with no row falls back to the market total; no stats leaves the usual [brackets].
  assert.equal(L.marketStatFor(now, { assetClass: 'Office', submarket: 'Airport' }).current.submarket, 'Market total');
  assert.equal(L.marketStatFor(now, { assetClass: 'Industrial' }), null);
  assert.equal(L.fillTemplate('{Vacancy}', { company: {} }), '[Vacancy]');
});

test('comp import: second header row, rate columns, months, and duplicate review', () => {
  const rows = [
    ['Tenant', 'Address', 'Building Name', 'Submarket', 'Size (SF)', 'Lease Term', 'Lease Rate', 'Rate Type', 'Escalations', 'Free Rent', 'TIA', ''],
    ['', '', '', '', '', '(Mos.)', '', '', '', '(Mos.)', '', 'Type'],
    ['Acme, Inc.', '1 Main St', 'One Main', 'Uptown', '4,000', '7', '27.5', 'FS', '0.03', '3', '$10-$15', 'Downsize & Extension'],
    ['Acme', '1 Main St', 'One Main', 'Uptown', '4,000', '7', '27', 'FS', '0.03', '3', '10', 'Renewal'],
    ['Birch', '2 Side St', '', 'Uptown', '2,000', '24', '20', 'NNN', '0', '0', '0', ''],
  ];
  const res = L.rowsToRecords(rows, L.COMP_IMPORT_ALIASES);
  assert.equal(res.records.length, 3);
  assert.deepEqual(Object.keys(res.mapping).sort(), ['address', 'building', 'dealType', 'escalationPct', 'freeRentMonths', 'rateBasis', 'sf', 'startingRent', 'submarket', 'tenant', 'termMonths', 'tiAllowance'].sort());
  const comps = res.records.map((r) => L.cleanImportedComp(r, { assetClass: 'Office', termUnit: 'months' }));
  assert.deepEqual([comps[0].startingRent, comps[0].rateBasis, comps[0].termMonths, comps[0].escalationPct, comps[0].tiAllowance, comps[0].dealType], [27.5, 'Full Service ($/SF/yr)', 7, 3, 10, 'Renewal']);
  assert.match(comps[0].notes, /Type: Downsize & Extension · TI: \$10-\$15/);
  assert.equal(comps[2].building, '2 Side St');
  // Already in the CRM without rent (an earlier import): the first row updates it; the second row is held for review.
  const existing = [{ id: 'c1', building: 'One Main', tenant: 'Acme Inc', sf: 4000 }, { id: 'c2', building: 'Other', tenant: 'Birch', sf: 9000, startingRent: 30 }];
  const plan = L.planCompImport(comps, existing);
  assert.deepEqual(plan.map((p) => [p.status, p.where]), [['duplicate', 'crm'], ['possible', 'file'], ['new', undefined]]);
  assert.equal(plan[0].match.id, 'c1');
  assert.match(plan[1].reason, /Same tenant and building; different terms/);
  // Same deal and terms again: a duplicate; an expansion (different size and date) at the same building: possible.
  const again = L.planCompImport([{ building: 'One Main', tenant: 'Acme', sf: 4000, startingRent: 27.5 }, { building: 'One Main', tenant: 'Acme', sf: 6000, signedDate: '2027-01-01' }], [Object.assign({ id: 'c3' }, comps[0])]);
  assert.deepEqual(again.map((p) => p.status), ['duplicate', 'possible']);
  assert.match(again[1].reason, /different date, size/);
});

test('comp import: defaults are marked so an update keeps the existing comp\'s values', () => {
  const c = L.cleanImportedComp({ building: 'X', startingRent: '30' }, { source: 'Outside broker', assetClass: 'Office' });
  assert.deepEqual([c.source, c.assetClass, c.rateBasis], ['Outside broker', 'Office', 'Full Service ($/SF/yr)']);
  assert.deepEqual(c.guessed, ['source', 'assetClass', 'rateBasis']);
  assert.equal(Object.keys(c).includes('guessed'), false);
  assert.deepEqual(L.cleanImportedComp({ building: 'X', source: 'CoStar', assetClass: 'Office', rateBasis: 'NNN' }).guessed, []);
});

test('research report PDFs: stats table, observations and submarket bullets from page-shaped lines', () => {
  const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length));
  const lines = [
    'Market Overview',
    'Market Observations',
    pad('           Economy', 100) + 'Leasing Market Fundamentals',
    pad(' –   Jobs grew 1.0% year over year in the metro,', 100) + '–   Asking rates rose 1.1% quarter over quarter to',
    pad('     ahead of the national rate.', 100) + '    a new high of $33.93/SF.',
    pad('           Major Transactions', 100) + 'Outlook',
    pad(' –   A firm signed the largest lease of the quarter at 165,000 SF.', 100) + '–   Rents should keep rising, at a slower pace than last year.',
    'Table of Contents',
    'Riverside Office Submarket Overview',
    '  Submarket Statistics – All Classes',
    '                     Total Inventory     Under          Total Vacancy   Qtr Absorption   YTD Absorption   Class A Direct Rent   Class B Direct Rent   Average Direct Asking',
    '                           (SF)     Construction (SF)       Rate            (SF)             (SF)            (Price/SF)            (Price/SF)           Rent (Price/SF)',
    ' Northside          14,875,838          0          32.9 %        96,302          115,116           $32.95            $27.06           $31.83',
    ' North Central/GA 400 Corridor   24,629,724   362,071   7.9 %   -10,877   147,061   $9.82   $15.75   $12.07',
    ' Market            155,510,029          0          26.1 %       603,703          934,425           $37.30            $28.03           $34.47',
    '                                                                                    F I R M   16',
    'Northside Office Submarket Overview',
    '        14.9 MSF        32.9%',
    'Current Conditions                                                     Average Asking Rents ($/SF FS) & Vacancy',
    '                                                                       $32.00',
    ' •   In the second quarter of 2026, the average asking rent in',
    '                                                                       $26.00',
    '     Northside rose by 0.5% quarter over quarter to $31.45/SF.',
    ' •   The vacancy rate decreased by 70 basis points quarter       Notable Lease Transactions',
    '     over quarter to 32.9%.',
    '                                                                                    F I R M   18',
  ];
  const r = L.parseResearchReport(lines, 'Riverside-Office-Report.pdf');
  assert.equal(r.quarter, '2Q26', 'from "the second quarter of 2026"');
  assert.equal(r.assetClass, 'Office');
  assert.equal(r.market, 'Riverside');
  assert.equal(r.rows[0].rentType, 'direct');
  assert.match(L.marketValues({ current: r.rows[0] }, {}).MarketStat, /direct asking rents averaged \$31\.83\/SF/);
  assert.deepEqual(r.rows.map((x) => [x.submarket, x.vacancy, x.askingRent, x.netAbsorption, x.classARent]), [
    ['Northside', 32.9, 31.83, 96302, 32.95],
    ['North Central/GA 400 Corridor', 7.9, 12.07, -10877, 9.82],
    ['Market total', 26.1, 34.47, 603703, 37.3],
  ]);
  assert.deepEqual(r.highlights['Leasing Market Fundamentals'], ['Asking rates rose 1.1% quarter over quarter to a new high of $33.93/SF.']);
  assert.deepEqual(r.highlights.Outlook, ['Rents should keep rising, at a slower pace than last year.']);
  assert.equal(r.highlights.Economy[0], 'Jobs grew 1.0% year over year in the metro, ahead of the national rate.');
  assert.deepEqual(r.submarkets.Northside, ['In the second quarter of 2026, the average asking rent in Northside rose by 0.5% quarter over quarter to $31.45/SF.', 'The vacancy rate decreased by 70 basis points quarter over quarter to 32.9%.']);
  assert.equal(L.parseResearchReport(lines, '3Q26 report.pdf').quarter, '3Q26', 'file name wins');
});

test('layoutLines: PDF text pieces on one baseline join, columns stay apart', () => {
  const items = [
    { str: 'Northside', x: 20, y: 500, w: 45 },
    { str: '32.9', x: 220, y: 500.5, w: 20 },
    { str: ' %', x: 240, y: 500, w: 8 },
    { str: 'Market', x: 20, y: 480, w: 30 },
    { str: '26.1 %', x: 220, y: 480, w: 28 },
  ];
  const lines = L.layoutLines(items);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Northside\s{3,}32\.9 %$/);
  assert.match(lines[1], /^Market\s{3,}26\.1 %$/);
});

test('market stats: CRM submarket names match the report\'s, with Research talking points', () => {
  const names = ['Northside', 'Uptown', 'Northwest/I-75 Corridor', 'CBD Total', 'Market total'];
  assert.equal(L.matchSubmarket(names, 'Uptown - West'), 'Uptown');
  assert.equal(L.matchSubmarket(names, 'Northwest/I-75'), 'Northwest/I-75 Corridor');
  assert.equal(L.matchSubmarket(names, 'northside'), 'Northside');
  assert.equal(L.matchSubmarket(names, 'Lakeview'), '');
  const stats = [
    { quarter: '2Q26', assetClass: 'Office', submarket: 'Uptown', vacancy: 32.2 },
    { quarter: '2Q26', assetClass: 'Office', submarket: 'Market total', vacancy: 26.1 },
  ];
  const reports = [{ quarter: '2Q26', assetClass: 'Office', highlights: { 'Leasing Market Fundamentals': ['Rents hit a new high.'] }, submarkets: { Uptown: ['Rents rose 0.5%.', 'The vacancy rate fell 70 bps to 32.2%.'] } }];
  const m = L.marketStatFor(stats, { assetClass: 'Office', submarket: 'Uptown - West' }, reports);
  assert.equal(m.current.submarket, 'Uptown');
  const v = L.marketValues(m, {});
  assert.equal(v.ResearchNote, 'The vacancy rate fell 70 bps to 32.2%.');
  assert.equal(v.MarketTrend, 'Rents hit a new high.');
});

test('comp import: an earlier copy missing its rent is updated, not held; OpEx is read', () => {
  const broken = { id: 'c1', building: 'The Tower', tenant: 'Acme', sf: 4495, termMonths: 84, escalationPct: 0 };
  const row = L.cleanImportedComp({ building: 'The Tower', tenant: 'Acme', sf: '4495', termMonths: '7', startingRent: '41', escalationPct: '0', opex: '$11.25' }, { termUnit: 'months' });
  assert.deepEqual([row.termMonths, row.startingRent, row.escalationPct, row.opex], [7, 41, 0, 11.25]);
  const [plan] = L.planCompImport([row], [broken]);
  assert.equal(plan.status, 'duplicate');
  assert.match(plan.reason, /missing its rent/);
  // With its rent on file, different terms still need a decision.
  assert.equal(L.planCompImport([row], [Object.assign({}, broken, { startingRent: 38 })])[0].status, 'possible');
  const res = L.rowsToRecords([['Building', 'Tenant', 'OpEx ($/SF)', 'Rent'], ['X', 'Y', '9.50', '30']], L.COMP_IMPORT_ALIASES);
  assert.equal(res.records[0].opex, '9.50');
});

test('submarketBrief: one submarket compared with the market and its last quarter', () => {
  const stats = [
    { quarter: '2Q26', assetClass: 'Office', submarket: 'Northside', vacancy: 26.7, askingRent: 32.07, rentType: 'direct', netAbsorption: 327887, ytdAbsorption: 418576, underConstruction: 0, inventory: 26669010, classARent: 33.65, classBRent: 25.8 },
    { quarter: '2Q26', assetClass: 'Office', submarket: 'Uptown', vacancy: 32.2, askingRent: 47.34 },
    { quarter: '2Q26', assetClass: 'Office', submarket: 'Riverside', vacancy: 18.8, askingRent: 30.33 },
    { quarter: '2Q26', assetClass: 'Office', submarket: 'CBD Total', vacancy: 30.9 },
    { quarter: '2Q26', assetClass: 'Office', submarket: 'Market total', vacancy: 26.1, askingRent: 34.47, inventory: 155510029 },
    { quarter: '1Q26', assetClass: 'Office', submarket: 'Northside', vacancy: 27.9, askingRent: 31.5 },
  ];
  const b = L.submarketBrief(stats, 'Office', 'Northside');
  assert.equal(b.quarter, '2Q26');
  assert.equal(b.previousQuarter, '1Q26');
  assert.deepEqual(b.points, [
    "Northside's office vacancy is 26.7%, down 120 bps from 1Q26, 0.6 points above the market average of 26.1% (2nd highest of 3 submarkets).",
    'Direct asking rent averages $32.07/SF, up 1.8% from 1Q26, 7% below the market average of $34.47.',
    'Class A at $33.65, Class B at $25.80 per SF.',
    'Tenants absorbed a net 327,887 SF in 2Q26 (more move-ins than move-outs), 418,576 SF year to date.',
    'Nothing is under construction, so no new supply is coming to compete with existing buildings.',
    'Northside has 26.7 MSF of office space, 17% of the market.',
  ]);
  assert.match(b.paragraph, /In short, Northside is about as available as the market overall, and demand was positive this quarter\.$/);
  assert.match(L.submarketBrief(stats, 'Office', 'Uptown').paragraph, /more availability than the market overall/);
  assert.match(L.submarketBrief(stats, 'Office', 'Market total').points[0], /^The market's office vacancy is 26\.1%\.$/);
  assert.equal(L.submarketBrief(stats, 'Office', 'Nowhere'), null);
});

test('prospecting report: prospects only, initial vs follow-up, opens, replies and who to follow up with', () => {
  const companies = [
    { id: 'a', name: 'Acme', relationship: 'Tenant / prospect', status: 'Contacted', leaseExpiration: '2027-06-30', leadTemp: 'Warm' },
    { id: 'b', name: 'Birch', status: 'Contacted' },
    { id: 'c', name: 'Cedar (client)', status: 'Active Client' },
    { id: 'd', name: 'Dune Realty', relationship: 'Landlord / ownership' },
    { id: 'e', name: 'Elm (deal)', status: 'Engaged' },
  ];
  const contacts = [{ id: 'pa', companyId: 'a', firstName: 'Pat', lastName: 'Lee' }, { id: 'pb', companyId: 'b', firstName: 'Sam' }, { id: 'me', companyId: 'x', firstName: 'Jo', email: 'jo@firm.test' }];
  const deals = [{ id: 'd1', companyId: 'e', stage: 'Touring', createdAt: '2026-10-01T00:00:00Z' }];
  const activities = [
    { type: 'Email', date: '2026-10-05', companyId: 'a', contactId: 'pa', subject: 'Intro', opens: 4, template: 'Building intro' },
    { type: 'Email', date: '2026-10-20', companyId: 'a', contactId: 'pa', subject: 'Following up', opens: 6, template: 'Following up' },
    { type: 'Email', date: '2026-10-21', companyId: 'b', contactId: 'pb', subject: 'Intro', opens: 1, template: 'Building intro' },
    { type: 'Email', date: '2026-10-22', companyId: 'b', subject: 'Reply: Intro', inbound: true, contactId: 'pb' },
    { type: 'Call', date: '2026-10-22', companyId: 'a', contactId: 'pa', outcome: 'Left voicemail' },
    { type: 'Email', date: '2026-10-21', companyId: 'c', subject: 'Check-in' },
    { type: 'Email', date: '2026-10-21', companyId: 'd', subject: 'Availability?' },
    { type: 'Email', date: '2026-10-21', companyId: 'e', subject: 'Tour recap' },
    { type: 'Email', date: '2026-10-21', companyId: 'a', contactId: 'me', subject: 'Internal fwd' },
    { type: 'Meeting', date: '2026-10-23', companyId: 'b', subject: 'Intro meeting' },
  ];
  const data = { companies, contacts, deals, activities };
  const { touches } = L.prospectTouches(data, { internalDomain: 'firm.test' });
  assert.deepEqual(touches.map((t) => [t.companyId, t.stage]), [['a', 'Initial outreach'], ['a', 'Follow-up'], ['b', 'Initial outreach'], ['a', 'Follow-up']]);
  const r = L.prospectingReport(data, { today: '2026-10-26', period: 'lastWeek', internalDomain: 'firm.test' });
  assert.deepEqual([r.range.from, r.range.to], ['2026-10-19', '2026-10-25']);
  assert.deepEqual(r.totals, { initial: 1, followUp: 2, emails: 2, calls: 1, linkedin: 0, companies: 2, opened: 2, openRate: 1, responses: 1, responseRate: 1 / 3, meetings: 1, conversation: 0 });
  assert.deepEqual(r.lists.initial.map((x) => [x.company, x.contact, x.subject]), [['Birch', 'Sam', 'Intro']]);
  assert.deepEqual(r.lists.followUp.map((x) => [x.company, x.type]), [['Acme', 'Call'], ['Acme', 'Email']]);
  assert.deepEqual(r.lists.opened.map((x) => [x.company, x.opens]), [['Acme', 6], ['Birch', 1]]);
  assert.deepEqual(r.lists.meetings.map((x) => x.company), ['Birch']);
  assert.deepEqual(r.responded.map((x) => [x.company, x.contact, x.how]), [['Birch', 'Sam', 'Replied: Intro']]);
  assert.deepEqual(r.openedNoReply.map((x) => [x.company, x.opens]), [['Acme', 6]]);
  assert.equal(r.followUps.length, 1);
  assert.equal(r.followUps[0].company, 'Acme');
  assert.match(r.followUps[0].why, /warm lead · lease expires in 8 mo · call 4 days ago, touch 3/);
  const byTemplate = Object.fromEntries(r.working.byTemplate.map((x) => [x.key, [x.sent, x.responded]]));
  assert.deepEqual(byTemplate['Building intro'], [2, 1]);
  assert.equal(r.weeks.length, 8);
  assert.deepEqual(r.weeks[6], { from: '2026-10-19', initial: 1, followUp: 2, responses: 1 });
  const text = L.prospectingRecapText(r);
  assert.match(text, /^Prospecting recap: Last week \(Oct 19, 2026 – Oct 25, 2026\)/);
  assert.match(text, /1 initial outreach and 2 follow-ups to 2 companies/);
  assert.match(text, /Follow up next:\n- Acme \(Pat Lee\)/);
  assert.deepEqual(L.periodRange('lastMonth', '2026-10-26'), { from: '2026-09-01', to: '2026-09-30', label: 'September' });
});

test('prospecting: a conversation after a reply and repeat log entries are not counted as follow-ups', () => {
  const data = {
    companies: [{ id: 'a', name: 'Acme', status: 'Contacted' }],
    contacts: [{ id: 'p1', companyId: 'a', firstName: 'Pat' }, { id: 'p2', companyId: 'a', firstName: 'Sam' }],
    deals: [],
    activities: [
      { id: '1', type: 'Email', date: '2026-10-05', companyId: 'a', contactId: 'p1', subject: 'Intro' },
      { id: '2', type: 'Email', date: '2026-10-05', companyId: 'a', contactId: 'p2', subject: 'Intro' },
      { id: '3', type: 'Email', date: '2026-10-07', companyId: 'a', contactId: 'p1', subject: 'Reply: Intro', inbound: true },
      { id: '4', type: 'Email', date: '2026-10-08', companyId: 'a', contactId: 'p1', subject: 'RE: Intro' },
      { id: '5', type: 'Email', date: '2026-10-09', companyId: 'a', contactId: 'p1', subject: 'RE: Intro times' },
      { id: '6', type: 'Email', date: '2026-12-01', companyId: 'a', contactId: 'p1', subject: 'Checking back in' },
    ],
  };
  const t = L.prospectTouches(data, {});
  assert.deepEqual(t.touches.map((x) => [x.id, x.stage]), [['1', 'Initial outreach'], ['6', 'Follow-up']]);
  assert.deepEqual(t.conversation.map((x) => x.id), ['4', '5']);
  assert.equal(data.activities[0].touchNo, undefined, 'store records are not changed');
  const r = L.prospectingReport(data, { today: '2026-10-11', period: 'thisWeek' });
  assert.equal(r.totals.conversation, 2);
  assert.equal(r.totals.followUp, 0);
});

test('alignComps: pairs sheet rows with CRM comps whatever their terms, lists differences, missing rows and leftovers', () => {
  const sheet = [
    L.cleanImportedComp({ tenant: 'Acme, Inc.', building: 'The Tower', address: '6 Main St', sf: '4495', termMonths: '7', startingRent: '41', rateBasis: 'FS', escalationPct: '0', assetClass: 'Office' }, { termUnit: 'months', source: 'X' }),
    L.cleanImportedComp({ tenant: 'Birch', address: '2 Side St', sf: '2000', startingRent: '20', assetClass: 'Office' }, { termUnit: 'months' }),
    L.cleanImportedComp({ tenant: 'Birch Co', address: '2 Side St', sf: '2000', startingRent: '19', assetClass: 'Office' }, { termUnit: 'months' }),
  ];
  const crm = [
    { id: 'old', tenant: 'Acme', building: 'The Tower', sf: 4495, termMonths: 84, assetClass: 'Office', source: 'Mine' },
    { id: 'old2', tenant: 'ACME INC', building: 'The Tower', sf: 4495, assetClass: 'Office' },
    { id: 'other', tenant: 'Cedar', building: 'Elsewhere', sf: 9000, assetClass: 'Office' },
    { id: 'ind', tenant: 'Dune', building: 'Warehouse', assetClass: 'Industrial' },
  ];
  const a = L.alignComps(sheet, crm);
  assert.equal(a.matched.length, 1);
  assert.equal(a.matched[0].existing.id, 'old');
  assert.deepEqual(a.matched[0].diffs.map((d) => [d.field, d.crm, d.file]), [
    ['address', '', '6 Main St'],
    ['tenant', 'Acme', 'Acme, Inc.'],
    ['termMonths', 84, 7],
    ['startingRent', '', 41],
    ['rateBasis', '', 'Full Service ($/SF/yr)'],
    ['escalationPct', '', 0],
  ]);
  assert.deepEqual(a.missing.map((m) => [m.row, m.repeatOf]), [[1, -1], [2, 1]]);
  assert.deepEqual(a.extras.map((e) => [e.existing.id, e.leftover]), [['old2', true], ['other', false]]);
});

test('rentMath works out monthly rent and the increase over 5 years', () => {
  assert.deepEqual(L.rentMath(17000, 12.75), { monthly: '$18,000', annual: '$217,000', increase: '$80,000' });
  assert.deepEqual(L.rentMath('2,000', '$15'), { monthly: '$2,500', annual: '$30,000', increase: '$11,000' });
  assert.equal(L.rentMath(17000, 12.75, 0.3).increase, '$50,000');
  assert.deepEqual(L.rentMath('', 12.75), { monthly: '', annual: '', increase: '' });
});

test('bracketSlots finds the outermost bracketed notes', () => {
  const t = 'A [fact, e.g. "[tenant] renewed"] on [day].';
  assert.deepEqual(L.bracketSlots(t).map((b) => b.raw), ['[fact, e.g. "[tenant] renewed"]', '[day]']);
  assert.deepEqual(L.bracketSlots('no notes'), []);
});

test('fillTemplate uses fill-ins typed in the draft dialog', () => {
  const ctx = { company: { name: 'Acme', building: 'Uptown Park' }, contact: { firstName: 'Sam' } };
  const t = 'With {CompBuilding} quoting {Rate} NNN, {SF} runs {MonthlyRent} a month, {AnnualIncrease} more a year. {Partner} and I, {MeetingDay}? [note]';
  assert.equal(L.fillTemplate(t, ctx), 'With Uptown Park quoting [Rate] NNN, [SF] runs [MonthlyRent] a month, [AnnualIncrease] more a year. [Partner] and I, [MeetingDay]? [note]');
  const inputs = { Rate: '12.75', SF: '17000', CompBuilding: 'Royal Ridge', Partner: 'Jo Smith', MeetingDay: '2026-11-10', '[note]': 'Thanks' };
  assert.equal(
    L.fillTemplate(t, Object.assign({ inputs }, ctx)),
    'With Royal Ridge quoting $12.75 NNN, 17,000 SF runs $18,000 a month, $80,000 more a year. Jo Smith and I, Tuesday, Nov 10? Thanks'
  );
  // The company's SF and partner fill in on their own; a deal partner wins.
  assert.equal(L.fillTemplate('{SF} {Partner}', { company: { sfOccupied: 5000, partner: 'Lee Park' } }), '5,000 SF Lee Park');
  assert.equal(L.fillTemplate('{Partner}', { company: { partner: 'Lee Park' }, partner: 'Jo Smith' }), 'Jo Smith');
});

test('templateFillIns lists what a template needs, in order', () => {
  const ctx = { company: { name: 'Acme', building: 'Uptown Park', sfOccupied: 17000 }, contact: { firstName: 'Sam' }, rentGrowth: 0.5 };
  const f = L.templateFillIns('Hi {FirstName} {LastName}, {SF} runs {AnnualIncrease} more. {Partner}, [specific day]', ctx);
  assert.deepEqual(
    f.map((x) => [x.key, x.value]),
    [['LastName', ''], ['SF', '17000'], ['Rate', ''], ['RateBasis', 'NNN'], ['OpEx', ''], ['RentGrowth', '50'], ['Partner', ''], ['[specific day]', '']]
  );
  assert.equal(f.find((x) => x.key === 'SF').saveTo, 'sfOccupied');
  assert.equal(f.find((x) => x.key === '[specific day]').label, 'specific day');
  // A placeholder inside a bracketed note is part of that note, not a fill-in of its own.
  assert.deepEqual(L.templateFillIns('[fact about {Submarket}]', ctx).map((x) => x.key), ['[fact about {Submarket}]']);
});

test('nextBusinessDays skips weekends', () => {
  assert.deepEqual(L.nextBusinessDays('2026-10-30', 3), ['2026-11-02', '2026-11-03', '2026-11-04']);
});

test('quoted rates are remembered by building and flagged after 6 months', () => {
  let rates = L.rememberRate({}, 'Uptown Park', '12.75', '2026-10-27');
  assert.deepEqual(rates['uptown park'], { building: 'Uptown Park', rate: 12.75, date: '2026-10-27' });
  const fresh = L.rememberedRate(rates, '100 Uptown Park Pkwy', '2027-02-01');
  assert.equal(fresh.rate, 12.75);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.note, 'Saved for Uptown Park on Oct 27, 2026: $12.75 NNN.');
  const old = L.rememberedRate(rates, 'Uptown Park', '2027-04-27');
  assert.equal(old.stale, true);
  assert.equal(old.note, 'Quoted Oct 27, 2026 ($12.75 NNN), 6 months ago. Re-confirm the rate at Uptown Park before sending.');
  assert.equal(L.rememberedRate(rates, 'Acme Tower', '2026-11-01'), null);
  assert.equal(L.rememberRate(rates, 'Acme Tower', '', '2026-11-01')['acme tower'], undefined);
  // The draft starts with the rate saved for the tenant's building.
  const f = L.templateFillIns('{Rate}', { company: { building: 'Uptown Park' }, buildingRates: rates, today: '2027-05-01' });
  assert.deepEqual([f[0].value, f[0].stale], ['12.75', true]);
});

test('working a deal alone switches partner wording to first person', () => {
  const t = '{Partner} and I represent tenants. {Partner} and I are happy to help. Could we grab 15 minutes? If not, let us know.';
  const ctx = { company: { name: 'Acme' } };
  assert.equal(L.fillTemplate(t, Object.assign({ partner: 'Jo Smith' }, ctx)), 'Jo Smith and I represent tenants. Jo Smith and I are happy to help. Could we grab 15 minutes? If not, let us know.');
  const solo = 'I represent tenants. I\'m happy to help. Could I grab 15 minutes? If not, let me know.';
  assert.equal(L.fillTemplate(t, Object.assign({ inputs: { Solo: 'yes', Partner: 'Jo Smith' } }, ctx)), solo);
  assert.equal(L.fillTemplate(t, { company: { partner: 'None' } }), solo);
  // Unticking the box in the draft wins over a saved "None".
  assert.equal(L.fillTemplate('{Partner} and I', { company: { partner: 'None' }, inputs: { Solo: 'no', Partner: 'Jo Smith' } }), 'Jo Smith and I');
  assert.equal(L.soloText('My partner {Partner} and I are tenant rep brokers with {MyFirm}.'), "I'm a tenant rep broker with {MyFirm}.");
  assert.equal(L.soloText('My partner Jo Smith and I spend time in Uptown and wanted to introduce ourselves. We\'re tenant rep brokers.'), "I spend time in Uptown and wanted to introduce myself. I'm a tenant rep broker.");
  assert.equal(L.templateFillIns('{Partner}', { company: { partner: 'None' } })[0].checked, true);
});

test('quoted rates can be NNN, NNN plus OpEx, or full service', () => {
  const ctx = (inputs) => ({ company: { sfOccupied: 17000 }, inputs: Object.assign({ Rate: '12.75' }, inputs) });
  const t = 'Quoting {Rate} NNN, {SF} runs {MonthlyRent} a month, {AnnualIncrease} more a year.';
  assert.equal(L.fillTemplate(t, ctx({})), 'Quoting $12.75 NNN, 17,000 SF runs $18,000 a month, $80,000 more a year.');
  assert.equal(L.fillTemplate(t, ctx({ RateBasis: 'NNN + OpEx', OpEx: '3.50' })), 'Quoting $12.75 NNN plus $3.50 OpEx, 17,000 SF runs $23,000 a month, $80,000 more a year.');
  assert.equal(L.fillTemplate('{Rate}', ctx({ RateBasis: 'NNN + OpEx' })), '$12.75 NNN plus [OpEx] OpEx');
  assert.equal(L.fillTemplate('{Rate}', ctx({ Rate: '28', RateBasis: 'Full service' })), '$28.00 full service');
  const rates = L.rememberRate({}, 'Uptown Park', '12.75', '2026-10-27', 'NNN + OpEx', '3.5');
  assert.deepEqual(rates['uptown park'], { building: 'Uptown Park', rate: 12.75, date: '2026-10-27', basis: 'NNN + OpEx', opex: 3.5 });
  assert.equal(L.rememberedRate(rates, 'Uptown Park', '2026-11-01').note, 'Saved for Uptown Park on Oct 27, 2026: $12.75 NNN plus $3.50 OpEx.');
  const f = L.templateFillIns('{Rate}', { company: { building: 'Uptown Park' }, buildingRates: rates, today: '2026-11-01' });
  assert.deepEqual(f.map((x) => [x.key, x.value]), [['Rate', '12.75'], ['RateBasis', 'NNN + OpEx'], ['OpEx', '3.5']]);
});

test('quotedRateList lists saved quotes with their age', () => {
  let rates = L.rememberRate({}, 'Uptown Park', '12.75', '2026-03-01');
  rates = L.rememberRate(rates, 'Acme Tower', '28', '2026-10-01', 'Full service');
  const all = L.quotedRateList(rates, '', '2026-10-27');
  assert.deepEqual(all.map((r) => [r.building, r.text, r.stale]), [['Acme Tower', '$28.00 full service', false], ['Uptown Park', '$12.75 NNN', true]]);
  assert.deepEqual(L.quotedRateList(rates, 'uptown', '2026-10-27').map((r) => r.key), ['uptown park']);
});

test('meeting days read as one, two or three dates', () => {
  assert.equal(L.meetingDays('2026-11-10'), 'Tuesday, Nov 10');
  assert.equal(L.meetingDays('2026-11-11,2026-11-10'), 'Tuesday, Nov 10 or Wednesday, Nov 11');
  assert.equal(L.meetingDays('2026-11-10,2026-11-11,2026-11-12'), 'Tuesday, Nov 10, Wednesday, Nov 11 or Thursday, Nov 12');
  assert.equal(L.meetingDays(''), '');
});

test('the standard closing switches to first person when working alone', () => {
  const close = "We'd love 15 minutes to see if we can help your team find the right long-term option. How does {MeetingDay} look for a brief call with our team?";
  assert.equal(
    L.fillTemplate(close, { company: { partner: 'None' }, inputs: { MeetingDay: '2026-11-10' } }),
    "I'd love 15 minutes to see if I can help your team find the right long-term option. How does Tuesday, Nov 10 look for a brief call?"
  );
});

test('Flex research: detected from the report, kept apart from industrial, used for office & industrial companies', () => {
  assert.equal(L.researchAsset('R&D/Flex'), 'Flex');
  assert.equal(L.researchAsset('Warehouse'), 'Industrial');
  assert.equal(L.researchAsset('Office'), 'Office');
  const lines = ['Riverside Flex Submarket Overview', '  Submarket Statistics – All Classes', '            Total Inventory   Under Construction   Total Vacancy Rate   Qtr Absorption   YTD Absorption   Direct Asking Rent', ' Northside      4,500,000      0      9.1 %      12,000      30,000      $14.25', ' Market Total   20,000,000     0      8.0 %      50,000      90,000      $13.10'];
  const r = L.parseResearchReport(lines, '2Q26-Riverside-Flex-Market-Report.pdf');
  assert.equal(r.assetClass, 'Flex');
  assert.deepEqual(r.rows.map((x) => [x.submarket, x.vacancy, x.askingRent]), [['Northside', 9.1, 14.25], ['Market total', 8, 13.1]]);
  // An industrial report that merely has an R&D/Flex rent column stays industrial.
  assert.equal(L.parseResearchReport(['Riverside Industrial Submarket Overview'], 'Industrial-Report.pdf').assetClass, 'Industrial');
  const stats = r.rows.concat([{ quarter: '2Q26', assetClass: 'Office', submarket: 'Northside', vacancy: 25 }]);
  assert.equal(L.marketStatFor(stats, { assetClass: 'Office & Industrial', submarket: 'Northside' }).current.vacancy, 9.1);
  assert.equal(L.marketStatFor(stats, { assetClass: 'Office', submarket: 'Northside' }).current.vacancy, 25);
  assert.equal(L.marketStatFor(r.rows.map((x) => Object.assign({}, x, { assetClass: 'Office' })), { assetClass: 'Office & Industrial', submarket: 'Northside' }).current.assetClass, 'Office', 'no flex on file: falls back to office');
});

test('single-submarket snapshot reports: tiles, absorption and last-quarter changes from the bullets, notable leases', () => {
  const pad = (s, n) => s + ' '.repeat(Math.max(2, n - s.length));
  const lines = [
    pad('', 170) + '3 Q 2 6 S U B M A R K E T S N A P S H O T',
    'Custom Riverside Corridor Flex Submarket Overview',
    '             4.2 MSF                                        23.3%                                      $13.43/SF                                              -206,642 SF                                              0 SF',
    '           Total Inventory                            Total Vacancy Rate                          Average Asking Rate                                      YTD 2026 Net Absorption                              Under Construction',
    pad('Current Conditions', 69) + 'Average Asking Rents ($/SF NNN) & Vacancy',
    pad(' •   At the end of the third quarter of 2026, average asking rent', 69) + '$2.00',
    '     increased 3.8% quarter over quarter to $13.43/SF NNN.',
    ' •   Net absorption totaled negative 87,705 SF for the quarter,',
    '     marking the third consecutive quarter of occupancy losses.',
    pad('', 69) + pad('Notable Lease Transactions', 90) + 'Notable Sale',
    ' •   The vacancy rate rose 210 basis points quarter over quarter',
    pad('     to 23.3%.', 73) + pad('Building Name', 34) + pad('Tenant', 24) + pad('Type', 9) + 'Size (SF)',
    pad('', 75) + pad('100 Main St', 32) + pad('Acme Labs', 23) + pad('Direct New', 13) + pad('27,936', 20) + '200 Oak Rd   Uptown Partners   $16.9 MM',
    pad('', 75) + pad('200 Side St', 32) + pad('Birch Co', 23) + pad('Renewal', 13) + '7,775',
    pad('', 170) + 'F I R M',
  ];
  const r = L.parseResearchReport(lines, '3Q26_Custom_Riverside_Corridor_Flex_Market_Overview.pdf');
  assert.deepEqual([r.quarter, r.assetClass], ['3Q26', 'Flex']);
  assert.equal(r.rows.length, 1);
  const row = r.rows[0];
  assert.deepEqual(
    [row.submarket, row.inventory, row.vacancy, row.askingRent, row.rentType, row.ytdAbsorption, row.underConstruction, row.netAbsorption],
    ['Riverside Corridor', 4200000, 23.3, 13.43, 'total', -206642, 0, -87705]
  );
  assert.deepEqual(row.qoq, { vacancyBps: 210, rentPct: 3.8 });
  assert.deepEqual(r.deals['Riverside Corridor'], [
    { building: '100 Main St', tenant: 'Acme Labs', type: 'Direct New', sf: 27936 },
    { building: '200 Side St', tenant: 'Birch Co', type: 'Renewal', sf: 7775 },
  ]);
  assert.equal(L.previousQuarter('1Q27'), '4Q26');
  assert.equal(L.previousQuarter('3Q26'), '2Q26');
  const prev = L.previousStat(row, [row]);
  assert.deepEqual([prev.quarter, prev.vacancy, prev.askingRent, prev.derived], ['2Q26', 21.2, 12.94, true]);
  const b = L.submarketBrief(r.rows, 'Flex', 'Riverside Corridor');
  assert.equal(b.points[0], "Riverside Corridor's flex vacancy is 23.3%, up 210 bps from 2Q26.");
  assert.equal(b.points[1], 'Asking rent (NNN) averages $13.43/SF, up 3.8% from 2Q26.');
  assert.deepEqual(L.bulletFacts(['Move-ins pushed vacancy down 26 basis points quarter over quarter to 26.1%.']), { vacancyBps: -26 });
});

test('notable leases: tenant and type only one space apart', () => {
  const pad = (s, n) => s + ' '.repeat(Math.max(2, n - s.length));
  const lines = ['Riverside Flex Submarket Overview', pad('', 80) + pad('Notable Lease Transactions', 90) + 'Notable Sale', pad('', 84) + pad('3355 Main Blvd', 29) + 'Acme Labs Ltd. Direct New  27,936', pad('', 84) + pad('64 Side Blvd', 29) + pad('Birch Pros', 16) + 'Renewal & Expansion    7,775', pad('', 84) + pad('2300 Lake Pkwy', 29) + pad('', 16) + 'New Lease    22,328', pad('', 84) + pad('4400 Green Pkwy', 29) + 'Direct New    21,790'];
  const r = L.parseResearchReport(lines, 'flex.pdf');
  assert.deepEqual(r.deals.Riverside.map((d) => [d.tenant, d.type, d.sf]), [['Acme Labs Ltd.', 'Direct New', 27936], ['Birch Pros', 'Renewal & Expansion', 7775], ['', 'New Lease', 22328], ['', 'Direct New', 21790]]);
});

test('report quarter: letter-spaced page stamp, else the latest quarter the text mentions', () => {
  const body = [' •   Following its last delivery in the first quarter of 2026, nothing has broken ground.', ' •   At the end of the third quarter of 2026, asking rent increased 1.0% quarter over quarter.', ' •   Vacancy is down from the first quarter of 2026.'];
  assert.equal(L.parseResearchReport(['West Riverside Flex Submarket Overview'].concat(body), 'West Riverside Flex.pdf').quarter, '3Q26');
  assert.equal(L.parseResearchReport(['                3 Q 2 6 S U B M A R K E T S N A P S H O T', 'West Riverside Flex Submarket Overview'].concat(body), 'report.pdf').quarter, '3Q26');
  assert.equal(L.parseResearchReport(['FIRM.COM   2Q26', 'Riverside Office Submarket Overview'].concat(body), 'report.pdf').quarter, '2Q26', 'a stamp beats the text');
});
