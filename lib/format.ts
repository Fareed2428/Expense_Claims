/**
 * Small display-formatting helpers shared across the Staff UI. Pure
 * functions only — no business rules here (those stay in claim-service.ts
 * and friends); this file just decides how a number/date/enum *looks*.
 */

const INR_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return INR_FORMATTER.format(amount);
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Formats an expense date (stored as a date-only value) without a time-of-day component. */
export function formatDate(date: string | Date): string {
  return DATE_FORMATTER.format(new Date(date));
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Formats a real timestamp (e.g. a ClaimEvent's createdAt), with time of day. */
export function formatDateTime(date: string | Date): string {
  return DATE_TIME_FORMATTER.format(new Date(date));
}

export const CATEGORY_LABEL: Record<string, string> = {
  TRAVEL: "Travel",
  MEALS: "Meals",
  SUPPLIES: "Supplies",
  TAXI: "Taxi",
  OTHER: "Other",
};

export const STATUS_LABEL: Record<string, string> = {
  PARSED: "Draft",
  SUBMITTED: "Awaiting review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PAID: "Paid",
};

export const EVENT_LABEL: Record<string, string> = {
  CREATED: "Claim created",
  PARSED: "Receipt parsed",
  EDITED: "Details corrected",
  SUBMITTED: "Submitted for review",
  DUPLICATE_FLAGGED: "Flagged as a possible duplicate",
  DUPLICATE_ACKNOWLEDGED: "Duplicate warning acknowledged by Finance",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PAID: "Marked as paid",
};
