# Tenant Rep CRM

A lightweight CRM built for **commercial real estate tenant representation**: prospecting and tracking
**office and industrial** occupiers, watching lease expirations, and running deals from pitch to executed lease.

It's a single-page web app with **no server, no install and no build step**. Open `index.html` in Chrome, Edge,
Safari or Firefox and it works. Your data stays in your browser on your computer.

## Features

| Area | What it does |
| --- | --- |
| **Dashboard** | KPIs (active prospects, leases expiring ≤ 24 mo, open and weighted pipeline, closed commission YTD, overdue follow-ups), follow-ups due this week, *who to call next*, pipeline by stage, tenants who *should be in the market now*, stale prospects, and expiring rep agreements. |
| **Companies & prospects** | Office / Industrial toggle, search, and filters for status, expiration window, submarket and priority. Sort by prospect score, expiration, size or longest time since last touch. Export the filtered list to CSV as a call list. |
| **Prospect score (0–100)** | Ranks who to call: lease timing (peaks 13–24 months out), size, growth signal, your A/B/C priority, and a *coverage gap* bonus for accounts nobody has touched lately. Each company page shows the breakdown. |
| **Lease timing** | Months to expiration, plus a recommended *start-the-process-by* date based on size (12 months under 10k SF, up to 36 months for 100k+ SF). Tenants inside that window that you haven't engaged are flagged ⚑. |
| **Lease expiration calendar** | Expirations grouped by quarter over the next 12–60 months, filterable by asset class, with an exportable call list. |
| **Company detail** | Current occupancy (address, building, submarket, SF, headcount, SF/person, landlord, rent, options, plus clear height and docks for industrial), contacts, deals and a full activity timeline. |
| **Contacts** | Decision-maker / influencer / gatekeeper roles, click-to-call, click-to-email, LinkedIn links. |
| **Today** | A daily to-do list (the home page): follow-ups you promised, who to call or email next (lead follow-ups first, then the best untouched leads, up to a daily goal you set), deals that have gone quiet or passed their target date, records to update, and a door-knocking route when several leads share a building. One tap logs a call or email. Do-Not-Call numbers are never offered as tap-to-call. |
| **Leads** | Companies you're working to win before there's a deal, in stages New → Initial Outreach → Follow Up → Engaged → Secured Lead (or Dead Lead), with Hot / Warm / Cold temperature. Change the stage right in the list; marking a lead Secured automatically creates its deal in Intro Call. Companies flagged Do Not Contact (Firm do-not-call list, not interested, working with another broker) stay in the CRM but never appear on Today. |
| **Deal pipeline** | A drag-and-drop board or a table. Stages run Intro Call → Market Survey → Touring → RFP → LOI → Lease Negotiation → Closed Won / Lost. Deal types: new lease, renewal, expansion, relocation, blend & extend, sublease, purchase, build-to-suit. |
| **Commission estimates** | Aggregate rent over the term with annual escalations and free rent, for $/SF/yr or $/SF/mo rates. Commission % or a flat override, your split %, and probability weighting (stage default or your own number). |
| **Requirements** | Office: headcount and parking. Industrial: clear height, dock and drive-in doors, power. The form shows only the fields that fit the deal's asset class. |
| **Market survey & tours** | Per deal, track candidate buildings: available SF, asking rent, estimated year-1 rent, TI, free rent, clear height and docks, tour date, and status (Identified → Toured → Proposal → Shortlisted → Selected / Rejected). |
| **Portfolio & production** | Closed-deal metrics: deals closed, total SF, total rent $ (aggregate lease value), commission earned, commission per SF and as a % of rent. Broken down by year, asset class, deal type and top clients, with Office/Industrial and year filters. Import your portfolio analysis as CSV (columns like *Client, Close Date, SF, Total Rent, Commission, Deal Type, Property Type, Term, Expiration* are recognized). Each new lease expiration is copied to the client, so **Renewals coming from your closed deals** lists your warmest renewal prospects. Deals without recorded results show estimates, flagged *est.* |
| **HubSpot & ZoomInfo data** | Companies keep a *last contacted* date (counted as a touch for stale-prospect tracking), a link back to the HubSpot record, and the ZoomInfo company size, HQ and industry. See *Syncing from HubSpot / ZoomInfo* below. |
| **Follow-ups** | Log calls, emails, meetings, tours, pitches and proposals with a follow-up date. *Save & schedule next touch* queues the next step in one click. Overdue items show in red and as a count in the sidebar. |
| **CSV import** | Import tenants and contacts from CoStar, Reonomy, ZoomInfo, Sales Navigator or Excel. Column names are recognized automatically (Tenant Name, SF Occupied, Expiration Date, Submarket, Landlord, Employees, Property Type…), along with common date formats (`6/30/2028`, `12/2027`, `Dec 2027`, `Q3 2027`, Excel serials). You get a preview before anything is written. Re-importing updates matching companies instead of creating duplicates. |
| **Backup / restore** | One-click JSON backup and restore (replace or merge). A banner reminds you if you haven't backed up in 14 days. |

## Getting started

1. **Open it.** Double-click `index.html`. Or, to serve it locally, run `npm start` and go to <http://localhost:8080>.
2. **Explore with demo data.** On the welcome screen click **Load demo data** to get fictional office and industrial tenants.
   When you're ready for real data, use **Import / Settings → Delete all data**.
3. **Set your defaults.** Under **Import / Settings**, enter your default commission %, escalation % and term.
4. **Import your prospects.** Export a tenant list from CoStar (or any spreadsheet) as CSV, then use **Import companies / tenants**.
   **Download template** gives you a blank CSV with the expected columns.

## Google Sheet sync (portfolio tracker)

The Portfolio page can stay in sync, both ways, with a Google Sheet that tracks your closed deals (columns like *Tenant Name, Type, Building, Submarket, Vertical, SF, Total Consideration, Gross Commission, Invoice #1/#2 Date, Notes*). Columns are matched by their header text, so their order doesn't matter.

**Setup (about 5 minutes, once):**
1. In the sheet: **Extensions → Apps Script**. Replace the editor contents with [`integrations/google-sheets-sync.gs`](integrations/google-sheets-sync.gs) and save.
2. Pick the **setup** function and click **Run**, then approve the permissions prompt. It adds a **CRM ID** column and prints your **sync key** in the execution log.
3. **Deploy → New deployment → Web app**. Set *Execute as* to **Me** and *Who has access* to **Anyone**, then copy the web app URL.
4. In the CRM: **Import / Settings → Google Sheet sync**. Paste the URL and the sync key, then click **Sync now**.

**How it behaves:**
- **When it syncs:** when you open the Portfolio page, every 2 minutes while it's open, after you save a deal marked *Track on my portfolio Google Sheet*, and when you click **Sync Google Sheet**.
- **Matching rows to deals:** sheet rows match existing deals by the CRM ID column. On the first sync, a row matches by tenant name and close date, so deals already synced from HubSpot aren't duplicated.
- **Which side wins:** whichever side changed since the last sync. If both changed the same deal, the sheet wins and the sync message tells you.
- **New deals:** a closed deal added in the CRM is inserted directly under the last deal row, inside your Total formulas' range.
- **Rescinded deals:** rows whose notes say rescinded, written off or cancelled are tracked as *Closed Lost* and left out of the totals.
- **Columns left alone:** admin columns (PT #, booked date, cash received, OTT check) are never overwritten by the CRM.
- **Security:** the sheet can stay *Restricted*. The script runs as you, and every request must carry the sync key. To revoke access, run `rotateKey`.

## Syncing from HubSpot / ZoomInfo

HubSpot and ZoomInfo can't be called from a browser page, so data comes in as a backup file:

1. Ask Claude (with the HubSpot and ZoomInfo connectors) to pull your companies, contacts and deals and build an import file.
2. In the CRM, go to **Import / Settings → Restore backup…**, pick the file, and choose **Cancel = merge** to keep anything you've added in the CRM.
   Records are keyed by their HubSpot IDs, so re-importing later updates them in place.

How CRM data maps (adjust the import script to your own setup):

- **Lifecycle stage:** customer → Active Client, opportunity → Engaged, lead → Contacted (if ever contacted) or Target. Companies with an open deal become Engaged.
- **Deal stages** are mapped onto the CRM's tenant-rep stages (survey, touring, LOI, negotiation, closed).
- **Submarket abbreviations** can be expanded to full names.
- **Asset class** isn't stored in HubSpot, so it's inferred: Office when a building name is on file, Industrial for logistics, manufacturing and supply companies. These records are tagged *asset class inferred*.
- **ZoomInfo headcount** is company-wide. It fills the local headcount only for companies headquartered in your home state. Otherwise it appears as *Company size (ZoomInfo)*.

## Your data, and backing it up

Everything is saved in your browser's local storage on the computer you're using. Nothing is sent anywhere.
That means:

- **Export a backup regularly** (Import / Settings → Export backup) and keep the `.json` file in OneDrive, Google Drive or Dropbox.
- To move to another computer or browser, use **Restore backup** there.
- Clearing your browser's site data erases the CRM. Restore from your latest backup if that happens.

## Hosting it online (optional)

To reach it from any computer at a fixed URL, turn on **GitHub Pages** for this repo
(Settings → Pages → Deploy from branch → `main` / root). Each browser still keeps its own data,
so use backup and restore to move data between devices.

## Development

Plain HTML, CSS and JavaScript with no dependencies.

```
index.html          app shell
css/styles.css      styles (light and dark mode, mobile layout)
js/logic.js         pure business logic: dates, scoring, commissions, CSV parsing (unit tested)
js/store.js         localStorage data layer, backup/restore, demo data
js/app.js           views, forms, routing, import/export
tests/              node:test unit tests
```

Run the tests with `npm test` (Node 18 or newer).
