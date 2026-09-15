import { describe, expect, it } from "vitest";
import { computeTotals, lineNet, nextDocumentNumber, toQuotationLines } from "./lines";

describe("lineNet", () => {
  it("multiplies quantity by unit price", () => {
    expect(lineNet({ quantity: 10, unitPrice: 2.5 })).toBe(25);
  });

  it("applies the line discount", () => {
    expect(lineNet({ quantity: 100, unitPrice: 1, discountPct: 12.5 })).toBe(87.5);
  });

  it("clamps nonsense input to zero rather than corrupting the document total", () => {
    expect(lineNet({ quantity: -5, unitPrice: 10 })).toBe(0);
    expect(lineNet({ quantity: Number.NaN, unitPrice: 10 })).toBe(0);
    expect(lineNet({ quantity: 10, unitPrice: 10, discountPct: 250 })).toBe(0);
  });
});

describe("computeTotals", () => {
  it("sums lines and adds tax on the discounted subtotal", () => {
    const totals = computeTotals(
      [
        { quantity: 10, unitPrice: 10 },
        { quantity: 4, unitPrice: 25, discountPct: 10 },
      ],
      20,
    );
    expect(totals.subtotal).toBe(190);
    expect(totals.tax).toBe(38);
    expect(totals.total).toBe(228);
  });

  it("does not accumulate float noise across many lines", () => {
    const lines = Array.from({ length: 30 }, () => ({ quantity: 3, unitPrice: 0.1 }));
    expect(computeTotals(lines, 0).subtotal).toBe(9);
  });

  it("treats a zero tax rate as tax-free", () => {
    expect(computeTotals([{ quantity: 1, unitPrice: 99.99 }], 0)).toEqual({
      subtotal: 99.99,
      tax: 0,
      total: 99.99,
    });
  });
});

describe("nextDocumentNumber", () => {
  it("continues from the highest existing suffix, not the array length", () => {
    const existing = [{ number: "QT-2026-0042" }, { number: "QT-2026-0007" }];
    expect(nextDocumentNumber("QT-2026-", existing)).toBe("QT-2026-0043");
  });

  it("starts at 0001 when nothing matches the prefix", () => {
    expect(nextDocumentNumber("SO-2026-", [{ number: "QT-2026-0042" }])).toBe("SO-2026-0001");
  });

  it("ignores malformed numbers instead of producing NaN", () => {
    expect(nextDocumentNumber("INV-", [{ number: "INV-draft" }, { number: "INV-0003" }])).toBe(
      "INV-0004",
    );
  });
});

describe("toQuotationLines", () => {
  it("drops blank rows left behind by the editor", () => {
    const lines = toQuotationLines(
      [
        { id: "a", description: "  ", quantity: 1, unitPrice: 10 },
        { id: "b", description: " Boards ", quantity: 2, unitPrice: 5 },
      ],
      "GBP",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: "b", description: "Boards", currency: "GBP" });
  });

  it("omits a zero discount rather than persisting a meaningless field", () => {
    const [line] = toQuotationLines(
      [{ id: "a", description: "Boards", quantity: 1, unitPrice: 10, discountPct: 0 }],
      "USD",
    );
    expect(line.discountPct).toBeUndefined();
  });
});
