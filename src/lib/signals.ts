/**
 * Renso Group CRM — signal engine.
 *
 * Fourteen modules each with its own list is fourteen places to look, and on a
 * busy morning nobody looks at all of them. This module reads across every
 * module and returns the short list of things that actually need a person
 * today, ranked, each one carrying the record it came from so it can be opened
 * in one tap.
 *
 * Design rules, learned from every alert system that ends up ignored:
 *
 * - **Every signal names its evidence.** Not "check this customer" but
 *   "INV-2026-0088 is 34 days past due, £12,400 outstanding". A signal you
 *   cannot verify from its own text is a signal you learn to dismiss.
 * - **No signal fires twice for the same fact.** An invoice that is both
 *   overdue and pushing an account over its credit limit produces the credit
 *   signal, not both.
 * - **Nothing is invented.** Where a figure needs an FX rate that isn't set,
 *   the signal says the rate is missing instead of guessing at parity.
 * - **Severity is about consequence, not recency.** Money at risk and
 *   compliance lapses outrank a quotation that has gone quiet.
 */

import { documentExpiry } from "@/lib/documents";
import { creditBook, type CreditInput, type CreditPosition } from "@/lib/credit";
import { priceCurves, priceMoves } from "@/lib/priceIndex";
import { documentMargin, type MarginContext } from "@/lib/margin";
import { staleRates, type FxTable } from "@/lib/fx";
import { responseStats, unlinkedCorrespondents } from "@/lib/commsAnalytics";
import { fulfilmentState } from "@/lib/fulfilment";
import type {
  Communication,
  Contact,
  Customer,
  Delivery,
  Document,
  Invoice,
  KycRecord,
  Order,
  PricingRecord,
  Product,
  Quotation,
  Supplier,
} from "@/lib/domain";

export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export type SignalKind =
  | "receivable"
  | "credit"
  | "margin"
  | "price"
  | "compliance"
  | "fulfilment"
  | "pipeline"
  | "relationship"
  | "data";

export const KIND_LABELS: Record<SignalKind, string> = {
  receivable: "Cash collection",
  credit: "Credit control",
  margin: "Margin",
  price: "Price movement",
  compliance: "Compliance",
  fulfilment: "Fulfilment",
  pipeline: "Pipeline",
  relationship: "Relationships",
  data: "Data quality",
};

/** Where tapping a signal should land. Mirrors `AppSection` without importing it. */
export type SignalTarget =
  | "invoices"
  | "payments"
  | "customers"
  | "suppliers"
  | "quotations"
  | "orders"
  | "products"
  | "pricing"
  | "kyc"
  | "documents"
  | "email"
  | "contacts"
  | "dealdesk"
  | "credit"
  | "priceintel"
  | "settings";

export interface Signal {
  id: string;
  kind: SignalKind;
  severity: Severity;
  /** One line, imperative where possible. */
  title: string;
  /** The evidence: figures, references, dates. */
  detail: string;
  /** What to do about it. */
  action?: string;
  target: SignalTarget;
  recordId?: string;
  /** Money at stake, in the reporting currency, where the signal is financial. */
  amount?: number;
  currency?: string;
  /** Used for ordering inside a severity band — bigger is more urgent. */
  weight: number;
}

export interface SignalInput {
  customers: Customer[];
  suppliers: Supplier[];
  products: Product[];
  invoices: Invoice[];
  orders: Order[];
  quotations: Quotation[];
  deliveries: Delivery[];
  payments: import("@/lib/domain").Payment[];
  pricingRecords: PricingRecord[];
  kycRecords: KycRecord[];
  documents: Document[];
  communications: Communication[];
  contacts: Contact[];
  /** Domains the company owns, so its own addresses are not proposed as leads. */
  ownDomains?: string[];
  fx: FxTable;
  reportingCurrency: string;
  marginFloorPct: number;
  documentExpiryWarningDays: number;
  followUpReminderDays: number;
  now?: Date;
}

const dayMs = 86_400_000;
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const daysBetween = (from: string, to: Date): number =>
  Math.floor((to.getTime() - new Date(from).getTime()) / dayMs);

const money = (amount: number, currency: string): string =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);

const invoiceBalance = (invoice: Invoice): number =>
  Math.max(0, invoice.total - (invoice.amountPaid ?? 0));

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

function receivableSignals(input: SignalInput, now: Date): Signal[] {
  return input.invoices
    .filter(
      (i) =>
        ["issued", "overdue", "partial"].includes(i.status) &&
        i.dueAt &&
        new Date(i.dueAt).getTime() < now.getTime() &&
        invoiceBalance(i) > 0,
    )
    .map((invoice) => {
      const late = daysBetween(invoice.dueAt!, now);
      const balance = round2(invoiceBalance(invoice));
      const customer = input.customers.find((c) => c.id === invoice.customerId);
      const severity: Severity = late >= 60 ? "critical" : late >= 30 ? "high" : "medium";
      return {
        id: `receivable:${invoice.id}`,
        kind: "receivable" as SignalKind,
        severity,
        title: `${invoice.number} is ${late} days past due`,
        detail: `${money(balance, invoice.currency)} outstanding from ${
          customer?.name ?? "an unknown account"
        }${invoice.status === "partial" ? ", part paid" : ""}.`,
        action: late >= 30 ? "Escalate — call, then hold further shipments." : "Send a reminder.",
        target: "invoices" as SignalTarget,
        recordId: invoice.id,
        amount: balance,
        currency: invoice.currency,
        weight: balance * (1 + late / 30),
      };
    });
}

function creditSignals(positions: CreditPosition[]): Signal[] {
  return positions
    .filter((p) => p.band === "stop" || p.band === "strained")
    .map((position) => ({
      id: `credit:${position.customerId}`,
      kind: "credit" as SignalKind,
      severity: (position.band === "stop" ? "critical" : "high") as Severity,
      title:
        position.band === "stop"
          ? `Hold new orders for ${position.customerName}`
          : `${position.customerName} is close to its credit ceiling`,
      detail: `${position.reason} Total exposure ${money(position.exposure, position.currency)}${
        position.creditLimit
          ? ` against a ${money(position.creditLimit, position.currency)} limit`
          : ""
      }.`,
      action:
        position.band === "stop"
          ? "Review the account before confirming anything further."
          : "Agree a higher limit or collect before the next order.",
      target: "credit" as SignalTarget,
      recordId: position.customerId,
      amount: position.exposure,
      currency: position.currency,
      weight: position.exposure * (position.band === "stop" ? 2 : 1),
    }));
}

function marginSignals(input: SignalInput, now: Date): Signal[] {
  const ctx: MarginContext = {
    pricingRecords: input.pricingRecords,
    products: input.products,
    fx: input.fx,
    floorPct: input.marginFloorPct,
    now,
  };
  const signals: Signal[] = [];

  // Live paper only. Flagging the margin on an invoice already issued is
  // hindsight; flagging it on a quotation still in play is a decision.
  const live = input.quotations.filter((q) => ["draft", "sent", "viewed"].includes(q.status));
  for (const quotation of live) {
    const margin = documentMargin(quotation, ctx);
    if (margin.marginPct === null) continue;
    if (margin.marginPct >= input.marginFloorPct) continue;
    const customer = input.customers.find((c) => c.id === quotation.customerId);
    signals.push({
      id: `margin:${quotation.id}`,
      kind: "margin",
      severity: margin.marginPct < 0 ? "critical" : "high",
      title:
        margin.marginPct < 0
          ? `${quotation.number} is quoted below cost`
          : `${quotation.number} is below the ${input.marginFloorPct}% margin floor`,
      detail: `${margin.marginPct}% on ${money(margin.revenue, margin.currency)} to ${
        customer?.name ?? "an unknown account"
      }, costed from ${
        margin.confidence === "measured" ? "live supplier offers" : "partial cost data"
      }.`,
      action: "Re-price, or record the reason for accepting the margin.",
      target: "dealdesk",
      recordId: quotation.id,
      amount: margin.revenue,
      currency: margin.currency,
      weight: margin.revenue * (margin.marginPct < 0 ? 3 : 1.5),
    });
  }
  return signals;
}

function priceSignals(input: SignalInput, now: Date): Signal[] {
  const curves = priceCurves(input.products, input.pricingRecords, input.fx, {
    currency: input.reportingCurrency,
    windowDays: 90,
    now,
  });
  return priceMoves(curves, 5).map((move) => ({
    id: `price:${move.productId}`,
    kind: "price" as SignalKind,
    severity: (Math.abs(move.changePct) >= 12 ? "high" : "medium") as Severity,
    title: `${move.productName} ${move.direction === "rising" ? "up" : "down"} ${Math.abs(
      move.changePct,
    )}% over ${move.windowDays} days`,
    detail: `${money(move.from, move.currency)} → ${money(move.to, move.currency)} per unit.${
      move.alternative
        ? ` ${move.alternative.supplierName} is currently ${move.alternative.savingPct}% cheaper.`
        : ""
    }`,
    action:
      move.direction === "rising"
        ? "Re-check open quotations priced off the older cost."
        : "Consider re-pricing to win volume.",
    target: "priceintel" as SignalTarget,
    recordId: move.productId,
    weight: Math.abs(move.changePct) * 100,
  }));
}

function complianceSignals(input: SignalInput, now: Date): Signal[] {
  const signals: Signal[] = [];

  for (const document of input.documents) {
    const expiry = documentExpiry(document, input.documentExpiryWarningDays, now);
    if (expiry.state !== "expired" && expiry.state !== "expiring") continue;
    const owner =
      input.customers.find((c) => c.id === document.customerId)?.name ??
      input.suppliers.find((s) => s.id === document.supplierId)?.name;
    signals.push({
      id: `document:${document.id}`,
      kind: "compliance",
      severity: expiry.state === "expired" ? "high" : "medium",
      title:
        expiry.state === "expired"
          ? `${document.name} has expired`
          : `${document.name} expires in ${expiry.daysRemaining} days`,
      detail: `${document.type} document${owner ? ` held against ${owner}` : ""}${
        document.reference ? `, reference ${document.reference}` : ""
      }.`,
      action: "Request a replacement before it blocks a shipment.",
      target: "documents",
      recordId: document.id,
      weight: expiry.state === "expired" ? 900 : 400 - (expiry.daysRemaining ?? 0),
    });
  }

  for (const kyc of input.kycRecords) {
    const customer = input.customers.find((c) => c.id === kyc.customerId);
    const waiting = ["submitted", "under_review"].includes(kyc.status);
    const stalled = kyc.status === "sent" && kyc.sentAt && daysBetween(kyc.sentAt, now) >= 7;
    if (!waiting && !stalled) continue;
    signals.push({
      id: `kyc:${kyc.id}`,
      kind: "compliance",
      severity: waiting ? "high" : "medium",
      title: waiting
        ? `KYC awaiting your review — ${customer?.name ?? "unknown account"}`
        : `KYC pack unanswered by ${customer?.name ?? "unknown account"}`,
      detail: waiting
        ? "The customer has submitted their pack; onboarding is blocked until it is reviewed."
        : `Sent ${daysBetween(kyc.sentAt!, now)} days ago with no submission.`,
      action: waiting ? "Review and decide." : "Chase the contact.",
      target: "kyc",
      recordId: kyc.id,
      weight: waiting ? 700 : 300,
    });
  }

  // Trading with an account that has never cleared KYC is a compliance
  // exposure, not a paperwork nicety, so it is surfaced against the order.
  for (const order of input.orders) {
    if (!["confirmed", "in_progress", "shipped"].includes(order.status)) continue;
    const customer = input.customers.find((c) => c.id === order.customerId);
    if (!customer || customer.kycStatus === "approved") continue;
    signals.push({
      id: `kycorder:${order.id}`,
      kind: "compliance",
      severity: "high",
      title: `${order.number} is live against un-cleared KYC`,
      detail: `${customer.name} is at KYC status "${customer.kycStatus}" while an order worth ${money(
        order.total,
        order.currency,
      )} is in progress.`,
      action: "Clear KYC or pause the order.",
      target: "kyc",
      recordId: customer.id,
      amount: order.total,
      currency: order.currency,
      weight: order.total,
    });
  }

  return signals;
}

function fulfilmentSignals(input: SignalInput, now: Date): Signal[] {
  const signals: Signal[] = [];
  for (const order of input.orders) {
    if (!["confirmed", "in_progress"].includes(order.status)) continue;
    const state = fulfilmentState(order, input.deliveries);
    if (!order.deliveryDate) continue;
    const late = daysBetween(order.deliveryDate, now);
    if (late <= 0 || state === "delivered") continue;
    const customer = input.customers.find((c) => c.id === order.customerId);
    signals.push({
      id: `fulfilment:${order.id}`,
      kind: "fulfilment",
      severity: late >= 14 ? "high" : "medium",
      title: `${order.number} is ${late} days past its delivery date`,
      detail: `${state === "part_delivered" ? "Part despatched" : "Nothing despatched"} for ${
        customer?.name ?? "an unknown account"
      } — ${money(order.total, order.currency)}.`,
      action: "Confirm a revised date with the customer.",
      target: "orders",
      recordId: order.id,
      amount: order.total,
      currency: order.currency,
      weight: order.total * (1 + late / 14),
    });
  }

  // Delivered and uninvoiced is money sitting on the warehouse floor.
  const invoicedOrders = new Set(
    input.invoices.filter((i) => i.orderId).map((i) => i.orderId as string),
  );
  for (const order of input.orders) {
    if (order.status !== "delivered" || invoicedOrders.has(order.id)) continue;
    signals.push({
      id: `uninvoiced:${order.id}`,
      kind: "receivable",
      severity: "high",
      title: `${order.number} is delivered but not invoiced`,
      detail: `${money(order.total, order.currency)} of goods has shipped with no invoice raised.`,
      action: "Raise the invoice — the clock on payment has not started.",
      target: "orders",
      recordId: order.id,
      amount: order.total,
      currency: order.currency,
      weight: order.total * 1.5,
    });
  }
  return signals;
}

function pipelineSignals(input: SignalInput, now: Date): Signal[] {
  const signals: Signal[] = [];

  for (const quotation of input.quotations) {
    if (!["sent", "viewed"].includes(quotation.status)) continue;

    if (quotation.validUntil) {
      const daysLeft = -daysBetween(quotation.validUntil, now);
      if (daysLeft >= 0 && daysLeft <= 7) {
        const customer = input.customers.find((c) => c.id === quotation.customerId);
        signals.push({
          id: `expiring:${quotation.id}`,
          kind: "pipeline",
          severity: daysLeft <= 2 ? "high" : "medium",
          title: `${quotation.number} expires ${daysLeft === 0 ? "today" : `in ${daysLeft} days`}`,
          detail: `${money(quotation.total, quotation.currency)} to ${
            customer?.name ?? "an unknown account"
          }, still open.`,
          action: "Close it, extend it, or let it lapse deliberately.",
          target: "quotations",
          recordId: quotation.id,
          amount: quotation.total,
          currency: quotation.currency,
          weight: quotation.total * 1.2,
        });
        continue;
      }
    }

    const reference = quotation.sentAt ?? quotation.createdAt;
    const quiet = daysBetween(reference, now);
    if (quiet >= input.followUpReminderDays) {
      const lastContact = input.communications
        .filter((c) => c.customerId === quotation.customerId)
        .reduce<string | null>(
          (latest, c) => (!latest || c.occurredAt > latest ? c.occurredAt : latest),
          null,
        );
      const silence = lastContact ? daysBetween(lastContact, now) : quiet;
      if (silence < input.followUpReminderDays) continue;
      const customer = input.customers.find((c) => c.id === quotation.customerId);
      signals.push({
        id: `followup:${quotation.id}`,
        kind: "pipeline",
        severity: "medium",
        title: `${quotation.number} has gone quiet`,
        detail: `Sent ${quiet} days ago to ${
          customer?.name ?? "an unknown account"
        }; no contact on the account for ${silence} days. ${money(
          quotation.total,
          quotation.currency,
        )} at stake.`,
        action: "Follow up.",
        target: "quotations",
        recordId: quotation.id,
        amount: quotation.total,
        currency: quotation.currency,
        weight: quotation.total,
      });
    }
  }

  const pending = input.pricingRecords.filter((r) => r.status === "pending_review");
  if (pending.length) {
    signals.push({
      id: "pricing:queue",
      kind: "pipeline",
      severity: pending.length >= 3 ? "high" : "medium",
      title: `${pending.length} supplier offer${pending.length === 1 ? "" : "s"} awaiting approval`,
      detail: `Extracted from correspondence and held for a human decision — nothing is priced off them until approved.`,
      action: "Review the queue.",
      target: "pricing",
      weight: 250 + pending.length * 50,
    });
  }

  return signals;
}

function relationshipSignals(input: SignalInput, now: Date): Signal[] {
  const signals: Signal[] = [];
  // Dormancy is only interesting on accounts that have actually traded. A lead
  // that has never ordered is a pipeline question, not a lapsed relationship.
  for (const customer of input.customers) {
    if (customer.status !== "active" || !customer.lastOrderAt) continue;
    const quiet = daysBetween(customer.lastOrderAt, now);
    if (quiet < 120) continue;
    signals.push({
      id: `dormant:${customer.id}`,
      kind: "relationship",
      severity: (customer.totalRevenue ?? 0) > 50_000 ? "high" : "low",
      title: `${customer.name} has not ordered in ${quiet} days`,
      detail: `Marked active, lifetime revenue ${money(
        customer.totalRevenue ?? 0,
        customer.currency,
      )}. Last order ${new Date(customer.lastOrderAt).toLocaleDateString("en-GB")}.`,
      action: "Reconnect, or move the account to inactive so the book stays honest.",
      target: "customers",
      recordId: customer.id,
      weight: customer.totalRevenue ?? 0,
    });
  }
  return signals;
}

/**
 * Correspondence signals.
 *
 * Requirement 1 asked the CRM to build the contact database from
 * correspondence, and requirement 2 asked it to chase what has gone unanswered.
 * Both are questions about the mailbox that the mailbox itself cannot ask,
 * because neither is visible from inside a single message.
 */
function correspondenceSignals(input: SignalInput, now: Date): Signal[] {
  const signals: Signal[] = [];

  const stats = responseStats(input.communications, input.customers, input.suppliers, now);
  for (const row of stats) {
    // Two days is the threshold: anything shorter is a normal working rhythm,
    // and a signal that fires the morning after every email is furniture.
    if (!row.outstanding || (row.oldestOutstandingHours ?? 0) < 48) continue;
    const hours = row.oldestOutstandingHours ?? 0;
    const days = Math.floor(hours / 24);
    signals.push({
      id: `unanswered:${row.entityType}:${row.entityId}`,
      kind: "pipeline",
      severity: days >= 5 ? "high" : "medium",
      title: `${row.name} has been waiting ${days} day${days === 1 ? "" : "s"} for a reply`,
      detail: `${row.outstanding} inbound message${
        row.outstanding === 1 ? "" : "s"
      } unanswered${
        row.medianHours !== null
          ? `, against a usual reply time of ${Math.round(row.medianHours)} hours on this account`
          : ""
      }.`,
      action: "Reply, or file the thread if it needs nothing.",
      target: "email",
      recordId: row.entityId,
      weight: hours * 4,
    });
  }

  const strangers = unlinkedCorrespondents(
    input.communications,
    input.contacts,
    input.customers,
    input.suppliers,
    input.ownDomains ?? [],
  );
  if (strangers.length) {
    signals.push({
      id: "contacts:unlinked",
      kind: "data",
      severity: "low",
      title: `${strangers.length} correspondent${
        strangers.length === 1 ? "" : "s"
      } not in the contact database`,
      detail: `${strangers
        .slice(0, 3)
        .map((person) => person.name || person.address)
        .join(", ")}${
        strangers.length > 3 ? ` and ${strangers.length - 3} more` : ""
      } have emailed and exist nowhere in Contacts.`,
      action: "Review and add the ones worth keeping.",
      target: "contacts",
      weight: 100 + strangers.length * 5,
    });
  }

  return signals;
}

function dataSignals(input: SignalInput, now: Date): Signal[] {
  const signals: Signal[] = [];

  const stale = staleRates(input.fx, now);
  if (stale.length) {
    signals.push({
      id: "fx:stale",
      kind: "data",
      severity: "medium",
      title: `${stale.length} exchange rate${stale.length === 1 ? "" : "s"} out of date`,
      detail: `${stale
        .map((r) => r.currency)
        .join(", ")} last confirmed over a month ago. Every converted figure inherits that age.`,
      action: "Update the rate table.",
      target: "settings",
      weight: 200,
    });
  }

  const noLimit = input.customers.filter(
    (c) => (c.status === "active" || c.status === "onboarding") && !c.creditLimit,
  );
  if (noLimit.length) {
    signals.push({
      id: "credit:nolimit",
      kind: "data",
      severity: "low",
      title: `${noLimit.length} trading account${
        noLimit.length === 1 ? " has" : "s have"
      } no credit limit`,
      detail: `Exposure on ${noLimit
        .slice(0, 3)
        .map((c) => c.name)
        .join(", ")}${noLimit.length > 3 ? ` and ${noLimit.length - 3} more` : ""} is uncontrolled.`,
      action: "Set limits so the credit checks can do their job.",
      target: "credit",
      weight: 120,
    });
  }

  const uncosted = input.products.filter((p) => p.isActive && !p.purchasePrice);
  if (uncosted.length) {
    signals.push({
      id: "product:uncosted",
      kind: "data",
      severity: "low",
      title: `${uncosted.length} active product${
        uncosted.length === 1 ? " has" : "s have"
      } no purchase cost`,
      detail: "Margin cannot be measured on any line quoting these, only estimated.",
      action: "Add a cost, or link an approved supplier offer.",
      target: "products",
      weight: 90,
    });
  }

  const flagged = input.communications.filter((c) => c.isFlagged && c.folder !== "archive");
  if (flagged.length) {
    signals.push({
      id: "mail:flagged",
      kind: "pipeline",
      severity: "low",
      title: `${flagged.length} message${flagged.length === 1 ? "" : "s"} flagged for follow-up`,
      detail: "Marked by you in the mailbox and not yet dealt with.",
      action: "Clear the follow-up list.",
      target: "email",
      weight: 80,
    });
  }

  return signals;
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

export function buildSignals(input: SignalInput): Signal[] {
  const now = input.now ?? new Date();

  const creditInput: CreditInput = {
    customers: input.customers,
    invoices: input.invoices,
    orders: input.orders,
    quotations: input.quotations,
    payments: input.payments,
    fx: input.fx,
    reportingCurrency: input.reportingCurrency,
    now,
  };
  const positions = creditBook(creditInput);

  const signals = [
    ...receivableSignals(input, now),
    ...creditSignals(positions),
    ...marginSignals(input, now),
    ...priceSignals(input, now),
    ...complianceSignals(input, now),
    ...fulfilmentSignals(input, now),
    ...pipelineSignals(input, now),
    ...relationshipSignals(input, now),
    ...correspondenceSignals(input, now),
    ...dataSignals(input, now),
  ];

  // Suppress the receivable signal where the same invoice is already the reason
  // an account is on stop: two rows about one late invoice reads as noise and
  // trains the user to skim.
  const stopped = new Set(
    positions.filter((p) => p.band === "stop").map((p) => p.customerId),
  );
  const deduped = signals.filter((signal) => {
    if (signal.kind !== "receivable" || !signal.recordId) return true;
    const invoice = input.invoices.find((i) => i.id === signal.recordId);
    return !invoice || !stopped.has(invoice.customerId);
  });

  return deduped.sort((a, b) => {
    const bySeverity =
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    return bySeverity !== 0 ? bySeverity : b.weight - a.weight;
  });
}

export interface SignalSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  /** Money explicitly at stake across financial signals. */
  valueAtStake: number;
  currency: string;
  byKind: { kind: SignalKind; count: number }[];
}

export function summariseSignals(
  signals: Signal[],
  reportingCurrency: string,
): SignalSummary {
  const counts = new Map<SignalKind, number>();
  for (const signal of signals) {
    counts.set(signal.kind, (counts.get(signal.kind) ?? 0) + 1);
  }
  const atStake = signals
    .filter(
      (s) =>
        s.amount !== undefined &&
        s.currency === reportingCurrency &&
        (s.kind === "receivable" || s.kind === "credit"),
    )
    .reduce((sum, s) => sum + (s.amount ?? 0), 0);

  return {
    total: signals.length,
    critical: signals.filter((s) => s.severity === "critical").length,
    high: signals.filter((s) => s.severity === "high").length,
    medium: signals.filter((s) => s.severity === "medium").length,
    low: signals.filter((s) => s.severity === "low").length,
    valueAtStake: round2(atStake),
    currency: reportingCurrency,
    byKind: [...counts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * The morning brief as plain text, for pasting into an email or a WhatsApp
 * group. Deliberately plain: it has to survive being pasted anywhere.
 */
export function briefText(signals: Signal[], now: Date = new Date()): string {
  const header = `Renso Group — morning brief, ${now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })}`;
  if (!signals.length) {
    return `${header}\n\nNothing needs attention. No overdue invoices, no expiring paperwork, no quotations past their follow-up date.`;
  }
  const lines = signals.slice(0, 12).map((signal, index) => {
    const detail = signal.action ? ` ${signal.action}` : "";
    return `${index + 1}. [${signal.severity.toUpperCase()}] ${signal.title}\n   ${
      signal.detail
    }${detail}`;
  });
  const more = signals.length > 12 ? `\n\n+ ${signals.length - 12} lower-priority items.` : "";
  return `${header}\n\n${lines.join("\n")}${more}`;
}
