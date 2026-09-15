/**
 * Fulfilment — how much of an order has actually shipped.
 *
 * Kept pure and separate from the store so it can be tested without React and
 * reused by the order list, the order detail view, the opportunity chain and
 * the dashboard without three of them quietly disagreeing.
 *
 * The important rule encoded here: you cannot despatch more than was ordered.
 * A CRM that silently accepts 120 units against a 100-unit line will produce an
 * invoice nobody can reconcile, so over-despatch is refused with a reason
 * rather than clamped.
 */
import type { Delivery, Invoice, Order, Payment, Quotation } from "./domain";

export interface LineProgress {
  lineId: string;
  description: string;
  ordered: number;
  delivered: number;
  outstanding: number;
}

/** Per-line delivered/outstanding position for an order. */
export function lineProgress(order: Order, deliveries: Delivery[]): LineProgress[] {
  const mine = deliveries.filter((d) => d.orderId === order.id);
  return order.lines.map((line) => {
    const delivered = mine.reduce((sum, d) => sum + (d.quantities?.[line.id] ?? 0), 0);
    const ordered = line.quantity ?? 0;
    return {
      lineId: line.id,
      description: line.description,
      ordered,
      delivered,
      outstanding: Math.max(0, ordered - delivered),
    };
  });
}

/** 0–1 across the whole order, weighted by quantity. */
export function fulfilmentRatio(order: Order, deliveries: Delivery[]): number {
  const rows = lineProgress(order, deliveries);
  const ordered = rows.reduce((s, r) => s + r.ordered, 0);
  if (ordered <= 0) return 0;
  const delivered = rows.reduce((s, r) => s + Math.min(r.delivered, r.ordered), 0);
  return delivered / ordered;
}

export type FulfilmentState = "not_started" | "part_delivered" | "delivered";

export function fulfilmentState(order: Order, deliveries: Delivery[]): FulfilmentState {
  const ratio = fulfilmentRatio(order, deliveries);
  if (ratio <= 0) return "not_started";
  if (ratio >= 1) return "delivered";
  return "part_delivered";
}

export interface DespatchCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Validates a proposed despatch against what is still outstanding.
 *
 * Returns a reason rather than a boolean alone so the UI can explain the
 * refusal — "3 outstanding, you entered 5" is actionable, "invalid" is not.
 */
export function checkDespatch(
  order: Order,
  deliveries: Delivery[],
  proposed: Record<string, number>,
): DespatchCheck {
  const rows = lineProgress(order, deliveries);
  let any = false;
  for (const row of rows) {
    const qty = Number(proposed[row.lineId] ?? 0);
    if (!qty) continue;
    if (qty < 0) return { ok: false, reason: "Quantities cannot be negative." };
    any = true;
    if (qty > row.outstanding) {
      return {
        ok: false,
        reason: `${row.description}: only ${row.outstanding} outstanding, ${qty} entered.`,
      };
    }
  }
  if (!any) return { ok: false, reason: "Enter a quantity on at least one line." };
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* The chain                                                                  */
/* -------------------------------------------------------------------------- */

export type ChainStageId =
  | "enquiry"
  | "quotation"
  | "order"
  | "delivery"
  | "invoice"
  | "payment";

export interface ChainStage {
  id: ChainStageId;
  label: string;
  state: "done" | "current" | "todo";
  detail?: string;
  recordId?: string;
}

/**
 * Resolves Roni's enquiry → quotation → order → delivery → invoice → payment
 * chain for one order, from live records.
 *
 * Nothing here is stored: the chain is derived every time, so a stage cannot
 * claim to be complete while the record behind it says otherwise. That was the
 * failure mode of showing a stage label on the opportunity record itself.
 */
export function orderChain(input: {
  order: Order;
  quotation?: Quotation;
  deliveries: Delivery[];
  invoices: Invoice[];
  payments: Payment[];
  formatMoney: (n: number, currency?: string) => string;
}): ChainStage[] {
  const { order, quotation, deliveries, invoices, payments, formatMoney } = input;
  const mine = deliveries.filter((d) => d.orderId === order.id);
  const invoice = invoices.find((i) => i.orderId === order.id);
  const paid = invoice
    ? payments
        .filter((p) => p.invoiceId === invoice.id && p.direction !== "out")
        .reduce((s, p) => s + p.amount, 0)
    : 0;
  const ratio = fulfilmentRatio(order, deliveries);

  const stages: ChainStage[] = [
    {
      id: "enquiry",
      label: "Enquiry",
      state: "done",
      detail: "Logged against the account",
    },
    {
      id: "quotation",
      label: "Quotation",
      state: quotation ? "done" : "todo",
      detail: quotation
        ? `${quotation.number} · ${formatMoney(quotation.total, quotation.currency)}`
        : "Raised directly as an order",
      recordId: quotation?.id,
    },
    {
      id: "order",
      label: "Order",
      state: "done",
      detail: `${order.number} · ${formatMoney(order.total, order.currency)}`,
      recordId: order.id,
    },
    {
      id: "delivery",
      label: "Delivery",
      state: ratio >= 1 ? "done" : ratio > 0 ? "current" : "todo",
      detail: mine.length
        ? `${mine.length} despatch${mine.length === 1 ? "" : "es"} · ${Math.round(ratio * 100)}% shipped`
        : "Nothing despatched yet",
    },
    {
      id: "invoice",
      label: "Invoice",
      state: invoice ? "done" : ratio >= 1 ? "current" : "todo",
      detail: invoice
        ? `${invoice.number} · ${formatMoney(invoice.total, invoice.currency)}`
        : "Not raised",
      recordId: invoice?.id,
    },
    {
      id: "payment",
      label: "Payment",
      state:
        invoice && paid >= invoice.total - 0.01
          ? "done"
          : paid > 0
            ? "current"
            : "todo",
      detail: invoice
        ? paid > 0
          ? `${formatMoney(paid, invoice.currency)} received of ${formatMoney(invoice.total, invoice.currency)}`
          : "Awaiting payment"
        : "Awaiting invoice",
    },
  ];

  return stages;
}
