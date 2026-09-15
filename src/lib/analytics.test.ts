import { describe, expect, it } from "vitest";
import type { Customer, Invoice, Opportunity, Order, Quotation, User } from "./domain";
import {
  countDelta,
  delta,
  openOrderValue,
  pipelineByStage,
  quotationConversion,
  receivablesAging,
  resolvePeriod,
  revenueByManager,
  revenueByMonth,
  revenueByTerritory,
  revenueDelta,
  winRate,
} from "./analytics";

const NOW = new Date("2026-06-15T12:00:00Z");

const invoice = (over: Partial<Invoice>): Invoice =>
  ({
    id: "i",
    number: "INV-1",
    customerId: "c1",
    status: "issued",
    lines: [],
    currency: "GBP",
    subtotal: 0,
    tax: 0,
    total: 100,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  }) as Invoice;

describe("resolvePeriod", () => {
  it("builds an equally sized comparison window immediately before the current one", () => {
    const p = resolvePeriod(30, NOW);
    expect(p.start?.toISOString()).toBe("2026-05-16T12:00:00.000Z");
    expect(p.previousStart?.toISOString()).toBe("2026-04-16T12:00:00.000Z");
    expect(p.previousEnd?.toISOString()).toBe("2026-05-16T12:00:00.000Z");
  });

  it("has no bounds for all-time", () => {
    expect(resolvePeriod(null, NOW).start).toBeNull();
  });
});

describe("delta", () => {
  it("reports percentage change against the previous window", () => {
    expect(delta(150, 100).changePct).toBe(50);
    expect(delta(50, 100).changePct).toBe(-50);
  });

  it("returns null rather than Infinity when there is no baseline", () => {
    expect(delta(80, 0).changePct).toBeNull();
  });

  it("treats zero-to-zero as flat, not unknown", () => {
    expect(delta(0, 0).changePct).toBe(0);
  });
});

describe("revenueDelta", () => {
  const invoices = [
    invoice({ id: "a", total: 1000, issuedAt: "2026-06-01T00:00:00Z" }),
    invoice({ id: "b", total: 400, issuedAt: "2026-04-20T00:00:00Z" }),
    invoice({ id: "c", total: 900, issuedAt: "2026-06-05T00:00:00Z", status: "draft" }),
  ];

  it("counts only issued or paid invoices, split across the two windows", () => {
    const result = revenueDelta(invoices, resolvePeriod(30, NOW));
    expect(result.current).toBe(1000);
    expect(result.previous).toBe(400);
  });

  it("excludes drafts from revenue entirely", () => {
    const result = revenueDelta(invoices, resolvePeriod(null, NOW));
    expect(result.current).toBe(1400);
  });
});

describe("countDelta", () => {
  it("compares records created in each window", () => {
    const records = [
      { createdAt: "2026-06-10T00:00:00Z" },
      { createdAt: "2026-06-01T00:00:00Z" },
      { createdAt: "2026-04-25T00:00:00Z" },
    ];
    const result = countDelta(records, resolvePeriod(30, NOW));
    expect(result.current).toBe(2);
    expect(result.previous).toBe(1);
  });
});

describe("revenueByMonth", () => {
  it("emits every month in range, including empty ones", () => {
    const points = revenueByMonth([invoice({ issuedAt: "2026-06-02T00:00:00Z", total: 500 })], 3, NOW);
    expect(points.map((p) => p.month)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(points[0].invoiced).toBe(0);
    expect(points[2].invoiced).toBe(500);
  });

  it("books collection in the month it was paid, not the month it was invoiced", () => {
    const points = revenueByMonth(
      [
        invoice({
          issuedAt: "2026-04-10T00:00:00Z",
          paidAt: "2026-06-03T00:00:00Z",
          status: "paid",
          total: 800,
          amountPaid: 800,
        }),
      ],
      3,
      NOW,
    );
    expect(points[0].invoiced).toBe(800);
    expect(points[0].collected).toBe(0);
    expect(points[2].collected).toBe(800);
  });
});

describe("pipelineByStage", () => {
  const opps = [
    { id: "1", stage: "enquiry", value: 100 },
    { id: "2", stage: "enquiry", value: 50 },
    { id: "3", stage: "closed_won", value: 900 },
  ] as Opportunity[];

  it("returns the open stages in funnel order and excludes closed ones", () => {
    const points = pipelineByStage(opps);
    expect(points.map((p) => p.stage)).toEqual([
      "enquiry",
      "quotation",
      "order",
      "delivery",
      "invoice",
      "payment",
    ]);
    expect(points[0]).toMatchObject({ count: 2, value: 150 });
  });
});

describe("winRate", () => {
  it("measures wins against decided opportunities only", () => {
    const opps = [
      { stage: "closed_won" },
      { stage: "closed_lost" },
      { stage: "closed_lost" },
      { stage: "enquiry" },
    ] as Opportunity[];
    expect(winRate(opps)).toEqual({ won: 1, lost: 2, ratePct: 33 });
  });

  it("is unknown rather than zero when nothing has closed", () => {
    expect(winRate([{ stage: "enquiry" }] as Opportunity[]).ratePct).toBeNull();
  });
});

describe("quotationConversion", () => {
  it("ignores drafts, which were never put to the customer", () => {
    const quotes = [
      { status: "draft" },
      { status: "sent" },
      { status: "converted" },
    ] as Quotation[];
    expect(quotationConversion(quotes)).toEqual({ sent: 2, converted: 1, ratePct: 50 });
  });
});

describe("revenue breakdowns", () => {
  const customers = [
    { id: "c1", territory: "UK & Ireland", ownerId: "u1" },
    { id: "c2", territory: "UK & Ireland", ownerId: "u2" },
    { id: "c3", totalRevenue: 700 },
  ] as Customer[];
  const invoices = [
    invoice({ customerId: "c1", total: 1000 }),
    invoice({ customerId: "c2", total: 250 }),
  ];

  it("groups by territory, sorted by revenue, with a real Unassigned bucket", () => {
    const points = revenueByTerritory(customers, invoices);
    expect(points[0]).toMatchObject({ label: "UK & Ireland", revenue: 1250, customers: 2 });
    expect(points[1]).toMatchObject({ label: "Unassigned", revenue: 700 });
  });

  it("falls back to lifetime revenue for customers with no invoices yet", () => {
    const points = revenueByTerritory([{ id: "c9", totalRevenue: 42 } as Customer], []);
    expect(points[0].revenue).toBe(42);
  });

  it("resolves manager ids to names", () => {
    const users = [{ id: "u1", name: "Roni Ornadel" }] as User[];
    const points = revenueByManager(customers, invoices, users);
    expect(points[0].label).toBe("Roni Ornadel");
  });
});

describe("receivablesAging", () => {
  it("buckets outstanding balances by how overdue they are", () => {
    const buckets = receivablesAging(
      [
        invoice({ id: "a", total: 100, dueAt: "2026-07-01T00:00:00Z" }),
        invoice({ id: "b", total: 200, dueAt: "2026-06-01T00:00:00Z" }),
        invoice({ id: "c", total: 300, dueAt: "2026-05-01T00:00:00Z" }),
        invoice({ id: "d", total: 400, dueAt: "2026-01-01T00:00:00Z" }),
        invoice({ id: "e", total: 999, status: "paid" }),
      ],
      NOW,
    );
    expect(buckets.map((b) => b.amount)).toEqual([100, 200, 300, 400]);
  });

  it("nets off part payments instead of chasing the gross total", () => {
    const buckets = receivablesAging(
      [invoice({ total: 1000, amountPaid: 600, status: "partial", dueAt: "2026-06-01T00:00:00Z" })],
      NOW,
    );
    expect(buckets[1].amount).toBe(400);
  });
});

describe("openOrderValue", () => {
  it("counts orders in flight but not drafts, delivered or cancelled", () => {
    const orders = [
      { status: "draft", total: 100 },
      { status: "confirmed", total: 200 },
      { status: "shipped", total: 300 },
      { status: "delivered", total: 400 },
      { status: "cancelled", total: 500 },
    ] as Order[];
    expect(openOrderValue(orders)).toBe(500);
  });
});
