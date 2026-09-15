/**
 * Renso Group CRM — formatting helpers (English / en-GB).
 */

const nbsp = "\u00A0";

export const money = (amount: number, currency = "GBP"): string => {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const moneyExact = (amount: number, currency = "GBP"): string => {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const decimal = (value: number): string => {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 0.01) return `${rounded}`;
  return value.toFixed(1);
};

export const quantity = (value: number, unit: string): string =>
  `${decimal(value)} ${unit}`;

export const time = (value: string | Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value instanceof Date ? value : new Date(value));

export const shortDate = (value: string | Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value instanceof Date ? value : new Date(value));

export const longDate = (value: string | Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value instanceof Date ? value : new Date(value));

export const relativeDay = (value: string | Date): string => {
  const d = value instanceof Date ? value : new Date(value);
  const now = new Date();
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return `In ${diff} days`;
  if (diff < -1 && diff > -7) return `${Math.abs(diff)} days ago`;
  return shortDate(d);
};
