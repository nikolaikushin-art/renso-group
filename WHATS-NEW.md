# Renso Group CRM — what's new

**Version 24 · the intelligence layer**

The previous build did the thirteen things it was asked to do. This one answers
the question that comes next: *given all of that data, what should we actually
do this morning?*

Four new modules, and one foundation underneath them.

---

## Signals

**Where:** top of the sidebar, under Dashboard. Also the bell in the top bar and
the second tab on mobile.

Fourteen modules means fourteen places to look, and on a busy morning nobody
looks at all of them. Signals reads across every module and returns the short
list of things that need a person today, ranked by consequence:

- invoices past due, with the days and the balance
- accounts that should not take another order until someone has called them
- quotations priced below the margin floor, or below cost
- products whose price has moved materially in the last 90 days
- certificates and contracts expiring, KYC packs awaiting review
- **live orders against accounts whose KYC has never cleared**
- **goods delivered and never invoiced** — money sitting on the floor
- quotations about to expire, or gone quiet past the follow-up window
- accounts marked active that have not ordered in four months

Every row states its evidence — "INV-2026-0088 is 34 days past due, £12,400
outstanding from Nordic Components AS" — and what to do about it. One tap opens
the record it came from.

**Copy morning brief** puts the whole list into plain text, ready to paste into
an email or a WhatsApp group.

Nothing here is stored. The list is rebuilt from the live records every time the
page opens, so clearing an invoice makes its signal disappear with no sync step,
and dismissing a row lasts for the session only. If it is still true tomorrow, it
comes back — which is the point.

---

## Deal Desk

**Where:** Sales → Deal Desk.

The previous build's own notes admitted that margin was an estimate until
purchase cost was linked at line level. It now is.

Every line on every quotation resolves a cost — from an approved supplier offer
first, a standing purchase price second — and **says which one it used**. A 31%
margin measured against a live offer from Shenzhen is a different claim from 31%
inferred from a price typed in March, and the desk sees the difference before it
discounts.

Where there is no cost at all, the margin reads *unknown*. It never reads 100%.

Alongside it, two working tools:

- **Landed cost.** Supplier price converted at your rate, freight spread across
  the consignment, duty on goods value, insurance, per-unit extras. Quoting off
  the supplier's unit price is the most common way a 22% deal ships at 9%.
- **Price solver.** Target margin → selling price, or a selling price → the
  margin and markup it implies. Margin is taken on revenue, which is how a
  trading desk quotes; markup is shown too, because suppliers quote in it.

Documents are listed worst margin first. A desk should meet its problems before
its wins.

---

## Credit Control

**Where:** Finance → Credit Control.

`creditLimit` was in the data model and nothing used it, which meant the app
would cheerfully confirm a fourth order for an account already sixty days late
on three invoices.

Exposure is now the whole forward commitment: unpaid invoices, plus confirmed
orders not yet invoiced, plus accepted quotations not yet ordered. Each account
is banded and given a reason on the record:

- **Hold new orders** — blocked, 60+ days past due, or already over the limit
- **Strained** — 30+ days past due, or at 85% of the limit
- **Watch** — something past due inside 30 days, or **no limit set at all**
- **Within terms**

Lateness outranks utilisation deliberately. An account sixty days late on a
small balance is a worse counterparty than one at 95% of its limit paying on
time.

Days sales outstanding is measured from each account's own receipts, not a
company-wide average — that average is exactly what hides a slow payer.

---

## Price Intelligence

**Where:** Sourcing → Price Intelligence.

Every approved offer is a dated observation of what a product cost from a named
supplier. Held together they are a curve, and a trading company lives on reading
it. For each product, over 30, 90 or 365 days:

- the direction and size of the move, with a sparkline
- volatility — which prices you can hold for fourteen days and which you cannot
- the supplier league table on their latest prices
- **whether the supplier who quoted most recently is still the cheapest one**
- what the cheapest live offer would save against the purchase price the
  products module has been quoting from

A product with one observation reports no direction. One observation is a price,
not a trend, and the curve says so rather than drawing a confident flat line.

---

## Underneath: the currency table

**Where:** Settings → Currency & trade.

Margin, exposure and the price index all convert through one manually maintained
rate table. Each rate carries the date it was entered. Saving re-stamps only the
rates that actually changed, so a stale table cannot be made to look fresh by
pressing Save.

Nothing fetches a live rate. There is no rate provider behind this build, and a
figure with invented provenance is worse than one you typed yourself.

The important part is what happens when a rate is *missing*: the amount is
reported in its own currency and excluded from the total, never assumed to be
at parity. Assuming parity is how a $40,000 exposure quietly becomes a £40,000
understatement. Rates over a month old are flagged, and raise their own signal.

---

## The interface

The new surfaces are built from the same system as the rest of the app, extended
with a small set of Apple-style display pieces: Fitness-style activity rings for
the signal load, sparklines at row scale, a Dynamic-Island-style capsule in the
top bar that expands to show the highest signal, and figures that count up
rather than snap into place.

All of it is hand-drawn against the existing design tokens, so it follows the
light/dark switch with no second palette, and no charting library was added to
the install.

The bell in the top bar, which previously did nothing, now carries the top
signal. The dashboard gained a strip showing the signal load and the three most
urgent actions. Global search now opens the record you searched for, rather than
the module it lives in.

---

## Still needing a backend

Honest as before: rates are entered by hand, signal dismissals last for the
session, and margin depends on offers being approved in the pricing queue. A
live rate feed, persistent dismissals and scheduled morning briefs are all
straightforward once there is a server — none of them change the models above.

---

# Version 25 — back to your list

This pass went through your original thirteen points again and finished the
parts that were still half-answered.

## Product sales & profitability (your point 8)

Point 8 asked for product sales and profitability. The dashboard had revenue,
but nothing that said *which products* made the money — and that is the answer
that reorders what a desk chases.

At the foot of the dashboard, under **Products**: units sold, revenue, measured
gross profit and margin for every product, how many invoices and how many
distinct customers it appeared on, and the change against the previous period of
the same length. Each product is banded A, B or C on the Pareto of gross profit,
so the handful carrying the business is obvious at a glance.

Two things it deliberately will not do. Freight, tooling and setup lines are
counted as revenue but never attributed to a product — a product should not be
credited with income it did not earn, and the unattributed total is shown
separately. And a product with no cost behind it reports margin as *unknown*
rather than as pure profit.

It also lists what you carry and have **not** sold in the period. A client asking
for the one line nobody has bought in a year, and the desk having no current cost
for it, is a credibility problem.

## Communication activity (your points 1 and 8)

Point 8 asked, if possible, to track emails sent and calls made. Under
**Communication**:

- A twelve-week calendar heatmap of everything sent and received, including the
  empty days — the gaps are the part worth seeing.
- Sent, received and calls logged, with weekly volume as a trend.
- **Median reply time per account**, and what is still waiting on you and for how
  long. This is the number that tells a sales director something a revenue chart
  cannot.
- **Correspondents not in the contact database** — addresses that have emailed
  and exist nowhere in Contacts, ready to be added.

That last one is point 1's "automatically create and maintain a centralised
contact database", made reviewable rather than automatic. Your inbox also
contains couriers, banks and no-reply robots; a CRM that ingests every address
it sees becomes a mailing list nobody trusts. So the system proposes and you
accept.

Phone calls are logged as a channel on the same model as email and WhatsApp, so
they appear in the account timeline, the analytics and the response measurement
without being a separate thing to maintain.

Two of these now raise signals in the morning queue: an account that has been
waiting more than two days for a reply, and correspondents worth adding.

## Reliability, actually measured (your point 9)

Point 9 asked for scoring that accounts for **payment reliability** and
**delivery performance**. Both existed as numbers, and neither was measured —
payment reliability was a count of paid versus overdue labels, and delivery
performance was a figure typed into the demo data.

Under **Reliability**, both are now derived from the records:

- **Payment behaviour** — on-time percentage from receipts against due dates,
  average and worst delay, part payments counted as their own behaviour rather
  than lumped in with "late". An account with a clean history and three overdue
  invoices on the desk today does not score 100.
- **Delivery performance** — on-time percentage from despatch dates against
  promised dates, plus average fill rate.

Every score carries its **sample size**. One invoice paid on time is not a
reliable payer, so a thin sample shows "—" and a note instead of a flattering
figure. The relationship ranking uses the measured score where there is enough
history and falls back to the old read where there is not.

## Where the money went (your point 8)

Under **Profit**: revenue → cost of sales → gross profit → overheads → net
profit, drawn as a waterfall. A stack of four numbers tells you the answer; the
waterfall tells you where it went, which is the question anyone looking at a
profit figure actually has. Where no costs have been booked for a period it says
so, rather than reporting the resulting 100% margin as good news.
