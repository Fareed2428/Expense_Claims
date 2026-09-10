/**
 * Small, pure UI-decision helpers extracted out of the claim detail page
 * so "which action does this viewer get for this claim" is independently
 * testable without rendering anything — and so the answer only has one
 * place to be wrong. These decide what the UI *offers*; the server (via
 * lib/claim-service.ts) is still what actually enforces it — a bug here
 * would at worst show/hide a button incorrectly, never grant a real
 * permission (see CLAUDE.md: "do not rely on hiding buttons for
 * authorization").
 */

import type { ClaimStatus, UserRole } from "@prisma/client";

interface ClaimForUiDecisions {
  status: ClaimStatus;
  claimantId: string;
}

interface ClaimForReviewDecision {
  status: ClaimStatus;
  claimantId: string;
  approverId: string | null;
}

/** A REJECTED claim's owner gets the "Edit & Resubmit" panel. Nobody else, and no other status — in particular, never a PAID claim, which is terminal. */
export function canResubmit(claim: ClaimForUiDecisions, viewerId: string): boolean {
  return claim.status === "REJECTED" && claim.claimantId === viewerId;
}

/** A PARSED (draft) claim's owner gets a "Continue editing" link back into the create-claim flow. */
export function canContinueEditingDraft(claim: ClaimForUiDecisions, viewerId: string): boolean {
  return claim.status === "PARSED" && claim.claimantId === viewerId;
}

/** True for any status where nothing further can be done from the Staff UI — no submit, no resubmit, nothing. PAID is always terminal; APPROVED and SUBMITTED are just "waiting," not actionable by the claimant either. */
export function hasNoClaimantAction(claim: ClaimForUiDecisions, viewerId: string): boolean {
  if (claim.claimantId !== viewerId) return true;
  return claim.status === "PAID" || claim.status === "APPROVED" || claim.status === "SUBMITTED";
}

/**
 * A manager gets Approve/Reject actions only for a SUBMITTED claim
 * assigned to them, and never for their own claim — the UI-side mirror of
 * the self-approval rule lib/claim-service.ts's assertCanReview()
 * actually enforces server-side. A bug here would at worst show a button
 * that the server then correctly refuses; it can never grant a real
 * permission (see this file's header comment).
 */
export function canReview(claim: ClaimForReviewDecision, actor: { id: string; role: UserRole }): boolean {
  if (actor.role !== "MANAGER") return false;
  if (claim.status !== "SUBMITTED") return false;
  if (claim.claimantId === actor.id) return false;
  return claim.approverId === actor.id;
}

/**
 * A duplicate-flagged claim needs Finance to explicitly acknowledge it
 * before it can be paid — the UI-side mirror of payClaim()'s
 * DuplicateAcknowledgementRequiredError. True only while the flag is set
 * AND nobody has acknowledged it yet; once duplicateAcknowledgedAt is
 * set, the warning is still shown (for context) but this returns false.
 */
export function needsDuplicateAcknowledgement(claim: {
  duplicateFlag: boolean;
  duplicateAcknowledgedAt: string | Date | null;
}): boolean {
  return claim.duplicateFlag && claim.duplicateAcknowledgedAt === null;
}

/**
 * Finance gets a Pay action only for an APPROVED claim — never PARSED,
 * SUBMITTED, REJECTED, or (terminal) PAID. Whether a flagged-but-not-yet-
 * acknowledged claim can actually be paid is a separate question (see
 * needsDuplicateAcknowledgement above); this only answers "is Finance
 * looking at something payable at all." The real enforcement, including
 * the duplicate-acknowledgement gate, is payClaim() in
 * lib/claim-service.ts — this is defense-in-depth only, same as every
 * other helper in this file.
 */
export function canPay(claim: { status: ClaimStatus }, actor: { role: UserRole }): boolean {
  return actor.role === "FINANCE" && claim.status === "APPROVED";
}
