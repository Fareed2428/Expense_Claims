import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Prisma so this suite never touches the real database — it tests
// the classification ladder and persistence logic in isolation. The
// separate, real-database verification (the actual seeded Ananya/Ola
// pair, DuplicateMatch persistence against Neon, idempotency on re-run)
// was performed via a temporary script during Phase 5 and is reported in
// the phase summary rather than committed here, matching how earlier
// phases (1–4) handled real-DB verification.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    claim: { findMany: vi.fn() },
    duplicateMatch: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  detectDuplicates,
  hashNormalizedText,
  recordDuplicateMatches,
  textSimilarity,
  type DuplicateCheckInput,
} from "./duplicate-detector";
import { normalizeReceiptText } from "./receipt-parser";

const findMany = vi.mocked(prisma.claim.findMany);
const findFirst = vi.mocked(prisma.duplicateMatch.findFirst);
const create = vi.mocked(prisma.duplicateMatch.create);
const update = vi.mocked(prisma.duplicateMatch.update);

beforeEach(() => {
  vi.clearAllMocks();
});

/** Builds a mocked candidate claim row shaped like what findCandidateClaims selects. */
function candidate(overrides: {
  id: string;
  merchant: string;
  amount: string;
  expenseDate: Date;
  category?: string;
  rawText?: string;
}) {
  const rawText = overrides.rawText ?? `${overrides.merchant} receipt Rs ${overrides.amount}`;
  const normalizedText = normalizeReceiptText(rawText);
  return {
    id: overrides.id,
    merchant: overrides.merchant,
    amount: new Prisma.Decimal(overrides.amount), // real Claim rows return a Decimal, not a plain string
    expenseDate: overrides.expenseDate,
    category: overrides.category ?? "TAXI",
    receipt: { normalizedText, textHash: hashNormalizedText(normalizedText) },
  };
}

const BASE_DATE = new Date(2026, 8, 9, 12, 0, 0); // 9 September 2026

function baseInput(overrides: Partial<DuplicateCheckInput> = {}): DuplicateCheckInput {
  return {
    claimantId: "user-ananya",
    rawReceiptText: "Ola auto MG Road to office Rs 180",
    merchant: "Ola",
    amount: 180,
    expenseDate: BASE_DATE,
    category: "TAXI" as never,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1–2: exact normalized-text / exact hash duplicate
// ---------------------------------------------------------------------------

describe("exact hash duplicate", () => {
  it("1. detects an exact normalized-text duplicate", async () => {
    findMany.mockResolvedValueOnce([
      candidate({
        id: "c1",
        merchant: "Ola",
        amount: "180",
        expenseDate: BASE_DATE,
        rawText: "Ola auto MG Road to office Rs 180",
      }) as never,
    ]);

    const result = await detectDuplicates(baseInput());

    expect(result.isDuplicate).toBe(true);
    expect(result.matches[0].matchType).toBe("EXACT_HASH");
    expect(result.matches[0].score).toBe(1);
  });

  it("2. hashNormalizedText produces identical hashes for texts that normalize the same", () => {
    const a = hashNormalizedText(normalizeReceiptText("Uber auto Chennai 3 Sep Rs 220"));
    const b = hashNormalizedText(normalizeReceiptText("UBER AUTO CHENNAI 3 SEP RS 220"));
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 3: case/spacing variation — the exact example from the brief
// ---------------------------------------------------------------------------

describe("case and spacing variation", () => {
  it('3. "Uber auto Chennai 3 Sep Rs 220" and "UBER AUTO CHENNAI 3 SEP RS 220" are the same normalized receipt', async () => {
    findMany.mockResolvedValueOnce([
      candidate({
        id: "c1",
        merchant: "Uber",
        amount: "220",
        expenseDate: BASE_DATE,
        rawText: "Uber auto Chennai 3 Sep Rs 220",
      }) as never,
    ]);

    const result = await detectDuplicates(
      baseInput({
        rawReceiptText: "UBER AUTO CHENNAI 3 SEP RS 220",
        merchant: "Uber",
        amount: 220,
      })
    );

    expect(result.matches[0].matchType).toBe("EXACT_HASH");
    expect(result.isDuplicate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4–5: reworded duplicate, weeks apart — the seeded Ananya/Ola scenario
// ---------------------------------------------------------------------------

describe("the seeded Ananya/Ola duplicate pair (fixture text from prisma/seed.ts)", () => {
  it("4–5. identifies a slightly reworded receipt, ~3 weeks apart, as a strong duplicate", async () => {
    const claimADate = new Date(2026, 7, 19, 12, 0, 0); // ~21 days before claim B
    findMany.mockResolvedValueOnce([
      candidate({
        id: "claim-a",
        merchant: "Ola",
        amount: "180",
        expenseDate: claimADate,
        rawText: "Ola auto MG Road to office Rs 180",
      }) as never,
    ]);

    const result = await detectDuplicates(
      baseInput({
        rawReceiptText: "OLA - MG ROAD TO OFFICE - INR 180.00",
        merchant: "Ola",
        amount: 180,
        expenseDate: BASE_DATE,
      })
    );

    expect(result.isDuplicate).toBe(true);
    expect(result.matches[0].claimId).toBe("claim-a");
    expect(result.matches[0].matchType).toBe("FUZZY_TEXT");
    expect(result.matches[0].score).toBeGreaterThanOrEqual(0.85); // "a high/strong score"
    expect(result.matches[0].reasons.some((r) => /similar/i.test(r))).toBe(true);
    expect(result.matches[0].reasons.some((r) => /amount/i.test(r))).toBe(true);
    expect(result.matches[0].reasons.some((r) => /merchant/i.test(r))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6: same-claimant requirement
// ---------------------------------------------------------------------------

describe("same-claimant requirement", () => {
  it("6. scopes the candidate query to the same claimant", async () => {
    findMany.mockResolvedValueOnce([]);
    await detectDuplicates(baseInput({ claimantId: "user-ananya" }));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ claimantId: "user-ananya" }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// 7: field match — same merchant + same amount + nearby date
// ---------------------------------------------------------------------------

describe("field-based match", () => {
  it("7. flags a tight-window same-merchant/same-amount match even with different text (HIGH, no text corroboration needed)", async () => {
    const twoDaysAgo = new Date(BASE_DATE);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    findMany.mockResolvedValueOnce([
      candidate({
        id: "c1",
        merchant: "Ola",
        amount: "180",
        expenseDate: twoDaysAgo,
        rawText: "Completely different note about a cab ride",
      }) as never,
    ]);

    const result = await detectDuplicates(
      baseInput({ rawReceiptText: "Another unrelated description entirely" })
    );

    expect(result.matches[0].matchType).toBe("FIELD_MATCH");
    expect(result.matches[0].score).toBeGreaterThanOrEqual(0.85);
    expect(result.isDuplicate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8–11: false positives (instruction section 11 — extremely important)
// ---------------------------------------------------------------------------

describe("false positives", () => {
  it("8. different claimant is never even considered a candidate (query is scoped per-claimant)", async () => {
    // The mock never returns Rohan's claim when we ask for Ananya's
    // candidates — this is what the where.claimantId filter guarantees in
    // the real query. Simulated here by simply not including it.
    findMany.mockResolvedValueOnce([]);
    const result = await detectDuplicates(baseInput({ claimantId: "user-ananya" }));
    expect(result.isDuplicate).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it("9. different amount is not a duplicate solely from similar wording", async () => {
    findMany.mockResolvedValueOnce([
      candidate({
        id: "c1",
        merchant: "Ola",
        amount: "450",
        expenseDate: BASE_DATE,
        rawText: "Ola auto MG Road to office Rs 450",
      }) as never,
    ]);

    const result = await detectDuplicates(
      baseInput({ rawReceiptText: "Ola auto MG Road to office Rs 180", amount: 180 })
    );

    expect(result.isDuplicate).toBe(false);
  });

  it("10. different merchant is not a duplicate without strong supporting evidence", async () => {
    findMany.mockResolvedValueOnce([
      candidate({
        id: "c1",
        merchant: "Uber",
        amount: "180",
        expenseDate: BASE_DATE,
        rawText: "Uber auto MG Road to office Rs 180",
      }) as never,
    ]);

    const result = await detectDuplicates(
      baseInput({ rawReceiptText: "Ola auto MG Road to office Rs 180", merchant: "Ola", amount: 180 })
    );

    expect(result.isDuplicate).toBe(false);
  });

  it("11. same claimant/merchant/amount but a clearly different trip, weeks apart, is not a duplicate", async () => {
    const seventeenDaysAgo = new Date(BASE_DATE);
    seventeenDaysAgo.setDate(seventeenDaysAgo.getDate() - 17);
    findMany.mockResolvedValueOnce([
      candidate({
        id: "c1",
        merchant: "Uber",
        amount: "220",
        expenseDate: seventeenDaysAgo,
        rawText: "Uber trip MG Road to airport Rs 220",
      }) as never,
    ]);

    const result = await detectDuplicates(
      baseInput({
        rawReceiptText: "Uber ride Koramangala to office Rs 220",
        merchant: "Uber",
        amount: 220,
      })
    );

    expect(result.isDuplicate).toBe(false);
    // Still visible for transparency, just not flagged.
    expect(result.matches[0]?.score).toBeLessThan(0.5);
  });

  it("similar merchant but a clearly different receipt (different amount) is not a duplicate", async () => {
    findMany.mockResolvedValueOnce([
      candidate({
        id: "c1",
        merchant: "Ola Cab",
        amount: "450",
        expenseDate: BASE_DATE,
        rawText: "Ola cab airport drop Rs 450 toll included",
      }) as never,
    ]);

    const result = await detectDuplicates(
      baseInput({ rawReceiptText: "Ola auto MG Road to office Rs 180", merchant: "Ola", amount: 180 })
    );

    expect(result.isDuplicate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12–13: multiple candidates, strongest-match selection
// ---------------------------------------------------------------------------

describe("multiple candidates", () => {
  it("12–13. returns all qualifying matches and surfaces the strongest as the overall score", async () => {
    findMany.mockResolvedValueOnce([
      candidate({
        id: "weak",
        merchant: "Ola",
        amount: "180",
        expenseDate: new Date(2026, 7, 15, 12, 0, 0),
        rawText: "Ola cab somewhere else Rs 180",
      }) as never,
      candidate({
        id: "exact",
        merchant: "Ola",
        amount: "180",
        expenseDate: BASE_DATE,
        rawText: "Ola auto MG Road to office Rs 180",
      }) as never,
    ]);

    const result = await detectDuplicates(baseInput());

    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    expect(result.matches[0].claimId).toBe("exact");
    expect(result.matches[0].score).toBe(1);
    expect(result.score).toBe(result.matches[0].score);
    // Sorted strongest-first.
    for (let i = 1; i < result.matches.length; i++) {
      expect(result.matches[i - 1].score).toBeGreaterThanOrEqual(result.matches[i].score);
    }
  });
});

// ---------------------------------------------------------------------------
// 14: match type classification
// ---------------------------------------------------------------------------

describe("match type classification", () => {
  it("14. assigns EXACT_HASH, FUZZY_TEXT, and FIELD_MATCH correctly for their respective scenarios", async () => {
    findMany.mockResolvedValueOnce([
      candidate({ id: "exact", merchant: "Ola", amount: "180", expenseDate: BASE_DATE, rawText: "Ola auto MG Road to office Rs 180" }) as never,
    ]);
    const exactResult = await detectDuplicates(baseInput());
    expect(exactResult.matches[0].matchType).toBe("EXACT_HASH");

    findMany.mockResolvedValueOnce([
      candidate({ id: "fuzzy", merchant: "Ola", amount: "180", expenseDate: new Date(2026, 7, 19, 12, 0, 0), rawText: "Ola auto MG Road to office Rs 180" }) as never,
    ]);
    const fuzzyResult = await detectDuplicates(
      baseInput({ rawReceiptText: "OLA - MG ROAD TO OFFICE - INR 180.00" })
    );
    expect(fuzzyResult.matches[0].matchType).toBe("FUZZY_TEXT");

    const twoDaysAgo = new Date(BASE_DATE);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    findMany.mockResolvedValueOnce([
      candidate({ id: "field", merchant: "Ola", amount: "180", expenseDate: twoDaysAgo, rawText: "Totally different note" }) as never,
    ]);
    const fieldResult = await detectDuplicates(baseInput({ rawReceiptText: "Something else entirely" }));
    expect(fieldResult.matches[0].matchType).toBe("FIELD_MATCH");
  });
});

// ---------------------------------------------------------------------------
// 15: score boundaries
// ---------------------------------------------------------------------------

describe("score boundaries", () => {
  it("15. textSimilarity returns 1 for identical strings and 0 for completely disjoint ones", () => {
    expect(textSimilarity("ola auto", "ola auto")).toBe(1);
    expect(textSimilarity("aaaa", "zzzz")).toBe(0);
  });

  it("textSimilarity is between 0 and 1 for partial overlap", () => {
    const score = textSimilarity(
      normalizeReceiptText("Ola auto MG Road to office Rs 180"),
      normalizeReceiptText("OLA - MG ROAD TO OFFICE - INR 180.00")
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("a candidate scoring below every tier's floor is not returned at all", async () => {
    findMany.mockResolvedValueOnce([
      candidate({
        id: "unrelated",
        merchant: "Amazon",
        amount: "9999",
        expenseDate: BASE_DATE,
        rawText: "Completely unrelated laptop bag purchase",
      }) as never,
    ]);
    const result = await detectDuplicates(baseInput());
    expect(result.matches).toHaveLength(0);
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 16: no candidates found
// ---------------------------------------------------------------------------

describe("no candidates", () => {
  it("16. returns isDuplicate=false, score 0, empty matches when there are no candidates at all", async () => {
    findMany.mockResolvedValueOnce([]);
    const result = await detectDuplicates(baseInput());
    expect(result).toEqual({ isDuplicate: false, score: 0, matches: [] });
  });
});

// ---------------------------------------------------------------------------
// 17: rejected historical claim handling
// ---------------------------------------------------------------------------

describe("rejected historical claims", () => {
  it("17. a REJECTED historical claim can still be identified as a possible duplicate", async () => {
    findMany.mockResolvedValueOnce([
      candidate({
        id: "rejected-claim",
        merchant: "Ola",
        amount: "180",
        expenseDate: BASE_DATE,
        rawText: "Ola auto MG Road to office Rs 180",
      }) as never,
    ]);
    // The mock stands in for a claim the real query already filtered to a
    // meaningful status (SUBMITTED/APPROVED/PAID/REJECTED) — this proves
    // classification doesn't itself discriminate against a rejected one.
    const result = await detectDuplicates(baseInput());
    expect(result.matches[0].claimId).toBe("rejected-claim");
    expect(result.isDuplicate).toBe(true);
  });

  it("candidate query includes REJECTED and excludes PARSED from the status filter", async () => {
    findMany.mockResolvedValueOnce([]);
    await detectDuplicates(baseInput());
    const call = findMany.mock.calls[0][0] as { where: { status: { in: string[] } } };
    expect(call.where.status.in).toContain("REJECTED");
    expect(call.where.status.in).not.toContain("PARSED");
  });
});

// ---------------------------------------------------------------------------
// 18–19: DuplicateMatch persistence
// ---------------------------------------------------------------------------

describe("recordDuplicateMatches", () => {
  it("18. persists a DuplicateMatch row for each match at/above the duplicate threshold", async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({} as never);

    await recordDuplicateMatches("new-claim", {
      isDuplicate: true,
      score: 1,
      matches: [
        { claimId: "old-claim", matchType: "EXACT_HASH", score: 1, reasons: ["exact"] },
        { claimId: "weak-claim", matchType: "FIELD_MATCH", score: 0.35, reasons: ["weak"] },
      ],
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claimId: "new-claim",
          matchedClaimId: "old-claim",
          matchType: "EXACT_HASH",
          score: 1,
        }),
      })
    );
  });

  it("19. updates an existing DuplicateMatch row in place instead of creating a duplicate row", async () => {
    findFirst.mockResolvedValueOnce({ id: "existing-row-id" } as never);
    update.mockResolvedValue({} as never);

    await recordDuplicateMatches("new-claim", {
      isDuplicate: true,
      score: 0.9,
      matches: [{ claimId: "old-claim", matchType: "FUZZY_TEXT", score: 0.9, reasons: ["reworded"] }],
    });

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-row-id" },
        data: expect.objectContaining({ matchType: "FUZZY_TEXT", score: 0.9 }),
      })
    );
  });

  it("does not persist LOW-tier (below-threshold) matches at all", async () => {
    await recordDuplicateMatches("new-claim", {
      isDuplicate: false,
      score: 0.35,
      matches: [{ claimId: "old-claim", matchType: "FIELD_MATCH", score: 0.35, reasons: ["weak"] }],
    });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
