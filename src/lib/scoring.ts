/**
 * Relationship scoring — v1 formula.
 *
 * This replaces sorting by the static seeded `relationshipScore` field with a
 * score actually computed from live store data (invoices, orders, pricing
 * records), so the ranking genuinely reorders when the underlying commercial
 * activity changes — not just a label describing weights that were never
 * applied.
 *
 * Weights match what the Scoring page already displays to the user:
 *   Customer: 35% revenue · 20% order frequency · 15% AOV · 15% recency · 15% payment reliability
 *   Supplier: 30% spend · 20% orders · 25% price competitiveness · 15% delivery · 10% terms
 *
 * Each component is normalised 0–100 relative to the current data set
 * (min–max scaling) so the composite score stays explainable: every score can
 * be traced back to where the customer/supplier sits among their peers on
 * each factor, not an opaque number.
 */
import type {
  Customer,
  Supplier,
  Invoice,
  Order,
  PricingRecord,
  Payment,
  Delivery,
  Product,
} from "./domain";
import { deliveryPerformance, paymentBehaviour } from "./reliability";

export interface ScoreComponents {
  score: number;
  components: { label: string; weightPct: number; value: number }[];
}

function normalise(values: number[], value: number): number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!isFinite(min) || !isFinite(max) || max === min) return values.length ? 50 : 0;
  return Math.round(((value - min) / (max - min)) * 100);
}

function daysSince(iso?: string): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

export function scoreCustomers(
  customers: Customer[],
  invoices: Invoice[],
  orders: Order[],
  /**
   * Receipts. When supplied, payment reliability is **measured** — settlement
   * dates against due dates, penalised for anything currently overdue — rather
   * than inferred from an invoice's status label. Optional so existing callers
   * keep working and degrade to the old read rather than breaking.
   */
  payments?: Payment[],
): Record<string, ScoreComponents> {
  const perCustomer = customers.map((c) => {
    const custInvoices = invoices.filter((i) => i.customerId === c.id);
    const custOrders = orders.filter((o) => o.customerId === c.id);
    const revenue = custInvoices
      .filter((i) => i.status === "paid" || i.status === "issued")
      .reduce((s, i) => s + (i.total || 0), 0) || c.totalRevenue || 0;
    const orderFrequency = custOrders.length || c.totalOrders || 0;
    const aov = orderFrequency > 0 ? revenue / orderFrequency : 0;
    const mostRecent = [c.lastOrderAt, ...custOrders.map((o) => o.createdAt), ...custInvoices.map((i) => i.issuedAt)]
      .filter(Boolean)
      .sort()
      .pop();
    const recencyDays = daysSince(mostRecent);
    const decidedInvoices = custInvoices.filter((i) => i.status === "paid" || i.status === "overdue");
    const measured = payments ? paymentBehaviour(c.id, invoices, payments) : null;
    const paymentReliability =
      // A measured score is preferred, but only where there is enough history
      // to mean anything. With one settled invoice the status-label read is no
      // worse and no better, and neither deserves to dominate the composite.
      measured && measured.score !== null && measured.confidence !== "low"
        ? measured.score
        : decidedInvoices.length > 0
          ? (decidedInvoices.filter((i) => i.status === "paid").length / decidedInvoices.length) * 100
          : 100; // no history yet — neutral, not penalised
    return { id: c.id, revenue, orderFrequency, aov, recencyDays, paymentReliability };
  });

  const revenues = perCustomer.map((p) => p.revenue);
  const freqs = perCustomer.map((p) => p.orderFrequency);
  const aovs = perCustomer.map((p) => p.aov);
  // Recency: fewer days = better, so invert before normalising.
  const recencyInverted = perCustomer.map((p) => (isFinite(p.recencyDays) ? -p.recencyDays : -Infinity));
  const finiteRecency = recencyInverted.filter((v) => isFinite(v));
  const reliabilities = perCustomer.map((p) => p.paymentReliability);

  const result: Record<string, ScoreComponents> = {};
  perCustomer.forEach((p, idx) => {
    const revenueScore = normalise(revenues, p.revenue);
    const freqScore = normalise(freqs, p.orderFrequency);
    const aovScore = normalise(aovs, p.aov);
    const recencyScore = isFinite(p.recencyDays)
      ? normalise(finiteRecency.length ? finiteRecency : [0], -p.recencyDays)
      : 0;
    const reliabilityScore = normalise(reliabilities, p.paymentReliability);

    const score = Math.round(
      revenueScore * 0.35 + freqScore * 0.2 + aovScore * 0.15 + recencyScore * 0.15 + reliabilityScore * 0.15,
    );

    result[p.id] = {
      score,
      components: [
        { label: "Revenue", weightPct: 35, value: revenueScore },
        { label: "Order frequency", weightPct: 20, value: freqScore },
        { label: "Average order value", weightPct: 15, value: aovScore },
        { label: "Recency", weightPct: 15, value: recencyScore },
        { label: "Payment reliability", weightPct: 15, value: reliabilityScore },
      ],
    };
    void idx;
  });
  return result;
}

/** Rough, transparent read of a free-text payment-terms string into a 0–100
 * favourability score (shorter terms = we get paid faster = better). Falls
 * back to a neutral midpoint when terms aren't set or aren't parseable —
 * this is deliberately simple rather than guessing at intent from vague text. */
function termsScore(paymentTerms?: string): number {
  if (!paymentTerms) return 50;
  const match = paymentTerms.match(/(\d+)/);
  if (!match) return 50;
  const days = Number(match[1]);
  if (!isFinite(days) || days <= 0) return 50;
  // Net 7 -> ~95, Net 30 -> ~75, Net 60 -> ~50, Net 90+ -> ~25
  return Math.max(0, Math.min(100, Math.round(100 - days * 0.8)));
}

/* -------------------------------------------------------------------------- */
/* Live cross-supplier price comparison (per product)                         */
/* -------------------------------------------------------------------------- */

export interface ProductMarketOffer {
  supplierId: string;
  supplierName: string;
  unitPrice: number;
  currency: string;
  extractedAt: string;
}

export interface ProductMarketPosition {
  productName: string;
  unitPrice: number;
  currency: string;
  marketMin: number;
  marketMax: number;
  rank: number; // 1 = cheapest
  totalSuppliers: number;
  percentAboveMin: number; // 0 = at market min
}

/** For each product, take each supplier's most recently *approved* offer —
 * approved records are the only ones treated as verified commercial fact.
 * Only offers priced in the same currency are compared against each other,
 * since the app has no FX conversion; mismatched-currency offers are simply
 * excluded from that product's market rather than compared unfairly. */
function latestApprovedOffersByProduct(
  pricingRecords: PricingRecord[],
): Map<string, Map<string, ProductMarketOffer>> {
  const byProduct = new Map<string, Map<string, ProductMarketOffer>>();
  const approved = pricingRecords.filter((r) => r.status === "approved" && r.supplierId);
  for (const r of approved) {
    if (!byProduct.has(r.productName)) byProduct.set(r.productName, new Map());
    const bySupplier = byProduct.get(r.productName)!;
    const existing = bySupplier.get(r.supplierId!);
    if (!existing || existing.extractedAt < r.extractedAt) {
      bySupplier.set(r.supplierId!, {
        supplierId: r.supplierId!,
        supplierName: r.supplierName,
        unitPrice: r.unitPrice,
        currency: r.currency,
        extractedAt: r.extractedAt,
      });
    }
  }
  return byProduct;
}

/** This supplier's standing against every other supplier that has an approved
 * price for the same product, in the same currency. Returns one row per
 * product this supplier has an approved offer for. */
export function supplierMarketPositions(
  supplierId: string,
  pricingRecords: PricingRecord[],
): ProductMarketPosition[] {
  const byProduct = latestApprovedOffersByProduct(pricingRecords);
  const rows: ProductMarketPosition[] = [];
  for (const [productName, bySupplier] of byProduct) {
    const mine = bySupplier.get(supplierId);
    if (!mine) continue;
    const sameCurrency = Array.from(bySupplier.values()).filter((o) => o.currency === mine.currency);
    if (sameCurrency.length < 1) continue;
    const prices = sameCurrency.map((o) => o.unitPrice).sort((a, b) => a - b);
    const marketMin = prices[0];
    const marketMax = prices[prices.length - 1];
    const rank = sameCurrency.filter((o) => o.unitPrice < mine.unitPrice).length + 1;
    const percentAboveMin = marketMin > 0 ? Math.round(((mine.unitPrice - marketMin) / marketMin) * 1000) / 10 : 0;
    rows.push({
      productName,
      unitPrice: mine.unitPrice,
      currency: mine.currency,
      marketMin,
      marketMax,
      rank,
      totalSuppliers: sameCurrency.length,
      percentAboveMin,
    });
  }
  return rows.sort((a, b) => a.productName.localeCompare(b.productName));
}

/** Live 0–100 competitiveness score derived from where this supplier's
 * approved prices actually land versus other suppliers on the same
 * products. Returns null when there isn't enough cross-supplier data yet
 * (single-sourced products, or no approved pricing at all) so the caller
 * can fall back to the seeded estimate instead of a misleading number. */
export function livePriceCompetitiveness(
  supplierId: string,
  pricingRecords: PricingRecord[],
): number | null {
  const positions = supplierMarketPositions(supplierId, pricingRecords).filter(
    (p) => p.totalSuppliers > 1,
  );
  if (positions.length === 0) return null;
  const perProductScore = positions.map((p) => {
    if (p.marketMax === p.marketMin) return 100;
    return Math.round(100 - ((p.unitPrice - p.marketMin) / (p.marketMax - p.marketMin)) * 100);
  });
  return Math.round(perProductScore.reduce((a, b) => a + b, 0) / perProductScore.length);
}

export function scoreSuppliers(
  suppliers: Supplier[],
  pricingRecords: PricingRecord[],
  /**
   * When supplied, delivery performance is **measured** from despatch dates
   * against promised dates rather than read from the `deliveryPerformance`
   * field, which was only ever a number someone typed.
   */
  fulfilment?: { orders: Order[]; deliveries: Delivery[]; products: Product[] },
): Record<string, ScoreComponents> {
  const spends = suppliers.map((s) => s.totalSpend || 0);
  const orderCounts = suppliers.map((s) => s.totalOrders || 0);

  const result: Record<string, ScoreComponents> = {};
  suppliers.forEach((s) => {
    const spendScore = normalise(spends, s.totalSpend || 0);
    const orderScore = normalise(orderCounts, s.totalOrders || 0);
    // Prefer a live score derived from actual cross-supplier approved
    // pricing on shared products; fall back to the seeded estimate when
    // there isn't yet enough overlapping market data to compute one.
    const priceScore = livePriceCompetitiveness(s.id, pricingRecords) ?? s.priceCompetitiveness ?? 50;
    const measuredDelivery = fulfilment ? deliveryPerformance(s.id, fulfilment) : null;
    const deliveryScore =
      measuredDelivery && measuredDelivery.score !== null && measuredDelivery.confidence !== "low"
        ? measuredDelivery.score
        : s.deliveryPerformance ?? 50;
    const terms = termsScore(s.paymentTerms);

    const score = Math.round(
      spendScore * 0.3 + orderScore * 0.2 + priceScore * 0.25 + deliveryScore * 0.15 + terms * 0.1,
    );

    result[s.id] = {
      score,
      components: [
        { label: "Spend", weightPct: 30, value: spendScore },
        { label: "Order count", weightPct: 20, value: orderScore },
        { label: "Price competitiveness", weightPct: 25, value: priceScore },
        { label: "Delivery performance", weightPct: 15, value: deliveryScore },
        { label: "Payment terms", weightPct: 10, value: terms },
      ],
    };
  });
  return result;
}
