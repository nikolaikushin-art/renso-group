/**
 * Renso Group CRM — dashboard analytics.
 *
 * Everything here is a pure function over the store's arrays so the numbers on
 * the dashboard can be tested without rendering anything, and so the same
 * calculation can later be moved server-side unchanged.
 */

import type {
  Customer,
  Invoice,
  Opportunity,
  OpportunityStage,
  Order,
  Quotation,
  User,
} from "./domain";

const DAY = 86400000;

/** Dashboard period options, in days. `null` means "since records began". */
export type PeriodDays = 30 | 90 | 365 | null;

export interface Period {
  /** Inclusive start of the current window; `null` for all time. */
  start: Date | null;
  end: Date;
  /** The equally-sized window immediately before `start`, for comparison. */
  previousStart: Date | null;
  previousEnd: Date | null;
}

export function resolvePeriod(days: PeriodDays, now: Date = new Date()): Period {
  if (days == null) {
    return { start: null, end: now, previousStart: null, previousEnd: null };
  }
  const start = new Date(now.getTime() - days * DAY);
  return {
    start,
    end: now,
    previousStart: new Date(start.getTime() - days * DAY),
    previousEnd: start,
  };
}

/** An invoice counts toward revenue once it has been issued, paid or not. */
export const isRevenueInvoice = (invoice: Invoice): boolean =>
  invoice.status === "issued" || invoice.status === "paid" || invoice.status === "partial";

/** The date revenue should be recognised on — issue date, falling back to creation. */
const revenueDate = (invoice: Invoice): Date => new Date(invoice.issuedAt || invoice.createdAt);

function withinWindow(date: Date, start: Date | null, end: Date | null): boolean {
  if (start && date < start) return false;
  if (end && date >= end) return false;
  return true;
}

export interface Delta {
  current: number;
  previous: number;
  /** Percentage change, or `null` when there is no baseline to compare against. */
  changePct: number | null;
}

export function delta(current: number, previous: number): Delta {
  if (previous === 0) {
    return { current, previous, changePct: current === 0 ? 0 : null };
  }
  return { current, previous, changePct: Math.round(((current - previous) / previous) * 1000) / 10 };
}

/** Revenue in the current window and the equivalent window before it. */
export function revenueDelta(invoices: Invoice[], period: Period): Delta {
  const eligible = invoices.filter(isRevenueInvoice);
  const current = eligible
    .filter((i) => withinWindow(revenueDate(i), period.start, null))
    .reduce((sum, i) => sum + i.total, 0);
  const previous = eligible
    .filter((i) => withinWindow(revenueDate(i), period.previousStart, period.previousEnd))
    .reduce((sum, i) => sum + i.total, 0);
  return delta(Math.round(current), Math.round(previous));
}

/** Count of records created in the current window versus the previous one. */
export function countDelta<T extends { createdAt: string }>(records: T[], period: Period): Delta {
  const current = records.filter((r) => withinWindow(new Date(r.createdAt), period.start, null)).length;
  const previous = records.filter((r) =>
    withinWindow(new Date(r.createdAt), period.previousStart, period.previousEnd),
  ).length;
  return delta(current, previous);
}

export interface MonthPoint {
  /** `YYYY-MM`, useful as a stable key. */
  month: string;
  /** Short label for the axis, e.g. "Mar 26". */
  label: string;
  invoiced: number;
  collected: number;
}

/**
 * Invoiced versus collected, bucketed by calendar month.
 *
 * Months with no activity are still emitted so the trend line has no phantom
 * gaps — a chart that skips empty months overstates how steady the business is.
 */
export function revenueByMonth(
  invoices: Invoice[],
  months = 12,
  now: Date = new Date(),
): MonthPoint[] {
  const buckets = new Map<string, MonthPoint>();
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);

  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(month, {
      month,
      label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      invoiced: 0,
      collected: 0,
    });
  }

  for (const invoice of invoices) {
    if (!isRevenueInvoice(invoice)) continue;
    const issued = revenueDate(invoice);
    const key = `${issued.getFullYear()}-${String(issued.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.invoiced += invoice.total;

    if (invoice.paidAt) {
      const paid = new Date(invoice.paidAt);
      const paidKey = `${paid.getFullYear()}-${String(paid.getMonth() + 1).padStart(2, "0")}`;
      const paidBucket = buckets.get(paidKey);
      if (paidBucket) paidBucket.collected += invoice.amountPaid ?? invoice.total;
    }
  }

  return Array.from(buckets.values()).map((b) => ({
    ...b,
    invoiced: Math.round(b.invoiced),
    collected: Math.round(b.collected),
  }));
}

export interface StagePoint {
  stage: OpportunityStage;
  label: string;
  count: number;
  value: number;
}

const STAGE_LABELS: Record<OpportunityStage, string> = {
  enquiry: "Enquiry",
  quotation: "Quotation",
  order: "Order",
  delivery: "Delivery",
  invoice: "Invoice",
  payment: "Payment",
  closed_won: "Won",
  closed_lost: "Lost",
};

const OPEN_STAGES: OpportunityStage[] = [
  "enquiry",
  "quotation",
  "order",
  "delivery",
  "invoice",
  "payment",
];

/** Open pipeline by stage, in funnel order. Closed stages are excluded. */
export function pipelineByStage(opportunities: Opportunity[]): StagePoint[] {
  return OPEN_STAGES.map((stage) => {
    const inStage = opportunities.filter((o) => o.stage === stage);
    return {
      stage,
      label: STAGE_LABELS[stage],
      count: inStage.length,
      value: Math.round(inStage.reduce((sum, o) => sum + (o.value || 0), 0)),
    };
  });
}

export interface WinRate {
  won: number;
  lost: number;
  /** Share of decided opportunities that were won; `null` when none are decided. */
  ratePct: number | null;
}

export function winRate(opportunities: Opportunity[]): WinRate {
  const won = opportunities.filter((o) => o.stage === "closed_won").length;
  const lost = opportunities.filter((o) => o.stage === "closed_lost").length;
  const decided = won + lost;
  return { won, lost, ratePct: decided === 0 ? null : Math.round((won / decided) * 100) };
}

/**
 * Share of quotations that reached an order.
 *
 * Drafts are excluded: a quotation nobody sent has not been tested against the
 * market, so counting it would flatter or punish the rate for no reason.
 */
export function quotationConversion(quotations: Quotation[]): {
  sent: number;
  converted: number;
  ratePct: number | null;
} {
  const sent = quotations.filter((q) => q.status !== "draft");
  const converted = sent.filter((q) => q.status === "converted" || q.convertedOrderId);
  return {
    sent: sent.length,
    converted: converted.length,
    ratePct: sent.length === 0 ? null : Math.round((converted.length / sent.length) * 100),
  };
}

export interface BreakdownPoint {
  key: string;
  label: string;
  revenue: number;
  customers: number;
}

/** Revenue grouped by a customer attribute (territory or relationship manager). */
function breakdownBy(
  customers: Customer[],
  invoices: Invoice[],
  keyOf: (c: Customer) => string,
  labelOf: (key: string) => string,
): BreakdownPoint[] {
  const revenueByCustomer = new Map<string, number>();
  for (const invoice of invoices) {
    if (!isRevenueInvoice(invoice)) continue;
    revenueByCustomer.set(
      invoice.customerId,
      (revenueByCustomer.get(invoice.customerId) || 0) + invoice.total,
    );
  }

  const grouped = new Map<string, BreakdownPoint>();
  for (const customer of customers) {
    const key = keyOf(customer);
    const existing = grouped.get(key) || { key, label: labelOf(key), revenue: 0, customers: 0 };
    // Fall back to the seeded lifetime figure when no invoice exists yet, so a
    // territory with real history doesn't read as zero.
    existing.revenue += revenueByCustomer.get(customer.id) ?? customer.totalRevenue ?? 0;
    existing.customers += 1;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values())
    .map((g) => ({ ...g, revenue: Math.round(g.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
}

export const UNASSIGNED_KEY = "__unassigned__";

export function revenueByTerritory(customers: Customer[], invoices: Invoice[]): BreakdownPoint[] {
  return breakdownBy(
    customers,
    invoices,
    (c) => c.territory || UNASSIGNED_KEY,
    (key) => (key === UNASSIGNED_KEY ? "Unassigned" : key),
  );
}

export function revenueByManager(
  customers: Customer[],
  invoices: Invoice[],
  users: User[],
): BreakdownPoint[] {
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return breakdownBy(
    customers,
    invoices,
    (c) => c.ownerId || UNASSIGNED_KEY,
    (key) => (key === UNASSIGNED_KEY ? "Unassigned" : nameOf.get(key) || "Unknown user"),
  );
}

/**
 * Money invoiced but not yet collected, split by how overdue it is.
 * Anything without a due date is treated as current rather than overdue.
 */
export interface AgingBucket {
  label: string;
  amount: number;
  count: number;
}

export function receivablesAging(invoices: Invoice[], now: Date = new Date()): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: "Current", amount: 0, count: 0 },
    { label: "1–30 days", amount: 0, count: 0 },
    { label: "31–60 days", amount: 0, count: 0 },
    { label: "60+ days", amount: 0, count: 0 },
  ];

  for (const invoice of invoices) {
    if (invoice.status === "paid" || invoice.status === "cancelled" || invoice.status === "draft") continue;
    const outstanding = invoice.total - (invoice.amountPaid || 0);
    if (outstanding <= 0) continue;

    const daysOverdue = invoice.dueAt
      ? Math.floor((now.getTime() - new Date(invoice.dueAt).getTime()) / DAY)
      : 0;
    const index = daysOverdue <= 0 ? 0 : daysOverdue <= 30 ? 1 : daysOverdue <= 60 ? 2 : 3;
    buckets[index].amount += outstanding;
    buckets[index].count += 1;
  }

  return buckets.map((b) => ({ ...b, amount: Math.round(b.amount) }));
}

/** Orders in flight — confirmed or part-fulfilled, not yet delivered or cancelled. */
export function openOrderValue(orders: Order[]): number {
  return Math.round(
    orders
      .filter((o) => ["confirmed", "in_progress", "shipped"].includes(o.status))
      .reduce((sum, o) => sum + o.total, 0),
  );
}
