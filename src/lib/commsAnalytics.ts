/**
 * Renso Group CRM — communication analytics.
 *
 * Requirement 1 asks the CRM to build the contact database out of
 * correspondence. Requirement 8 asks, "if possible", to track communication
 * activity — emails sent, calls made. Both were half-answered: the mailbox and
 * the timeline existed, but nothing read *across* them.
 *
 * This module does three jobs:
 *
 * 1. **Activity** — what was sent and received, by day and by channel, so the
 *    dashboard can show whether the desk is actually talking to anyone.
 * 2. **Responsiveness** — how long inbound messages wait for a reply, measured
 *    per account from the real timestamps. This is the metric that tells a
 *    sales director something they cannot get from a revenue chart.
 * 3. **Unlinked correspondents** — addresses the company has exchanged mail
 *    with that exist nowhere in the contact database, surfaced as candidates.
 *    That is requirement 1's "automatically create and maintain a centralised
 *    contact database", made reviewable instead of automatic: creating records
 *    from every address that ever emailed would fill the CRM with couriers,
 *    newsletters and no-reply robots.
 */

import type { Communication, Contact, Customer, Supplier } from "@/lib/domain";

const dayMs = 86_400_000;
const hourMs = 3_600_000;

export interface ActivityDay {
  /** ISO date, midnight. */
  date: string;
  sent: number;
  received: number;
  calls: number;
  total: number;
}

export interface ChannelSplit {
  channel: string;
  sent: number;
  received: number;
  total: number;
}

export interface ActivitySummary {
  days: ActivityDay[];
  channels: ChannelSplit[];
  sent: number;
  received: number;
  calls: number;
  /** Busiest single day in the window. */
  peak: ActivityDay | null;
  /** Mean messages per active day — a truer read than dividing by the window. */
  perActiveDay: number;
  activeDays: number;
  windowDays: number;
}

const startOfDay = (value: string | Date): string => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

/** Day-by-day activity over a trailing window, ready for a calendar heatmap. */
export function activitySummary(
  communications: Communication[],
  windowDays = 84,
  now: Date = new Date(),
): ActivitySummary {
  const cutoff = now.getTime() - (windowDays - 1) * dayMs;

  const buckets = new Map<string, ActivityDay>();
  // Every day in the window is seeded, including the empty ones. A heatmap
  // drawn only from days that had traffic hides exactly what it should show.
  for (let i = 0; i < windowDays; i += 1) {
    const date = startOfDay(new Date(now.getTime() - i * dayMs));
    buckets.set(date, { date, sent: 0, received: 0, calls: 0, total: 0 });
  }

  const channels = new Map<string, ChannelSplit>();
  let sent = 0;
  let received = 0;
  let calls = 0;

  for (const message of communications) {
    const at = new Date(message.occurredAt).getTime();
    if (!Number.isFinite(at) || at < cutoff || at > now.getTime()) continue;

    const key = startOfDay(message.occurredAt);
    const bucket = buckets.get(key);
    const inbound = message.direction === "inbound";

    const split = channels.get(message.channel) ?? {
      channel: message.channel,
      sent: 0,
      received: 0,
      total: 0,
    };
    split.total += 1;
    if (inbound) split.received += 1;
    else split.sent += 1;
    channels.set(message.channel, split);

    if (message.channel === "call") calls += 1;
    if (inbound) received += 1;
    else sent += 1;

    if (bucket) {
      bucket.total += 1;
      if (message.channel === "call") bucket.calls += 1;
      if (inbound) bucket.received += 1;
      else bucket.sent += 1;
    }
  }

  const days = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  const active = days.filter((d) => d.total > 0);
  const peak = active.length
    ? active.reduce((a, b) => (b.total > a.total ? b : a))
    : null;

  return {
    days,
    channels: [...channels.values()].sort((a, b) => b.total - a.total),
    sent,
    received,
    calls,
    peak,
    perActiveDay: active.length
      ? Math.round(((sent + received) / active.length) * 10) / 10
      : 0,
    activeDays: active.length,
    windowDays,
  };
}

export interface ResponseStats {
  entityId: string;
  entityType: "customer" | "supplier";
  name: string;
  /** Inbound messages that received a reply. */
  answered: number;
  /** Inbound messages still unanswered. */
  outstanding: number;
  /** Median hours to reply. Median, not mean — one holiday skews a mean. */
  medianHours: number | null;
  /** Longest wait on an inbound message that is still unanswered. */
  oldestOutstandingHours: number | null;
  lastContactAt: string | null;
  /** Days since anyone spoke to this account either way. */
  silentDays: number | null;
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? Math.round(sorted[mid] * 10) / 10
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
};

/**
 * Reply latency per account.
 *
 * An inbound message counts as answered by the first outbound message to the
 * same account *after* it. Threading would be more precise, but most real
 * mailboxes thread badly and an account-level read is the one a sales director
 * acts on anyway.
 */
export function responseStats(
  communications: Communication[],
  customers: Customer[],
  suppliers: Supplier[],
  now: Date = new Date(),
): ResponseStats[] {
  const rows: ResponseStats[] = [];

  const analyse = (
    entityId: string,
    entityType: "customer" | "supplier",
    name: string,
  ): ResponseStats | null => {
    const thread = communications
      .filter((c) =>
        entityType === "customer" ? c.customerId === entityId : c.supplierId === entityId,
      )
      // Drafts have not been sent, so they cannot have answered anything.
      .filter((c) => c.folder !== "drafts")
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    if (!thread.length) return null;

    const outbound = thread.filter((c) => c.direction === "outbound");
    const latencies: number[] = [];
    let outstanding = 0;
    let oldest: number | null = null;

    for (const inbound of thread.filter((c) => c.direction === "inbound")) {
      const at = new Date(inbound.occurredAt).getTime();
      const reply = outbound.find((c) => new Date(c.occurredAt).getTime() > at);
      if (reply) {
        latencies.push((new Date(reply.occurredAt).getTime() - at) / hourMs);
      } else {
        outstanding += 1;
        const waited = (now.getTime() - at) / hourMs;
        if (oldest === null || waited > oldest) oldest = waited;
      }
    }

    const lastContactAt = thread[thread.length - 1].occurredAt;
    return {
      entityId,
      entityType,
      name,
      answered: latencies.length,
      outstanding,
      medianHours: median(latencies),
      oldestOutstandingHours: oldest === null ? null : Math.round(oldest),
      lastContactAt,
      silentDays: Math.floor((now.getTime() - new Date(lastContactAt).getTime()) / dayMs),
    };
  };

  for (const customer of customers) {
    const row = analyse(customer.id, "customer", customer.name);
    if (row) rows.push(row);
  }
  for (const supplier of suppliers) {
    const row = analyse(supplier.id, "supplier", supplier.name);
    if (row) rows.push(row);
  }

  // Slowest first: this list exists to be worked, not admired.
  return rows.sort(
    (a, b) =>
      (b.oldestOutstandingHours ?? -1) - (a.oldestOutstandingHours ?? -1) ||
      (b.medianHours ?? -1) - (a.medianHours ?? -1),
  );
}

export interface Correspondent {
  address: string;
  name?: string;
  messages: number;
  lastAt: string;
  /** Set when the message was already linked to an account. */
  linkedTo?: { type: "customer" | "supplier"; id: string; name: string };
}

/**
 * Addresses seen in correspondence that are not in the contact database.
 *
 * Automation stops short of creating the record on purpose. An inbox contains
 * couriers, banks, newsletters and no-reply robots, and a CRM that ingests all
 * of them becomes a mailing list nobody trusts. These are candidates for a
 * human to accept.
 */
export function unlinkedCorrespondents(
  communications: Communication[],
  contacts: Contact[],
  customers: Customer[],
  suppliers: Supplier[],
  ownDomains: string[] = [],
): Correspondent[] {
  const known = new Set(
    [
      ...contacts.map((c) => c.email),
      ...customers.map((c) => c.email),
      ...suppliers.map((s) => s.email),
    ]
      .filter(Boolean)
      .map((address) => (address as string).toLowerCase()),
  );

  const isOurs = (address: string): boolean =>
    ownDomains.some((domain) => address.toLowerCase().endsWith(domain.toLowerCase()));

  const map = new Map<string, Correspondent>();

  for (const message of communications) {
    if (message.direction !== "inbound" || !message.from) continue;
    const address = message.from.trim().toLowerCase();
    // Phone numbers arrive here from WhatsApp; they are not email contacts and
    // pretending otherwise produces records nobody can mail.
    if (!address.includes("@")) continue;
    if (known.has(address) || isOurs(address)) continue;

    const entry = map.get(address) ?? {
      address,
      name: message.fromName,
      messages: 0,
      lastAt: message.occurredAt,
    };
    entry.messages += 1;
    if (message.occurredAt > entry.lastAt) entry.lastAt = message.occurredAt;
    if (!entry.name && message.fromName) entry.name = message.fromName;

    // If the message itself is already filed against an account, say so — the
    // suggestion is then "add the person", not "work out who this is".
    if (!entry.linkedTo) {
      const customer = customers.find((c) => c.id === message.customerId);
      const supplier = suppliers.find((s) => s.id === message.supplierId);
      if (customer) entry.linkedTo = { type: "customer", id: customer.id, name: customer.name };
      else if (supplier) entry.linkedTo = { type: "supplier", id: supplier.id, name: supplier.name };
    }

    map.set(address, entry);
  }

  return [...map.values()].sort(
    (a, b) => b.messages - a.messages || b.lastAt.localeCompare(a.lastAt),
  );
}
