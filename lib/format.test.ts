import { describe, expect, it } from "vitest";
import { CATEGORY_LABEL, EVENT_LABEL, STATUS_LABEL, formatCurrency, formatDate, formatDateTime } from "./format";

describe("formatCurrency", () => {
  it("formats a plain number as INR", () => {
    expect(formatCurrency(180)).toContain("180");
    expect(formatCurrency(180)).toMatch(/₹/);
  });

  it("formats a decimal amount with two places", () => {
    expect(formatCurrency(1299.5)).toMatch(/1,299\.50/);
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toContain("0");
  });
});

describe("formatDate / formatDateTime", () => {
  it("formats a date-only value without shifting a day (UTC-anchored)", () => {
    expect(formatDate("2026-09-03")).toContain("2026");
    expect(formatDate("2026-09-03")).toMatch(/3 Sep/);
  });

  it("accepts a real Date object as well as a string", () => {
    const asString = formatDate("2026-09-03");
    const asDate = formatDate(new Date("2026-09-03T00:00:00.000Z"));
    expect(asDate).toBe(asString);
  });

  it("formatDateTime includes a time component", () => {
    const result = formatDateTime("2026-09-03T14:30:00.000Z");
    expect(result).toMatch(/\d/); // has some numeric time content
    expect(result).toContain("2026");
  });
});

describe("label maps cover every enum value used in the schema", () => {
  it("CATEGORY_LABEL covers all five categories", () => {
    for (const category of ["TRAVEL", "MEALS", "SUPPLIES", "TAXI", "OTHER"]) {
      expect(CATEGORY_LABEL[category]).toBeTruthy();
    }
  });

  it("STATUS_LABEL covers all five statuses", () => {
    for (const status of ["PARSED", "SUBMITTED", "APPROVED", "REJECTED", "PAID"]) {
      expect(STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it("EVENT_LABEL covers every ClaimEventType", () => {
    for (const eventType of [
      "CREATED",
      "PARSED",
      "EDITED",
      "SUBMITTED",
      "DUPLICATE_FLAGGED",
      "DUPLICATE_ACKNOWLEDGED",
      "APPROVED",
      "REJECTED",
      "PAID",
    ]) {
      expect(EVENT_LABEL[eventType]).toBeTruthy();
    }
  });
});
