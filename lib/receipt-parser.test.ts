import { describe, expect, it } from "vitest";
import { normalizeReceiptText, parseReceiptText } from "./receipt-parser";

// Fixed "now" so every date-related assertion (missing-year assumptions,
// chrono's relative-date fallback) is deterministic regardless of when
// the test suite actually runs.
const NOW = new Date(2026, 8, 9, 12, 0, 0); // 9 September 2026

// ---------------------------------------------------------------------------
// 1–5: standard receipts for each of the main merchants/categories
// ---------------------------------------------------------------------------

describe("standard receipts", () => {
  it("1. parses a standard Uber receipt", () => {
    const r = parseReceiptText("Uber trip - MG Road to airport\nFare: Rs 350\n03 Sep", { now: NOW });
    expect(r.merchant).toBe("Uber");
    expect(r.category).toBe("TAXI");
    expect(r.amount).toBe(350);
    expect(r.currency).toBe("INR");
    expect(r.date).toEqual(new Date(2026, 8, 3, 12, 0, 0));
  });

  it("2. parses a standard Ola receipt", () => {
    const r = parseReceiptText("Ola cab - client site visit\nFare: Rs 610", { now: NOW });
    expect(r.merchant).toBe("Ola");
    expect(r.category).toBe("TAXI");
    expect(r.amount).toBe(610);
    expect(r.currency).toBe("INR");
  });

  it("3. parses a standard IRCTC receipt", () => {
    const r = parseReceiptText("IRCTC chennai blr 28/08 INR 1850", { now: NOW });
    expect(r.merchant).toBe("IRCTC");
    expect(r.category).toBe("TRAVEL");
    expect(r.amount).toBe(1850);
    expect(r.currency).toBe("INR");
    expect(r.date).toEqual(new Date(2026, 7, 28, 12, 0, 0));
  });

  it("4. parses a restaurant/meal receipt", () => {
    const r = parseReceiptText("Mainland China restaurant - client dinner\nAmount: Rs 6,200\nCovers: 5 guests", {
      now: NOW,
    });
    expect(r.category).toBe("MEALS");
    expect(r.amount).toBe(6200);
  });

  it("5. parses a supplies receipt", () => {
    const r = parseReceiptText("Staples - printer cartridges and paper\nTotal: Rs 2,400", { now: NOW });
    expect(r.merchant).toBe("Staples");
    expect(r.category).toBe("SUPPLIES");
    expect(r.amount).toBe(2400);
  });
});

// ---------------------------------------------------------------------------
// 6: currency formats
// ---------------------------------------------------------------------------

describe("currency formats", () => {
  it.each([
    ["₹220", 220],
    ["Rs 220", 220],
    ["Rs. 220", 220],
    ["INR 220", 220],
    ["220/-", 220],
  ])("recognizes %s as amount %d", (text, expected) => {
    const r = parseReceiptText(`Auto ride ${text}`, { now: NOW });
    expect(r.amount).toBe(expected);
    expect(r.currency).toBe("INR");
  });
});

// ---------------------------------------------------------------------------
// 7: amounts with commas
// ---------------------------------------------------------------------------

describe("amounts with thousands separators", () => {
  it("parses ₹1,299.50", () => {
    const r = parseReceiptText("Hotel bill total ₹1,299.50", { now: NOW });
    expect(r.amount).toBe(1299.5);
  });

  it("parses Rs 1,850", () => {
    const r = parseReceiptText("Train fare Rs 1,850", { now: NOW });
    expect(r.amount).toBe(1850);
  });
});

// ---------------------------------------------------------------------------
// 8: date formats
// ---------------------------------------------------------------------------

describe("date formats", () => {
  it("dd/mm (no year) — assumes current year, day-first", () => {
    const r = parseReceiptText("Ola cab 28/08 Rs 200", { now: NOW });
    expect(r.date).toEqual(new Date(2026, 7, 28, 12, 0, 0));
    expect(r.warnings.some((w) => w.includes("assumed 2026"))).toBe(true);
  });

  it("dd/mm/yyyy — explicit year, day-first, no assumption warning", () => {
    const r = parseReceiptText("Cab fare 03/09/2026 Rs 200", { now: NOW });
    expect(r.date).toEqual(new Date(2026, 8, 3, 12, 0, 0));
    expect(r.warnings.some((w) => w.includes("assumed"))).toBe(false);
  });

  it("dd Mon (day + short month name) — assumes current year", () => {
    const r = parseReceiptText("Cab fare 3 Sep Rs 200", { now: NOW });
    expect(r.date).toEqual(new Date(2026, 8, 3, 12, 0, 0));
  });

  it("yyyy-mm-dd (ISO)", () => {
    const r = parseReceiptText("Cab fare 2026-09-03 Rs 200", { now: NOW });
    expect(r.date).toEqual(new Date(2026, 8, 3, 12, 0, 0));
  });

  it("does not silently construct an impossible date (30 Feb)", () => {
    const r = parseReceiptText("Cab fare 30 Feb Rs 200", { now: NOW });
    expect(r.date).toBeNull();
    expect(r.warnings).toContain("Could not determine the expense date.");
  });
});

// ---------------------------------------------------------------------------
// 9–10: messy capitalization and spacing
// ---------------------------------------------------------------------------

describe("messy formatting", () => {
  it("9. handles inconsistent capitalization (OLA vs Ola vs ola)", () => {
    const upper = parseReceiptText("OLA - MG ROAD TO OFFICE - INR 180.00", { now: NOW });
    const lower = parseReceiptText("ola auto mg road to office rs 180", { now: NOW });
    expect(upper.merchant).toBe("Ola");
    expect(lower.merchant).toBe("Ola");
    expect(upper.category).toBe("TAXI");
    expect(lower.category).toBe("TAXI");
  });

  it("10. handles inconsistent/irregular spacing", () => {
    const r = parseReceiptText("uber   auto    chennai   220", { now: NOW });
    expect(r.merchant).toBe("Uber");
    expect(r.amount).toBe(220);
  });
});

// ---------------------------------------------------------------------------
// 11: multi-line receipts
// ---------------------------------------------------------------------------

describe("multi-line receipts", () => {
  it("11. parses a multi-line receipt", () => {
    const r = parseReceiptText(
      "Business lunch with client\nRestaurant: Spice Route\nAmount: Rs 1450\nGST included",
      { now: NOW }
    );
    expect(r.category).toBe("MEALS");
    expect(r.amount).toBe(1450);
    expect(r.description).not.toContain("\n");
  });
});

// ---------------------------------------------------------------------------
// 12: itemized amounts + final total
// ---------------------------------------------------------------------------

describe("itemized receipts with a final total", () => {
  it("12. prefers the final total over an individual item price", () => {
    const r = parseReceiptText(
      "cafe coffee day 2 cappuccino 1 sandwich total rs 340/-",
      { now: NOW }
    );
    expect(r.amount).toBe(340);
    expect(r.merchant).toBe("Cafe Coffee Day");
  });

  it("keeps item text intact in the description — a number+word item like '1 sandwich' must not be mistaken for a day+month-name date fragment and stripped", () => {
    const r = parseReceiptText(
      "cafe coffee day 2 cappuccino 1 sandwich total rs 340/-",
      { now: NOW }
    );
    expect(r.description).toContain("2 cappuccino");
    expect(r.description).toContain("1 sandwich");
  });

  it("prefers a 'Total:' line over an unrelated reference number", () => {
    const r = parseReceiptText(
      "IndiGo Airlines - Chennai to Mumbai\nBooking ref: 6E-2291\nFare: Rs 7,300",
      { now: NOW }
    );
    expect(r.amount).toBe(7300);
  });
});

// ---------------------------------------------------------------------------
// 13–14: missing date / missing amount
// ---------------------------------------------------------------------------

describe("missing fields", () => {
  it("13. returns null date with a warning when no date is present", () => {
    const r = parseReceiptText("Ola auto MG Road to office Rs 180", { now: NOW });
    expect(r.date).toBeNull();
    expect(r.warnings).toContain("Could not determine the expense date.");
  });

  it("14. returns null amount with a warning when no amount is present", () => {
    const r = parseReceiptText("Ola auto MG Road to office, 3 Sep", { now: NOW });
    expect(r.amount).toBeNull();
    expect(r.currency).toBeNull();
    expect(r.warnings).toContain("Could not determine the amount.");
  });
});

// ---------------------------------------------------------------------------
// 15: unknown merchant / category
// ---------------------------------------------------------------------------

describe("unknown merchant and category", () => {
  it("15. falls back to Other with a warning for unrecognized text", () => {
    const r = parseReceiptText("miscellaneous vendor charge 500", { now: NOW });
    expect(r.category).toBe("OTHER");
    expect(r.warnings).toContain("Category could not be confidently determined; defaulted to Other.");
  });

  it("still returns a conservative merchant guess rather than null when some text remains", () => {
    const r = parseReceiptText("courier charges for client documents 450", { now: NOW });
    expect(r.merchant).not.toBeNull();
    expect(r.warnings.some((w) => w.includes("could not be confidently identified"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 16: normalization behavior
// ---------------------------------------------------------------------------

describe("normalizeReceiptText", () => {
  it("16. lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeReceiptText("Ola auto MG Road to office Rs 180")).toBe(
      "ola auto mg road to office rs 180"
    );
    expect(normalizeReceiptText("OLA - MG ROAD TO OFFICE - INR 180.00")).toBe(
      "ola mg road to office inr 180 00"
    );
  });

  it("collapses irregular spacing", () => {
    expect(normalizeReceiptText("uber   auto    chennai")).toBe("uber auto chennai");
  });

  it("is idempotent", () => {
    const once = normalizeReceiptText("Ola - Auto! Rs.180/-");
    expect(normalizeReceiptText(once)).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// 17: confidence calculation
// ---------------------------------------------------------------------------

describe("confidence", () => {
  it("17. is high when merchant + date + amount + category are all found", () => {
    const r = parseReceiptText("Ola cab - client site visit\nFare: Rs 610\n03 Sep", { now: NOW });
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("is medium when merchant + amount + category are found but no date", () => {
    const r = parseReceiptText("Ola cab - client site visit\nFare: Rs 610", { now: NOW });
    expect(r.confidence).toBeGreaterThanOrEqual(0.55);
    expect(r.confidence).toBeLessThan(0.85);
  });

  it("is low when only the amount is found", () => {
    const r = parseReceiptText("Rs 610", { now: NOW });
    expect(r.confidence).toBeLessThan(0.4);
  });

  it("is 0 for text with nothing recognizable at all", () => {
    const r = parseReceiptText("", { now: NOW });
    expect(r.confidence).toBe(0);
  });

  it("stays within [0, 1]", () => {
    const r = parseReceiptText("Ola cab - client site visit\nFare: Rs 610\n03 Sep 2026", { now: NOW });
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 18: warnings
// ---------------------------------------------------------------------------

describe("warnings", () => {
  it("18. warns when currency was assumed (no explicit symbol/word)", () => {
    const r = parseReceiptText("uber auto chennai 3 sept 220", { now: NOW });
    expect(r.warnings).toContain("Currency was assumed to be INR.");
  });

  it("warns about ambiguity when multiple distinct amounts are equally plausible", () => {
    const r = parseReceiptText("Rs 100 and also Rs 200, no clear total", { now: NOW });
    expect(r.warnings.some((w) => w.includes("multiple possible amounts"))).toBe(true);
  });

  it("does not warn about ambiguity when there is one clear total among item lines", () => {
    const r = parseReceiptText(
      "cafe coffee day 2 cappuccino 1 sandwich total rs 340/-",
      { now: NOW }
    );
    expect(r.warnings.some((w) => w.includes("multiple possible amounts"))).toBe(false);
  });

  it("warns when the year had to be assumed", () => {
    const r = parseReceiptText("Ola cab 28/08 Rs 200", { now: NOW });
    expect(r.warnings.some((w) => w.startsWith("Year not specified"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The five receipts named explicitly in the Phase 4 brief, and the full
// set of raw receipt texts from prisma/seed.ts, as fixtures.
// ---------------------------------------------------------------------------

describe("the five receipts named in the Phase 4 brief", () => {
  it('"Ola auto MG Road to office Rs 180"', () => {
    const r = parseReceiptText("Ola auto MG Road to office Rs 180", { now: NOW });
    expect(r.merchant).toBe("Ola");
    expect(r.category).toBe("TAXI");
    expect(r.amount).toBe(180);
    expect(r.currency).toBe("INR");
  });

  it('"OLA - MG ROAD TO OFFICE - INR 180.00" parses to the same key fields as its pair above (for Phase 5)', () => {
    const first = parseReceiptText("Ola auto MG Road to office Rs 180", { now: NOW });
    const second = parseReceiptText("OLA - MG ROAD TO OFFICE - INR 180.00", { now: NOW });
    expect(second.merchant).toBe(first.merchant);
    expect(second.category).toBe(first.category);
    expect(second.amount).toBe(first.amount);
    expect(second.currency).toBe(first.currency);
  });

  it('"uber auto chennai 3 sept 220"', () => {
    const r = parseReceiptText("uber auto chennai 3 sept 220", { now: NOW });
    expect(r.merchant).toBe("Uber");
    expect(r.category).toBe("TAXI");
    expect(r.amount).toBe(220);
    expect(r.date).toEqual(new Date(2026, 8, 3, 12, 0, 0));
  });

  it('"IRCTC chennai blr 28/08 INR 1850"', () => {
    const r = parseReceiptText("IRCTC chennai blr 28/08 INR 1850", { now: NOW });
    expect(r.merchant).toBe("IRCTC");
    expect(r.category).toBe("TRAVEL");
    expect(r.amount).toBe(1850);
    expect(r.date).toEqual(new Date(2026, 7, 28, 12, 0, 0));
  });

  it('"cafe coffee day 2 cappuccino 1 sandwich total rs 340/-"', () => {
    const r = parseReceiptText("cafe coffee day 2 cappuccino 1 sandwich total rs 340/-", { now: NOW });
    expect(r.merchant).toBe("Cafe Coffee Day");
    expect(r.category).toBe("MEALS");
    expect(r.amount).toBe(340);
  });
});

// Every rawReceiptText string from prisma/seed.ts's buildClaimSpecs(),
// copied here verbatim as fixtures (seeding itself needs a live database,
// so these are the strings, not a live import of the seed module) — a
// smoke pass confirming the parser never throws and always returns a
// well-formed result for every real receipt this app's demo data uses.
const SEED_RECEIPT_TEXTS = [
  "IRCTC chennai blr 28/08 INR 1850",
  "Business Lunch - The Bombay Canteen\nAmount: Rs 1,200\nParty size: 4",
  "Reliance Digital - USB-C hub, HDMI cable\nTotal: Rs 2,150\nInvoice #RD-88213",
  "uber auto chennai 3 sept 220",
  "IndiGo Airlines - Chennai to Mumbai\nBooking ref: 6E-2291\nFare: Rs 7,300",
  "Mainland China restaurant - client dinner\nAmount: Rs 6,200\nCovers: 5 guests",
  "Staples - printer cartridges and paper\nTotal: Rs 2,400",
  "OLA CAB TRIP 09/09 fare 187 gst incl",
  "stationery items rs 950 no bill breakdown",
  "cafe coffee day 2 cappuccino 1 sandwich total rs 340/-",
  "Ola auto MG Road to office Rs 180",
  "OLA - MG ROAD TO OFFICE - INR 180.00",
  "MakeMyTrip - Chennai to Bangalore bus ticket\nAmount: Rs 3,400",
  "courier charges for client documents 450",
  "SpiceJet - Bangalore to Delhi\nBooking ref: SG-7742\nFare: Rs 5,400",
  "Amazon Business - laptop bag and accessories\nOrder total: Rs 1,350",
  "Business lunch with client\nRestaurant: Spice Route\nAmount: Rs 1450\nGST included",
  "Conference travel - Bangalore\nFlight + cab\nTotal: Rs 8,900",
  "Team dinner - Toit Brewpub\nAmount: Rs 4,200",
  "Ola cab - client site visit\nFare: Rs 610",
  "chai n snacks meeting client 220rs",
];

describe("every seed receipt text (prisma/seed.ts fixtures)", () => {
  it.each(SEED_RECEIPT_TEXTS)("parses without throwing and finds an amount: %s", (text) => {
    const r = parseReceiptText(text, { now: NOW });
    expect(r.amount).not.toBeNull();
    expect(r.description.length).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("recovers the exact amounts from the seed data", () => {
    const expectedAmounts: Record<string, number> = {
      "IRCTC chennai blr 28/08 INR 1850": 1850,
      "uber auto chennai 3 sept 220": 220,
      "OLA CAB TRIP 09/09 fare 187 gst incl": 187,
      "stationery items rs 950 no bill breakdown": 950,
      "cafe coffee day 2 cappuccino 1 sandwich total rs 340/-": 340,
      "Ola auto MG Road to office Rs 180": 180,
      "OLA - MG ROAD TO OFFICE - INR 180.00": 180,
      "courier charges for client documents 450": 450,
      "Ola cab - client site visit\nFare: Rs 610": 610,
      "chai n snacks meeting client 220rs": 220,
    };
    for (const [text, expected] of Object.entries(expectedAmounts)) {
      expect(parseReceiptText(text, { now: NOW }).amount, text).toBe(expected);
    }
  });

  it("recovers the expected category for each seed receipt", () => {
    const expectedCategories: Record<string, string> = {
      "IRCTC chennai blr 28/08 INR 1850": "TRAVEL",
      "Business Lunch - The Bombay Canteen\nAmount: Rs 1,200\nParty size: 4": "MEALS",
      "Reliance Digital - USB-C hub, HDMI cable\nTotal: Rs 2,150\nInvoice #RD-88213": "SUPPLIES",
      "uber auto chennai 3 sept 220": "TAXI",
      "OLA CAB TRIP 09/09 fare 187 gst incl": "TAXI",
      "stationery items rs 950 no bill breakdown": "SUPPLIES",
      "cafe coffee day 2 cappuccino 1 sandwich total rs 340/-": "MEALS",
      "Ola auto MG Road to office Rs 180": "TAXI",
      "OLA - MG ROAD TO OFFICE - INR 180.00": "TAXI",
      "MakeMyTrip - Chennai to Bangalore bus ticket\nAmount: Rs 3,400": "TRAVEL",
      "SpiceJet - Bangalore to Delhi\nBooking ref: SG-7742\nFare: Rs 5,400": "TRAVEL",
      "Amazon Business - laptop bag and accessories\nOrder total: Rs 1,350": "SUPPLIES",
      "Conference travel - Bangalore\nFlight + cab\nTotal: Rs 8,900": "TRAVEL",
      "Team dinner - Toit Brewpub\nAmount: Rs 4,200": "MEALS",
      "Ola cab - client site visit\nFare: Rs 610": "TAXI",
      "chai n snacks meeting client 220rs": "MEALS",
    };
    for (const [text, expected] of Object.entries(expectedCategories)) {
      expect(parseReceiptText(text, { now: NOW }).category, text).toBe(expected);
    }
  });

  it("never returns the raw text verbatim as the description", () => {
    for (const text of SEED_RECEIPT_TEXTS) {
      const r = parseReceiptText(text, { now: NOW });
      expect(r.description).not.toBe(text);
    }
  });

  it("does not mistake booking/invoice reference numbers for a date", () => {
    const r = parseReceiptText("IndiGo Airlines - Chennai to Mumbai\nBooking ref: 6E-2291\nFare: Rs 7,300", {
      now: NOW,
    });
    expect(r.date).toBeNull();
  });
});
