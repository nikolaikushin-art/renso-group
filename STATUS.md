# Renso Group CRM — build status

Verified: typecheck clean · lint 0 errors · 48/48 tests · production build succeeds.

## This pass

### Brand (all four supplied assets installed)
- `mark-navy.png` / `mark-white.png` — globe only, square-trimmed. The white is
  recoloured from the navy's own alpha channel, so both themes render **identical
  geometry** and the mark cannot shift when the theme is toggled.
- `mark-white.svg` — supplied vector, used as the Safari mask icon.
- `logo-blue.png` / `logo-white.png` — the full stacked lockup, used on sign-in
  where there is vertical room for it.
- Sidebar header uses a **horizontal** lockup: globe + live-text wordmark. The
  previous header scaled the stacked artwork into a 56px bar, which rendered the
  word "RENSO" about five pixels tall — that was the visibility problem, not colour.
  Live text also stays crisp at every size and takes the theme ink colour for free.
- Collapsed rail shows the globe alone.
- All favicons, app icons and the manifest regenerated from the new globe.

### Email — full Outlook-style client (`components/MailModule.tsx`)
- Three panes: folders · message list · reading pane.
- Inbox / Starred / Follow-up / Sent / Drafts / Archive, with unread counts.
  Starred and Follow-up are views over flags, so a message never leaves its folder.
- Search, star, flag, mark read/unread, archive, reply, forward, compose, drafts.
- **Linked records rail** — each message binds to its customer or supplier *and*
  to the quotation / order / invoice / product it concerns, showing live values
  and navigating straight into those modules.
- Attachments file into Documents against the correct account, typed by filename,
  and stamped so they cannot be filed twice.
- **Extract terms** runs received messages through `parseCommercialTerms` into the
  pricing review queue. Never auto-approves; returns nothing when no unit price is
  found rather than guessing.
- WhatsApp runs on the same model and the same pane.
- 13 seeded messages wired to real seed records (FR4 offer, QT-2026-0042 pushback,
  INV-2026-0088 part payment, EuroMetal price revision, Brightline KYC pack).

### Campaigns / mass mailing (`components/CampaignsPage.tsx`) — requirement 7
- Audience builder stores **rules, not a frozen address list**; rules resolve
  against live CRM data while building and again at send time.
- Filters: target side of the book, account status, segment, territory, country,
  tags, approved-KYC-only, dormancy window.
- Live resolved-recipient count and list, with click-through to each account.
- Template editor with merge fields and a live preview rendered against a real
  recipient. Unknown tokens are left visible so typos surface in preview.
- Sending writes one outbound message per recipient into that account's timeline,
  so mailbox, account page and campaign report cannot diverge.
- Engagement report: delivered / opened / clicked / bounced, per recipient.
- De-duplicates by address and skips recipients with no email.

### Invoices (`components/InvoicePreview.tsx`) — requirement 13
- Opens the real document: letterhead, both parties, line breakdown with
  discounts, subtotal/VAT/total, payment position, balance due, registration footer.
- Print → PDF via a dedicated `@media print` stylesheet that strips app chrome and
  forces the sheet to white. No server-side renderer to keep in sync.
- Ledger around it: outstanding / overdue / collected totals, filters, search,
  overdue day counts.
- Linked tiles to customer, order, quotation and correspondence.

### Cross-module navigation
- Single `openRecord(section, id)` path. Any module can open a specific record in
  another; the target clears on the way out so it cannot go stale.

## Known gaps (deliberate, not oversight)
- Campaign opens/clicks are recorded but not simulated — real figures need a
  sending provider webhook.
- Gross and net margin remain estimates until purchase cost is linked at line level.
- Figures are not converted between currencies.

---

## Pass 2 — Finance

### Accounting (`lib/accounting.ts`, `components/AccountingPage.tsx`) — requirement 12
Rebuilt from a three-tile summary into a surface an accountant can work in.
Four period-scoped views, each exporting to CSV:

- **Profit & loss** — revenue net of VAT, cost of sales, gross profit, operating
  expenses broken out by category, net profit, plus aged creditors.
- **VAT return** — UK box numbering (1, 3, 4, 5, 6, 7) ready to type into a
  submission. Boxes 2, 8 and 9 held at zero because the EC acquisition data
  isn't captured; a guessed figure on a statutory return is worse than an
  obvious zero, and the UI says so.
- **General ledger** — real double-entry journal built from invoices, expenses
  and payments. An invoice debits trade debtors and credits sales plus VAT; a
  receipt debits bank and credits debtors. The UI asserts the journal balances
  and shows a badge either way. Rows click through to the source record.
- **Expenses** — full CRUD with categories, supplier and order linkage, VAT,
  and mark-paid which writes a real outbound payment.

Two deliberate accounting choices:
- Gross profit is **measured** from cost-of-sales expenses, not estimated from
  an overhead assumption. A period with revenue but no booked costs reports
  margin as *unavailable* and warns, rather than reporting a 100% margin.
- Everything is accruals-basis (invoice date, expense date), because that's what
  a filing needs. Cash movement lives in Payments and the two are never blended.

### Payments — requirement 13
`Payment` existed in the domain but had never been wired to the store. Now:
- Receipts in and payments out, with method, bank reference, date and notes.
- **Recording a receipt updates the invoice's paid amount and status in the same
  transaction**, so the ledger and the sales view cannot drift apart.
- Over-allocation is blocked with an explanation rather than silently accepted.
- "Awaiting payment" queue driven off real outstanding balances.

### Dashboard
Gross and net profit are now measured from booked expenses instead of a
supplier-spend proxy. The old proxy remains as a fallback only when no expenses
exist at all, so the dashboard is never blank on a fresh install.

### Seed
8 expenses and 4 payments, booked against the same suppliers, orders and
invoices the sales side uses — so P&L, VAT and the ledger all have real shape.

### Tests
59 passing (up from 40), including 11 new accounting tests covering VAT
exclusion from revenue, cost-of-sales classification, the incomplete-costs
guard, period boundaries, VAT netting, aged bucketing, and a proof that the
double-entry journal balances.

---

## Pass 3 — Intelligence layer

Verified: typecheck clean · lint 0 errors · **96/96 tests** (up from 59) ·
production build succeeds · four new modules code-split out of the main bundle.

This pass took the three items the previous status note listed as known gaps and
closed them, rather than adding a fourth surface on top of them.

### Currency (`lib/fx.ts`) — closes "figures are not converted between currencies"

A manually maintained rate table against one base currency, each rate carrying
the date it was entered. Nothing fetches a live rate, because a client-side
build cannot hold a rate provider's licence and a number with invented
provenance is worse than a number the user typed.

Three decisions that matter more than the arithmetic:

- **A missing rate returns `null`, not 1.0.** Assuming parity is how an
  unconverted USD balance quietly understates exposure by 20%. Callers must
  then say the rate is missing.
- **A cross rate is as old as its weakest leg.** A fresh EUR rate crossed
  through a six-month-old USD rate is a six-month-old cross rate, and reports
  itself that way.
- **`sumInCurrency` reports what it could not convert** rather than dropping it,
  so a tile can read "£412,900 (+ $18,400 unconverted)".

Rates over 30 days old are flagged stale and raise a data-quality signal. The
PLN rate is seeded deliberately old so that path renders on real data.

### Margin (`lib/margin.ts`) — closes "margin remains an estimate"

Every quotation, order and invoice line now resolves a cost, in order of
preference: an approved unexpired supplier offer → the product's standing
purchase price → nothing. **The basis travels with the number to the screen.**

- Where no cost exists, margin is reported as **unknown**, never as 100%.
- The document percentage is taken over **costed revenue only**. Dividing by
  total revenue would inflate the figure every time a line has no cost — the
  precise error this module exists to remove. Coverage is shown alongside.
- `bestOfferFor` picks the cheapest *live approved* offer: an unapproved offer
  and a lapsed one are both ignored, so a rejected price cannot flatter a deal.
- Lines under `productSettings.lowMarginThresholdPct` are flagged, and live
  quotations below it raise a signal. Below cost raises a critical one.

### Credit (`lib/credit.ts`) — `Customer.creditLimit` finally drives something

Exposure is the whole forward commitment: unpaid invoices + confirmed orders not
yet invoiced + accepted quotations not yet ordered. An invoiced order is counted
once, not twice. Merely *sent* quotations are excluded — counting speculative
paper as exposure makes every active account look distressed, and a control that
cries wolf gets switched off.

Banding is opinionated on purpose, and **lateness outranks utilisation**: an
account 60 days late on a small balance is a worse counterparty than one at 95%
of its limit paying to terms. DSO is measured from each account's own receipts,
weighted by amount — a company-wide average is exactly what hides a slow payer.

### Price index (`lib/priceIndex.ts`)

Approved offers read as a dated curve per product: trend over a 30/90/365-day
window, volatility as a coefficient of variation, cheapest live supplier, and
the saving against the standing purchase price. A 2% deadband stops a re-quote
with a rounding difference from reporting a "direction" every refresh. A single
observation reports `unknown` rather than drawing a confident flat line.

### Signals (`lib/signals.ts`)

Nine generators across every module: overdue receivables, credit breaches,
below-floor quotations, price moves, expiring documents, KYC awaiting review,
**live orders against un-cleared KYC**, late and part-despatched orders,
**delivered-but-uninvoiced goods**, quotations expiring or gone quiet, dormant
traded accounts, stale rates, accounts with no limit, uncosted products, flagged
mail.

- Every row names its evidence — "INV-2026-0088 is 34 days past due, £12,400
  outstanding", not "check this customer".
- **De-duplicated against itself**: an invoice that is also the reason an account
  is on stop produces the credit signal, not both.
- Severity is consequence, not recency. Ranked by severity then by money.
- Derived on every render; a dismissal is session-scoped, so tomorrow the signal
  returns if the fact has not changed.

### UI (`components/apple.tsx`)

Activity rings, sparklines, a Dynamic-Island-style status capsule, count-up
digits, bullet bars, Wallet-style card stacks, styled native range sliders — all
hand-drawn SVG against the existing tokens. No charting dependency was added:
recharts is already lazy-loaded for the one dashboard chart and a second library
for a 40px sparkline would cost more bundle than the whole feature. Reduced
motion is honoured **in JavaScript**, because a rAF-driven counter cannot be
stopped by a media query.

### Wiring

- Signals sits under the dashboard in navigation and on the mobile tab bar, with
  a live badge. The top-bar bell — which previously did nothing at all — now
  carries the highest signal in an expanding capsule.
- Dashboard gained a signal strip: rings plus the top three actions.
- Global search now opens **the record**, not just its module.
- Settings → Currency & trade edits the rate table and the landed-cost defaults.
  Saving re-stamps only the rates that actually changed, so a stale table cannot
  be made to look fresh by pressing Save.
- The four modules are lazy-loaded, keeping them off the cold-start path.

### Known gaps (deliberate)

- Rates are entered by hand. A live feed needs a provider and a backend.
- Landed cost applies duty to goods value only. Where a consignment is valued
  CIF for customs the duty base is higher; the calculator takes the
  conservative reading and the UI states which it uses.
- Signal dismissals are session-scoped. Persisting them needs a backend, and
  persisting them in localStorage would let a dismissal outlive the fact.
- Break-even assumes fixed cost is recovered on this deal alone.

---

## Pass 4 — Requirement 8 and 9, finished

Verified: typecheck clean · lint 0 errors · **122/122 tests** · production build
succeeds.

This pass went back to Roni's original thirteen points and picked off the parts
of them that were still thin, rather than inventing new territory.

### Product sales & profitability (`lib/productPerformance.ts`) — requirement 8

Requirement 8 lists "product sales and profitability" and the build had neither:
it had product records and it had revenue, but nothing that said which products
made the money.

- Revenue is taken from **invoices, not orders**. An order is a promise; an
  invoice is a sale.
- Cost resolves through the same margin engine the Deal Desk uses, so a
  product's profitability and a quotation's margin cannot disagree about what a
  thing cost.
- **A line with no product link is revenue but not product revenue.** Freight,
  tooling and setup are real money and belong in the P&L; attributing them to a
  product flatters that product with income it did not earn. The unattributed
  total is reported separately on screen.
- ABC banding is Pareto on gross profit, decided on the cumulative share
  *before* each product — so a single product carrying the whole business is an
  A, not a C, which is what testing after the addition would have given.
- Also reports what is carried and has **not** sold. Dead lines on a price list
  cost credibility.

### Communication activity (`lib/commsAnalytics.ts`) — requirements 1 and 8

Requirement 8 asked, "if possible", for emails sent and calls made.
Requirement 1 asked the CRM to build the contact database out of
correspondence. Three functions:

- **Activity** — sent, received and calls by day over twelve weeks, as a
  calendar heatmap. Every day in the window is seeded including the empty ones:
  a chart drawn only from days that had traffic hides exactly what it should
  show. Calls are a channel on the existing model, not a new record type, so
  they appear in the timeline and the analytics with no second code path.
- **Responsiveness** — median hours to reply per account, plus what is still
  unanswered and for how long. Median, not mean: one holiday skews a mean. A
  draft does not count as a reply.
- **Unlinked correspondents** — addresses that have emailed and exist nowhere in
  Contacts, surfaced as *candidates*. Automation deliberately stops short of
  creating the record: an inbox also contains couriers, banks and no-reply
  robots, and a CRM that ingests every address becomes a mailing list nobody
  trusts. Own domains and WhatsApp phone numbers are excluded.

Two new signals come out of this: an account waiting more than 48 hours for a
reply, and correspondents missing from the contact database.

### Measured reliability (`lib/reliability.ts`) — requirement 9

Requirement 9 asked for scoring that accounts for payment reliability and
delivery performance. Both existed as numbers and neither was measured: payment
reliability was a paid-versus-overdue headcount, delivery performance was a
figure typed into the seed file.

- **Payment behaviour** from receipts against due dates: on-time percentage,
  mean and worst delay, part payments counted as their own behaviour rather than
  folded into "late". The score is penalised for anything **currently** overdue,
  because a clean history and three overdue invoices on the desk today is not a
  reliable payer.
- **Delivery performance** from despatch dates against promised dates, plus fill
  rate, judged on the first despatch — that is when the supplier delivered to
  us.
- Every figure carries its **sample size**. One invoice paid on time is not a
  reliable payer, so a thin sample reports "—" and a note rather than a
  flattering 100. `scoreCustomers` and `scoreSuppliers` now prefer the measured
  score but only where confidence is above "thin", and fall back to the old read
  otherwise.

Delivery is approximated through the customer orders carrying each supplier's
products, and the UI says so. Modelling purchase orders directly would make it
exact and needs a purchasing module, not a formula.

### Dashboard

The new work is tabbed rather than stacked — Products · Profit · Communication ·
Reliability. Four more panels in a column turns a dashboard into a document
nobody scrolls to the end of. All four are period-scoped from the existing
selector, and the revenue-to-net-profit waterfall replaces guessing at where the
money went with showing it.

The dashboard footnote has been corrected: it still claimed figures were not
converted between currencies and that margin was an estimate. Both stopped being
true in pass 3.

### Known gaps (deliberate)

- Response latency is account-level, not thread-level. Most real mailboxes
  thread badly, and an account-level read is the one a sales director acts on.
- Supplier delivery performance is inferred through sales orders, as above.
- Unlinked correspondents are proposed, never created.
