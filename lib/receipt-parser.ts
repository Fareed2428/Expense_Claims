/**
 * Deterministic receipt-text parser.
 *
 * Converts messy, human-written receipt text (pasted by a staff member)
 * into structured expense fields. No LLM, no external API — regex +
 * pattern matching + chrono-node as a fallback for date formats the
 * explicit rules below don't already cover. Same output for the same
 * input, every time, which is what makes it testable and reviewable.
 *
 * This is a pure function over a string: it never touches the database
 * and never creates a claim. The claim-creation flow (later phases) is
 * what calls this, shows the result to the user, and lets them correct
 * it before anything is written anywhere.
 *
 * `normalizeReceiptText` is exported specifically so Phase 5's duplicate
 * detector can reuse the exact same normalization this parser (and the
 * Phase 3 seed data) already agrees on.
 */

import * as chrono from "chrono-node";
import type { ExpenseCategory } from "@prisma/client";

export interface ParsedReceipt {
  merchant: string | null;
  date: Date | null;
  amount: number | null;
  currency: "INR" | null;
  category: ExpenseCategory | null;
  description: string;
  confidence: number;
  warnings: string[];
}

export interface ParseReceiptOptions {
  /** Reference "now", for missing-year date assumptions and chrono's relative-date handling. Defaults to the real current time; tests pass a fixed value for determinism. */
  now?: Date;
}

// ---------------------------------------------------------------------------
// Text normalization — also used by Phase 5's duplicate detector.
// ---------------------------------------------------------------------------

/**
 * Lowercases, strips punctuation, and collapses whitespace, so two
 * receipts that differ only in capitalization/spacing/punctuation
 * normalize to the same string (e.g. "Ola auto MG Road to office Rs 180"
 * and "OLA - MG ROAD TO OFFICE - INR 180.00" both reduce to essentially
 * the same token sequence). Deliberately simple — this is normalization,
 * not the similarity scoring Phase 5 will build on top of it.
 */
export function normalizeReceiptText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Amount extraction
// ---------------------------------------------------------------------------

const NUMBER = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const RS_WORD = String.raw`(?<![a-z])rs\.?(?![a-z])`;
const INR_WORD = String.raw`(?<![a-z])inr(?![a-z])`;

const PREFIX_AMOUNT_RE = new RegExp(String.raw`(?:₹|${RS_WORD}|${INR_WORD})\s*(${NUMBER})`, "gi");
const SUFFIX_AMOUNT_RE = new RegExp(String.raw`(${NUMBER})\s*(?:/-|${RS_WORD}|₹|${INR_WORD})`, "gi");

const AMOUNT_KEYWORDS = ["grand total", "net amount", "total", "amount", "fare", "paid"];
const KEYWORD_AMOUNT_RE = new RegExp(
  String.raw`\b(${AMOUNT_KEYWORDS.join("|")})\b\s*[:\-]?\s*(?:(₹|${RS_WORD}|${INR_WORD})\s*)?(${NUMBER})`,
  "gi"
);

const BARE_NUMBER_RE = /\b\d+(?:\.\d{1,2})?\b/g;

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

interface AmountCandidate {
  value: number;
  matchText: string;
  index: number;
  score: number; // 3 = keyword+marker, 2 = keyword only, 1 = marker only
}

interface AmountExtraction {
  amount: number | null;
  hadExplicitCurrencyMarker: boolean;
  /** The exact substring of the input that produced the winning amount (including its marker/keyword, where present) — used to strip it back out when building the description. Not re-derived via regex there, to avoid stripping something that was never actually validated as the amount (see buildDescription's comment). */
  matchText: string | null;
  warnings: string[];
}

function extractAmount(text: string, excludedRanges: Array<[number, number]>): AmountExtraction {
  const warnings: string[] = [];
  const isExcluded = (idx: number) => excludedRanges.some(([s, e]) => idx >= s && idx < e);

  const candidates = new Map<number, AmountCandidate>();
  const consider = (index: number, matchText: string, value: number, score: number) => {
    if (isExcluded(index)) return;
    const existing = candidates.get(index);
    if (!existing || score > existing.score) {
      candidates.set(index, { value, matchText, index, score });
    }
  };

  for (const m of text.matchAll(KEYWORD_AMOUNT_RE)) {
    const numberText = m[3];
    const hasMarker = Boolean(m[2]);
    const numberIndex = m.index! + m[0].length - numberText.length;
    consider(numberIndex, m[0], toNumber(numberText), hasMarker ? 3 : 2);
  }
  for (const m of text.matchAll(PREFIX_AMOUNT_RE)) {
    consider(m.index! + m[0].length - m[1].length, m[0], toNumber(m[1]), 1);
  }
  for (const m of text.matchAll(SUFFIX_AMOUNT_RE)) {
    consider(m.index!, m[0], toNumber(m[1]), 1);
  }

  let pool = [...candidates.values()];

  if (pool.length === 0) {
    // Nothing currency-marked or keyword-anchored anywhere — fall back to
    // the last standalone number in the text that isn't part of a date
    // we already extracted. Low confidence, and always flagged: we're
    // guessing that a bare number is money.
    const bare = [...text.matchAll(BARE_NUMBER_RE)].filter((m) => !isExcluded(m.index!));
    if (bare.length === 0) {
      warnings.push("Could not determine the amount.");
      return { amount: null, hadExplicitCurrencyMarker: false, matchText: null, warnings };
    }
    const last = bare[bare.length - 1];
    warnings.push("Currency was assumed to be INR.");
    if (bare.length > 1) {
      warnings.push("Receipt contains multiple possible amounts; used the last number found.");
    }
    return { amount: toNumber(last[0]), hadExplicitCurrencyMarker: false, matchText: last[0], warnings };
  }

  pool.sort((a, b) => (b.score - a.score) || (b.index - a.index));
  const best = pool[0];
  const hadMarker = best.score === 3 || best.score === 1;
  if (!hadMarker) {
    warnings.push("Currency was assumed to be INR.");
  }

  const rivals = pool.filter(
    (c) => c.score === best.score && c.value !== best.value && c.index !== best.index
  );
  if (rivals.length > 0) {
    warnings.push("Receipt contains multiple possible amounts; used the most likely one.");
  }

  return { amount: best.value, hadExplicitCurrencyMarker: hadMarker, matchText: best.matchText, warnings };
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------
//
// Numeric and day+month-name dates are handled by our own explicit,
// day-first (Indian convention) rules — deliberately not delegated to
// chrono-node's default US-style (month-first) slash-date parsing, since
// "03/09" needs to mean 3 September here, not March 9. chrono-node is
// used only as a fallback for anything these rules don't recognize.

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const ISO_DATE_RE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const NUMERIC_DMY_RE = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/;
const DAY_MONTHNAME_RE = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})?\b/;
const NUMERIC_DM_RE = /\b(\d{1,2})[/-](\d{1,2})\b/;

/** Constructs a Date and rejects anything that isn't a real calendar date (no silent Feb-30-rolls-into-March). */
function tryConstructDate(day: number, month: number, year: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000 || year > 9999) return null;
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

interface DateExtraction {
  date: Date | null;
  span: [number, number] | null;
  warnings: string[];
}

function extractDate(text: string, now: Date): DateExtraction {
  const warnings: string[] = [];

  let m = text.match(ISO_DATE_RE);
  if (m) {
    const date = tryConstructDate(Number(m[3]), Number(m[2]), Number(m[1]));
    if (date) return { date, span: [m.index!, m.index! + m[0].length], warnings };
    warnings.push("Receipt contained an invalid date and it was ignored.");
  }

  m = text.match(NUMERIC_DMY_RE);
  if (m) {
    const date = tryConstructDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (date) return { date, span: [m.index!, m.index! + m[0].length], warnings };
    warnings.push("Receipt contained an invalid date and it was ignored.");
  }

  m = text.match(DAY_MONTHNAME_RE);
  if (m) {
    const month = MONTH_NAMES[m[2].toLowerCase()];
    if (month) {
      const yearGiven = m[3] !== undefined;
      const year = yearGiven ? Number(m[3]) : now.getFullYear();
      const date = tryConstructDate(Number(m[1]), month, year);
      if (date) {
        if (!yearGiven) warnings.push(`Year not specified in the receipt; assumed ${year}.`);
        return { date, span: [m.index!, m.index! + m[0].length], warnings };
      }
      warnings.push("Receipt contained an invalid date and it was ignored.");
    }
  }

  m = text.match(NUMERIC_DM_RE);
  if (m) {
    const year = now.getFullYear();
    const date = tryConstructDate(Number(m[1]), Number(m[2]), year);
    if (date) {
      warnings.push(`Year not specified in the receipt; assumed ${year}.`);
      return { date, span: [m.index!, m.index! + m[0].length], warnings };
    }
    warnings.push("Receipt contained an invalid date and it was ignored.");
  }

  // Fallback: chrono-node, for anything our explicit rules above didn't
  // match (relative phrases, ordinal-only text, etc).
  const chronoResults = chrono.parse(text, now, { forwardDate: false });
  if (chronoResults.length > 0) {
    const result = chronoResults[0];
    const date = result.start.date();
    const yearGiven = result.start.isCertain("year");
    if (!yearGiven) {
      warnings.push(`Year not specified in the receipt; assumed ${date.getFullYear()}.`);
    }
    return { date, span: [result.index, result.index + result.text.length], warnings };
  }

  warnings.push("Could not determine the expense date.");
  return { date: null, span: null, warnings };
}

// ---------------------------------------------------------------------------
// Merchant extraction
// ---------------------------------------------------------------------------
//
// Not an exhaustive whitelist — just normalization for the handful of
// vendors that show up constantly in this kind of receipt, so "OLA",
// "ola cab" and "Ola auto" all read as the same merchant. Anything else
// falls back to a first-meaningful-line heuristic.

const KNOWN_MERCHANTS: Array<{ canonical: string; pattern: RegExp }> = [
  { canonical: "Ola", pattern: /\bola\b/i },
  { canonical: "Uber", pattern: /\buber\b/i },
  { canonical: "IRCTC", pattern: /\birctc\b/i },
  { canonical: "Swiggy", pattern: /\bswiggy\b/i },
  { canonical: "Zomato", pattern: /\bzomato\b/i },
  { canonical: "Amazon", pattern: /\bamazon(?:\s+business)?\b/i },
  { canonical: "Cafe Coffee Day", pattern: /\bcafe coffee day\b|\bccd\b/i },
  { canonical: "MakeMyTrip", pattern: /\bmakemytrip\b/i },
  { canonical: "IndiGo Airlines", pattern: /\bindigo(?:\s+airlines)?\b/i },
  { canonical: "SpiceJet", pattern: /\bspicejet\b/i },
  { canonical: "Reliance Digital", pattern: /\breliance digital\b/i },
  { canonical: "Staples", pattern: /\bstaples\b/i },
];

function findKnownMerchant(text: string): { canonical: string; match: string } | null {
  for (const { canonical, pattern } of KNOWN_MERCHANTS) {
    const m = text.match(pattern);
    if (m) return { canonical, match: m[0] };
  }
  return null;
}

interface MerchantExtraction {
  merchant: string | null;
  known: boolean;
}

function extractMerchant(
  text: string,
  dateMatchText: string | null,
  amountMatchText: string | null
): MerchantExtraction {
  const known = findKnownMerchant(text);
  if (known) return { merchant: known.canonical, known: true };

  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return { merchant: null, known: false };

  const beforeSeparator = firstLine.split(/\s[-–:]\s/)[0];

  // Remove only the already-*validated* date/amount matches (see
  // buildDescription's comment for why this isn't a blind regex pass).
  let withoutKnownMatches = beforeSeparator;
  if (dateMatchText) withoutKnownMatches = withoutKnownMatches.replace(dateMatchText, " ");
  if (amountMatchText) withoutKnownMatches = withoutKnownMatches.replace(amountMatchText, " ");

  const stripped = withoutKnownMatches
    .replace(/[^a-zA-Z0-9&'.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped) return { merchant: null, known: false };

  // Deliberately NOT title-casing every word here: we don't actually know
  // this is a proper noun (it might just be leftover generic text, e.g.
  // "stationery items"), so re-casing it would look more confident than
  // the extraction really is. Preserve the source's own casing, and only
  // capitalize the very first character for a minimally tidy presentation.
  const merchant = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  return { merchant, known: false };
}

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------
//
// Deterministic keyword scoring: count distinct keyword hits per
// category, highest count wins. Counting (rather than "first pattern in
// list order wins") is what correctly resolves a receipt that mentions
// more than one category's keywords, e.g. "Conference travel ... Flight +
// cab" — TRAVEL ("travel", "flight") outscores TAXI ("cab") 2-to-1.

const CATEGORY_KEYWORDS: Record<Exclude<ExpenseCategory, "OTHER">, string[]> = {
  TAXI: ["ola", "uber", "auto", "cab", "taxi"],
  MEALS: [
    "restaurant", "cafe", "lunch", "dinner", "breakfast", "food", "swiggy",
    "zomato", "snacks", "chai", "coffee", "cappuccino", "sandwich", "meal",
  ],
  SUPPLIES: [
    "amazon", "stationery", "supplies", "mouse", "keyboard", "printer",
    "cartridge", "laptop bag", "hub", "cable", "staples",
  ],
  TRAVEL: [
    "irctc", "train", "flight", "hotel", "airline", "airlines", "makemytrip",
    "spicejet", "indigo", "booking", "travel", "bus ticket",
  ],
};

interface CategoryClassification {
  category: ExpenseCategory;
  matched: boolean;
}

function classifyCategory(text: string): CategoryClassification {
  const lower = text.toLowerCase();
  let best: { category: ExpenseCategory; score: number } = { category: "OTHER", score: 0 };

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as Array<
    [Exclude<ExpenseCategory, "OTHER">, string[]]
  >) {
    const score = keywords.filter((kw) => new RegExp(`\\b${kw}\\b`, "i").test(lower)).length;
    if (score > best.score) best = { category, score };
  }

  if (best.score === 0) return { category: "OTHER", matched: false };
  return { category: best.category, matched: true };
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------
//
// A cleaned-up remainder of the raw text with the already-*validated*
// date/amount/known-merchant fragments stripped back out — not the raw
// text verbatim, and not an attempt to invent semantic detail (no city-
// code expansion, no guessing what "train" vs "cab" means beyond what's
// already in the category).
//
// Deliberately takes the literal matched substrings that extractDate/
// extractAmount already validated, rather than re-running their regexes
// independently here: DAY_MONTHNAME_RE, for instance, matches "1
// sandwich" just as readily as "3 Sep" at the regex level — extractDate
// rejects it because "sandwich" isn't in MONTH_NAMES, but a second,
// unvalidated pass over the same pattern would happily strip it anyway.
// Removing exactly what was already proven real avoids that whole class
// of false-positive stripping.

const MAX_DESCRIPTION_LENGTH = 140;

function buildDescription(rawText: string, matchesToRemove: Array<string | null>): string {
  let remainder = rawText;
  for (const match of matchesToRemove) {
    if (match) remainder = remainder.replace(match, " ");
  }

  const cleaned = remainder
    .replace(/[\r\n]+/g, " ")
    .replace(/[:#/]/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Expense";

  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  if (capitalized.length <= MAX_DESCRIPTION_LENGTH) return capitalized;

  const truncated = capitalized.slice(0, MAX_DESCRIPTION_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated).trimEnd() + "…";
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------
//
// A deterministic, explainable point score — not a machine-learning
// confidence. Each of the four important fields contributes points based
// on how it was found; the total (0–1) reflects how much of the receipt
// was reliably understood.

function scoreMerchant(m: MerchantExtraction): number {
  if (m.merchant === null) return 0;
  return m.known ? 0.25 : 0.15;
}

function scoreDate(d: DateExtraction): number {
  if (d.date === null) return 0;
  const yearAssumed = d.warnings.some((w) => w.startsWith("Year not specified"));
  return yearAssumed ? 0.22 : 0.3;
}

function scoreAmount(a: AmountExtraction): number {
  if (a.amount === null) return 0;
  if (!a.hadExplicitCurrencyMarker) return 0.1;
  return 0.3;
}

function scoreCategory(c: CategoryClassification): number {
  return c.matched ? 0.15 : 0;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parseReceiptText(rawText: string, options: ParseReceiptOptions = {}): ParsedReceipt {
  const now = options.now ?? new Date();
  const warnings: string[] = [];

  const dateResult = extractDate(rawText, now);
  warnings.push(...dateResult.warnings);
  const dateMatchText = dateResult.span ? rawText.slice(dateResult.span[0], dateResult.span[1]) : null;

  const amountResult = extractAmount(rawText, dateResult.span ? [dateResult.span] : []);
  warnings.push(...amountResult.warnings);

  const merchantResult = extractMerchant(rawText, dateMatchText, amountResult.matchText);
  if (merchantResult.merchant === null) {
    warnings.push("Could not determine the merchant.");
  } else if (!merchantResult.known) {
    warnings.push("Merchant name could not be confidently identified from a known vendor list.");
  }

  const categoryResult = classifyCategory(rawText);
  if (!categoryResult.matched) {
    warnings.push("Category could not be confidently determined; defaulted to Other.");
  }

  const knownMerchantMatch = findKnownMerchant(rawText)?.match ?? null;
  const description = buildDescription(rawText, [knownMerchantMatch, dateMatchText, amountResult.matchText]);

  const currency: "INR" | null = amountResult.amount !== null ? "INR" : null;

  const confidence = Math.min(
    1,
    Math.max(
      0,
      scoreMerchant(merchantResult) + scoreDate(dateResult) + scoreAmount(amountResult) + scoreCategory(categoryResult)
    )
  );

  return {
    merchant: merchantResult.merchant,
    date: dateResult.date,
    amount: amountResult.amount,
    currency,
    category: categoryResult.category,
    description,
    confidence: Math.round(confidence * 100) / 100,
    warnings,
  };
}
