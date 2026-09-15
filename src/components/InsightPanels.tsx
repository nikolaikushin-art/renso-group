/**
 * Renso Group CRM — dashboard insight panels.
 *
 * Roni's requirement 8 asked for a dashboard covering revenue, gross and net
 * profit, sales performance, top customers and suppliers, supplier spend,
 * **product sales and profitability**, historical trends, and — "if possible" —
 * communication activity. The first six were built. These panels are the last
 * three, plus requirement 9's measured reliability and requirement 1's
 * contact-database automation made reviewable.
 *
 * Each panel is a separate component so the dashboard composes them rather than
 * growing another four hundred lines, and so any of them can be moved onto the
 * module it belongs to later without being untangled first.
 */
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Clock,
  Inbox,
  Layers,
  MailQuestion,
  PackageSearch,
  Radio,
  ShieldQuestion,
  Timer,
  TrendingDown,
  UserPlus,
} from "lucide-react";
import { useStore } from "@/lib/store";
import {
  categoryMix,
  productPerformance,
  unsoldProducts,
  type ProductPerformance,
} from "@/lib/productPerformance";
import {
  activitySummary,
  responseStats,
  unlinkedCorrespondents,
} from "@/lib/commsAnalytics";
import {
  CONFIDENCE_LABELS,
  deliveryBook,
  paymentBook,
} from "@/lib/reliability";
import { isCostOfSales } from "@/lib/accounting";
import type { MarginContext } from "@/lib/margin";
import { Group, Row, Pill, Segmented, EmptyState } from "@/components/ios";
import {
  ActivityHeatmap,
  ShareBar,
  Sparkline,
  TrendPill,
  Waterfall,
} from "@/components/apple";
import { money, moneyExact, shortDate } from "@/lib/format";
import type { AppSection } from "@/components/Shell";

const BAND_TONE = { A: "success", B: "accent", C: "neutral" } as const;

/* -------------------------------------------------------------------------- */
/* Product profitability — requirement 8                                      */
/* -------------------------------------------------------------------------- */

export function ProductProfitabilityPanel({
  windowDays,
  onOpenRecord,
}: {
  windowDays: number;
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [sort, setSort] = useState<"profit" | "revenue" | "units">("profit");

  const margin: MarginContext = useMemo(
    () => ({
      pricingRecords: store.pricingRecords,
      products: store.products,
      fx: store.fx,
      floorPct: store.productSettings.lowMarginThresholdPct,
    }),
    [store.pricingRecords, store.products, store.fx, store.productSettings.lowMarginThresholdPct],
  );

  const result = useMemo(() => {
    const now = new Date();
    const dayMs = 86_400_000;
    return productPerformance({
      products: store.products,
      invoices: store.invoices,
      window: { from: new Date(now.getTime() - windowDays * dayMs), to: now },
      priorWindow: {
        from: new Date(now.getTime() - windowDays * 2 * dayMs),
        to: new Date(now.getTime() - windowDays * dayMs),
      },
      margin,
      currency: store.fx.base,
    });
  }, [store.products, store.invoices, margin, store.fx.base, windowDays]);

  const rows = useMemo(() => {
    const copy = [...result.products];
    if (sort === "revenue") copy.sort((a, b) => b.revenue - a.revenue);
    else if (sort === "units") copy.sort((a, b) => b.unitsSold - a.unitsSold);
    return copy;
  }, [result.products, sort]);

  const mix = useMemo(() => categoryMix(result.products), [result.products]);
  const dead = useMemo(
    () => unsoldProducts(store.products, result.products),
    [store.products, result.products],
  );

  if (!result.products.length) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="No product sales in this period"
        description="Profitability is measured from invoice lines linked to a product. Raise an invoice from an order and every line carrying a product starts reporting its own units, revenue and margin here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Group
        label="Product sales & profitability"
        labelTrailing={`Last ${windowDays} days`}
      >
        <div className="px-3.5 py-3">
          <Segmented<"profit" | "revenue" | "units">
            value={sort}
            onChange={setSort}
            options={[
              { id: "profit", label: "Gross profit" },
              { id: "revenue", label: "Revenue" },
              { id: "units", label: "Units" },
            ]}
          />
        </div>
        {rows.map((row) => (
          <ProductRow
            key={row.productId}
            row={row}
            onOpen={() => onOpenRecord("products", row.productId)}
          />
        ))}
        <div className="ios-row px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-tertiary">
          Revenue comes from issued and paid invoices, not orders — an order is a promise, an
          invoice is a sale. Cost resolves through the same engine the Deal Desk uses, so a
          product's margin here and a quotation's margin there cannot disagree.
          {result.unattributedRevenue > 0 ? (
            <>
              {" "}
              {money(result.unattributedRevenue, result.currency)} of revenue sat on lines with no
              product link — freight, tooling and setup — and is counted in the total but not
              against any product.
            </>
          ) : null}
          {result.excludedInvoices > 0 ? (
            <>
              {" "}
              {result.excludedInvoices} invoice
              {result.excludedInvoices === 1 ? "" : "s"} excluded for want of an exchange rate.
            </>
          ) : null}
        </div>
      </Group>

      {mix.length > 1 ? (
        <Group label="Revenue mix by category">
          <div className="px-3.5 py-4">
            <ShareBar
              segments={mix.map((entry) => ({
                label: entry.category,
                value: entry.revenue,
                share: entry.share,
              }))}
              format={(n) => money(n, result.currency)}
            />
          </div>
        </Group>
      ) : null}

      {dead.length ? (
        <Group label="Carried but not sold" labelTrailing={`${dead.length}`}>
          {dead.slice(0, 6).map((product) => (
            <Row
              key={product.id}
              title={product.name}
              subtitle={`${product.sku} · no sales in ${windowDays} days`}
              onClick={() => onOpenRecord("products", product.id)}
              trailing={<Pill tone="neutral">dormant</Pill>}
            />
          ))}
          <div className="ios-row px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-tertiary">
            Dead lines on a price list cost credibility: a client asks for the one item nobody
            has bought in a year and the desk has no current cost to quote.
          </div>
        </Group>
      ) : null}
    </div>
  );
}

function ProductRow({ row, onOpen }: { row: ProductPerformance; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="ios-row row-hover brand-focus flex w-full items-center gap-3 px-3.5 py-3 text-left"
    >
      <Pill tone={BAND_TONE[row.band]}>{row.band}</Pill>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium text-ink">{row.name}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[12.5px] text-ink-secondary">
          {row.unitsSold.toLocaleString("en-GB")} units · {row.invoiceCount} invoice
          {row.invoiceCount === 1 ? "" : "s"} · {row.customerCount} customer
          {row.customerCount === 1 ? "" : "s"}
          <TrendPill changePct={row.changePct} />
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="tnum block text-[14.5px] font-semibold text-ink">
          {row.grossProfit === null ? "—" : money(row.grossProfit, row.currency)}
        </span>
        <span className="tnum block text-[12px] text-ink-tertiary">
          {row.marginPct === null
            ? "cost unknown"
            : `${row.marginPct}%${row.partialCost ? " · partial" : ""}`}
        </span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Profit waterfall — requirement 8                                           */
/* -------------------------------------------------------------------------- */

export function ProfitWaterfallPanel({ windowDays }: { windowDays: number }) {
  const store = useStore();

  const data = useMemo(() => {
    const dayMs = 86_400_000;
    const from = new Date(Date.now() - windowDays * dayMs);
    const inWindow = (iso?: string) => Boolean(iso && new Date(iso) >= from);

    const revenue = store.invoices
      .filter(
        (i) =>
          ["paid", "issued", "overdue", "partial"].includes(i.status) &&
          inWindow(i.issuedAt ?? i.createdAt),
      )
      .reduce((sum, i) => sum + i.subtotal, 0);

    const expenses = store.expenses.filter((e) => inWindow(e.date));
    const costOfSales = expenses
      .filter((e) => isCostOfSales(e.category))
      .reduce((sum, e) => sum + e.net, 0);
    const overheads = expenses
      .filter((e) => !isCostOfSales(e.category))
      .reduce((sum, e) => sum + e.net, 0);

    return {
      revenue: Math.round(revenue),
      costOfSales: Math.round(costOfSales),
      overheads: Math.round(overheads),
      gross: Math.round(revenue - costOfSales),
      net: Math.round(revenue - costOfSales - overheads),
      hasCosts: expenses.length > 0,
    };
  }, [store.invoices, store.expenses, windowDays]);

  return (
    <Group label="Revenue to net profit" labelTrailing={`Last ${windowDays} days`}>
      <div className="px-3.5 py-4">
        <Waterfall
          steps={[
            { label: "Revenue", value: data.revenue, total: true },
            { label: "Cost of sales", value: -data.costOfSales },
            { label: "Gross profit", value: data.gross, total: true },
            { label: "Overheads", value: -data.overheads },
            { label: "Net profit", value: data.net, total: true },
          ]}
          format={(n) => money(n, store.fx.base)}
        />
      </div>
      <div className="ios-row px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-tertiary">
        Revenue is net of VAT and taken on an accruals basis, so this reconciles to the P&L in
        Accounting rather than to the bank.{" "}
        {data.hasCosts
          ? "Cost of sales is measured from booked purchases and freight, not assumed from an overhead percentage."
          : "No costs have been booked in this period, so gross profit here is revenue — which is a gap in the bookkeeping, not a 100% margin."}
      </div>
    </Group>
  );
}

/* -------------------------------------------------------------------------- */
/* Communication activity — requirements 1 and 8                              */
/* -------------------------------------------------------------------------- */

export function CommsActivityPanel({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();

  const activity = useMemo(() => activitySummary(store.communications, 84), [store.communications]);
  const responses = useMemo(
    () => responseStats(store.communications, store.customers, store.suppliers),
    [store.communications, store.customers, store.suppliers],
  );
  const strangers = useMemo(
    () =>
      unlinkedCorrespondents(
        store.communications,
        store.contacts,
        store.customers,
        store.suppliers,
        [store.organisation.website?.replace(/^https?:\/\//, "") ?? "rensogroup.com", "rensogroup.com"],
      ),
    [store.communications, store.contacts, store.customers, store.suppliers, store.organisation],
  );

  const waiting = responses.filter((r) => r.outstanding > 0);
  const answered = responses.filter((r) => r.medianHours !== null);
  const weekly = useMemo(() => {
    // Weekly totals for the sparkline: the heatmap shows the texture, the
    // sparkline shows whether the trend is up or down.
    const buckets: number[] = [];
    for (let i = 0; i < activity.days.length; i += 7) {
      buckets.push(activity.days.slice(i, i + 7).reduce((sum, d) => sum + d.total, 0));
    }
    return buckets;
  }, [activity.days]);

  return (
    <div className="space-y-4">
      <Group label="Communication activity" labelTrailing="Last 12 weeks">
        <div className="px-3.5 py-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <div className="tnum text-[22px] font-bold leading-none text-ink">
                {activity.sent}
              </div>
              <div className="text-[11.5px] text-ink-tertiary">Sent</div>
            </div>
            <div>
              <div className="tnum text-[22px] font-bold leading-none text-ink">
                {activity.received}
              </div>
              <div className="text-[11.5px] text-ink-tertiary">Received</div>
            </div>
            <div>
              <div className="tnum text-[22px] font-bold leading-none text-ink">
                {activity.calls}
              </div>
              <div className="text-[11.5px] text-ink-tertiary">Calls logged</div>
            </div>
            <div>
              <div className="tnum text-[22px] font-bold leading-none text-ink">
                {activity.perActiveDay}
              </div>
              <div className="text-[11.5px] text-ink-tertiary">Per active day</div>
            </div>
            <div className="ml-auto">
              <Sparkline values={weekly} token="--accent" width={110} height={34} />
              <div className="mt-0.5 text-right text-[11px] text-ink-tertiary">
                Weekly volume
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto pb-1">
            <ActivityHeatmap days={activity.days} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-ink-tertiary">
            <span>{shortDate(activity.days[0].date)}</span>
            <span>
              {activity.activeDays} of {activity.windowDays} days had contact
              {activity.peak ? ` · busiest ${shortDate(activity.peak.date)}` : ""}
            </span>
            <span>Today</span>
          </div>
        </div>

        {activity.channels.length ? (
          <div className="ios-row flex flex-wrap gap-2 px-3.5 py-3">
            {activity.channels.map((channel) => (
              <span
                key={channel.channel}
                className="ios-fill-soft flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] text-ink-secondary"
              >
                <Radio className="h-3.5 w-3.5" />
                <span className="capitalize">{channel.channel}</span>
                <span className="tnum font-semibold text-ink">{channel.total}</span>
              </span>
            ))}
          </div>
        ) : null}
      </Group>

      {waiting.length ? (
        <Group label="Waiting on us" labelTrailing={`${waiting.length}`}>
          {waiting.slice(0, 6).map((row) => (
            <Row
              key={`${row.entityType}-${row.entityId}`}
              icon={Inbox}
              iconClass={
                (row.oldestOutstandingHours ?? 0) > 48
                  ? "bg-[rgb(var(--danger))]"
                  : "bg-accent"
              }
              title={row.name}
              subtitle={`${row.outstanding} message${
                row.outstanding === 1 ? "" : "s"
              } unanswered · longest wait ${formatHours(row.oldestOutstandingHours)}`}
              value={row.medianHours === null ? "—" : formatHours(row.medianHours)}
              valueSub="usual reply"
              onClick={() =>
                onOpenRecord(row.entityType === "customer" ? "customers" : "suppliers", row.entityId)
              }
            />
          ))}
          <div className="ios-row px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-tertiary">
            An inbound message counts as answered by the first reply to that account afterwards.
            Drafts do not count — a half-written reply has not answered anyone.
          </div>
        </Group>
      ) : null}

      {answered.length ? (
        <Group label="Response time by account" labelTrailing="Median, slowest first">
          {answered.slice(0, 6).map((row) => (
            <Row
              key={`resp-${row.entityType}-${row.entityId}`}
              icon={Timer}
              iconClass="bg-[rgb(var(--tile-neutral))]"
              title={row.name}
              subtitle={`${row.answered} answered · last contact ${
                row.silentDays === 0 ? "today" : `${row.silentDays} days ago`
              }`}
              value={formatHours(row.medianHours)}
              onClick={() =>
                onOpenRecord(row.entityType === "customer" ? "customers" : "suppliers", row.entityId)
              }
            />
          ))}
        </Group>
      ) : null}

      {strangers.length ? (
        <Group label="Correspondents not in the contact database" labelTrailing={`${strangers.length}`}>
          {strangers.slice(0, 6).map((person) => (
            <Row
              key={person.address}
              icon={UserPlus}
              iconClass="bg-accent"
              title={person.name || person.address}
              subtitle={`${person.address} · ${person.messages} message${
                person.messages === 1 ? "" : "s"
              }${person.linkedTo ? ` · mail filed against ${person.linkedTo.name}` : ""}`}
              value={shortDate(person.lastAt)}
              onClick={() => onOpenRecord("contacts")}
              trailing={<MailQuestion className="h-4 w-4 text-ink-tertiary" />}
            />
          ))}
          <div className="ios-row px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-tertiary">
            These are candidates, not records. An inbox also contains couriers, banks and
            no-reply robots, and a CRM that ingests every address it sees becomes a mailing list
            nobody trusts — so the system proposes and a person accepts.
          </div>
        </Group>
      ) : null}
    </div>
  );
}

const formatHours = (hours: number | null): string => {
  if (hours === null) return "—";
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)}d`;
};

/* -------------------------------------------------------------------------- */
/* Measured reliability — requirement 9                                       */
/* -------------------------------------------------------------------------- */

export function ReliabilityPanel({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [side, setSide] = useState<"customers" | "suppliers">("customers");

  const payments = useMemo(
    () => paymentBook(store.customers, store.invoices, store.payments),
    [store.customers, store.invoices, store.payments],
  );
  const deliveries = useMemo(
    () =>
      deliveryBook(store.suppliers, {
        orders: store.orders,
        deliveries: store.deliveries,
        products: store.products,
      }),
    [store.suppliers, store.orders, store.deliveries, store.products],
  );

  const customerRows = store.customers
    .map((customer) => ({ customer, behaviour: payments[customer.id] }))
    .sort((a, b) => (a.behaviour.score ?? 101) - (b.behaviour.score ?? 101));

  const supplierRows = store.suppliers
    .map((supplier) => ({ supplier, performance: deliveries[supplier.id] }))
    .sort((a, b) => (a.performance.score ?? 101) - (b.performance.score ?? 101));

  return (
    <Group
      label="Measured reliability"
      labelTrailing="Worst first"
    >
      <div className="px-3.5 py-3">
        <Segmented<"customers" | "suppliers">
          value={side}
          onChange={setSide}
          options={[
            { id: "customers", label: "Payment behaviour" },
            { id: "suppliers", label: "Delivery performance" },
          ]}
        />
      </div>

      {side === "customers"
        ? customerRows.map(({ customer, behaviour }) => (
            <Row
              key={customer.id}
              icon={behaviour.openOverdue > 0 ? TrendingDown : Clock}
              iconClass={
                behaviour.openOverdue > 0
                  ? "bg-[rgb(var(--danger))]"
                  : "bg-[rgb(var(--tile-neutral))]"
              }
              title={customer.name}
              subtitle={
                behaviour.onTimePct === null
                  ? behaviour.note
                  : `${behaviour.onTimePct}% on time over ${behaviour.settled} settled · ${
                      behaviour.avgDaysLate !== null && behaviour.avgDaysLate > 0
                        ? `${behaviour.avgDaysLate} days late on average`
                        : "paid to terms"
                    }${behaviour.openOverdue ? ` · ${behaviour.openOverdue} overdue now` : ""}`
              }
              value={behaviour.score === null ? "—" : String(behaviour.score)}
              valueSub={CONFIDENCE_LABELS[behaviour.confidence]}
              onClick={() => onOpenRecord("customers", customer.id)}
              trailing={
                behaviour.partPayments ? (
                  <Pill tone="caution">part payer</Pill>
                ) : undefined
              }
            />
          ))
        : supplierRows.map(({ supplier, performance }) => (
            <Row
              key={supplier.id}
              icon={Layers}
              iconClass={
                performance.openLate > 0
                  ? "bg-[rgb(var(--danger))]"
                  : "bg-[rgb(var(--tile-neutral))]"
              }
              title={supplier.name}
              subtitle={
                performance.onTimePct === null
                  ? performance.note
                  : `${performance.onTimePct}% on time over ${performance.assessed} order${
                      performance.assessed === 1 ? "" : "s"
                    }${
                      performance.avgFillRate !== null
                        ? ` · ${performance.avgFillRate}% average fill`
                        : ""
                    }${performance.openLate ? ` · ${performance.openLate} open and late` : ""}`
              }
              value={performance.score === null ? "—" : String(performance.score)}
              valueSub={CONFIDENCE_LABELS[performance.confidence]}
              onClick={() => onOpenRecord("suppliers", supplier.id)}
            />
          ))}

      <div className="ios-row flex gap-2 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-tertiary">
        <ShieldQuestion className="mt-[2px] h-3.5 w-3.5 shrink-0" />
        <span>
          Both figures are measured, not typed in: payment behaviour from receipts against due
          dates, delivery performance from despatch dates against promised dates. Every score
          carries its sample size, because one invoice paid on time is not a reliable payer — and
          where there is no history the score reads "—" rather than a flattering 100.
          {side === "suppliers"
            ? " Delivery is read through the customer orders carrying each supplier's products; modelling purchase orders directly would make it exact."
            : ""}
        </span>
      </div>
    </Group>
  );
}

/** Shared trailing affordance for the dashboard panels. */
export function PanelLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="brand-focus inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent"
    >
      {label}
      <ArrowRight className="h-3 w-3" strokeWidth={2.4} />
    </button>
  );
}
