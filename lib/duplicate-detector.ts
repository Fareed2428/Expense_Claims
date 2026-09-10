/**
 * Hybrid duplicate-receipt detector.
 *
 * Compares a candidate claim (about to be parsed/submitted/resubmitted)
 * against a claimant's own historical claims and reports how likely it is
 * to be the same underlying receipt filed again. Deterministic, local,
 * explainable — no LLM, no external API. This is the concrete
 * implementation of CLAUDE.md Section 5 / the implementation plan's
 * Section 7.
 *
 * Three signals, each computed against a *narrowed* candidate set (same
 * claimant, workflow-meaningful status, expense date within
 * CANDIDATE_DATE_WINDOW_DAYS — see findCandidateClaims):
 *
 *   1. EXACT_HASH  — SHA-256 of the normalized receipt text, compared to
 *      Receipt.textHash. Catches same-day copy/paste re-submission and
 *      case/spacing-only variants trivially.
 *   2. FUZZY_TEXT   — Dice's coefficient over character bigrams of the
 *      normalized text. Catches "typed slightly differently the second
 *      time" (CLAUDE.md's own phrase for this scenario).
 *   3. FIELD_MATCH  — same claimant (a query precondition, not a
 *      per-candidate signal) + amount + merchant + expense-date proximity
 *      + category, compared on the *structured* Claim fields (not the raw
 *      receipt text).
 *
 * These are combined by an explicit, documented rule ladder (see
 * classifyCandidate below) rather than a blind OR — a single weak signal
 * is never enough, and a genuinely-different receipt with a coincidentally
 * similar template (same merchant/route wording, different amount; same
 * amount/merchant, different route) does not get flagged. See this file's
 * test suite for the concrete false-positive scenarios this rules out.
 *
 * WHY FLAG, NOT BLOCK (CLAUDE.md Section 5 / 7): a false positive here
 * costs a human one extra glance, not a blocked claim — the real
 * business risk ("finance has paid twice before") only materializes at
 * the payout step, which is where hard friction belongs (a later phase).
 * This module only detects and records; it never rejects a claim.
 */

import { createHash } from "node:crypto";
import type { ClaimStatus, DuplicateMatchType, ExpenseCategory, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeReceiptText } from "@/lib/receipt-parser";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DuplicateCheckInput {
  claimantId: string;
  rawReceiptText: string;
  merchant: string | null;
  amount: number;
  expenseDate: Date;
  category?: ExpenseCategory | null;
  /** Exclude this claim from candidates — pass the claim's own id when re-checking a claim that already exists (e.g. on resubmission), so it never matches itself. */
  excludeClaimId?: string;
}

export interface DuplicateCandidateMatch {
  claimId: string;
  matchType: DuplicateMatchType;
  /** 0–1. Fixed per confidence tier (see SCORE_* constants) rather than a continuously blended number, so the same evidence always produces the same, easily-quoted score. */
  score: number;
  reasons: string[];
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  score: number;
  matches: DuplicateCandidateMatch[];
}

// ---------------------------------------------------------------------------
// Tuning constants — documented here, not scattered through the logic.
// ---------------------------------------------------------------------------

/** Claim statuses worth comparing against. PARSED is deliberately excluded: an un-submitted draft isn't a "historical claim" yet — flagging against someone's own other draft would be noise, and both drafts get re-checked at submit time anyway. REJECTED stays in: the same receipt, corrected and resubmitted, should still surface as a possible match — the workflow layer (a later phase) decides what that means for a rejected claim specifically. */
const CANDIDATE_STATUSES: ClaimStatus[] = ["SUBMITTED", "APPROVED", "PAID", "REJECTED"];

/** How far back/forward (in days) to look for candidates at all. Wide enough to catch "three weeks apart" (CLAUDE.md's own duplicate scenario, ~21 days) with real margin, without pulling in a claimant's entire history. Suggested as "approximately 30 days" in the Phase 5 brief; kept exactly there since 30 comfortably covers the 21-day seeded scenario and there's no evidence a wider window is needed. */
const CANDIDATE_DATE_WINDOW_DAYS = 30;

/** A much narrower window used only for the "strong field match, no text corroboration needed" tier (see classifyCandidate). Two claims from the *same person*, *same merchant*, *same amount*, within a couple of days of each other, are suspicious enough on their own even before comparing text — but "within 30 days" alone is not: a recurring cab ride at a fixed fare is a completely normal pattern across a month and must not auto-flag just because the numbers line up (see the false-positive tests). */
const TIGHT_DATE_WINDOW_DAYS = 3;

/** Amount is treated as "matching" within this tolerance, to absorb rounding (e.g. ₹179.50 parsed as ₹180). */
const AMOUNT_TOLERANCE = 1;

/**
 * Dice-coefficient thresholds. Chosen empirically against this project's
 * own real seed data and false-positive scenarios (see
 * lib/duplicate-detector.test.ts), not picked in the abstract:
 *   - The real seeded Ananya/Ola pair ("Ola auto MG Road to office Rs 180"
 *     vs "OLA - MG ROAD TO OFFICE - INR 180.00") scores ~0.76.
 *   - A genuine false positive — same claimant, same merchant, same
 *     amount, but a *different* trip ("Uber trip MG Road to airport" vs
 *     "Uber ride Koramangala to office") — scores ~0.45, purely from
 *     shared filler words ("uber", "to", "rs", the amount). That must
 *     stay below the threshold that (combined with matching fields) would
 *     flag a duplicate.
 * FUZZY_MEDIUM sits comfortably above that 0.45 false positive and below
 * the real pair's 0.76; FUZZY_STRONG sits at/below the real pair's score
 * so it still clears the "combined HIGH" bar.
 */
const FUZZY_STRONG = 0.7;
const FUZZY_MEDIUM = 0.55;

/** Fixed scores per confidence tier — see classifyCandidate. */
const SCORE_EXACT_HASH = 1.0;
const SCORE_HIGH_COMBINED = 0.9;
const SCORE_HIGH_TIGHT_FIELD = 0.85;
const SCORE_MEDIUM_COMBINED = 0.65;
const SCORE_LOW = 0.35;

/** A match's score must reach this to count toward isDuplicate and get persisted as a DuplicateMatch row. LOW-tier matches (score 0.35) are still returned in `matches` for transparency, but don't cross this bar. */
const DUPLICATE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Signal 1 — exact hash of normalized text
// ---------------------------------------------------------------------------

/** SHA-256 hex digest of already-normalized text. Same algorithm prisma/seed.ts uses to populate Receipt.textHash, so it's directly comparable to existing rows without recomputing anything. */
export function hashNormalizedText(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

// ---------------------------------------------------------------------------
// Signal 2 — fuzzy text similarity (Dice's coefficient over bigrams)
// ---------------------------------------------------------------------------

function bigrams(value: string): string[] {
  const grams: string[] = [];
  for (let i = 0; i < value.length - 1; i++) grams.push(value.substring(i, i + 2));
  return grams;
}

/**
 * Sørensen–Dice coefficient over character bigrams: 2×(shared bigrams) /
 * (total bigrams in both strings). Chosen over Levenshtein/Jaro-Winkler
 * because it's cheap, has no external dependency, tolerates word reorder
 * and punctuation differences well (exactly the "typed slightly
 * differently" case), and is simple enough to explain in one sentence.
 * Bigrams are matched with multiplicity (each one in B can only satisfy
 * one match in A), which is what makes this the real Dice coefficient and
 * not just a Jaccard-style set overlap.
 */
export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  const pool = bigramsB.slice();

  let shared = 0;
  for (const gram of bigramsA) {
    const idx = pool.indexOf(gram);
    if (idx !== -1) {
      shared++;
      pool.splice(idx, 1);
    }
  }

  return (2 * shared) / (bigramsA.length + bigramsB.length);
}

// ---------------------------------------------------------------------------
// Signal 3 — field-based match
// ---------------------------------------------------------------------------

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE;
}

/**
 * Case-insensitive exact match, substring containment ("Ola" vs "Ola
 * Cab"), or a moderate Dice threshold as a last resort — merchant strings
 * are short, so bigram overlap is a coarser signal here than for full
 * receipt text; 0.5 is deliberately looser than the text thresholds above
 * for that reason.
 */
function merchantsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.includes(na)) return true;
  if (nb.length >= 3 && na.includes(nb)) return true;
  return textSimilarity(na, nb) >= 0.5;
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Candidate retrieval
// ---------------------------------------------------------------------------

interface CandidateClaim {
  id: string;
  merchant: string;
  amount: Prisma.Decimal;
  expenseDate: Date;
  category: ExpenseCategory;
  receipt: { normalizedText: string; textHash: string } | null;
}

async function findCandidateClaims(input: DuplicateCheckInput): Promise<CandidateClaim[]> {
  const windowStart = new Date(input.expenseDate);
  windowStart.setDate(windowStart.getDate() - CANDIDATE_DATE_WINDOW_DAYS);
  const windowEnd = new Date(input.expenseDate);
  windowEnd.setDate(windowEnd.getDate() + CANDIDATE_DATE_WINDOW_DAYS);

  return prisma.claim.findMany({
    where: {
      claimantId: input.claimantId, // same-claimant is a hard precondition, not a scored signal — see the module comment and README/CLAUDE.md
      status: { in: CANDIDATE_STATUSES },
      expenseDate: { gte: windowStart, lte: windowEnd },
      ...(input.excludeClaimId ? { id: { not: input.excludeClaimId } } : {}),
    },
    select: {
      id: true,
      merchant: true,
      amount: true,
      expenseDate: true,
      category: true,
      receipt: { select: { normalizedText: true, textHash: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Classification ladder
// ---------------------------------------------------------------------------

/**
 * Classifies one candidate against the input. Evaluated as an explicit,
 * ordered ladder (first matching rule wins) rather than additive scoring
 * across the board — additive weights turned out to let amount+merchant
 * agreement alone drift into "strong" territory regardless of how far
 * apart in time or how different the receipt text was, which is exactly
 * the false positive the brief calls out (same person/merchant/amount,
 * clearly different trips, weeks apart). Gating the strongest tiers on
 * either an exact hash, real text similarity, or a *tight* date window
 * closes that gap; see this file's header comment for the reasoning and
 * the test suite for the scenarios that pin it down.
 */
function classifyCandidate(
  input: DuplicateCheckInput,
  candidate: CandidateClaim
): DuplicateCandidateMatch | null {
  const normalizedInput = normalizeReceiptText(input.rawReceiptText);
  const inputHash = hashNormalizedText(normalizedInput);

  const candidateAmount = candidate.amount.toNumber();
  const exactHash = candidate.receipt !== null && candidate.receipt.textHash === inputHash;
  const fuzzy = candidate.receipt ? textSimilarity(normalizedInput, candidate.receipt.normalizedText) : 0;
  const amountMatch = amountsMatch(input.amount, candidateAmount);
  const merchantMatch = merchantsMatch(input.merchant, candidate.merchant);
  const categoryMatch = Boolean(input.category) && input.category === candidate.category;
  const daysApart = daysBetween(input.expenseDate, candidate.expenseDate);

  const reasons: string[] = ["Same claimant."];
  if (amountMatch) reasons.push(`Same amount (₹${candidateAmount}).`);
  if (merchantMatch) reasons.push(`Same/similar merchant (${candidate.merchant}).`);
  if (categoryMatch) reasons.push(`Same category (${candidate.category}).`);
  if (daysApart <= TIGHT_DATE_WINDOW_DAYS) {
    reasons.push(`Expense dates are ${daysApart} day(s) apart.`);
  } else {
    reasons.push(`Expense dates are ${daysApart} days apart (within the ${CANDIDATE_DATE_WINDOW_DAYS}-day comparison window).`);
  }
  if (fuzzy >= FUZZY_MEDIUM) {
    reasons.push(`Receipt text is highly similar (${Math.round(fuzzy * 100)}% match) despite different wording.`);
  }

  // 1. Exact normalized-text match — the strongest possible signal.
  if (exactHash) {
    return {
      claimId: candidate.id,
      matchType: "EXACT_HASH",
      score: SCORE_EXACT_HASH,
      reasons: ["Normalized receipt text is an exact match.", ...reasons],
    };
  }

  // 2. Field agreement + genuinely similar text — the seeded Ananya/Ola
  //    scenario lands here (~0.76 similarity, 21 days apart).
  if (amountMatch && merchantMatch && fuzzy >= FUZZY_STRONG) {
    return { claimId: candidate.id, matchType: "FUZZY_TEXT", score: SCORE_HIGH_COMBINED, reasons };
  }

  // 3. Field agreement within a tight date window — suspicious even
  //    without text corroboration (same person/vendor/amount, a couple
  //    of days apart is not a normal recurring-expense pattern).
  if (amountMatch && merchantMatch && daysApart <= TIGHT_DATE_WINDOW_DAYS) {
    return { claimId: candidate.id, matchType: "FIELD_MATCH", score: SCORE_HIGH_TIGHT_FIELD, reasons };
  }

  // 4. Field agreement + moderate text similarity — real but weaker
  //    evidence than tier 2/3; still flagged, at MEDIUM confidence.
  if (amountMatch && merchantMatch && fuzzy >= FUZZY_MEDIUM) {
    return { claimId: candidate.id, matchType: "FUZZY_TEXT", score: SCORE_MEDIUM_COMBINED, reasons };
  }

  // 5. Field agreement alone, weak-or-no text support — e.g. the same
  //    fixed-fare commute repeated within the month. Reported for
  //    visibility, but NOT flagged as a duplicate (see DUPLICATE_THRESHOLD).
  if (amountMatch && merchantMatch) {
    return { claimId: candidate.id, matchType: "FIELD_MATCH", score: SCORE_LOW, reasons };
  }

  // 6. Meaningful text similarity with no field corroboration at all
  //    (e.g. merchant differs). Also reported at LOW only — high text
  //    similarity between receipts for a *different* merchant or a
  //    *different* amount turns out to be common for same-shaped receipts
  //    ("<merchant> auto MG Road to office Rs <amount>") and must not
  //    outrank a genuine field mismatch.
  if (fuzzy >= FUZZY_MEDIUM) {
    return { claimId: candidate.id, matchType: "FUZZY_TEXT", score: SCORE_LOW, reasons };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main entry point (read-only — does not write to the database)
// ---------------------------------------------------------------------------

export async function detectDuplicates(input: DuplicateCheckInput): Promise<DuplicateCheckResult> {
  const candidates = await findCandidateClaims(input);

  const matches = candidates
    .map((candidate) => classifyCandidate(input, candidate))
    .filter((m): m is DuplicateCandidateMatch => m !== null)
    .sort((a, b) => b.score - a.score);

  const score = matches.length > 0 ? matches[0].score : 0;
  const isDuplicate = score >= DUPLICATE_THRESHOLD;

  return { isDuplicate, score, matches };
}

// ---------------------------------------------------------------------------
// Persistence — a deliberate separate step, not run automatically by
// detectDuplicates(). Detection is meant to run early (e.g. right after
// parsing, as a warning) and doesn't need to write anything; persisting
// DuplicateMatch rows is meaningful once a claim actually exists (e.g. at
// submission), which is when a caller should invoke this.
// ---------------------------------------------------------------------------

/**
 * Writes DuplicateMatch rows for every match in `result` that clears
 * DUPLICATE_THRESHOLD (LOW-tier matches are informational only and are
 * not persisted). Idempotent: if a (claimId, matchedClaimId) row already
 * exists, it's updated in place rather than duplicated — the schema has
 * no unique constraint on that pair (Phase 5 was scoped not to change
 * prisma/schema.prisma), so this is enforced here in application code via
 * an explicit find-then-write instead of a DB-level upsert.
 */
export async function recordDuplicateMatches(
  claimId: string,
  result: DuplicateCheckResult
): Promise<void> {
  const toPersist = result.matches.filter((m) => m.score >= DUPLICATE_THRESHOLD);

  for (const match of toPersist) {
    const existing = await prisma.duplicateMatch.findFirst({
      where: { claimId, matchedClaimId: match.claimId },
      select: { id: true },
    });

    if (existing) {
      await prisma.duplicateMatch.update({
        where: { id: existing.id },
        data: { matchType: match.matchType, score: match.score },
      });
    } else {
      await prisma.duplicateMatch.create({
        data: {
          claimId,
          matchedClaimId: match.claimId,
          matchType: match.matchType,
          score: match.score,
        },
      });
    }
  }
}
