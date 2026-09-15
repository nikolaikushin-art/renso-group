import { describe, expect, it } from "vitest";
import { parseCommercialTerms, renderTemplate } from "./store";

describe("parseCommercialTerms", () => {
  it("extracts the worked example from the requirements", () => {
    // The exact sentence Roni gave as the acceptance case.
    const r = parseCommercialTerms("We can offer 500 units at $42 each, delivery in 3 weeks.");
    expect(r.quantity).toBe(500);
    expect(r.unitPrice).toBe(42);
    expect(r.currency).toBe("USD");
    expect(r.deliveryInfo).toBe("3 weeks");
  });

  it("handles thousands separators and decimals", () => {
    const r = parseCommercialTerms(
      "We can offer 5,000 units of FR4 1.6mm at $1.98 each, delivery in 3 weeks FOB Shenzhen. Terms 30% deposit.",
    );
    expect(r.quantity).toBe(5000);
    expect(r.unitPrice).toBe(1.98);
    expect(r.currency).toBe("USD");
    expect(r.commercialTerms).toContain("FOB Shenzhen");
  });

  it("reads an ISO currency code written before the amount", () => {
    const r = parseCommercialTerms("Aluminium 6061-T6 Bar 25mm: EUR 11.40/m for 500m+.");
    expect(r.unitPrice).toBe(11.4);
    expect(r.currency).toBe("EUR");
  });

  it("recognises sterling and a ranged lead time", () => {
    const r = parseCommercialTerms(
      "Price is GBP 3.25 per unit. Lead time 12-15 working days ex Duisburg.",
    );
    expect(r.unitPrice).toBe(3.25);
    expect(r.currency).toBe("GBP");
    expect(r.deliveryInfo).toMatch(/12\s*-\s*15 working days/);
  });

  it("returns no price rather than guessing when none is stated", () => {
    // The conservative path matters more than the happy path: a wrong price
    // banked silently is worse than an offer that needs typing in by hand.
    const r = parseCommercialTerms(
      "Thanks for the enquiry — we will come back to you with pricing next week.",
    );
    expect(r.unitPrice).toBeUndefined();
  });

  it("does not mistake a quantity for a price", () => {
    const r = parseCommercialTerms("We hold 240 boxes in stock.");
    expect(r.quantity).toBe(240);
    expect(r.unitPrice).toBeUndefined();
  });
});

describe("renderTemplate", () => {
  it("fills merge fields from the recipient and sender", () => {
    const out = renderTemplate(
      "Dear {{first_name}}, regards {{sender_name}}",
      "James Whitfield",
      "Roni Ornadel",
    );
    expect(out).toBe("Dear James, regards Roni Ornadel");
  });

  it("leaves unknown tokens visible instead of blanking them", () => {
    // A typo should be obvious in the preview, not mail a sentence with a hole.
    const out = renderTemplate("Hello {{frist_name}}", "James Whitfield", "Roni");
    expect(out).toContain("{{frist_name}}");
  });
});
