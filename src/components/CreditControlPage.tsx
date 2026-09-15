/**
 * Renso Group CRM — Credit Control.
 *
 * `Customer.creditLimit` sat in the domain model unused, which meant nothing in
 * the app could tell you that confirming the next order would take an account
 * 40% past a limit it was already late against. This module reads the whole
 * forward commitment — unpaid invoices, uninvoiced orders, accepted quotations —
 * bands it, and says what to do.
 *
 * The band is deliberately opinionated. A control surface that reports numbers
 * and leaves the judgement entirely to the reader is a spreadsheet; the value
 * is in stating, on the record, that this account should not take another order
 * until someone has made a phone call.
 */
import { useMemo, useState } from "react";
import {
  AlertOctagon,
  ArrowRight,
  Ban,
  CalendarClock,
  Gauge,
  Info,
  ShieldCheck,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { useStore } from "@/lib/store";
import {
  bookTotals,
  creditBook,
  RISK_LABELS,
  type CreditPosition,
  type RiskBand,
} from "@/lib/credit";
import { receivablesAging } from "@/lib/analytics";
import {
  PageHeader,
  Group,
  Row,
  Segmented,
  StatTile,
  StatRow,
  Pill,
  EmptyState,
  FieldRow,
  Button,
} from "@/components/ios";
import { RingGauge, MiniBars, NumberTicker } from "@/components/apple";
import { money } from "@/lib/format";
import type { AppSection } from "@/components/Shell";

const BAND_TOKEN: Record<RiskBand, string> = {
  clear: "--success",
  watch: "--caution",
  strained: "--accent",
  stop: "--danger",
};

const BAND_TONE: Record<RiskBand, "success" | "caution" | "accent" | "danger"> = {
  clear: "success",
  watch: "caution",
  strained: "accent",
  stop: "danger",
};

export function CreditControlPage({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [band, setBand] = useState<"all" | RiskBand>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const positions = useMemo(
    () =>
      creditBook({
        customers: store.customers,
        invoices: store.invoices,
        orders: store.orders,
        quotations: store.quotations,
        payments: store.payments,
        fx: store.fx,
        reportingCurrency: store.fx.base,
      }),
    [store.customers, store.invoices, store.orders, store.quotations, store.payments, store.fx],
  );

  const totals = bookTotals(positions);
  const shown = band === "all" ? positions : positions.filter((p) => p.band === band);
  const selected = positions.find((p) => p.customerId === selectedId) ?? shown[0] ?? null;

  const aging = useMemo(() => receivablesAging(store.invoices), [store.invoices]);
  const counts = (target: RiskBand) => positions.filter((p) => p.band === target).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit Control"
        subtitle={`Forward exposure across the book: unpaid invoices, uninvoiced orders and accepted quotations, converted into ${store.fx.base}.`}
      />

      <StatRow>
        <StatTile
          label="Total exposure"
          value={money(totals.exposure, store.fx.base)}
          hint="Owed, committed and accepted"
          icon={Wallet}
        />
        <StatTile
          label="Past due"
          value={money(totals.overdue, store.fx.base)}
          hint={totals.overdue > 0 ? "Collect before committing more" : "Nothing past due"}
          tone={totals.overdue > 0 ? "danger" : "success"}
          icon={CalendarClock}
        />
        <StatTile
          label="On strained or stopped accounts"
          value={money(totals.atRisk, store.fx.base)}
          hint={`${counts("stop")} stopped · ${counts("strained")} strained`}
          tone={totals.atRisk > 0 ? "caution" : "success"}
          icon={AlertOctagon}
        />
        <StatTile
          label="Days sales outstanding"
          value={totals.dso === null ? "—" : `${totals.dso} days`}
          hint={
            totals.dso === null
              ? "No settled invoices to measure from"
              : "Exposure-weighted, measured from receipts"
          }
          icon={TrendingDown}
        />
      </StatRow>

      {/* Aged receivables as a bar row — the shape matters more than the
          numbers, and a full chart library is not worth the bundle for five
          buckets. */}
      <Group label="Aged receivables" labelTrailing="From issued invoices">
        <div className="flex flex-wrap items-end gap-6 px-3.5 py-4">
          <MiniBars
            values={aging.map((bucket) => bucket.amount)}
            token="--accent"
            height={44}
            barWidth={22}
          />
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {aging.map((bucket) => (
              <div key={bucket.label}>
                <div className="tnum text-[15px] font-semibold text-ink">
                  {money(bucket.amount, store.fx.base)}
                </div>
                <div className="text-[11.5px] text-ink-tertiary">{bucket.label}</div>
              </div>
            ))}
          </div>
        </div>
      </Group>

      <Segmented
        value={band}
        onChange={(next) => {
          setBand(next);
          setSelectedId(null);
        }}
        options={[
          { id: "all", label: "All", count: positions.length },
          { id: "stop", label: "Stopped", count: counts("stop") },
          { id: "strained", label: "Strained", count: counts("strained") },
          { id: "watch", label: "Watch", count: counts("watch") },
          { id: "clear", label: "Clear", count: counts("clear") },
        ]}
      />

      {shown.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={`No accounts in "${band === "all" ? "the book" : RISK_LABELS[band as RiskBand]}"`}
          description="Switch band to see the rest of the book."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <Group label="Accounts" labelTrailing="Riskiest first">
            {shown.map((position) => (
              <Row
                key={position.customerId}
                title={position.customerName}
                subtitle={
                  position.creditLimit
                    ? `${money(position.exposure, position.currency)} of ${money(
                        position.creditLimit,
                        position.currency,
                      )}`
                    : `${money(position.exposure, position.currency)} · no limit set`
                }
                value={
                  position.utilisation === null
                    ? "—"
                    : `${Math.round(position.utilisation * 100)}%`
                }
                valueSub={position.worstDaysLate ? `${position.worstDaysLate}d late` : "on terms"}
                onClick={() => setSelectedId(position.customerId)}
                className={
                  selected?.customerId === position.customerId ? "bg-accent/[0.07]" : undefined
                }
                trailing={
                  <Pill tone={BAND_TONE[position.band]}>{RISK_LABELS[position.band]}</Pill>
                }
              />
            ))}
          </Group>

          {selected ? (
            <PositionDetail
              key={selected.customerId}
              position={selected}
              onOpenRecord={onOpenRecord}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function PositionDetail({
  position,
  onOpenRecord,
}: {
  position: CreditPosition;
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const token = BAND_TOKEN[position.band];
  const customer = store.customers.find((c) => c.id === position.customerId);

  const openInvoices = store.invoices.filter(
    (i) =>
      i.customerId === position.customerId &&
      ["issued", "overdue", "partial"].includes(i.status) &&
      i.total - (i.amountPaid ?? 0) > 0,
  );

  return (
    <div className="space-y-4">
      <div className="ios-group p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <RingGauge
            value={position.utilisation ?? 0}
            token={token}
            size={92}
            thickness={9}
            label={
              position.utilisation === null ? "—" : `${Math.round(position.utilisation * 100)}%`
            }
            sublabel="of limit"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-semibold text-ink">{position.customerName}</h2>
              <Pill tone={BAND_TONE[position.band]}>{RISK_LABELS[position.band]}</Pill>
              {position.partial ? <Pill tone="neutral">partly converted</Pill> : null}
            </div>
            <p
              className="mt-1.5 text-[13px] leading-relaxed"
              style={{ color: `rgb(var(${token}))` }}
            >
              {position.reason}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="tinted"
                onClick={() => onOpenRecord("customers", position.customerId)}
              >
                Open account
              </Button>
              <Button size="sm" variant="plain" onClick={() => onOpenRecord("payments")}>
                Record a receipt
              </Button>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <NumberTicker
              value={position.exposure}
              format={(n) => money(n, position.currency)}
              className="block text-[24px] font-bold leading-none tracking-tight text-ink"
            />
            <span className="text-[11.5px] text-ink-tertiary">Total exposure</span>
          </div>
        </div>
      </div>

      <Group label="How the exposure is made up">
        <FieldRow
          label="Unpaid invoices"
          value={money(position.outstanding, position.currency)}
        />
        <FieldRow
          label="Of which past due"
          value={
            position.overdue > 0 ? (
              <span style={{ color: "rgb(var(--danger))" }}>
                {money(position.overdue, position.currency)}
                {position.worstDaysLate ? ` · ${position.worstDaysLate} days` : ""}
              </span>
            ) : (
              "None"
            )
          }
        />
        <FieldRow
          label="Confirmed orders not yet invoiced"
          value={money(position.committed, position.currency)}
        />
        <FieldRow
          label="Accepted quotations not yet ordered"
          value={money(position.pipelineCommitted, position.currency)}
        />
        <FieldRow
          label="Agreed credit limit"
          value={
            position.creditLimit
              ? money(position.creditLimit, position.currency)
              : "Not set"
          }
        />
        <FieldRow
          label="Headroom"
          value={
            position.headroom === null ? (
              "Unbounded — no limit set"
            ) : (
              <span
                style={{
                  color:
                    position.headroom < 0 ? "rgb(var(--danger))" : "rgb(var(--text-primary))",
                }}
              >
                {money(position.headroom, position.currency)}
              </span>
            )
          }
        />
        <FieldRow
          label="Payment terms"
          value={customer?.paymentTerms ?? "Not recorded"}
        />
        <FieldRow
          label="This account's DSO"
          value={
            position.dso === null ? "No settled invoices yet" : `${position.dso} days`
          }
        />
      </Group>

      {openInvoices.length ? (
        <Group label="Open invoices" labelTrailing={`${openInvoices.length}`}>
          {openInvoices.map((invoice) => {
            const balance = invoice.total - (invoice.amountPaid ?? 0);
            const late =
              invoice.dueAt && new Date(invoice.dueAt) < new Date()
                ? Math.floor(
                    (Date.now() - new Date(invoice.dueAt).getTime()) / 86_400_000,
                  )
                : 0;
            return (
              <Row
                key={invoice.id}
                title={invoice.number}
                subtitle={
                  late > 0
                    ? `${late} days past due`
                    : invoice.dueAt
                      ? `Due ${new Date(invoice.dueAt).toLocaleDateString("en-GB")}`
                      : "No due date recorded"
                }
                value={money(balance, invoice.currency)}
                valueSub={invoice.status}
                onClick={() => onOpenRecord("invoices", invoice.id)}
                trailing={late > 0 ? <Pill tone="danger">late</Pill> : undefined}
              />
            );
          })}
        </Group>
      ) : null}

      <Group label="How the band is decided">
        <div className="space-y-2 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-secondary">
          <p className="flex gap-2">
            <Ban className="mt-[2px] h-3.5 w-3.5 shrink-0" style={{ color: "rgb(var(--danger))" }} />
            <span>
              <strong className="text-ink">Hold new orders</strong> — blocked account, an invoice
              60 days or more past due, or exposure already over the limit.
            </span>
          </p>
          <p className="flex gap-2">
            <Gauge className="mt-[2px] h-3.5 w-3.5 shrink-0" style={{ color: "rgb(var(--accent))" }} />
            <span>
              <strong className="text-ink">Strained</strong> — 30 days or more past due, or at 85%
              of the limit with little headroom.
            </span>
          </p>
          <p className="flex gap-2">
            <Info className="mt-[2px] h-3.5 w-3.5 shrink-0" style={{ color: "rgb(var(--caution))" }} />
            <span>
              <strong className="text-ink">Watch</strong> — some balance past due but inside 30
              days, or no limit set at all, which leaves exposure uncontrolled.
            </span>
          </p>
          <p className="pt-1">
            Lateness outranks utilisation on purpose: an account 60 days late on a small balance
            is a worse counterparty than one at 95% of its limit paying to terms.
          </p>
        </div>
      </Group>
    </div>
  );
}
