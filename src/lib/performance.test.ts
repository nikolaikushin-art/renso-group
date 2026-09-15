import { describe, expect, it } from "vitest";
import {
  categoryMix,
  productPerformance,
  unsoldProducts,
} from "@/lib/productPerformance";
import {
  activitySummary,
  responseStats,
  unlinkedCorrespondents,
} from "@/lib/commsAnalytics";
import {
  confidenceFor,
  deliveryPerformance,
  paymentBehaviour,
} from "@/lib/reliability";
import type { MarginContext } from "@/lib/margin";
import type { FxTable } from "@/lib/fx";
import type {
  Communication,
  Contact,
  Customer,
  Delivery,
  Invoice,
  Order,
  Payment,
  PricingRecord,
  Product,
} from "@/lib/domain";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const dayMs = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * dayMs).toISOString();
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

const fx: FxTable = {
  base: "GBP",
  rates: [
    { currency: "USD", perBase: 1.25, asOf: daysAgo(2) },
    { currency: "EUR", perBase: 1.2, asOf: daysAgo(2) },
  ],
};

const products: Product[] = [
  {
    id: "p1",
    sku: "WID-1",
    name: "Widget",
    category: "Electronics",
    unit: "pcs",
    purchasePrice: 6,
    sellingPrice: 10,
    currency: "GBP",
    supplierIds: ["s1"],
    tags: [],
    isActive: true,
    createdAt: daysAgo(200),
    updatedAt: daysAgo(10),
  },
  {
    id: "p2",
    sku: "GAD-1",
    name: "Gadget",
    category: "Metals",
    unit: "pcs",
    currency: "GBP",
    supplierIds: ["s2"],
    tags: [],
    isActive: true,
    createdAt: daysAgo(200),
    updatedAt: daysAgo(10),
  },
  {
    id: "p3",
    sku: "DEAD-1",
    name: "Never Sold",
    unit: "pcs",
    currency: "GBP",
    supplierIds: [],
    tags: [],
    isActive: true,
    createdAt: daysAgo(200),
    updatedAt: daysAgo(200),
  },
];

const marginCtx: MarginContext = {
  pricingRecords: [] as PricingRecord[],
  products,
  fx,
  floorPct: 15,
  now: NOW,
};

const invoice = (over: Partial<Invoice> & { id: string }): Invoice => ({
  number: "INV-1",
  customerId: "c1",
  status: "paid",
  lines: [],
  currency: "GBP",
  subtotal: 0,
  tax: 0,
  total: 0,
  issuedAt: daysAgo(10),
  createdAt: daysAgo(10),
  updatedAt: daysAgo(10),
  ...over,
});

const window = { from: new Date(NOW.getTime() - 90 * dayMs), to: NOW };
const priorWindow = {
  from: new Date(NOW.getTime() - 180 * dayMs),
  to: new Date(NOW.getTime() - 90 * dayMs),
};

/* -------------------------------------------------------------------------- */
/* Product performance                                                        */
/* -------------------------------------------------------------------------- */

describe("product performance", () => {
  const invoices: Invoice[] = [
    invoice({
      id: "i1",
      total: 1000,
      lines: [
        {
          id: "l1",
          productId: "p1",
          description: "Widget",
          quantity: 100,
          unitPrice: 10,
          currency: "GBP",
        },
      ],
    }),
    invoice({
      id: "i2",
      customerId: "c2",
      issuedAt: daysAgo(20),
      createdAt: daysAgo(20),
      total: 1500,
      lines: [
        {
          id: "l2",
          productId: "p1",
          description: "Widget",
          quantity: 50,
          unitPrice: 10,
          currency: "GBP",
        },
        {
          id: "l3",
          description: "Freight and tooling",
          quantity: 1,
          unitPrice: 500,
          currency: "GBP",
        },
      ],
    }),
    invoice({
      id: "i3",
      issuedAt: daysAgo(120),
      createdAt: daysAgo(120),
      total: 500,
      lines: [
        {
          id: "l4",
          productId: "p1",
          description: "Widget",
          quantity: 50,
          unitPrice: 10,
          currency: "GBP",
        },
      ],
    }),
  ];

  it("measures units, revenue and margin from invoices", () => {
    const result = productPerformance({
      products,
      invoices,
      window,
      priorWindow,
      margin: marginCtx,
      currency: "GBP",
    });
    const widget = result.products.find((p) => p.productId === "p1")!;
    expect(widget.unitsSold).toBe(150);
    expect(widget.revenue).toBe(1500);
    // 150 units at a £6 standing cost.
    expect(widget.cost).toBe(900);
    expect(widget.marginPct).toBe(40);
    expect(widget.invoiceCount).toBe(2);
    expect(widget.customerCount).toBe(2);
  });

  it("counts a line with no product as revenue but not as product revenue", () => {
    const result = productPerformance({
      products,
      invoices,
      window,
      margin: marginCtx,
      currency: "GBP",
    });
    expect(result.revenue).toBe(2000);
    expect(result.unattributedRevenue).toBe(500);
    expect(result.products.reduce((sum, p) => sum + p.revenue, 0)).toBe(1500);
  });

  it("compares against the prior window", () => {
    const result = productPerformance({
      products,
      invoices,
      window,
      priorWindow,
      margin: marginCtx,
      currency: "GBP",
    });
    const widget = result.products.find((p) => p.productId === "p1")!;
    expect(widget.priorRevenue).toBe(500);
    expect(widget.changePct).toBe(200);
  });

  it("reports margin as unknown for a product with no cost at all", () => {
    const result = productPerformance({
      products,
      invoices: [
        invoice({
          id: "i9",
          total: 400,
          lines: [
            {
              id: "l9",
              productId: "p2",
              description: "Gadget",
              quantity: 20,
              unitPrice: 20,
              currency: "GBP",
            },
          ],
        }),
      ],
      window,
      margin: marginCtx,
      currency: "GBP",
    });
    const gadget = result.products[0];
    expect(gadget.cost).toBeNull();
    expect(gadget.marginPct).toBeNull();
  });

  it("converts a foreign-currency invoice and excludes one with no rate", () => {
    const converted = productPerformance({
      products,
      invoices: [
        invoice({
          id: "i10",
          currency: "EUR",
          total: 120,
          lines: [
            {
              id: "l10",
              productId: "p1",
              description: "Widget",
              quantity: 10,
              unitPrice: 12,
              currency: "EUR",
            },
          ],
        }),
      ],
      window,
      margin: marginCtx,
      currency: "GBP",
    });
    // 120 EUR at 1.2 per GBP = 100 GBP.
    expect(converted.revenue).toBe(100);

    const excluded = productPerformance({
      products,
      invoices: [
        invoice({
          id: "i11",
          currency: "AUD",
          total: 500,
          lines: [
            {
              id: "l11",
              productId: "p1",
              description: "Widget",
              quantity: 10,
              unitPrice: 50,
              currency: "AUD",
            },
          ],
        }),
      ],
      window,
      margin: marginCtx,
      currency: "GBP",
    });
    expect(excluded.revenue).toBe(0);
    expect(excluded.excludedInvoices).toBe(1);
  });

  it("classifies the products carrying the profit as band A", () => {
    const result = productPerformance({
      products,
      invoices: [
        invoice({
          id: "i12",
          total: 10000,
          lines: [
            {
              id: "l12",
              productId: "p1",
              description: "Widget",
              quantity: 1000,
              unitPrice: 10,
              currency: "GBP",
            },
          ],
        }),
      ],
      window,
      margin: marginCtx,
      currency: "GBP",
    });
    expect(result.products[0].band).toBe("A");
    expect(result.products[0].profitShare).toBe(1);
  });

  it("does not classify anything when there are no sales", () => {
    const result = productPerformance({
      products,
      invoices: [],
      window,
      margin: marginCtx,
      currency: "GBP",
    });
    expect(result.products).toHaveLength(0);
    expect(result.grossProfit).toBeNull();
  });

  it("ignores drafts and cancelled invoices", () => {
    const result = productPerformance({
      products,
      invoices: [
        invoice({
          id: "i13",
          status: "draft",
          total: 999,
          lines: [
            {
              id: "l13",
              productId: "p1",
              description: "Widget",
              quantity: 99,
              unitPrice: 10,
              currency: "GBP",
            },
          ],
        }),
      ],
      window,
      margin: marginCtx,
      currency: "GBP",
    });
    expect(result.revenue).toBe(0);
  });

  it("splits the mix by category and lists what never sold", () => {
    const result = productPerformance({
      products,
      invoices,
      window,
      margin: marginCtx,
      currency: "GBP",
    });
    const mix = categoryMix(result.products);
    expect(mix[0].category).toBe("Electronics");
    expect(mix[0].share).toBe(1);
    expect(unsoldProducts(products, result.products).map((p) => p.id)).toEqual(["p2", "p3"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Communication analytics                                                    */
/* -------------------------------------------------------------------------- */

const comm = (over: Partial<Communication> & { id: string }): Communication => ({
  channel: "email",
  direction: "inbound",
  body: "test",
  isReceived: true,
  occurredAt: hoursAgo(5),
  createdAt: hoursAgo(5),
  ...over,
});

describe("communication analytics", () => {
  it("buckets activity by day and keeps the empty days", () => {
    const summary = activitySummary(
      [
        comm({ id: "m1", occurredAt: hoursAgo(2) }),
        comm({ id: "m2", direction: "outbound", occurredAt: hoursAgo(3) }),
        comm({ id: "m3", channel: "call", direction: "outbound", occurredAt: daysAgo(3) }),
      ],
      14,
      NOW,
    );
    expect(summary.days).toHaveLength(14);
    expect(summary.sent).toBe(2);
    expect(summary.received).toBe(1);
    expect(summary.calls).toBe(1);
    expect(summary.activeDays).toBe(2);
    expect(summary.peak?.total).toBe(2);
  });

  it("excludes messages outside the window", () => {
    const summary = activitySummary([comm({ id: "m1", occurredAt: daysAgo(200) })], 14, NOW);
    expect(summary.sent + summary.received).toBe(0);
  });

  it("splits by channel", () => {
    const summary = activitySummary(
      [
        comm({ id: "m1", channel: "whatsapp" }),
        comm({ id: "m2", channel: "whatsapp", direction: "outbound" }),
        comm({ id: "m3", channel: "email" }),
      ],
      14,
      NOW,
    );
    expect(summary.channels[0].channel).toBe("whatsapp");
    expect(summary.channels[0].total).toBe(2);
  });

  it("measures reply latency as a median and flags what is unanswered", () => {
    const customers = [{ id: "c1", name: "Aether" } as Customer];
    const stats = responseStats(
      [
        comm({ id: "m1", customerId: "c1", occurredAt: hoursAgo(50) }),
        comm({ id: "m2", customerId: "c1", direction: "outbound", occurredAt: hoursAgo(48) }),
        comm({ id: "m3", customerId: "c1", occurredAt: hoursAgo(30) }),
        comm({ id: "m4", customerId: "c1", direction: "outbound", occurredAt: hoursAgo(20) }),
        comm({ id: "m5", customerId: "c1", occurredAt: hoursAgo(6) }),
      ],
      customers,
      [],
      NOW,
    );
    const row = stats[0];
    expect(row.answered).toBe(2);
    expect(row.medianHours).toBe(6); // 2h and 10h
    expect(row.outstanding).toBe(1);
    expect(row.oldestOutstandingHours).toBe(6);
    expect(row.silentDays).toBe(0);
  });

  it("does not treat a draft as a reply", () => {
    const stats = responseStats(
      [
        comm({ id: "m1", customerId: "c1", occurredAt: hoursAgo(30) }),
        comm({
          id: "m2",
          customerId: "c1",
          direction: "outbound",
          folder: "drafts",
          occurredAt: hoursAgo(20),
        }),
      ],
      [{ id: "c1", name: "Aether" } as Customer],
      [],
      NOW,
    );
    expect(stats[0].answered).toBe(0);
    expect(stats[0].outstanding).toBe(1);
  });

  it("surfaces unknown correspondents and skips our own domain and known contacts", () => {
    const contacts = [{ id: "ct1", email: "known@buyer.com" } as Contact];
    const found = unlinkedCorrespondents(
      [
        comm({ id: "m1", from: "known@buyer.com" }),
        comm({ id: "m2", from: "roni@rensogroup.com" }),
        comm({ id: "m3", from: "new.buyer@acme.io", fromName: "Sam Reed", customerId: "c1" }),
        comm({ id: "m4", from: "new.buyer@acme.io" }),
        comm({ id: "m5", from: "+44 7700 900112", channel: "whatsapp" }),
      ],
      contacts,
      [{ id: "c1", name: "Aether Trading" } as Customer],
      [],
      ["rensogroup.com"],
    );
    expect(found).toHaveLength(1);
    expect(found[0].address).toBe("new.buyer@acme.io");
    expect(found[0].messages).toBe(2);
    expect(found[0].name).toBe("Sam Reed");
    expect(found[0].linkedTo?.name).toBe("Aether Trading");
  });

  it("ignores outbound messages when hunting for new correspondents", () => {
    const found = unlinkedCorrespondents(
      [comm({ id: "m1", direction: "outbound", from: "roni@x.com", to: "stranger@y.com" })],
      [],
      [],
      [],
    );
    expect(found).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Reliability                                                                */
/* -------------------------------------------------------------------------- */

describe("reliability", () => {
  it("grades confidence by sample size", () => {
    expect(confidenceFor(0)).toBe("none");
    expect(confidenceFor(2)).toBe("low");
    expect(confidenceFor(5)).toBe("fair");
    expect(confidenceFor(20)).toBe("good");
  });

  it("measures payment behaviour from receipts against due dates", () => {
    const invoices: Invoice[] = [
      invoice({
        id: "i1",
        total: 1000,
        amountPaid: 1000,
        issuedAt: daysAgo(60),
        dueAt: daysAgo(30),
      }),
      invoice({
        id: "i2",
        total: 500,
        amountPaid: 500,
        issuedAt: daysAgo(90),
        dueAt: daysAgo(60),
      }),
    ];
    const payments: Payment[] = [
      {
        id: "pay1",
        direction: "in",
        invoiceId: "i1",
        amount: 1000,
        currency: "GBP",
        paidAt: daysAgo(35),
        createdAt: daysAgo(35),
      },
      {
        id: "pay2",
        direction: "in",
        invoiceId: "i2",
        amount: 500,
        currency: "GBP",
        paidAt: daysAgo(50),
        createdAt: daysAgo(50),
      },
    ];
    const result = paymentBehaviour("c1", invoices, payments, NOW);
    expect(result.settled).toBe(2);
    expect(result.onTime).toBe(1);
    expect(result.onTimePct).toBe(50);
    expect(result.worstDaysLate).toBe(10);
    expect(result.avgDaysLate).toBe(3);
    expect(result.confidence).toBe("low");
    expect(result.note).toContain("indicative");
  });

  it("returns no score at all rather than a flattering one with no history", () => {
    const result = paymentBehaviour("c1", [], [], NOW);
    expect(result.score).toBeNull();
    expect(result.onTimePct).toBeNull();
    expect(result.note).toContain("nothing to measure");
  });

  it("penalises an account that is currently overdue", () => {
    const invoices: Invoice[] = [
      invoice({
        id: "i1",
        total: 1000,
        amountPaid: 1000,
        issuedAt: daysAgo(60),
        dueAt: daysAgo(40),
      }),
      invoice({
        id: "i2",
        status: "overdue",
        total: 800,
        amountPaid: 0,
        issuedAt: daysAgo(50),
        dueAt: daysAgo(20),
      }),
    ];
    const payments: Payment[] = [
      {
        id: "pay1",
        direction: "in",
        invoiceId: "i1",
        amount: 1000,
        currency: "GBP",
        paidAt: daysAgo(45),
        createdAt: daysAgo(45),
      },
    ];
    const result = paymentBehaviour("c1", invoices, payments, NOW);
    expect(result.onTimePct).toBe(100);
    expect(result.openOverdue).toBe(1);
    // On-time history, but currently late: the score must not read 100.
    expect(result.score).toBe(85);
  });

  it("counts part payments as their own behaviour, not as settled", () => {
    const result = paymentBehaviour(
      "c1",
      [
        invoice({
          id: "i1",
          status: "partial",
          total: 1000,
          amountPaid: 400,
          dueAt: daysAgo(10),
        }),
      ],
      [],
      NOW,
    );
    expect(result.settled).toBe(0);
    expect(result.partPayments).toBe(1);
  });

  it("measures supplier delivery against the promised date on the first despatch", () => {
    const orders: Order[] = [
      {
        id: "o1",
        number: "SO-1",
        customerId: "c1",
        status: "delivered",
        lines: [
          {
            id: "ol1",
            productId: "p1",
            description: "Widget",
            quantity: 100,
            unitPrice: 10,
            currency: "GBP",
          },
        ],
        currency: "GBP",
        subtotal: 1000,
        tax: 0,
        total: 1000,
        deliveryDate: daysAgo(20),
        createdAt: daysAgo(40),
        updatedAt: daysAgo(15),
      },
    ];
    const deliveries: Delivery[] = [
      {
        id: "d1",
        orderId: "o1",
        reference: "DN-1",
        quantities: { ol1: 100 },
        despatchedAt: daysAgo(15),
        createdAt: daysAgo(15),
      },
    ];
    const result = deliveryPerformance("s1", { orders, deliveries, products, now: NOW });
    expect(result.assessed).toBe(1);
    expect(result.onTimePct).toBe(0);
    expect(result.avgDaysLate).toBe(5);
    expect(result.avgFillRate).toBe(100);
    expect(result.confidence).toBe("low");
  });

  it("counts an undespatched order past its date as open and late", () => {
    const orders: Order[] = [
      {
        id: "o1",
        number: "SO-1",
        customerId: "c1",
        status: "confirmed",
        lines: [
          {
            id: "ol1",
            productId: "p1",
            description: "Widget",
            quantity: 100,
            unitPrice: 10,
            currency: "GBP",
          },
        ],
        currency: "GBP",
        subtotal: 1000,
        tax: 0,
        total: 1000,
        deliveryDate: daysAgo(5),
        createdAt: daysAgo(40),
        updatedAt: daysAgo(5),
      },
    ];
    const result = deliveryPerformance("s1", { orders, deliveries: [], products, now: NOW });
    expect(result.openLate).toBe(1);
    expect(result.assessed).toBe(0);
    expect(result.score).toBeNull();
  });

  it("says there is nothing to measure for a supplier with no relevant orders", () => {
    const result = deliveryPerformance("s9", {
      orders: [],
      deliveries: [],
      products,
      now: NOW,
    });
    expect(result.confidence).toBe("none");
    expect(result.note).toContain("No orders");
  });
});
