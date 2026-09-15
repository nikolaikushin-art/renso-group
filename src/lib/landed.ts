/**
 * Renso Group CRM — landed cost.
 *
 * A trading company does not buy at the supplier's unit price; it buys at the
 * unit price plus freight, duty, insurance and the FX it settled at. Quoting
 * off the supplier price is exactly how a deal that showed 22% gross ships at
 * 9%. This module turns an offer into the number the desk should actually quote
 * from, and then solves in both directions:
 *
 *   offer → landed unit cost → selling price at a target margin
 *   offer → landed unit cost → margin implied by a given selling price
 *
 * Duty is applied to the goods value only (the customs value), not to freight,
 * which is the normal UK treatment for a CIF-valued consignment and the
 * conservative choice where it differs.
 */

import { convert, type FxTable } from "@/lib/fx";

export interface LandedInput {
  /** Supplier unit price in `currency`. */
  unitPrice: number;
  currency: string;
  /** Units on the consignment. Freight is spread across these. */
  quantity: number;
  /** Total freight for the consignment, in `freightCurrency`. */
  freightTotal?: number;
  freightCurrency?: string;
  /** Import duty as a percentage of goods value. */
  dutyPct?: number;
  /** Insurance as a percentage of goods value. */
  insurancePct?: number;
  /** Any other per-unit cost — inspection, certification, rework. */
  otherPerUnit?: number;
  /** Currency the desk quotes in. */
  targetCurrency: string;
}

export interface LandedCost {
  /** Goods cost per unit, converted into the target currency. */
  goodsPerUnit: number;
  freightPerUnit: number;
  dutyPerUnit: number;
  insurancePerUnit: number;
  otherPerUnit: number;
  /** The figure to quote from. */
  landedPerUnit: number;
  /** Landed cost of the whole consignment. */
  landedTotal: number;
  currency: string;
  /** Uplift over the raw supplier price, as a percentage. */
  upliftPct: number;
  /** Set when a leg could not be converted — the result is then partial. */
  warnings: string[];
}

const round = (n: number, dp = 4): number => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export function landedCost(
  input: LandedInput,
  table: FxTable,
  now: Date = new Date(),
): LandedCost {
  const warnings: string[] = [];
  const qty = input.quantity > 0 ? input.quantity : 1;

  const goodsConverted = convert(
    input.unitPrice,
    input.currency,
    input.targetCurrency,
    table,
    now,
  );
  if (!goodsConverted) {
    warnings.push(
      `No ${input.currency}→${input.targetCurrency} rate set, so goods cost is shown unconverted.`,
    );
  }
  const goodsPerUnit = goodsConverted ? goodsConverted.amount : input.unitPrice;
  if (goodsConverted?.stale) {
    warnings.push(`The ${input.currency} rate is out of date — confirm before quoting.`);
  }

  let freightPerUnit = 0;
  if (input.freightTotal && input.freightTotal > 0) {
    const freightCurrency = input.freightCurrency || input.targetCurrency;
    const freightConverted = convert(
      input.freightTotal,
      freightCurrency,
      input.targetCurrency,
      table,
      now,
    );
    if (!freightConverted) {
      warnings.push(`No ${freightCurrency} rate set, so freight is excluded.`);
    } else {
      freightPerUnit = freightConverted.amount / qty;
    }
  }

  const dutyPerUnit = goodsPerUnit * ((input.dutyPct ?? 0) / 100);
  const insurancePerUnit = goodsPerUnit * ((input.insurancePct ?? 0) / 100);
  const otherPerUnit = input.otherPerUnit ?? 0;

  const landedPerUnit =
    goodsPerUnit + freightPerUnit + dutyPerUnit + insurancePerUnit + otherPerUnit;

  return {
    goodsPerUnit: round(goodsPerUnit),
    freightPerUnit: round(freightPerUnit),
    dutyPerUnit: round(dutyPerUnit),
    insurancePerUnit: round(insurancePerUnit),
    otherPerUnit: round(otherPerUnit),
    landedPerUnit: round(landedPerUnit),
    landedTotal: round(landedPerUnit * qty, 2),
    currency: input.targetCurrency,
    upliftPct: goodsPerUnit > 0 ? round(((landedPerUnit - goodsPerUnit) / goodsPerUnit) * 100, 2) : 0,
    warnings,
  };
}

/**
 * Selling price that yields `marginPct` **on the sale** (margin, not markup).
 * Trading desks quote margin on revenue; using the markup formula here is the
 * single most common way a quote comes out light.
 */
export function priceForMargin(landedPerUnit: number, marginPct: number): number | null {
  if (marginPct >= 100) return null; // unreachable: 100% margin needs zero cost
  const divisor = 1 - marginPct / 100;
  if (divisor <= 0) return null;
  return round(landedPerUnit / divisor, 4);
}

/** Margin percentage implied by a selling price against a landed cost. */
export function marginFromPrice(landedPerUnit: number, sellingPrice: number): number | null {
  if (sellingPrice <= 0) return null;
  return round(((sellingPrice - landedPerUnit) / sellingPrice) * 100, 2);
}

/** Markup percentage — shown alongside margin because suppliers quote in it. */
export function markupFromPrice(landedPerUnit: number, sellingPrice: number): number | null {
  if (landedPerUnit <= 0) return null;
  return round(((sellingPrice - landedPerUnit) / landedPerUnit) * 100, 2);
}

export interface BreakEven {
  /** Units that must sell to cover the fixed cost of the deal. */
  units: number | null;
  contributionPerUnit: number;
}

/** Break-even on a deal carrying a fixed cost (tooling, certification, samples). */
export function breakEven(
  landedPerUnit: number,
  sellingPrice: number,
  fixedCost: number,
): BreakEven {
  const contributionPerUnit = round(sellingPrice - landedPerUnit, 4);
  if (contributionPerUnit <= 0) return { units: null, contributionPerUnit };
  return {
    units: Math.ceil(fixedCost / contributionPerUnit),
    contributionPerUnit,
  };
}
