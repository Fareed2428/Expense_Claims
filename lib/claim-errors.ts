/**
 * Typed domain errors for the claim service layer, each carrying the HTTP
 * status the API routes should map it to. Keeping the status on the error
 * itself (same pattern as lib/auth.ts's AuthError) means a route handler
 * never has to guess a status code — see claimErrorResponse below.
 *
 * These are business-rule errors, not infrastructure errors: a route
 * handler should catch exactly these (plus AuthError from lib/auth.ts)
 * and let anything else propagate as an unhandled 500 — never translate a
 * raw Prisma/database error into a client-facing message.
 */

export class ClaimServiceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

/** No authenticated user at all. Route handlers normally catch this via lib/auth.ts's AuthError first — this exists for service-layer defense in depth (see the module-level "don't just trust the caller" note in claim-service.ts). */
export class UnauthorizedError extends ClaimServiceError {
  constructor(message = "Authentication required.") {
    super(401, message);
  }
}

/** Authenticated, but not allowed to perform this operation (wrong role, not the assigned approver, not the claimant, etc). */
export class ForbiddenError extends ClaimServiceError {
  constructor(message = "You do not have access to this claim.") {
    super(403, message);
  }
}

export class ClaimNotFoundError extends ClaimServiceError {
  constructor(claimId: string) {
    super(404, `Claim ${claimId} was not found.`);
  }
}

/** The requested status transition isn't allowed from the claim's current status — see lib/claim-state-machine.ts. Also used by the concurrency-safe conditional update when a race means the claim's status changed between the check and the write. */
export class InvalidTransitionError extends ClaimServiceError {
  constructor(from: string, to: string) {
    super(409, `Cannot move a claim from ${from} to ${to}.`);
  }
}

/** The one rule CLAUDE.md calls out as non-negotiable: a manager can never approve or reject their own claim. Kept as its own error type (rather than folding into ForbiddenError) so it reads unambiguously in logs/tests — this specific rule failing is never something to shrug off as a generic permissions issue. */
export class SelfApprovalNotAllowedError extends ClaimServiceError {
  constructor() {
    super(403, "A manager cannot approve or reject their own claim.");
  }
}

/** The claim's data doesn't satisfy a business rule for the requested operation (e.g. submitting with no amount, rejecting with no note). */
export class InvalidClaimDataError extends ClaimServiceError {
  constructor(message: string) {
    super(400, message);
  }
}

/** payClaim() refuses a duplicateFlag=true claim until acknowledgeDuplicate() has been called by Finance. */
export class DuplicateAcknowledgementRequiredError extends ClaimServiceError {
  constructor() {
    super(
      409,
      "This claim is flagged as a possible duplicate and must be acknowledged by Finance before it can be paid."
    );
  }
}

/**
 * Converts a ClaimServiceError into the NextResponse a route handler
 * should return. Returns null for anything else so the caller can
 * rethrow it (mirrors lib/auth.ts's authErrorResponse — the two are
 * meant to be tried in the same catch block).
 */
export function claimErrorResponse(err: unknown): Response | null {
  if (err instanceof ClaimServiceError) {
    return Response.json({ error: err.message, code: err.name }, { status: err.status });
  }
  return null;
}
