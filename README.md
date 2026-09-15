# Renso Group CRM

**Commercial operating system for Renso Group**  
843 Finchley Rd, London NW11 8NA

Apple-level UI discipline · Renso navy `#0B2B47` · Black / white control system · Zero gold · English only · Fully portable · Vercel-compatible client demo

---

## Quick start

```bash
# Install
npm install

# Local development
npm run dev
# → http://localhost:5173

# Production build
npm run build
npm run preview
```

### Demo login

| Field    | Value                 |
|----------|-----------------------|
| Email    | `roni@rensogroup.com` |
| Password | `roni`                |

Signs in as **Roni Ornadel** (Sales Director / Administrator).

---

## Deploy to Vercel

```bash
npm install
npx vercel --prod
```

Or connect the GitHub repository in the Vercel dashboard.  
`vercel.json` is already configured for Vite (SPA rewrites, correct output directory).

Environment variables: see `.env.example`. The current client-side demo does not require secrets. Live integrations, server-side authentication, persistence, file storage, and scheduled jobs require a backend before production use.

---

## Deploy to GitHub

```bash
git init
git add .
git commit -m "Renso Group CRM — pre-production"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/renso-group-crm.git
git push -u origin main
```

Then import the repo in Vercel.

---

## Intelligence layer (v24)

Four modules sit on top of the thirteen requirements, each closing a gap the
previous build had explicitly flagged as open.

| Module | What it does | Gap it closes |
|---|---|---|
| **Signals** | Reads across all modules and returns the ranked list of what needs a person today, with the evidence and the action on every row. Exports a plain-text morning brief. | Fourteen modules, fourteen places to look. |
| **Deal Desk** | Line-level margin resolved from approved supplier offers, with the cost basis stated on every figure. Landed-cost calculator (FX, freight, duty, insurance) and a two-way price solver. | *"Gross and net margin remain estimates until purchase cost is linked at line level."* |
| **Credit Control** | Forward exposure per account — unpaid invoices + uninvoiced orders + accepted quotations — banded clear / watch / strained / stop, with per-account DSO. | `Customer.creditLimit` existed in the domain and drove nothing. |
| **Price Intelligence** | 90-day supplier price curves from approved offers: trend, volatility, cheapest live supplier, saving against the standing purchase price. | Pricing was a database, not an index. |

Four further engines answer the parts of requirements 1, 8 and 9 that were
still thin: **product sales & profitability** (units, revenue, measured gross
profit and ABC banding per product), **communication activity** (a twelve-week
heatmap of emails and calls, median reply time per account, and correspondents
missing from the contact database), **measured payment reliability and supplier
delivery performance** — both now derived from receipts and despatches rather
than typed in, each carrying its sample size — and a **revenue-to-net-profit
waterfall**. They appear as four tabs at the foot of the dashboard.

Supporting these: a manual, dated **FX rate table** (Settings → Currency & trade)
that every converted figure resolves through — closing *"figures are not
converted between currencies"*.

### Design rules held throughout

- **A missing rate returns nothing, never parity.** Treating an unknown rate as
  1.0 is how a £40k exposure becomes a £40k understatement, silently.
- **Margin percentage is taken over costed revenue only**, so lines with no cost
  cannot inflate it.
- **Cost provenance travels to the screen.** "Approved supplier offer" and
  "standing purchase price" are different claims and the desk sees which it has.
- **A single price observation reports no direction.** One observation is a
  price, not a trend.
- **Signals are derived, never stored.** Clearing an invoice makes its signal
  disappear with no sync step; a dismissal lasts the session only.

## 13-point client requirements — status

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | Email & WhatsApp + historical scan | **PARTIALLY LIVE** | Timeline + runnable historical scan against sample data. Live mailbox / WhatsApp Business API: **configuration required**. |
| 2 | Sales & quotations pipeline | **PARTIALLY LIVE** | Quotation creation, status, convert → Order → Invoice with data carry-over. Automated follow-up job is status-based (real scheduler needs backend). |
| 3 | Product database | **PARTIALLY LIVE** | SKU, specs, multi-supplier pricing visible on product detail. |
| 4 | Price list / portfolio export | **PARTIALLY LIVE** | **Generate price list** downloads a real branded HTML document from structured pricing data; print/save as PDF is browser-native. |
| 5 | Product price search | **PARTIALLY LIVE** | Search/filter/sort with supplier, date, source. Client example present. |
| 6 | Document management | **PARTIALLY LIVE** | Categories, entity links, seed documents. Email-attachment association pipeline architected. |
| 7 | Mass email / marketing | **ARCHITECTED / CONFIG REQUIRED** | Campaigns UI with explicit **Provider not connected** state. |
| 8 | BI Dashboard | **PARTIALLY LIVE** | Revenue, gross/net profit (derived from invoices + supplier spend), pipeline, top customers/suppliers — calculated from store data. |
| 9 | Relationship scoring | **PARTIALLY LIVE** | Ranked customer & supplier lists with relationship scores. |
| 10 | AI extraction | **PARTIALLY LIVE** | Exact client example *“We can offer 500 units at $42 each, delivery in 3 weeks”* in pending review. Human Approve / Reject. Never auto-commits. |
| 11 | KYC / onboarding | **PARTIALLY LIVE** | Status workflow (sent → submitted → review → approved/rejected). Public form link deferred. |
| 12 | Accounting | **PARTIALLY LIVE / ARCHITECTED** | Internal CRM finance view. External connector: Xero-ready, **NOT CONNECTED**. |
| 13 | Invoicing | **PARTIALLY LIVE** | Create, status, convert from order, totals feed dashboard revenue. |

**Design system**  
Renso navy + white + refined neutrals. Rounded controls, dense typography (Inter), consistent tables/cards, meaningful empty states, mobile-aware shell. Zero gold/yellow. Single Lucide icon family.

**Portability**  
Vite + React 19 + TypeScript. No Replit/Emergent SDKs or platform-specific dependencies. `.env.example` + `vercel.json` included. Optional browser-test packages are intentionally not part of the install path so the production build remains portable.

---

## Architecture notes

- **Client-side store** with realistic seed data for demo and pre-production review. Changes are session-scoped in memory.
- **Human-in-the-loop** for all AI-extracted commercial data.
- **Honest integration states**: never fake “Connected”.
- Backend, live email/WhatsApp/Xero/mailing provider, and scheduled jobs are the natural next phase.

---

## License / ownership

Proprietary — Renso Group. Not for redistribution without permission.
