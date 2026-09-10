/**
 * Shared request-body → ClaimCorrections parsing, used by both
 * PATCH /api/claims/[id] (correcting a PARSED draft) and
 * POST /api/claims/[id]/resubmit (correcting + resubmitting a REJECTED
 * claim) — both accept the same shape, so the validation lives once here
 * rather than being copied between the two route files.
 */

import type { ExpenseCategory } from "@prisma/client";
import type { ClaimCorrections } from "@/lib/claim-service";
import { InvalidClaimDataError } from "@/lib/claim-errors";

const VALID_CATEGORIES: readonly ExpenseCategory[] = ["TRAVEL", "MEALS", "SUPPLIES", "TAXI", "OTHER"];

export function parseClaimCorrections(body: unknown): ClaimCorrections {
  const raw = (body ?? {}) as Record<string, unknown>;
  const corrections: ClaimCorrections = {};

  if (raw.rawReceiptText !== undefined) {
    if (typeof raw.rawReceiptText !== "string") throw new InvalidClaimDataError("rawReceiptText must be a string.");
    corrections.rawReceiptText = raw.rawReceiptText;
  }
  if (raw.merchant !== undefined) {
    if (typeof raw.merchant !== "string") throw new InvalidClaimDataError("merchant must be a string.");
    corrections.merchant = raw.merchant;
  }
  if (raw.amount !== undefined) {
    if (typeof raw.amount !== "number") throw new InvalidClaimDataError("amount must be a number.");
    corrections.amount = raw.amount;
  }
  if (raw.expenseDate !== undefined) {
    const date = new Date(raw.expenseDate as string);
    if (Number.isNaN(date.getTime())) throw new InvalidClaimDataError("expenseDate must be a valid date.");
    corrections.expenseDate = date;
  }
  if (raw.category !== undefined) {
    if (!VALID_CATEGORIES.includes(raw.category as ExpenseCategory)) {
      throw new InvalidClaimDataError(`category must be one of: ${VALID_CATEGORIES.join(", ")}.`);
    }
    corrections.category = raw.category as ExpenseCategory;
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") throw new InvalidClaimDataError("description must be a string.");
    corrections.description = raw.description;
  }

  return corrections;
}

/** Reads a request body that's allowed to be empty (no corrections at all is valid for both PATCH and resubmit). */
export async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidClaimDataError("Invalid request body.");
  }
}
