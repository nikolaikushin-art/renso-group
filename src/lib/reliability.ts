/**
 * Renso Group CRM — measured reliability.
 *
 * Requirement 9 asks for relationship scoring that accounts for **payment
 * reliability** on the customer side and **delivery performance** on the
 * supplier side. Both existed as numbers, and neither was measured: payment
 * reliability was a paid-versus-overdue headcount, and delivery performance
 * was a figure typed into the seed file.
 *
 * This module measures both from the records that already exist — receipts
 * against invoice due dates, despatches against promised delivery dates.
 *
 * The important addition is **confidence**. One invoice paid on time is not a
 * reliable payer, and a supplier with a single delivery has no track record.
 * Every figure here carries its sample size, and the UI is expected to say
 * "insufficient history" rather than print a flattering 100%.
 */

import type { Delivery, Invoice, Order, Payment } from "@/lib/domain";
import { fulfilmentRatio } from "@/lib/fulfilment";

const dayMs = 86_400_000;

export type Confidence = "none" | "low" | "fair" | "good";

/** Sample sizes below which a percentage is not worth printing. */
export function confidenceFor(sample: number): Confidence {
  if (sample === 0) return "none";
  if (sample < 3) return "low";
  if (sample < 8) return "fair";
  return "good";
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  none: "No history",
  low: "Thin history",
  fair: "Fair sample",
  good: "Good sample",
};

export interface PaymentBehaviour {
  customerId: string;
  /** Invoices settled in full, with both an issue date and receipts. */
  settled: number;
  /** Settled on or before the due date. */
  onTime: number;
  onTimePct: number | null;
  /** Mean days late across settled invoices. Negative means early. */
  avgDaysLate: number | null;
  /** Worst single settlement delay. */
  worstDaysLate: number | null;
  /** Currently open invoices past their due date. */
  openOverdue: number;
  /** Part-paid invoices — a distinct behaviour from simply late. */
  partPayments: number;
  confidence: Confidence;
  /** 0–100, for the scoring composite. Null when there is no history. */
  score: number | null;
  /** What the UI shows instead of a number when history is thin. */
  note?: string;
}

export function paymentBehaviour(
  customerId: string,
  invoices: Invoice[],
  payments: Payment[],
  now: Date = new Date(),
): PaymentBehaviour {
  const mine = invoices.filter((i) => i.customerId === customerId);
  const receipts = payments.filter((p) => p.direction === "in");

  let settled = 0;
  let onTime = 0;
  let totalLate = 0;
  let worst: number | null = null;

  for (const invoice of mine) {
    if (!invoice.dueAt) continue;
    const paid = invoice.amountPaid ?? 0;
    // Only fully settled invoices carry a verdict. A part payment says
    // something else, and is counted separately below.
    if (paid + 0.01 < invoice.total) continue;

    const invoiceReceipts = receipts
      .filter((p) => p.invoiceId === invoice.id)
      .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
    const settledAt = invoiceReceipts[0]?.paidAt ?? invoice.paidAt;
    if (!settledAt) continue;

    const late = Math.round(
      (new Date(settledAt).getTime() - new Date(invoice.dueAt).getTime()) / dayMs,
    );
    settled += 1;
    totalLate += late;
    if (late <= 0) onTime += 1;
    if (worst === null || late > worst) worst = late;
  }

  const openOverdue = mine.filter(
    (i) =>
      ["issued", "overdue", "partial"].includes(i.status) &&
      i.dueAt &&
      new Date(i.dueAt).getTime() < now.getTime() &&
      i.total - (i.amountPaid ?? 0) > 0,
  ).length;

  const partPayments = mine.filter(
    (i) => (i.amountPaid ?? 0) > 0 && (i.amountPaid ?? 0) + 0.01 < i.total,
  ).length;

  const confidence = confidenceFor(settled);
  const onTimePct = settled > 0 ? Math.round((onTime / settled) * 100) : null;
  const avgDaysLate = settled > 0 ? Math.round(totalLate / settled) : null;

  // Score punishes an account that is currently late as well as one that paid
  // late historically. A clean record and three overdue invoices on the desk
  // right now is not a reliable payer.
  let score: number | null = null;
  if (onTimePct !== null) {
    const latenessPenalty = Math.min(40, Math.max(0, avgDaysLate ?? 0) * 1.5);
    const openPenalty = Math.min(30, openOverdue * 15);
    score = Math.max(0, Math.min(100, Math.round(onTimePct - latenessPenalty - openPenalty)));
  }

  return {
    customerId,
    settled,
    onTime,
    onTimePct,
    avgDaysLate,
    worstDaysLate: worst,
    openOverdue,
    partPayments,
    confidence,
    score,
    note:
      confidence === "none"
        ? "No settled invoices yet — nothing to measure."
        : confidence === "low"
          ? `Measured from ${settled} settled invoice${settled === 1 ? "" : "s"} — treat as indicative.`
          : undefined,
  };
}

export interface DeliveryPerformance {
  supplierId: string;
  /** Orders containing this supplier's products that had a promised date. */
  assessed: number;
  onTime: number;
  onTimePct: number | null;
  /** Mean days late on despatch against the promised delivery date. */
  avgDaysLate: number | null;
  /** Mean share of ordered quantity actually despatched. */
  avgFillRate: number | null;
  /** Orders still open past their promised date. */
  openLate: number;
  confidence: Confidence;
  score: number | null;
  note?: string;
}

/**
 * Supplier delivery performance, measured through the orders their products
 * were sold on.
 *
 * This is an approximation and the UI says so: Renso buys against customer
 * orders, so a late despatch to the customer is usually — but not always — a
 * late delivery from the supplier. Modelling purchase orders properly would
 * make this exact, and that needs a purchasing module rather than a formula.
 */
export function deliveryPerformance(
  supplierId: string,
  input: {
    orders: Order[];
    deliveries: Delivery[];
    products: { id: string; supplierIds: string[] }[];
    now?: Date;
  },
): DeliveryPerformance {
  const now = input.now ?? new Date();
  const theirProducts = new Set(
    input.products.filter((p) => p.supplierIds.includes(supplierId)).map((p) => p.id),
  );

  const relevant = input.orders.filter(
    (order) =>
      order.status !== "cancelled" &&
      order.status !== "draft" &&
      order.lines.some((line) => line.productId && theirProducts.has(line.productId)),
  );

  let assessed = 0;
  let onTime = 0;
  let totalLate = 0;
  let fillTotal = 0;
  let openLate = 0;

  for (const order of relevant) {
    const despatches = input.deliveries
      .filter((d) => d.orderId === order.id)
      .sort((a, b) => new Date(a.despatchedAt).getTime() - new Date(b.despatchedAt).getTime());

    fillTotal += fulfilmentRatio(order, input.deliveries);

    if (!order.deliveryDate) continue;
    const promised = new Date(order.deliveryDate).getTime();

    if (!despatches.length) {
      if (promised < now.getTime()) openLate += 1;
      continue;
    }

    // Judged on the first despatch: that is when the supplier delivered to us.
    const late = Math.round((new Date(despatches[0].despatchedAt).getTime() - promised) / dayMs);
    assessed += 1;
    totalLate += late;
    if (late <= 0) onTime += 1;
  }

  const confidence = confidenceFor(assessed);
  const onTimePct = assessed > 0 ? Math.round((onTime / assessed) * 100) : null;
  const avgDaysLate = assessed > 0 ? Math.round(totalLate / assessed) : null;
  const avgFillRate = relevant.length
    ? Math.round((fillTotal / relevant.length) * 100)
    : null;

  let score: number | null = null;
  if (onTimePct !== null) {
    const latenessPenalty = Math.min(40, Math.max(0, avgDaysLate ?? 0) * 2);
    const openPenalty = Math.min(25, openLate * 12);
    score = Math.max(0, Math.min(100, Math.round(onTimePct - latenessPenalty - openPenalty)));
  }

  return {
    supplierId,
    assessed,
    onTime,
    onTimePct,
    avgDaysLate,
    avgFillRate,
    openLate,
    confidence,
    score,
    note:
      confidence === "none"
        ? "No orders with a promised date carry this supplier's products yet."
        : confidence === "low"
          ? `Measured from ${assessed} order${assessed === 1 ? "" : "s"} — indicative only.`
          : undefined,
  };
}

export function paymentBook(
  customers: { id: string }[],
  invoices: Invoice[],
  payments: Payment[],
  now: Date = new Date(),
): Record<string, PaymentBehaviour> {
  const out: Record<string, PaymentBehaviour> = {};
  for (const customer of customers) {
    out[customer.id] = paymentBehaviour(customer.id, invoices, payments, now);
  }
  return out;
}

export function deliveryBook(
  suppliers: { id: string }[],
  input: {
    orders: Order[];
    deliveries: Delivery[];
    products: { id: string; supplierIds: string[] }[];
    now?: Date;
  },
): Record<string, DeliveryPerformance> {
  const out: Record<string, DeliveryPerformance> = {};
  for (const supplier of suppliers) {
    out[supplier.id] = deliveryPerformance(supplier.id, input);
  }
  return out;
}
