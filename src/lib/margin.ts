/**
 * Renso Group CRM — line-level margin.
 *
 * The previous build's own status note read: "Gross and net margin remain
 * estimates until purchase cost is linked at line level." This module is that
 * link. For every quotation, order and invoice line it resolves a cost from,
 * in order of preference:
 *
 *   1. an **approved, unexpired supplier offer** for that product (the real,
 *      dated, attributable price someone actually offered);
 *   2. the product's standing purchase price (a maintained figure, but not a
 *      quotation from anyone);
 *   3. nothing.
 *
 * The basis travels with the number all the way to the screen. A margin
 * measured from a live offer and a margin inferred from a standing price are
 * different claims, and a desk about to discount 4% needs to know which one it
 * is looking at. Where no cost exists the margin is reported as **unknown**,
 * never as 100%.
 */

import { convert, type FxTable } from "@/lib/fx";
import type { PricingRecord, QuotationLine } from "@/lib/domain";

export type CostBasis = "offer" | "standing" | "none";

export const COST_BASIS_LABELS: Record<CostBasis, string> = {
  offer: "Approved supplier offer",
  standing: "Standing purchase price",
  none: "No cost linked",
};

export interface LineMargin {
  lineId: string;
  description: string;
  quantity: number;
  /** Revenue for the line, net of line discount, in document currency. */
  net: number;
  /** Resolved unit cost in document currency, or null when unknown. */
  unitCost: number | null;
  /** Total cost for the line. */
  cost: number | null;
  /** Cash margin. Null when cost is unknown. */
  margin: number | null;
  /** Margin on revenue, as a percentage. Null when cost is unknown. */
  marginPct: number | null;
  basis: CostBasis;
  /** Which supplier and offer produced the cost, when basis is "offer". */
  sourceSupplier?: string;
  sourceOfferId?: string;
  /** True when marginPct falls below the configured floor. */
  belowFloor: boolean;
  /** Set when the cost needed an FX conversion that was missing or stale. */
  note?: string;
}

export interface DocumentMargin {
  lines: LineMargin[];
  revenue: number;
  /** Cost of the lines that have one. */
  cost: number;
  margin: number;
  marginPct: number | null;
  currency: string;
  /** Lines with no cost basis at all. */
  uncostedLines: number;
  /** Share of revenue that has a cost behind it, 0–1. */
  coverage: number;
  /** Lines under the margin floor. */
  breaches: LineMargin[];
  /** "measured" when every line is costed, "partial" when some are, else "unknown". */
  confidence: "measured" | "partial" | "unknown";
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const lineNet = (line: QuotationLine): number =>
  line.quantity * line.unitPrice * (1 - (line.discountPct ?? 0) / 100);

const isLive = (record: PricingRecord, now: Date): boolean => {
  if (record.status !== "approved") return false;
  if (!record.validUntil) return true;
  return new Date(record.validUntil).getTime() >= now.getTime();
};

/**
 * Picks the cost-bearing offer for a product: the cheapest live approved offer,
 * and among equal prices the most recent. Cheapest is the right default
 * because it is the cost the desk *could* buy at today; the panel still lists
 * the alternatives so the buyer can override.
 */
export function bestOfferFor(
  productId: string | undefined,
  records: PricingRecord[],
  now: Date = new Date(),
): PricingRecord | null {
  if (!productId) return null;
  const candidates = records.filter((r) => r.productId === productId && isLive(r, now));
  if (!candidates.length) return null;
  return candidates.reduce((best, current) => {
    if (current.unitPrice < best.unitPrice) return current;
    if (current.unitPrice > best.unitPrice) return best;
    return new Date(current.extractedAt) > new Date(best.extractedAt) ? current : best;
  });
}

export interface MarginContext {
  pricingRecords: PricingRecord[];
  products: { id: string; purchasePrice?: number; currency: string }[];
  fx: FxTable;
  /** Margin floor from product settings, as a percentage. */
  floorPct: number;
  now?: Date;
}

export function lineMargin(
  line: QuotationLine,
  documentCurrency: string,
  ctx: MarginContext,
): LineMargin {
  const now = ctx.now ?? new Date();
  const net = round2(lineNet(line));

  const base: LineMargin = {
    lineId: line.id,
    description: line.description,
    quantity: line.quantity,
    net,
    unitCost: null,
    cost: null,
    margin: null,
    marginPct: null,
    basis: "none",
    belowFloor: false,
  };

  const resolve = (
    amount: number,
    currency: string,
    basis: CostBasis,
    extra?: Partial<LineMargin>,
  ): LineMargin => {
    const converted = convert(amount, currency, documentCurrency, ctx.fx, now);
    if (!converted) {
      return {
        ...base,
        basis,
        ...extra,
        note: `Cost is in ${currency}; no ${currency}→${documentCurrency} rate is set, so margin cannot be stated.`,
      };
    }
    const unitCost = round2(converted.amount);
    const cost = round2(unitCost * line.quantity);
    const margin = round2(net - cost);
    const marginPct = net > 0 ? round2((margin / net) * 100) : null;
    return {
      ...base,
      basis,
      unitCost,
      cost,
      margin,
      marginPct,
      belowFloor: marginPct !== null && marginPct < ctx.floorPct,
      note: converted.stale
        ? `Converted at a rate last set more than a month ago — confirm before committing.`
        : undefined,
      ...extra,
    };
  };

  const offer = bestOfferFor(line.productId, ctx.pricingRecords, now);
  if (offer) {
    return resolve(offer.unitPrice, offer.currency, "offer", {
      sourceSupplier: offer.supplierName,
      sourceOfferId: offer.id,
    });
  }

  const product = ctx.products.find((p) => p.id === line.productId);
  if (product?.purchasePrice && product.purchasePrice > 0) {
    return resolve(product.purchasePrice, product.currency, "standing");
  }

  return base;
}

export function documentMargin(
  doc: { lines: QuotationLine[]; currency: string },
  ctx: MarginContext,
): DocumentMargin {
  const lines = doc.lines.map((line) => lineMargin(line, doc.currency, ctx));
  const revenue = round2(lines.reduce((sum, l) => sum + l.net, 0));
  const costed = lines.filter((l) => l.cost !== null);
  const cost = round2(costed.reduce((sum, l) => sum + (l.cost ?? 0), 0));
  const costedRevenue = costed.reduce((sum, l) => sum + l.net, 0);
  const margin = round2(costedRevenue - cost);

  return {
    lines,
    revenue,
    cost,
    margin,
    // Margin percentage is taken over the *costed* revenue only. Dividing by
    // total revenue would quietly inflate the figure every time a line has no
    // cost attached, which is precisely the error this module exists to remove.
    marginPct: costedRevenue > 0 ? round2((margin / costedRevenue) * 100) : null,
    currency: doc.currency,
    uncostedLines: lines.length - costed.length,
    coverage: revenue > 0 ? costedRevenue / revenue : 0,
    breaches: lines.filter((l) => l.belowFloor),
    confidence:
      costed.length === 0 ? "unknown" : costed.length === lines.length ? "measured" : "partial",
  };
}

/** Ranked worst-margin documents, for the desk's attention queue. */
export function marginRanking<T extends { id: string; number: string; lines: QuotationLine[]; currency: string }>(
  docs: T[],
  ctx: MarginContext,
): { doc: T; margin: DocumentMargin }[] {
  return docs
    .map((doc) => ({ doc, margin: documentMargin(doc, ctx) }))
    .filter((entry) => entry.margin.marginPct !== null)
    .sort((a, b) => (a.margin.marginPct ?? 0) - (b.margin.marginPct ?? 0));
}
