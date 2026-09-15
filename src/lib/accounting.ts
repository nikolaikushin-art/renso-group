/**
 * Accounting engine (requirement 12).
 *
 * Pure functions over CRM records, so the numbers an accountant sees are
 * derived from the same invoices, expenses and payments the sales side works
 * with — there is no second set of books to reconcile.
 *
 * Two deliberate choices worth knowing about:
 *
 * 1. Gross profit is *measured* from expenses categorised as cost of sales,
 *    not estimated from an overhead assumption. Where no cost has been booked
 *    against a period, the report says so rather than inventing a margin.
 * 2. Everything is reported on an accruals basis (invoice date, expense date),
 *    because that is what a UK filing needs. Cash movement is reported
 *    separately in the payments view, and the two are never blended.
 */
import type { Expense, ExpenseCategory, Invoice, Payment } from "./domain";

export interface Period {
  from: Date;
  to: Date;
  label: string;
}

/** Cost-of-sales categories. Everything else is an operating expense. */
const COST_OF_SALES: ExpenseCategory[] = ["purchases", "freight_duty"];

export function isCostOfSales(category: ExpenseCategory) {
  return COST_OF_SALES.includes(category);
}

/** Calendar quarters and years back from today, for the period picker. */
export function financialPeriods(reference = new Date()): Period[] {
  const out: Period[] = [];
  const y = reference.getFullYear();
  const q = Math.floor(reference.getMonth() / 3);

  for (let back = 0; back < 4; back += 1) {
    const qi = q - back;
    const year = y + Math.floor(qi / 4);
    const quarter = ((qi % 4) + 4) % 4;
    const from = new Date(year, quarter * 3, 1);
    const to = new Date(year, quarter * 3 + 3, 0, 23, 59, 59, 999);
    out.push({ from, to, label: `Q${quarter + 1} ${year}` });
  }

  out.push({
    from: new Date(y, 0, 1),
    to: new Date(y, 11, 31, 23, 59, 59, 999),
    label: `${y}`,
  });
  out.push({
    from: new Date(y - 1, 0, 1),
    to: new Date(y - 1, 11, 31, 23, 59, 59, 999),
    label: `${y - 1}`,
  });
  return out;
}

function within(iso: string | undefined, period: Period) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= period.from.getTime() && t <= period.to.getTime();
}

/** Invoices count from their issue date; drafts and cancellations never do. */
function countsAsSale(inv: Invoice) {
  return inv.status !== "draft" && inv.status !== "cancelled";
}

export interface ProfitAndLoss {
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  /** Null when no cost of sales has been booked — a 100% margin is almost
   *  always missing data, and reporting it as fact would be misleading. */
  grossMarginPct: number | null;
  operatingExpenses: number;
  expensesByCategory: { category: ExpenseCategory; amount: number }[];
  netProfit: number;
  netMarginPct: number | null;
  invoiceCount: number;
  expenseCount: number;
  /** True when the period has revenue but nothing booked as cost of sales. */
  costsIncomplete: boolean;
}

export function profitAndLoss(
  invoices: Invoice[],
  expenses: Expense[],
  period: Period,
): ProfitAndLoss {
  let revenue = 0;
  let invoiceCount = 0;
  for (const inv of invoices) {
    if (!countsAsSale(inv)) continue;
    if (!within(inv.issuedAt ?? inv.createdAt, period)) continue;
    // Revenue is net of VAT — VAT is never income, it is collected on account.
    revenue += inv.subtotal;
    invoiceCount += 1;
  }

  const byCategory = new Map<ExpenseCategory, number>();
  let costOfSales = 0;
  let operatingExpenses = 0;
  let expenseCount = 0;
  for (const e of expenses) {
    if (!within(e.date, period)) continue;
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.net);
    if (isCostOfSales(e.category)) costOfSales += e.net;
    else operatingExpenses += e.net;
    expenseCount += 1;
  }

  const grossProfit = revenue - costOfSales;
  const netProfit = grossProfit - operatingExpenses;

  return {
    revenue,
    costOfSales,
    grossProfit,
    grossMarginPct: revenue > 0 && costOfSales > 0 ? round1((grossProfit / revenue) * 100) : null,
    operatingExpenses,
    expensesByCategory: [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    netProfit,
    netMarginPct: revenue > 0 ? round1((netProfit / revenue) * 100) : null,
    invoiceCount,
    expenseCount,
    costsIncomplete: revenue > 0 && costOfSales === 0,
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/**
 * UK VAT return, using the standard box numbering so the figures can be typed
 * straight into an HMRC submission. Boxes 2 and 9 (EC acquisitions) are held at
 * zero — the data to populate them correctly isn't captured yet, and a guessed
 * figure on a statutory return is worse than an obvious zero.
 */
export interface VatReturn {
  box1_outputVat: number;
  box3_totalOutputVat: number;
  box4_inputVat: number;
  box5_netDue: number;
  box6_totalSalesExVat: number;
  box7_totalPurchasesExVat: number;
  salesCount: number;
  purchasesCount: number;
}

export function vatReturn(
  invoices: Invoice[],
  expenses: Expense[],
  period: Period,
): VatReturn {
  let outputVat = 0;
  let salesExVat = 0;
  let salesCount = 0;
  for (const inv of invoices) {
    if (!countsAsSale(inv)) continue;
    if (!within(inv.issuedAt ?? inv.createdAt, period)) continue;
    outputVat += inv.tax;
    salesExVat += inv.subtotal;
    salesCount += 1;
  }

  let inputVat = 0;
  let purchasesExVat = 0;
  let purchasesCount = 0;
  for (const e of expenses) {
    if (!within(e.date, period)) continue;
    inputVat += e.vat;
    purchasesExVat += e.net;
    purchasesCount += 1;
  }

  return {
    box1_outputVat: outputVat,
    box3_totalOutputVat: outputVat,
    box4_inputVat: inputVat,
    box5_netDue: outputVat - inputVat,
    // HMRC wants whole pounds in boxes 6 and 7.
    box6_totalSalesExVat: Math.round(salesExVat),
    box7_totalPurchasesExVat: Math.round(purchasesExVat),
    salesCount,
    purchasesCount,
  };
}

export interface LedgerEntry {
  id: string;
  date: string;
  reference: string;
  description: string;
  account: string;
  debit: number;
  credit: number;
  currency: string;
  entityName?: string;
  source: "invoice" | "expense" | "receipt" | "payment";
  sourceId: string;
}

/**
 * Double-entry journal built from the CRM's own records. Every line balances:
 * an invoice debits debtors and credits sales plus VAT; a receipt debits bank
 * and credits debtors; and so on.
 */
export function generalLedger(
  invoices: Invoice[],
  expenses: Expense[],
  payments: Payment[],
  period: Period,
  names: { customer: (id?: string) => string | undefined; supplier: (id?: string) => string | undefined },
): LedgerEntry[] {
  const out: LedgerEntry[] = [];

  for (const inv of invoices) {
    const date = inv.issuedAt ?? inv.createdAt;
    if (!countsAsSale(inv) || !within(date, period)) continue;
    const who = names.customer(inv.customerId);
    out.push({
      id: `${inv.id}-dr`,
      date,
      reference: inv.number,
      description: `Sales invoice — ${who ?? "customer"}`,
      account: "Trade debtors",
      debit: inv.total,
      credit: 0,
      currency: inv.currency,
      entityName: who,
      source: "invoice",
      sourceId: inv.id,
    });
    out.push({
      id: `${inv.id}-cr`,
      date,
      reference: inv.number,
      description: "Sales",
      account: "Sales",
      debit: 0,
      credit: inv.subtotal,
      currency: inv.currency,
      entityName: who,
      source: "invoice",
      sourceId: inv.id,
    });
    if (inv.tax > 0) {
      out.push({
        id: `${inv.id}-vat`,
        date,
        reference: inv.number,
        description: "Output VAT",
        account: "VAT control",
        debit: 0,
        credit: inv.tax,
        currency: inv.currency,
        entityName: who,
        source: "invoice",
        sourceId: inv.id,
      });
    }
  }

  for (const e of expenses) {
    if (!within(e.date, period)) continue;
    const who = e.supplierName ?? names.supplier(e.supplierId);
    out.push({
      id: `${e.id}-dr`,
      date: e.date,
      reference: e.reference ?? "—",
      description: e.description,
      account: isCostOfSales(e.category) ? "Cost of sales" : "Operating expenses",
      debit: e.net,
      credit: 0,
      currency: e.currency,
      entityName: who,
      source: "expense",
      sourceId: e.id,
    });
    if (e.vat > 0) {
      out.push({
        id: `${e.id}-vat`,
        date: e.date,
        reference: e.reference ?? "—",
        description: "Input VAT",
        account: "VAT control",
        debit: e.vat,
        credit: 0,
        currency: e.currency,
        entityName: who,
        source: "expense",
        sourceId: e.id,
      });
    }
    out.push({
      id: `${e.id}-cr`,
      date: e.date,
      reference: e.reference ?? "—",
      description: e.description,
      account: "Trade creditors",
      debit: 0,
      credit: e.net + e.vat,
      currency: e.currency,
      entityName: who,
      source: "expense",
      sourceId: e.id,
    });
  }

  for (const p of payments) {
    if (!within(p.paidAt, period)) continue;
    const who = p.direction === "in" ? names.customer(p.customerId) : names.supplier(p.supplierId);
    const isIn = p.direction === "in";
    out.push({
      id: `${p.id}-bank`,
      date: p.paidAt,
      reference: p.reference ?? "—",
      description: isIn ? `Receipt — ${who ?? "customer"}` : `Payment — ${who ?? "supplier"}`,
      account: "Bank",
      debit: isIn ? p.amount : 0,
      credit: isIn ? 0 : p.amount,
      currency: p.currency,
      entityName: who,
      source: isIn ? "receipt" : "payment",
      sourceId: p.id,
    });
    out.push({
      id: `${p.id}-contra`,
      date: p.paidAt,
      reference: p.reference ?? "—",
      description: isIn ? "Debtor settlement" : "Creditor settlement",
      account: isIn ? "Trade debtors" : "Trade creditors",
      debit: isIn ? 0 : p.amount,
      credit: isIn ? p.amount : 0,
      currency: p.currency,
      entityName: who,
      source: isIn ? "receipt" : "payment",
      sourceId: p.id,
    });
  }

  return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** A journal that doesn't balance is a bug, so the UI can assert on this. */
export function ledgerBalance(entries: LedgerEntry[]) {
  const debit = entries.reduce((s, e) => s + e.debit, 0);
  const credit = entries.reduce((s, e) => s + e.credit, 0);
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 };
}

export interface AgedBucket {
  label: string;
  amount: number;
  count: number;
}

/** Aged creditors — what Renso owes, bucketed by age of the expense. */
export function agedCreditors(expenses: Expense[], asOf = new Date()): AgedBucket[] {
  const buckets: AgedBucket[] = [
    { label: "Current", amount: 0, count: 0 },
    { label: "1–30 days", amount: 0, count: 0 },
    { label: "31–60 days", amount: 0, count: 0 },
    { label: "60+ days", amount: 0, count: 0 },
  ];
  for (const e of expenses) {
    if (e.isPaid) continue;
    const days = Math.floor((asOf.getTime() - new Date(e.date).getTime()) / 86400000);
    const gross = e.net + e.vat;
    const i = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : 3;
    buckets[i].amount += gross;
    buckets[i].count += 1;
  }
  return buckets;
}
