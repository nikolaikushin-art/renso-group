/**
 * Renso Group CRM — product sales & profitability.
 *
 * Requirement 8 asks for "product sales and profitability" on the dashboard.
 * The build had product *records* and it had revenue, but nothing that said
 * which products made the money — which is the question a trading company
 * actually asks, because the answer reorders what you chase.
 *
 * Revenue is taken from **invoices**, not orders, because an order is a promise
 * and an invoice is a sale. Cost comes through the same margin engine the Deal
 * Desk uses, so a product's profitability and a quotation's margin can never
 * disagree about what a thing cost.
 *
 * Two deliberate refusals:
 *
 * - **A line with no product link is counted as revenue but not as product
 *   revenue.** Freight, tooling and setup lines are real money and belong in
 *   the P&L; attributing them to a product would flatter that product's margin
 *   with income it did not earn. The unattributed total is reported separately.
 * - **ABC classification needs revenue to classify.** With no sales at all, the
 *   function returns an empty ranking rather than declaring every product an
 *   equal "A".
 */

import { lineMargin, type MarginContext } from "@/lib/margin";
import { convert } from "@/lib/fx";
import type { Invoice, Product, QuotationLine } from "@/lib/domain";

/** Pareto band. A = the products carrying the first 80% of gross profit. */
export type AbcBand = "A" | "B" | "C";

export interface ProductPerformance {
  productId: string;
  sku?: string;
  name: string;
  category?: string;
  unitsSold: number;
  revenue: number;
  cost: number | null;
  grossProfit: number | null;
  marginPct: number | null;
  /** Invoices this product appeared on. */
  invoiceCount: number;
  /** Distinct customers who bought it. */
  customerCount: number;
  lastSoldAt: string | null;
  /** Revenue in the previous, equal-length period. */
  priorRevenue: number;
  /** Change against the prior period, as a percentage. Null with no prior base. */
  changePct: number | null;
  band: AbcBand;
  /** Share of total gross profit, 0–1. */
  profitShare: number;
  currency: string;
  /** True when some lines had no cost, so margin covers part of the revenue. */
  partialCost: boolean;
}

export interface PerformanceWindow {
  from: Date;
  to: Date;
}

export interface ProductPerformanceResult {
  products: ProductPerformance[];
  revenue: number;
  grossProfit: number | null;
  /** Revenue on invoice lines with no product link — freight, tooling, setup. */
  unattributedRevenue: number;
  currency: string;
  /** Invoices excluded because their currency had no rate. */
  excludedInvoices: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const isSale = (invoice: Invoice): boolean =>
  invoice.status === "paid" ||
  invoice.status === "issued" ||
  invoice.status === "overdue" ||
  invoice.status === "partial";

const invoiceDate = (invoice: Invoice): string => invoice.issuedAt ?? invoice.createdAt;

const inWindow = (iso: string, window: PerformanceWindow): boolean => {
  const t = new Date(iso).getTime();
  return t >= window.from.getTime() && t <= window.to.getTime();
};

const lineNet = (line: QuotationLine): number =>
  line.quantity * line.unitPrice * (1 - (line.discountPct ?? 0) / 100);

export function productPerformance(input: {
  products: Product[];
  invoices: Invoice[];
  window: PerformanceWindow;
  /** Equal-length window immediately before `window`, for the comparison. */
  priorWindow?: PerformanceWindow;
  margin: MarginContext;
  currency: string;
}): ProductPerformanceResult {
  const { products, invoices, window, priorWindow, margin, currency } = input;

  type Accumulator = {
    units: number;
    revenue: number;
    cost: number;
    costedRevenue: number;
    uncosted: boolean;
    invoices: Set<string>;
    customers: Set<string>;
    lastSoldAt: string | null;
  };
  const acc = new Map<string, Accumulator>();
  const prior = new Map<string, number>();

  let revenue = 0;
  let unattributed = 0;
  let excludedInvoices = 0;

  const sales = invoices.filter(isSale);

  for (const invoice of sales) {
    const date = invoiceDate(invoice);
    const current = inWindow(date, window);
    const isPrior = priorWindow ? inWindow(date, priorWindow) : false;
    if (!current && !isPrior) continue;

    // Convert once per invoice rather than per line: the whole document shares
    // a currency, and converting a line at a time invites rounding drift.
    const rate = convert(1, invoice.currency, currency, margin.fx, margin.now ?? new Date());
    if (!rate) {
      if (current) excludedInvoices += 1;
      continue;
    }

    for (const line of invoice.lines) {
      const net = round2(lineNet(line) * rate.rate);

      if (isPrior && line.productId) {
        prior.set(line.productId, (prior.get(line.productId) ?? 0) + net);
        continue;
      }
      if (!current) continue;

      revenue += net;

      if (!line.productId) {
        unattributed += net;
        continue;
      }

      const entry =
        acc.get(line.productId) ??
        {
          units: 0,
          revenue: 0,
          cost: 0,
          costedRevenue: 0,
          uncosted: false,
          invoices: new Set<string>(),
          customers: new Set<string>(),
          lastSoldAt: null,
        };

      // Cost is resolved through the shared margin engine, in the reporting
      // currency, so profitability here and margin on the Deal Desk are the
      // same arithmetic over the same offers.
      const measured = lineMargin(line, currency, margin);

      entry.units += line.quantity;
      entry.revenue += net;
      entry.invoices.add(invoice.id);
      entry.customers.add(invoice.customerId);
      if (!entry.lastSoldAt || date > entry.lastSoldAt) entry.lastSoldAt = date;
      if (measured.cost !== null) {
        entry.cost += measured.cost;
        entry.costedRevenue += net;
      } else {
        entry.uncosted = true;
      }
      acc.set(line.productId, entry);
    }
  }

  const rows: ProductPerformance[] = [];
  for (const [productId, entry] of acc) {
    const product = products.find((p) => p.id === productId);
    const hasCost = entry.costedRevenue > 0;
    const grossProfit = hasCost ? round2(entry.costedRevenue - entry.cost) : null;
    const priorRevenue = round2(prior.get(productId) ?? 0);
    rows.push({
      productId,
      sku: product?.sku,
      name: product?.name ?? "Unlinked product",
      category: product?.category,
      unitsSold: entry.units,
      revenue: round2(entry.revenue),
      cost: hasCost ? round2(entry.cost) : null,
      grossProfit,
      // Measured over costed revenue only, exactly as the Deal Desk does it.
      marginPct:
        hasCost && entry.costedRevenue > 0
          ? round2(((entry.costedRevenue - entry.cost) / entry.costedRevenue) * 100)
          : null,
      invoiceCount: entry.invoices.size,
      customerCount: entry.customers.size,
      lastSoldAt: entry.lastSoldAt,
      priorRevenue,
      changePct:
        priorRevenue > 0 ? round2(((entry.revenue - priorRevenue) / priorRevenue) * 100) : null,
      band: "C",
      profitShare: 0,
      currency,
      partialCost: entry.uncosted && hasCost,
    });
  }

  rows.sort((a, b) => (b.grossProfit ?? 0) - (a.grossProfit ?? 0) || b.revenue - a.revenue);

  const totalProfit = rows.reduce((sum, row) => sum + Math.max(0, row.grossProfit ?? 0), 0);
  if (totalProfit > 0) {
    let cumulative = 0;
    for (const row of rows) {
      row.profitShare = round2(Math.max(0, row.grossProfit ?? 0) / totalProfit);
      // Banded on the cumulative share *before* this product, so the product
      // that carries the business over 80% is itself an A. Testing after the
      // addition would file a single product carrying everything as a C.
      row.band = cumulative < 0.8 ? "A" : cumulative < 0.95 ? "B" : "C";
      cumulative += row.profitShare;
    }
  }

  const measuredProfit = rows.some((r) => r.grossProfit !== null)
    ? round2(rows.reduce((sum, row) => sum + (row.grossProfit ?? 0), 0))
    : null;

  return {
    products: rows,
    revenue: round2(revenue),
    grossProfit: measuredProfit,
    unattributedRevenue: round2(unattributed),
    currency,
    excludedInvoices,
  };
}

export interface CategoryShare {
  category: string;
  revenue: number;
  grossProfit: number;
  share: number;
}

/** Revenue and profit by product category — the mix behind the headline. */
export function categoryMix(rows: ProductPerformance[]): CategoryShare[] {
  const map = new Map<string, { revenue: number; grossProfit: number }>();
  for (const row of rows) {
    const key = row.category || "Uncategorised";
    const entry = map.get(key) ?? { revenue: 0, grossProfit: 0 };
    entry.revenue += row.revenue;
    entry.grossProfit += row.grossProfit ?? 0;
    map.set(key, entry);
  }
  const total = [...map.values()].reduce((sum, e) => sum + e.revenue, 0);
  return [...map.entries()]
    .map(([category, entry]) => ({
      category,
      revenue: round2(entry.revenue),
      grossProfit: round2(entry.grossProfit),
      share: total > 0 ? entry.revenue / total : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Products carried in the catalogue that have not sold inside the window.
 * Dead stock on a price list costs credibility: a client asks for the one line
 * nobody has bought in a year and the desk has no current cost for it.
 */
export function unsoldProducts(
  products: Product[],
  rows: ProductPerformance[],
): Product[] {
  const sold = new Set(rows.map((r) => r.productId));
  return products.filter((p) => p.isActive && !sold.has(p.id));
}
