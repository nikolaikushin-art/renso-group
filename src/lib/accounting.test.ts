import { describe, expect, it } from "vitest";
import {
  agedCreditors,
  generalLedger,
  ledgerBalance,
  profitAndLoss,
  vatReturn,
  type Period,
} from "./accounting";
import type { Expense, Invoice, Payment } from "./domain";

const period: Period = {
  from: new Date("2026-01-01T00:00:00Z"),
  to: new Date("2026-03-31T23:59:59Z"),
  label: "Q1 2026",
};

const invoice = (over: Partial<Invoice>): Invoice => ({
  id: "i1",
  number: "INV-1",
  customerId: "c1",
  status: "issued",
  lines: [],
  currency: "GBP",
  subtotal: 10000,
  tax: 2000,
  total: 12000,
  issuedAt: "2026-02-10T00:00:00Z",
  createdAt: "2026-02-10T00:00:00Z",
  updatedAt: "2026-02-10T00:00:00Z",
  ...over,
});

const expense = (over: Partial<Expense>): Expense => ({
  id: "e1",
  date: "2026-02-12T00:00:00Z",
  description: "Stock purchase",
  category: "purchases",
  net: 6000,
  vat: 1200,
  currency: "GBP",
  isPaid: false,
  createdAt: "2026-02-12T00:00:00Z",
  ...over,
});

describe("profitAndLoss", () => {
  it("measures gross profit from cost-of-sales expenses", () => {
    const p = profitAndLoss([invoice({})], [expense({})], period);
    expect(p.revenue).toBe(10000);
    expect(p.costOfSales).toBe(6000);
    expect(p.grossProfit).toBe(4000);
    expect(p.grossMarginPct).toBe(40);
  });

  it("treats overheads as operating expenses, not cost of sales", () => {
    const p = profitAndLoss(
      [invoice({})],
      [expense({}), expense({ id: "e2", category: "salaries", net: 2500, vat: 0 })],
      period,
    );
    expect(p.costOfSales).toBe(6000);
    expect(p.operatingExpenses).toBe(2500);
    expect(p.netProfit).toBe(1500);
  });

  it("excludes VAT from revenue — it is collected, not earned", () => {
    const p = profitAndLoss([invoice({})], [], period);
    expect(p.revenue).toBe(10000); // not 12000
  });

  it("ignores draft and cancelled invoices", () => {
    const p = profitAndLoss(
      [invoice({ id: "d", status: "draft" }), invoice({ id: "x", status: "cancelled" })],
      [],
      period,
    );
    expect(p.revenue).toBe(0);
    expect(p.invoiceCount).toBe(0);
  });

  it("flags a period with revenue but no booked costs rather than reporting 100% margin", () => {
    const p = profitAndLoss([invoice({})], [], period);
    expect(p.costsIncomplete).toBe(true);
    expect(p.grossMarginPct).toBeNull();
  });

  it("excludes records outside the period", () => {
    const p = profitAndLoss(
      [invoice({ issuedAt: "2025-11-01T00:00:00Z" })],
      [expense({ date: "2025-11-02T00:00:00Z" })],
      period,
    );
    expect(p.revenue).toBe(0);
    expect(p.costOfSales).toBe(0);
  });
});

describe("vatReturn", () => {
  it("nets input VAT against output VAT", () => {
    const v = vatReturn([invoice({})], [expense({})], period);
    expect(v.box1_outputVat).toBe(2000);
    expect(v.box4_inputVat).toBe(1200);
    expect(v.box5_netDue).toBe(800);
  });

  it("reports boxes 6 and 7 net of VAT in whole pounds", () => {
    const v = vatReturn([invoice({ subtotal: 10000.4 })], [expense({ net: 6000.6 })], period);
    expect(v.box6_totalSalesExVat).toBe(10000);
    expect(v.box7_totalPurchasesExVat).toBe(6001);
  });
});

describe("generalLedger", () => {
  const names = { customer: () => "Aether Trading Ltd", supplier: () => "EuroMetal" };

  it("balances debits against credits", () => {
    const payment: Payment = {
      id: "p1",
      direction: "in",
      invoiceId: "i1",
      customerId: "c1",
      amount: 12000,
      currency: "GBP",
      paidAt: "2026-03-01T00:00:00Z",
      createdAt: "2026-03-01T00:00:00Z",
    };
    const entries = generalLedger([invoice({})], [expense({})], [payment], period, names);
    const b = ledgerBalance(entries);
    expect(b.balanced).toBe(true);
  });

  it("posts an invoice as debtors debit against sales and VAT credits", () => {
    const entries = generalLedger([invoice({})], [], [], period, names);
    const debtors = entries.find((e) => e.account === "Trade debtors");
    expect(debtors?.debit).toBe(12000);
    expect(entries.find((e) => e.account === "Sales")?.credit).toBe(10000);
    expect(entries.find((e) => e.account === "VAT control")?.credit).toBe(2000);
  });
});

describe("agedCreditors", () => {
  it("buckets unpaid expenses by age and ignores settled ones", () => {
    const asOf = new Date("2026-03-01T00:00:00Z");
    const buckets = agedCreditors(
      [
        expense({ id: "a", date: "2026-02-20T00:00:00Z" }), // 9 days
        expense({ id: "b", date: "2026-01-05T00:00:00Z" }), // 55 days
        expense({ id: "c", date: "2025-11-01T00:00:00Z" }), // 120 days
        expense({ id: "d", date: "2026-02-20T00:00:00Z", isPaid: true }),
      ],
      asOf,
    );
    expect(buckets[1].count).toBe(1);
    expect(buckets[2].count).toBe(1);
    expect(buckets[3].count).toBe(1);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(3);
  });
});
