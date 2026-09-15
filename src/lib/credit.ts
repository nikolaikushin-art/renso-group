/**
 * Renso Group CRM — credit exposure.
 *
 * `Customer.creditLimit` existed in the domain and was never used by anything,
 * which meant the app could cheerfully confirm a fourth order for an account
 * already 60 days late on three invoices. Exposure here is the whole forward
 * commitment, not just the unpaid ledger:
 *
 *   unpaid invoices  — money owed now
 * + open orders      — goods committed but not yet invoiced
 * + accepted quotes  — orders in all but name
 *
 * Quotations that are merely *sent* are excluded. Counting speculative paper
 * as exposure makes every active account look distressed, and a control that
 * cries wolf gets switched off.
 */

import { sumInCurrency, type FxTable } from "@/lib/fx";
import type { Customer, Invoice, Order, Payment, Quotation } from "@/lib/domain";

export type RiskBand = "clear" | "watch" | "strained" | "stop";

export const RISK_LABELS: Record<RiskBand, string> = {
  clear: "Within terms",
  watch: "Watch",
  strained: "Strained",
  stop: "Hold new orders",
};

export interface CreditPosition {
  customerId: string;
  customerName: string;
  currency: string;
  /** Unpaid balance on issued invoices. */
  outstanding: number;
  /** Portion of `outstanding` past its due date. */
  overdue: number;
  /** Days past due on the oldest overdue invoice. */
  worstDaysLate: number;
  /** Value of confirmed-but-uninvoiced orders. */
  committed: number;
  /** Value of accepted quotations not yet turned into orders. */
  pipelineCommitted: number;
  /** outstanding + committed + pipelineCommitted. */
  exposure: number;
  creditLimit?: number;
  /** exposure ÷ creditLimit, or null when no limit is set. */
  utilisation: number | null;
  /** Headroom left before the limit. Null when no limit is set. */
  headroom: number | null;
  /** Days sales outstanding, measured from this account's paid invoices. */
  dso: number | null;
  band: RiskBand;
  /** Plain-English reason for the band — what the UI actually shows. */
  reason: string;
  /** True when a rate was missing and part of the exposure is excluded. */
  partial: boolean;
}

const dayMs = 86_400_000;
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const daysBetween = (from: string, to: Date): number =>
  Math.floor((to.getTime() - new Date(from).getTime()) / dayMs);

const invoiceBalance = (invoice: Invoice): number =>
  Math.max(0, invoice.total - (invoice.amountPaid ?? 0));

const isOpenInvoice = (invoice: Invoice): boolean =>
  ["issued", "overdue", "partial"].includes(invoice.status);

/**
 * Days sales outstanding for one account: the payment-weighted average delay
 * between issue and settlement. Measured from this account's own history
 * rather than a company-wide average, because that average is exactly what
 * hides a slow payer.
 */
export function customerDso(
  invoices: Invoice[],
  payments: Payment[],
  customerId: string,
): number | null {
  const settled = invoices.filter(
    (i) => i.customerId === customerId && i.issuedAt && (i.status === "paid" || i.amountPaid),
  );
  if (!settled.length) return null;

  let weighted = 0;
  let weight = 0;
  for (const invoice of settled) {
    const receipts = payments.filter((p) => p.direction === "in" && p.invoiceId === invoice.id);
    for (const receipt of receipts) {
      const days = daysBetween(invoice.issuedAt!, new Date(receipt.paidAt));
      if (days < 0) continue;
      weighted += days * receipt.amount;
      weight += receipt.amount;
    }
  }
  if (weight <= 0) return null;
  return Math.round(weighted / weight);
}

export interface CreditInput {
  customers: Customer[];
  invoices: Invoice[];
  orders: Order[];
  quotations: Quotation[];
  payments: Payment[];
  fx: FxTable;
  /** Currency the desk reads exposure in. */
  reportingCurrency: string;
  now?: Date;
}

export function creditPosition(customer: Customer, input: CreditInput): CreditPosition {
  const now = input.now ?? new Date();
  const to = input.reportingCurrency;

  const openInvoices = input.invoices.filter(
    (i) => i.customerId === customer.id && isOpenInvoice(i),
  );

  const outstandingTotal = sumInCurrency(
    openInvoices.map((i) => ({ amount: invoiceBalance(i), currency: i.currency })),
    to,
    input.fx,
    now,
  );

  const overdueInvoices = openInvoices.filter(
    (i) => i.dueAt && new Date(i.dueAt).getTime() < now.getTime(),
  );
  const overdueTotal = sumInCurrency(
    overdueInvoices.map((i) => ({ amount: invoiceBalance(i), currency: i.currency })),
    to,
    input.fx,
    now,
  );

  const worstDaysLate = overdueInvoices.reduce(
    (worst, i) => Math.max(worst, daysBetween(i.dueAt!, now)),
    0,
  );

  // Orders that are live but not yet invoiced. An order with an invoice
  // against it would otherwise be counted twice — once as committed goods and
  // again as an unpaid invoice.
  const invoicedOrderIds = new Set(
    input.invoices.filter((i) => i.orderId).map((i) => i.orderId as string),
  );
  const openOrders = input.orders.filter(
    (o) =>
      o.customerId === customer.id &&
      ["confirmed", "in_progress", "shipped"].includes(o.status) &&
      !invoicedOrderIds.has(o.id),
  );
  const committedTotal = sumInCurrency(
    openOrders.map((o) => ({ amount: o.total, currency: o.currency })),
    to,
    input.fx,
    now,
  );

  const acceptedQuotes = input.quotations.filter(
    (q) => q.customerId === customer.id && q.status === "accepted" && !q.convertedOrderId,
  );
  const pipelineTotal = sumInCurrency(
    acceptedQuotes.map((q) => ({ amount: q.total, currency: q.currency })),
    to,
    input.fx,
    now,
  );

  const outstanding = round2(outstandingTotal.total);
  const overdue = round2(overdueTotal.total);
  const committed = round2(committedTotal.total);
  const pipelineCommitted = round2(pipelineTotal.total);
  const exposure = round2(outstanding + committed + pipelineCommitted);

  const creditLimit = customer.creditLimit;
  const utilisation = creditLimit && creditLimit > 0 ? exposure / creditLimit : null;
  const headroom = creditLimit && creditLimit > 0 ? round2(creditLimit - exposure) : null;
  const dso = customerDso(input.invoices, input.payments, customer.id);

  const partial =
    outstandingTotal.unconverted.length > 0 ||
    committedTotal.unconverted.length > 0 ||
    pipelineTotal.unconverted.length > 0;

  const { band, reason } = classify({
    overdue,
    worstDaysLate,
    utilisation,
    exposure,
    hasLimit: Boolean(creditLimit && creditLimit > 0),
    blocked: customer.status === "blocked",
  });

  return {
    customerId: customer.id,
    customerName: customer.name,
    currency: to,
    outstanding,
    overdue,
    worstDaysLate,
    committed,
    pipelineCommitted,
    exposure,
    creditLimit,
    utilisation,
    headroom,
    dso,
    band,
    reason,
    partial,
  };
}

/**
 * Banding rules, in one place so the dashboard, the customer page and the
 * order screen cannot disagree about whether an account is in trouble.
 * Lateness dominates utilisation: an account 60 days late on a small balance
 * is a worse counterparty than one sitting at 95% of a limit and paying on time.
 */
function classify(input: {
  overdue: number;
  worstDaysLate: number;
  utilisation: number | null;
  exposure: number;
  hasLimit: boolean;
  blocked: boolean;
}): { band: RiskBand; reason: string } {
  if (input.blocked) {
    return { band: "stop", reason: "Account is blocked — no new commitments." };
  }
  if (input.worstDaysLate >= 60) {
    return {
      band: "stop",
      reason: `Invoice ${input.worstDaysLate} days past due. Collect before committing further goods.`,
    };
  }
  if (input.utilisation !== null && input.utilisation > 1) {
    return {
      band: "stop",
      reason: `Exposure is ${Math.round(input.utilisation * 100)}% of the agreed limit.`,
    };
  }
  if (input.worstDaysLate >= 30) {
    return {
      band: "strained",
      reason: `Invoice ${input.worstDaysLate} days past due.`,
    };
  }
  if (input.utilisation !== null && input.utilisation >= 0.85) {
    return {
      band: "strained",
      reason: `Exposure at ${Math.round(input.utilisation * 100)}% of limit — little headroom left.`,
    };
  }
  if (input.overdue > 0) {
    return { band: "watch", reason: "Some balance is past due, but inside 30 days." };
  }
  if (!input.hasLimit && input.exposure > 0) {
    return {
      band: "watch",
      reason: "No credit limit is set for this account, so exposure is uncontrolled.",
    };
  }
  if (input.utilisation !== null && input.utilisation >= 0.6) {
    return { band: "clear", reason: "Paying to terms, using over half the agreed limit." };
  }
  return { band: "clear", reason: "Paying to terms and well inside the agreed limit." };
}

export function creditBook(input: CreditInput): CreditPosition[] {
  return input.customers
    .map((customer) => creditPosition(customer, input))
    .sort((a, b) => {
      const order: RiskBand[] = ["stop", "strained", "watch", "clear"];
      const diff = order.indexOf(a.band) - order.indexOf(b.band);
      return diff !== 0 ? diff : b.exposure - a.exposure;
    });
}

export interface BookTotals {
  exposure: number;
  outstanding: number;
  overdue: number;
  atRisk: number;
  withoutLimit: number;
  /** Weighted DSO across accounts that have one. */
  dso: number | null;
}

export function bookTotals(positions: CreditPosition[]): BookTotals {
  const withDso = positions.filter((p) => p.dso !== null && p.outstanding + p.exposure > 0);
  const dsoWeight = withDso.reduce((sum, p) => sum + Math.max(p.exposure, 1), 0);
  return {
    exposure: round2(positions.reduce((sum, p) => sum + p.exposure, 0)),
    outstanding: round2(positions.reduce((sum, p) => sum + p.outstanding, 0)),
    overdue: round2(positions.reduce((sum, p) => sum + p.overdue, 0)),
    atRisk: round2(
      positions
        .filter((p) => p.band === "stop" || p.band === "strained")
        .reduce((sum, p) => sum + p.exposure, 0),
    ),
    withoutLimit: positions.filter((p) => !p.creditLimit && p.exposure > 0).length,
    dso: withDso.length
      ? Math.round(
          withDso.reduce((sum, p) => sum + (p.dso ?? 0) * Math.max(p.exposure, 1), 0) / dsoWeight,
        )
      : null,
  };
}
