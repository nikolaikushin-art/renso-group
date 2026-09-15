import { describe, expect, it } from "vitest";
import { documentExpiry, documentsNeedingAttention, expiryLabel } from "./documents";

const NOW = new Date("2026-06-15T12:00:00Z");
const at = (iso: string) => ({ expiresAt: iso });

describe("documentExpiry", () => {
  it("treats a missing expiry as a document that never expires", () => {
    expect(documentExpiry({}, 30, NOW)).toEqual({ state: "none", daysRemaining: null });
  });

  it("marks a document expiring inside the warning window", () => {
    expect(documentExpiry(at("2026-07-01T00:00:00Z"), 30, NOW)).toEqual({
      state: "expiring",
      daysRemaining: 16,
    });
  });

  it("marks a document valid beyond the warning window", () => {
    expect(documentExpiry(at("2026-12-01T00:00:00Z"), 30, NOW).state).toBe("valid");
  });

  it("marks a past date expired with a negative countdown", () => {
    const info = documentExpiry(at("2026-05-30T00:00:00Z"), 30, NOW);
    expect(info.state).toBe("expired");
    expect(info.daysRemaining).toBe(-16);
  });

  it("counts the expiry day itself as still expiring, not expired", () => {
    expect(documentExpiry(at("2026-06-15T00:00:00Z"), 30, NOW)).toEqual({
      state: "expiring",
      daysRemaining: 0,
    });
  });

  it("respects a shorter warning window from settings", () => {
    expect(documentExpiry(at("2026-07-01T00:00:00Z"), 7, NOW).state).toBe("valid");
  });

  it("ignores an unparseable date rather than throwing", () => {
    expect(documentExpiry(at("not-a-date"), 30, NOW).state).toBe("none");
  });
});

describe("documentsNeedingAttention", () => {
  it("returns expired first, then soonest expiring, and drops the rest", () => {
    const result = documentsNeedingAttention(
      [
        { id: "valid", expiresAt: "2027-01-01T00:00:00Z" },
        { id: "soon", expiresAt: "2026-06-20T00:00:00Z" },
        { id: "none" },
        { id: "expired", expiresAt: "2026-01-01T00:00:00Z" },
      ],
      30,
      NOW,
    );
    expect(result.map((r) => r.document.id)).toEqual(["expired", "soon"]);
  });
});

describe("expiryLabel", () => {
  it("phrases each state in plain language", () => {
    expect(expiryLabel({ state: "none", daysRemaining: null })).toBe("No expiry");
    expect(expiryLabel({ state: "expiring", daysRemaining: 0 })).toBe("Expires today");
    expect(expiryLabel({ state: "expiring", daysRemaining: 1 })).toBe("1 day left");
    expect(expiryLabel({ state: "expired", daysRemaining: -3 })).toBe("Expired 3 days ago");
  });
});
