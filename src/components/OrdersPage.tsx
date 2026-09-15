/**
 * Orders.
 *
 * This is the hinge of Roni's second requirement — enquiry → quotation → order
 * → delivery → invoice → payment — and it was the weakest module in the build:
 * a list of rows with a date field and a note, no detail view, and no concept
 * of a despatch at all, which meant the "delivery" stage of his chain was a
 * word on a diagram rather than a record.
 *
 * It now has three things it didn't:
 *   1. A detail view, built from the shared iOS primitives.
 *   2. Real deliveries — part-shipment, carrier, tracking, arrival — with the
 *      order status derived from them rather than set by hand.
 *   3. The chain rendered on every order, with each stage opening the actual
 *      record behind it. That is what makes the modules one system instead of
 *      six lists.
 */
import {
  Building2,
  FileText,
  Mail,
  MapPin,
  Package,
  PackageCheck,
  Plus,
  Receipt,
  ScrollText,
  Ship,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  BackLink,
  Button,
  ChainTimeline,
  EmptyState,
  FieldRow,
  Group,
  PageHeader,
  Pill,
  ProgressBar,
  RelatedPanel,
  Row,
  SearchField,
  Segmented,
  SectionLabel,
  StatRow,
  StatTile,
  StatusPill,
  Sheet,
} from "@/components/ios";
import { useStore } from "@/lib/store";
import type { Order, OrderStatus } from "@/lib/domain";
import {
  fulfilmentRatio,
  fulfilmentState,
  lineProgress,
  orderChain,
} from "@/lib/fulfilment";
import type { AppSection } from "@/components/Shell";

function money(n: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function shortDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Status transitions the user may drive by hand. Shipped and delivered are
 *  deliberately absent — those are consequences of despatches, not buttons. */
const MANUAL_FLOW: Record<string, { next: OrderStatus; label: string; tone?: "accent" | "danger" }[]> = {
  draft: [
    { next: "confirmed", label: "Confirm order" },
    { next: "cancelled", label: "Cancel", tone: "danger" },
  ],
  confirmed: [{ next: "in_progress", label: "Start fulfilment" }],
};

type Filter = "all" | "open" | "shipping" | "closed";

export function OrdersPage({
  initialOrderId,
  onOpenRecord,
}: {
  initialOrderId?: string | null;
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(initialOrderId ?? null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const selected = store.orders.find((o) => o.id === selectedId) ?? null;

  const stats = useMemo(() => {
    const open = store.orders.filter(
      (o) => !["delivered", "cancelled"].includes(o.status),
    );
    const awaitingDespatch = store.orders.filter(
      (o) =>
        !["draft", "cancelled"].includes(o.status) &&
        fulfilmentState(o, store.deliveries) !== "delivered",
    );
    const awaitingInvoice = store.orders.filter(
      (o) =>
        fulfilmentRatio(o, store.deliveries) >= 1 &&
        !store.invoices.some((i) => i.orderId === o.id) &&
        o.status !== "cancelled",
    );
    return {
      openValue: open.reduce((s, o) => s + o.total, 0),
      openCount: open.length,
      awaitingDespatch: awaitingDespatch.length,
      awaitingInvoice: awaitingInvoice.length,
    };
  }, [store.orders, store.deliveries, store.invoices]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.orders.filter((o) => {
      const customer = store.customers.find((c) => c.id === o.customerId);
      if (filter === "open" && ["delivered", "cancelled"].includes(o.status)) return false;
      if (filter === "shipping" && fulfilmentState(o, store.deliveries) === "not_started")
        return false;
      if (filter === "closed" && !["delivered", "cancelled"].includes(o.status)) return false;
      if (!q) return true;
      return (
        o.number.toLowerCase().includes(q) ||
        (customer?.name || "").toLowerCase().includes(q) ||
        (o.customerReference || "").toLowerCase().includes(q)
      );
    });
  }, [store.orders, store.customers, store.deliveries, filter, query]);

  if (selected) {
    return (
      <OrderDetail
        order={selected}
        onBack={() => setSelectedId(null)}
        onOpenRecord={onOpenRecord}
        onNotice={setNotice}
        notice={notice}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        subtitle="Confirm, despatch and invoice — the middle of the chain."
        actions={
          <Button
            variant="filled"
            icon={Plus}
            onClick={() => onOpenRecord("quotations")}
          >
            From quotation
          </Button>
        }
      />

      {notice ? (
        <div className="ios-group px-3.5 py-2.5 text-[13.5px] text-accent">{notice}</div>
      ) : null}

      <StatRow>
        <StatTile label="Open order value" value={money(stats.openValue)} hint={`${stats.openCount} open`} />
        <StatTile label="Awaiting despatch" value={String(stats.awaitingDespatch)} tone={stats.awaitingDespatch ? "accent" : "neutral"} />
        <StatTile
          label="Ready to invoice"
          value={String(stats.awaitingInvoice)}
          tone={stats.awaitingInvoice ? "success" : "neutral"}
          hint="Fully delivered, not yet billed"
        />
        <StatTile label="Delivery notes" value={String(store.deliveries.length)} hint="Despatches on file" />
      </StatRow>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Segmented<Filter>
          className="sm:w-[380px]"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All" },
            { id: "open", label: "Open" },
            { id: "shipping", label: "Shipping" },
            { id: "closed", label: "Closed" },
          ]}
        />
        <div className="flex-1">
          <SearchField value={query} onChange={setQuery} placeholder="Order number, customer or their PO" />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No orders here"
          description="Accepted quotations convert into orders, or raise one directly from a customer."
        />
      ) : (
        <Group>
          {visible.map((order) => {
            const customer = store.customers.find((c) => c.id === order.customerId);
            const ratio = fulfilmentRatio(order, store.deliveries);
            const invoice = store.invoices.find((i) => i.orderId === order.id);
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => setSelectedId(order.id)}
                className="ios-row row-hover brand-focus block w-full px-3.5 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] bg-accent text-white">
                    <Package className="h-[17px] w-[17px]" strokeWidth={2.1} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[14px] font-semibold text-ink">
                        {order.number}
                      </span>
                      <StatusPill status={order.status} />
                      {invoice ? <Pill tone="success">invoiced</Pill> : null}
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-ink-secondary">
                      {customer?.name || "—"}
                      {order.customerReference ? ` · their ref ${order.customerReference}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tnum text-[15px] font-semibold text-ink">
                      {money(order.total, order.currency)}
                    </div>
                    <div className="text-[12px] text-ink-tertiary">
                      {order.deliveryDate ? `due ${shortDate(order.deliveryDate)}` : "no date"}
                    </div>
                  </div>
                </div>
                {order.status !== "draft" && order.status !== "cancelled" ? (
                  <div className="mt-2.5 flex items-center gap-2.5 pl-[42px]">
                    <ProgressBar value={ratio} tone={ratio >= 1 ? "success" : "accent"} />
                    <span className="tnum shrink-0 text-[11.5px] text-ink-tertiary">
                      {Math.round(ratio * 100)}% shipped
                    </span>
                  </div>
                ) : null}
              </button>
            );
          })}
        </Group>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                     */
/* -------------------------------------------------------------------------- */

function OrderDetail({
  order,
  onBack,
  onOpenRecord,
  onNotice,
  notice,
}: {
  order: Order;
  onBack: () => void;
  onOpenRecord: (section: AppSection, id?: string) => void;
  onNotice: (text: string | null) => void;
  notice: string | null;
}) {
  const store = useStore();
  const [despatchOpen, setDespatchOpen] = useState(false);

  const customer = store.customers.find((c) => c.id === order.customerId);
  const quotation = store.quotations.find(
    (q) => q.id === order.quotationId || q.convertedOrderId === order.id,
  );
  const invoice = store.invoices.find((i) => i.orderId === order.id);
  const deliveries = store.deliveries
    .filter((d) => d.orderId === order.id)
    .sort((a, b) => new Date(b.despatchedAt).getTime() - new Date(a.despatchedAt).getTime());
  const progress = lineProgress(order, store.deliveries);
  const ratio = fulfilmentRatio(order, store.deliveries);
  const correspondence = store.communications.filter((c) => c.orderId === order.id);

  const chain = orderChain({
    order,
    quotation,
    deliveries: store.deliveries,
    invoices: store.invoices,
    payments: store.payments,
    formatMoney: money,
  });

  const related = [
    customer && {
      key: "customer",
      icon: Building2,
      label: "Customer",
      title: customer.name,
      detail: `${customer.status} · ${money(customer.totalRevenue ?? 0, customer.currency)} lifetime`,
      onOpen: () => onOpenRecord("customers", customer.id),
    },
    quotation && {
      key: "quotation",
      icon: FileText,
      label: "Quotation",
      title: quotation.number,
      detail: `${quotation.status} · ${money(quotation.total, quotation.currency)}`,
      onOpen: () => onOpenRecord("quotations", quotation.id),
    },
    invoice && {
      key: "invoice",
      icon: Receipt,
      label: "Invoice",
      title: invoice.number,
      detail: `${invoice.status} · ${money(invoice.total, invoice.currency)}`,
      onOpen: () => onOpenRecord("invoices", invoice.id),
    },
    correspondence.length > 0 && {
      key: "mail",
      icon: Mail,
      label: "Correspondence",
      title: `${correspondence.length} message${correspondence.length === 1 ? "" : "s"}`,
      detail: "About this order",
      onOpen: () => onOpenRecord(correspondence[0].channel === "whatsapp" ? "whatsapp" : "email"),
    },
  ].filter(Boolean) as Parameters<typeof RelatedPanel>[0]["items"];

  const canInvoice = !invoice && order.status !== "cancelled" && ratio > 0;

  return (
    <div className="space-y-5">
      <BackLink label="Orders" onClick={onBack} />

      <PageHeader
        title={order.number}
        subtitle={`${customer?.name || "—"} · ${money(order.total, order.currency)}`}
        actions={
          <>
            {(MANUAL_FLOW[order.status] || []).map((step) => (
              <Button
                key={step.next}
                variant={step.tone === "danger" ? "plain" : "tinted"}
                tone={step.tone === "danger" ? "danger" : "accent"}
                onClick={() => {
                  store.updateOrderStatus(order.id, step.next);
                  onNotice(`Order marked ${step.next.replace(/_/g, " ")}.`);
                }}
              >
                {step.label}
              </Button>
            ))}
            {order.status !== "draft" && order.status !== "cancelled" && ratio < 1 ? (
              <Button variant="filled" icon={Ship} onClick={() => setDespatchOpen(true)}>
                Record despatch
              </Button>
            ) : null}
            <Button
              variant={canInvoice ? "filled" : "tinted"}
              icon={Receipt}
              disabled={!canInvoice}
              onClick={() => {
                const id = store.convertOrderToInvoice(order.id);
                onNotice(id ? "Invoice raised from this order." : "This order already has an invoice.");
              }}
            >
              {invoice ? "Invoiced" : "Raise invoice"}
            </Button>
          </>
        }
      />

      {notice ? (
        <div className="ios-group px-3.5 py-2.5 text-[13.5px] text-accent">{notice}</div>
      ) : null}

      <StatRow>
        <StatTile label="Order value" value={money(order.total, order.currency)} hint={`${order.lines.length} line${order.lines.length === 1 ? "" : "s"}`} />
        <StatTile
          label="Despatched"
          value={`${Math.round(ratio * 100)}%`}
          tone={ratio >= 1 ? "success" : ratio > 0 ? "accent" : "neutral"}
          hint={`${deliveries.length} delivery note${deliveries.length === 1 ? "" : "s"}`}
        />
        <StatTile label="Promised" value={order.deliveryDate ? shortDate(order.deliveryDate) : "Not set"} hint={order.incoterms || "No incoterms"} />
        <StatTile
          label="Invoiced"
          value={invoice ? money(invoice.total, invoice.currency) : "—"}
          tone={invoice ? "success" : "neutral"}
          hint={invoice ? invoice.status : "Not raised"}
        />
      </StatRow>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {/* Lines with their delivery position — the thing the old page
              couldn't show, because it had no despatch record to compare to. */}
          <Group label="Lines" labelTrailing={`${Math.round(ratio * 100)}% shipped`}>
            {progress.map((row, i) => {
              const line = order.lines[i];
              const lineRatio = row.ordered ? row.delivered / row.ordered : 0;
              return (
                <div key={row.lineId} className="ios-row px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14.5px] font-medium text-ink">
                        {row.description}
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-ink-secondary">
                        {row.ordered} × {money(line.unitPrice, order.currency)}
                        {line.discountPct ? ` · less ${line.discountPct}%` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tnum text-[14.5px] font-semibold text-ink">
                        {money(row.ordered * line.unitPrice * (1 - (line.discountPct ?? 0) / 100), order.currency)}
                      </div>
                      <div className="tnum text-[12px] text-ink-tertiary">
                        {row.delivered} of {row.ordered} shipped
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2.5">
                    <ProgressBar value={lineRatio} tone={lineRatio >= 1 ? "success" : "accent"} />
                    {row.outstanding > 0 ? (
                      <Pill tone="neutral">{row.outstanding} outstanding</Pill>
                    ) : (
                      <Pill tone="success" icon={PackageCheck}>complete</Pill>
                    )}
                  </div>
                </div>
              );
            })}
            <FieldRow label="Subtotal" value={money(order.subtotal, order.currency)} />
            <FieldRow label="VAT" value={money(order.tax, order.currency)} />
            <FieldRow label="Total" value={money(order.total, order.currency)} />
          </Group>

          <Group
            label="Deliveries"
            labelTrailing={deliveries.length ? `${deliveries.length}` : undefined}
          >
            {deliveries.length === 0 ? (
              <p className="px-3.5 py-4 text-[13.5px] text-ink-secondary">
                Nothing despatched yet. Recording a despatch updates the order's
                status automatically — part shipments keep it in progress.
              </p>
            ) : (
              deliveries.map((d) => {
                const units = Object.values(d.quantities || {}).reduce((a, b) => a + b, 0);
                return (
                  <Row
                    key={d.id}
                    icon={d.deliveredAt ? PackageCheck : Truck}
                    iconClass={d.deliveredAt ? "bg-success" : "bg-accent"}
                    title={d.reference}
                    subtitle={`${units} units · ${d.carrier || "carrier not set"}${
                      d.trackingRef ? ` · ${d.trackingRef}` : ""
                    }`}
                    trailing={
                      d.deliveredAt ? (
                        <Pill tone="success">arrived {shortDate(d.deliveredAt)}</Pill>
                      ) : (
                        <Button
                          size="sm"
                          variant="tinted"
                          onClick={() => {
                            store.markDeliveryArrived(d.id);
                            onNotice(`${d.reference} marked as arrived.`);
                          }}
                        >
                          Mark arrived
                        </Button>
                      )
                    }
                    chevron={false}
                  />
                );
              })
            )}
          </Group>

          <Group label="Fulfilment details">
            <FieldRow label="Customer reference" value={order.customerReference || "—"} />
            <FieldRow label="Incoterms" value={order.incoterms || "—"} />
            <FieldRow
              label="Deliver to"
              value={
                <span className="inline-flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-tertiary" />
                  <span>{order.deliveryAddress || customer?.city || "—"}</span>
                </span>
              }
            />
            <FieldRow label="Promised date" value={shortDate(order.deliveryDate)} />
            <FieldRow label="Internal note" value={order.notes || "—"} />
          </Group>
        </div>

        <div className="space-y-5">
          <section>
            <SectionLabel>Chain</SectionLabel>
            <div className="ios-group p-4">
              <ChainTimeline
                stages={chain.map((stage) => ({
                  label: stage.label,
                  state: stage.state,
                  detail: stage.detail,
                  onOpen:
                    stage.id === "quotation" && stage.recordId
                      ? () => onOpenRecord("quotations", stage.recordId)
                      : stage.id === "invoice" && stage.recordId
                        ? () => onOpenRecord("invoices", stage.recordId)
                        : stage.id === "payment" && invoice
                          ? () => onOpenRecord("payments", invoice.id)
                          : undefined,
                }))}
              />
            </div>
          </section>

          <RelatedPanel items={related} />
        </div>
      </div>

      {despatchOpen ? (
        <DespatchSheet
          order={order}
          onClose={() => setDespatchOpen(false)}
          onDone={(message) => {
            onNotice(message);
            setDespatchOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Despatch sheet                                                             */
/* -------------------------------------------------------------------------- */

function DespatchSheet({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const store = useStore();
  const progress = lineProgress(order, store.deliveries);
  // Pre-filled with everything outstanding, because a full despatch is the
  // common case and typing the same numbers back in is pure friction.
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(progress.map((r) => [r.lineId, String(r.outstanding)])),
  );
  const [carrier, setCarrier] = useState("");
  const [trackingRef, setTrackingRef] = useState("");
  const [despatchedAt, setDespatchedAt] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsed: Record<string, number> = {};
    for (const [lineId, value] of Object.entries(quantities)) {
      const n = Number(value);
      if (n > 0) parsed[lineId] = n;
    }
    const result = store.addDelivery({
      orderId: order.id,
      quantities: parsed,
      carrier: carrier.trim() || undefined,
      trackingRef: trackingRef.trim() || undefined,
      despatchedAt: despatchedAt ? new Date(despatchedAt).toISOString() : undefined,
    });
    if (!result.id) {
      setError(result.message);
      return;
    }
    onDone(result.message);
  };

  const inputClass =
    "h-10 w-full rounded-[10px] border border-divider bg-canvas px-3 text-[14px] text-ink outline-none focus:border-accent";

  return (
    <Sheet
      title="Record despatch"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] text-ink-tertiary">
            Over-despatch is refused, not clamped.
          </span>
          <Button variant="filled" onClick={submit}>
            Record despatch
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error ? (
          <p
            className="rounded-[10px] px-3 py-2 text-[13px] font-medium"
            style={{ backgroundColor: "rgb(var(--danger) / 0.14)", color: "rgb(var(--danger))" }}
          >
            {error}
          </p>
        ) : null}

        <Group label="Quantities">
          {progress.map((row) => (
            <div key={row.lineId} className="ios-row flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-ink">{row.description}</div>
                <div className="text-[12px] text-ink-tertiary">
                  {row.outstanding} outstanding of {row.ordered}
                </div>
              </div>
              <input
                type="number"
                min={0}
                max={row.outstanding}
                value={quantities[row.lineId] ?? ""}
                onChange={(e) =>
                  setQuantities((q) => ({ ...q, [row.lineId]: e.target.value }))
                }
                className={`${inputClass} w-24 text-right`}
              />
            </div>
          ))}
        </Group>

        <Group label="Shipment">
          <div className="ios-row space-y-3 px-3.5 py-3">
            <label className="block">
              <span className="mb-1 block text-[12.5px] text-ink-secondary">Carrier</span>
              <input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="DHL Air, Bring Cargo…"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12.5px] text-ink-secondary">Tracking reference</span>
              <input
                value={trackingRef}
                onChange={(e) => setTrackingRef(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12.5px] text-ink-secondary">Despatched</span>
              <input
                type="date"
                value={despatchedAt}
                onChange={(e) => setDespatchedAt(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
        </Group>
      </div>
    </Sheet>
  );
}
