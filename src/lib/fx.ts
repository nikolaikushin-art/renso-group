/**
 * Renso Group CRM — currency conversion.
 *
 * The old build could not add a USD offer to a EUR offer to a GBP invoice, so
 * every cross-currency total was either wrong or quietly omitted. This module
 * is the fix, and it is deliberately conservative about it:
 *
 * - Rates are **manually maintained** against one base currency, each carrying
 *   the date it was entered. Nothing here fetches a live rate, because a
 *   client-side demo cannot hold a rate provider's licence, and a number with
 *   an invented provenance is worse than a number the user typed themselves.
 * - A missing rate returns `null` rather than 1.0. Treating an unknown rate as
 *   parity is how a £40k exposure becomes a £40k *understatement*, silently.
 * - Every conversion reports the rate and the date it was set, so any figure
 *   on screen can be traced to the rate that produced it. Anything older than
 *   `STALE_AFTER_DAYS` is flagged stale rather than hidden.
 */

/** Days after which a manually-entered rate stops being presented as current. */
export const STALE_AFTER_DAYS = 30;

export interface FxRate {
  /** ISO 4217 code, e.g. "USD". */
  currency: string;
  /** Units of `currency` per 1 unit of base. */
  perBase: number;
  /** ISO date the rate was entered or last confirmed. */
  asOf: string;
}

export interface FxTable {
  base: string;
  rates: FxRate[];
}

export interface Converted {
  /** Amount in the target currency. */
  amount: number;
  /** Effective rate applied: target units per source unit. */
  rate: number;
  /** Oldest `asOf` of the rates used, so a cross-rate reports its weakest leg. */
  asOf: string;
  /** True when the rate is older than `STALE_AFTER_DAYS`. */
  stale: boolean;
}

const dayMs = 86_400_000;

const daysSince = (iso: string, now: Date): number =>
  Math.floor((now.getTime() - new Date(iso).getTime()) / dayMs);

const findRate = (table: FxTable, currency: string): FxRate | null => {
  if (currency === table.base) {
    return { currency: table.base, perBase: 1, asOf: new Date(0).toISOString() };
  }
  return table.rates.find((r) => r.currency === currency) ?? null;
};

/**
 * Converts between any two currencies in the table, crossing through base.
 * Returns `null` when either leg has no rate — the caller must then say so
 * rather than print a figure it cannot stand behind.
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  table: FxTable,
  now: Date = new Date(),
): Converted | null {
  if (!Number.isFinite(amount)) return null;
  if (from === to) {
    return { amount, rate: 1, asOf: new Date(now).toISOString(), stale: false };
  }
  const src = findRate(table, from);
  const dst = findRate(table, to);
  if (!src || !dst || src.perBase <= 0) return null;

  const rate = dst.perBase / src.perBase;
  // The weakest leg governs: a fresh EUR rate crossed through a six-month-old
  // USD rate is a six-month-old cross rate, and should say so.
  const legs = [src, dst].filter((r) => r.currency !== table.base);
  const oldest = legs.length
    ? legs.reduce((a, b) => (new Date(a.asOf) < new Date(b.asOf) ? a : b))
    : src;
  return {
    amount: amount * rate,
    rate,
    asOf: oldest.asOf,
    stale: daysSince(oldest.asOf, now) > STALE_AFTER_DAYS,
  };
}

export interface MixedTotal {
  /** Total of everything that could be converted. */
  total: number;
  /** Currencies present in the input, for disclosure. */
  currencies: string[];
  /** Amounts that had no rate, kept in their own currency. */
  unconverted: { currency: string; amount: number }[];
  /** True when at least one leg used a stale rate. */
  stale: boolean;
}

/**
 * Sums a mixed-currency set into one currency, reporting — never discarding —
 * whatever it could not convert. A dashboard tile can then read
 * "£412,900 (+ $18,400 unconverted)" instead of pretending the second figure
 * does not exist.
 */
export function sumInCurrency(
  items: { amount: number; currency: string }[],
  to: string,
  table: FxTable,
  now: Date = new Date(),
): MixedTotal {
  let total = 0;
  let stale = false;
  const unconvertedMap = new Map<string, number>();
  const currencies = new Set<string>();

  for (const item of items) {
    currencies.add(item.currency);
    const converted = convert(item.amount, item.currency, to, table, now);
    if (!converted) {
      unconvertedMap.set(
        item.currency,
        (unconvertedMap.get(item.currency) ?? 0) + item.amount,
      );
      continue;
    }
    total += converted.amount;
    if (converted.stale) stale = true;
  }

  return {
    total,
    currencies: [...currencies].sort(),
    unconverted: [...unconvertedMap.entries()].map(([currency, amount]) => ({
      currency,
      amount,
    })),
    stale,
  };
}

/** Human label for a conversion's provenance, e.g. "USD 1.2640 · set 12 Sep". */
export function rateLabel(converted: Converted, from: string, to: string): string {
  const when = new Date(converted.asOf);
  const date = Number.isNaN(when.getTime())
    ? "unknown date"
    : when.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `1 ${from} = ${converted.rate.toFixed(4)} ${to} · set ${date}`;
}

/** Rates that need re-checking, oldest first. */
export function staleRates(table: FxTable, now: Date = new Date()): FxRate[] {
  return table.rates
    .filter((r) => daysSince(r.asOf, now) > STALE_AFTER_DAYS)
    .sort((a, b) => new Date(a.asOf).getTime() - new Date(b.asOf).getTime());
}
