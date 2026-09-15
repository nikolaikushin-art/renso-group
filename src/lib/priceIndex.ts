/**
 * Renso Group CRM — price index.
 *
 * Every approved offer the desk has ever banked is a dated observation of what
 * a product cost from a named supplier. Held together they are a price curve,
 * and a trading company lives or dies on reading it: whether aluminium is
 * drifting up, whether the incumbent supplier has quietly stopped being the
 * cheapest, whether today's offer is a genuine improvement or just noise.
 *
 * Two rules keep this honest:
 *
 * - Comparison happens in **one currency**. An offer in USD and an offer in EUR
 *   are not comparable until both are converted, and where a rate is missing
 *   the observation is excluded and counted, never silently treated as parity.
 * - A trend is only stated where there is something to trend. One observation
 *   is a price, not a direction, and this module says so rather than drawing a
 *   confident flat line through a single point.
 */

import { convert, type FxTable } from "@/lib/fx";
import type { PricingRecord, Product } from "@/lib/domain";

export interface PriceObservation {
  offerId: string;
  supplierId?: string;
  supplierName: string;
  /** Unit price converted into the index currency. */
  unitPrice: number;
  /** As quoted, before conversion. */
  nativePrice: number;
  nativeCurrency: string;
  quantity?: number;
  at: string;
  stale: boolean;
}

export type TrendDirection = "rising" | "falling" | "flat" | "unknown";

export interface PriceCurve {
  productId: string;
  productName: string;
  sku?: string;
  currency: string;
  /** Observations oldest → newest. */
  observations: PriceObservation[];
  /** Most recent observation. */
  latest: PriceObservation | null;
  /** Cheapest live observation. */
  best: PriceObservation | null;
  /** Mean across all observations. */
  mean: number | null;
  /** Coefficient of variation as a percentage — how jumpy this product is. */
  volatilityPct: number | null;
  /** Change from the earliest observation inside the window, as a percentage. */
  changePct: number | null;
  windowDays: number;
  direction: TrendDirection;
  /** Saving available by moving to `best` from the standing purchase price. */
  savingVsStandingPct: number | null;
  /** Observations dropped for want of an FX rate. */
  excluded: number;
  /** True when the cheapest supplier is not the most recent one quoted. */
  betterSupplierAvailable: boolean;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const dayMs = 86_400_000;

/**
 * A price move under this threshold is treated as flat. Suppliers re-quote with
 * small differences constantly; without a deadband the UI would report a
 * direction on every refresh and the signal would mean nothing.
 */
export const FLAT_BAND_PCT = 2;

export function priceCurve(
  product: Product,
  records: PricingRecord[],
  fx: FxTable,
  options: { currency: string; windowDays?: number; now?: Date } = { currency: "GBP" },
): PriceCurve {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 90;
  const currency = options.currency;
  const cutoff = now.getTime() - windowDays * dayMs;

  const relevant = records.filter(
    (r) =>
      r.productId === product.id &&
      (r.status === "approved" || r.status === "converted") &&
      new Date(r.extractedAt).getTime() >= cutoff,
  );

  let excluded = 0;
  const observations: PriceObservation[] = [];
  for (const record of relevant) {
    const converted = convert(record.unitPrice, record.currency, currency, fx, now);
    if (!converted) {
      excluded += 1;
      continue;
    }
    observations.push({
      offerId: record.id,
      supplierId: record.supplierId,
      supplierName: record.supplierName,
      unitPrice: round2(converted.amount),
      nativePrice: record.unitPrice,
      nativeCurrency: record.currency,
      quantity: record.quantity,
      at: record.extractedAt,
      stale: converted.stale,
    });
  }
  observations.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const latest = observations.length ? observations[observations.length - 1] : null;
  const best = observations.length
    ? observations.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a))
    : null;

  const prices = observations.map((o) => o.unitPrice);
  const mean = prices.length ? round2(prices.reduce((a, b) => a + b, 0) / prices.length) : null;

  let volatilityPct: number | null = null;
  if (prices.length > 1 && mean && mean > 0) {
    const variance =
      prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / (prices.length - 1);
    volatilityPct = round2((Math.sqrt(variance) / mean) * 100);
  }

  let changePct: number | null = null;
  let direction: TrendDirection = "unknown";
  if (observations.length > 1) {
    const first = observations[0].unitPrice;
    const last = latest!.unitPrice;
    if (first > 0) {
      changePct = round2(((last - first) / first) * 100);
      direction =
        Math.abs(changePct) < FLAT_BAND_PCT ? "flat" : changePct > 0 ? "rising" : "falling";
    }
  }

  // Standing purchase price is compared in the product's own currency, then
  // converted, so a product maintained in EUR is not judged against a GBP index.
  let savingVsStandingPct: number | null = null;
  if (best && product.purchasePrice && product.purchasePrice > 0) {
    const standing = convert(product.purchasePrice, product.currency, currency, fx, now);
    if (standing && standing.amount > 0) {
      savingVsStandingPct = round2(((standing.amount - best.unitPrice) / standing.amount) * 100);
    }
  }

  return {
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    currency,
    observations,
    latest,
    best,
    mean,
    volatilityPct,
    changePct,
    windowDays,
    direction,
    savingVsStandingPct,
    excluded,
    betterSupplierAvailable: Boolean(
      best && latest && best.offerId !== latest.offerId && best.unitPrice < latest.unitPrice,
    ),
  };
}

export function priceCurves(
  products: Product[],
  records: PricingRecord[],
  fx: FxTable,
  options: { currency: string; windowDays?: number; now?: Date },
): PriceCurve[] {
  return products
    .map((product) => priceCurve(product, records, fx, options))
    .sort((a, b) => b.observations.length - a.observations.length);
}

export interface PriceMove {
  productId: string;
  productName: string;
  direction: Exclude<TrendDirection, "unknown" | "flat">;
  changePct: number;
  currency: string;
  from: number;
  to: number;
  windowDays: number;
  /** The cheaper supplier available now, when one exists. */
  alternative?: { supplierName: string; unitPrice: number; savingPct: number };
}

/** Material moves only — the input to the signal engine and the alerts panel. */
export function priceMoves(curves: PriceCurve[], thresholdPct = 5): PriceMove[] {
  const moves: PriceMove[] = [];
  for (const curve of curves) {
    if (
      curve.changePct === null ||
      curve.direction === "flat" ||
      curve.direction === "unknown" ||
      Math.abs(curve.changePct) < thresholdPct ||
      !curve.latest ||
      !curve.observations.length
    ) {
      continue;
    }
    const alternative =
      curve.betterSupplierAvailable && curve.best && curve.latest.unitPrice > 0
        ? {
            supplierName: curve.best.supplierName,
            unitPrice: curve.best.unitPrice,
            savingPct: round2(
              ((curve.latest.unitPrice - curve.best.unitPrice) / curve.latest.unitPrice) * 100,
            ),
          }
        : undefined;
    moves.push({
      productId: curve.productId,
      productName: curve.productName,
      direction: curve.direction,
      changePct: curve.changePct,
      currency: curve.currency,
      from: curve.observations[0].unitPrice,
      to: curve.latest.unitPrice,
      windowDays: curve.windowDays,
      alternative,
    });
  }
  return moves.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

/** Supplier league table for one product, cheapest first. */
export function supplierSpread(curve: PriceCurve): {
  supplierName: string;
  unitPrice: number;
  at: string;
  vsBestPct: number;
}[] {
  const bySupplier = new Map<string, PriceObservation>();
  for (const observation of curve.observations) {
    const existing = bySupplier.get(observation.supplierName);
    if (!existing || new Date(observation.at) > new Date(existing.at)) {
      bySupplier.set(observation.supplierName, observation);
    }
  }
  const rows = [...bySupplier.values()].sort((a, b) => a.unitPrice - b.unitPrice);
  const cheapest = rows[0]?.unitPrice ?? 0;
  return rows.map((row) => ({
    supplierName: row.supplierName,
    unitPrice: row.unitPrice,
    at: row.at,
    vsBestPct: cheapest > 0 ? round2(((row.unitPrice - cheapest) / cheapest) * 100) : 0,
  }));
}
