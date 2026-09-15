/**
 * Renso Group CRM — line-item maths and document numbering.
 *
 * Quotations, orders and invoices all carry the same `QuotationLine[]` shape,
 * so the arithmetic that turns lines into subtotal / tax / total lives here
 * rather than being re-derived (and drifting) in each form.
 */

import type { QuotationLine, UUID } from "./domain";

export interface DraftLine {
  id: UUID;
  productId?: UUID;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
}

export interface DocumentTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/** Round to 2dp without accumulating binary float noise across many lines. */
export const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Net value of a single line after its own discount.
 * Negative quantities/prices are clamped to 0 — the forms never need them and
 * allowing them silently corrupts document totals.
 */
export function lineNet(line: Pick<DraftLine, "quantity" | "unitPrice" | "discountPct">): number {
  const qty = Number.isFinite(line.quantity) ? Math.max(0, line.quantity) : 0;
  const price = Number.isFinite(line.unitPrice) ? Math.max(0, line.unitPrice) : 0;
  const discount = Math.min(100, Math.max(0, line.discountPct ?? 0));
  return round2(qty * price * (1 - discount / 100));
}

/** Subtotal / tax / total for a set of lines at a given tax rate. */
export function computeTotals(
  lines: Pick<DraftLine, "quantity" | "unitPrice" | "discountPct">[],
  taxRatePct = 0,
): DocumentTotals {
  const subtotal = round2(lines.reduce((sum, line) => sum + lineNet(line), 0));
  const rate = Math.max(0, taxRatePct) / 100;
  const tax = round2(subtotal * rate);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

/**
 * Next document number for a prefix, based on the highest numeric suffix already
 * in use. Counting the array length instead (the previous approach) reissues a
 * number as soon as anything is deleted or seeded out of order.
 */
export function nextDocumentNumber(
  prefix: string,
  existing: { number?: string }[],
  pad = 4,
): string {
  const highest = existing.reduce((max, doc) => {
    if (!doc.number || !doc.number.startsWith(prefix)) return max;
    const suffix = Number.parseInt(doc.number.slice(prefix.length), 10);
    return Number.isFinite(suffix) && suffix > max ? suffix : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(pad, "0")}`;
}

/** Strip the editor's draft rows down to persisted `QuotationLine` records. */
export function toQuotationLines(lines: DraftLine[], currency: string): QuotationLine[] {
  return lines
    .filter((line) => line.description.trim().length > 0)
    .map((line) => ({
      id: line.id,
      productId: line.productId || undefined,
      description: line.description.trim(),
      quantity: Math.max(0, line.quantity) || 0,
      unitPrice: Math.max(0, line.unitPrice) || 0,
      currency,
      discountPct: line.discountPct ? Math.min(100, Math.max(0, line.discountPct)) : undefined,
    }));
}

let lineSeq = 0;
/** Stable-enough unique id for a freshly added editor row. */
export const newLineId = (): string => `ln_${Date.now().toString(36)}_${(lineSeq += 1)}`;

export const blankLine = (): DraftLine => ({
  id: newLineId(),
  description: "",
  quantity: 1,
  unitPrice: 0,
});
