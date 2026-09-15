/**
 * Renso Group CRM — document expiry tracking.
 *
 * Expiry is derived, never stored: a document's state is a function of
 * `expiresAt` and the current date, so it can't go stale the way a persisted
 * "expired" flag would when nobody runs a nightly job.
 */

import type { Document } from "./domain";

export type ExpiryState = "none" | "valid" | "expiring" | "expired";

export interface ExpiryInfo {
  state: ExpiryState;
  /** Whole days until expiry; negative once expired. `null` when no expiry is set. */
  daysRemaining: number | null;
}

export const EXPIRY_LABELS: Record<ExpiryState, string> = {
  none: "No expiry",
  valid: "Valid",
  expiring: "Expiring",
  expired: "Expired",
};

const DAY = 86400000;

/** Whole days between two instants, counting calendar days rather than 24h blocks. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY);
}

/**
 * Classify a single document.
 *
 * `warningDays` comes from CRM settings so the threshold is a business decision
 * rather than a constant buried in a component.
 */
export function documentExpiry(
  doc: Pick<Document, "expiresAt">,
  warningDays = 30,
  now: Date = new Date(),
): ExpiryInfo {
  if (!doc.expiresAt) return { state: "none", daysRemaining: null };
  const expires = new Date(doc.expiresAt);
  if (Number.isNaN(expires.getTime())) return { state: "none", daysRemaining: null };

  const daysRemaining = daysBetween(now, expires);
  if (daysRemaining < 0) return { state: "expired", daysRemaining };
  if (daysRemaining <= Math.max(0, warningDays)) return { state: "expiring", daysRemaining };
  return { state: "valid", daysRemaining };
}

/**
 * Documents needing attention, soonest first. Already-expired documents sort
 * ahead of merely expiring ones because they are the more urgent problem.
 */
export function documentsNeedingAttention<T extends Pick<Document, "expiresAt">>(
  docs: T[],
  warningDays = 30,
  now: Date = new Date(),
): { document: T; expiry: ExpiryInfo }[] {
  return docs
    .map((document) => ({ document, expiry: documentExpiry(document, warningDays, now) }))
    .filter((entry) => entry.expiry.state === "expired" || entry.expiry.state === "expiring")
    .sort((a, b) => (a.expiry.daysRemaining ?? 0) - (b.expiry.daysRemaining ?? 0));
}

/** Human-readable countdown for a document row. */
export function expiryLabel(info: ExpiryInfo): string {
  if (info.state === "none" || info.daysRemaining == null) return EXPIRY_LABELS.none;
  if (info.state === "expired") {
    const days = Math.abs(info.daysRemaining);
    return days === 0 ? "Expires today" : `Expired ${days} day${days === 1 ? "" : "s"} ago`;
  }
  if (info.daysRemaining === 0) return "Expires today";
  return `${info.daysRemaining} day${info.daysRemaining === 1 ? "" : "s"} left`;
}
