/**
 * The claim lifecycle — single source of truth for which status
 * transitions are allowed. Every place that changes a claim's status
 * (claim-service.ts, exclusively — see that file's header) goes through
 * assertValidTransition() first, so "paid is terminal" and "no skipping
 * states" are true because the code can't do otherwise, not just by
 * convention.
 *
 *   PARSED ──submit──────▶ SUBMITTED ──approve──▶ APPROVED ──pay──▶ PAID
 *                              │
 *                              └──reject──▶ REJECTED ──resubmit──▶ SUBMITTED
 *
 * PAID has no outgoing edges at all. APPROVED's only outgoing edge is to
 * PAID — an approved claim can't be rejected after the fact; paying it is
 * the only thing left that can happen to it.
 */

import type { ClaimStatus } from "@prisma/client";
import { InvalidTransitionError } from "@/lib/claim-errors";

const ALLOWED_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  PARSED: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  APPROVED: ["PAID"],
  REJECTED: ["SUBMITTED"],
  PAID: [],
};

export function allowedNextStatuses(from: ClaimStatus): readonly ClaimStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throws InvalidTransitionError if the transition isn't allowed; otherwise returns void. */
export function assertValidTransition(from: ClaimStatus, to: ClaimStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
