/**
 * Claim service — the one place claim business rules live.
 *
 * ARCHITECTURE RULE: every write to Claim.status, and every rule around
 * who may do what to a claim, lives here — never in a React component,
 * never only in an API route handler. Route handlers (app/api/claims/**)
 * do exactly three things: authenticate/authorize the request (via
 * lib/auth.ts), parse/validate the request shape, and call one of the
 * functions below. If a rule needs to change, it changes in this file.
 *
 * Every status-changing operation goes through applyTransition(), which
 * is the *only* place `Claim.status` is written anywhere in this module
 * (or the codebase). That's what makes "paid is terminal" and "no
 * skipping states" actually true rather than just documented — see
 * lib/claim-state-machine.ts for the transition table itself, and the
 * concurrency note on applyTransition for how a race between two
 * requests is handled.
 */

import type { Claim, ClaimEventType, ClaimStatus, ExpenseCategory, Prisma, User, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";
import { assertValidTransition } from "@/lib/claim-state-machine";
import {
  ClaimNotFoundError,
  DuplicateAcknowledgementRequiredError,
  ForbiddenError,
  InvalidClaimDataError,
  InvalidTransitionError,
  SelfApprovalNotAllowedError,
} from "@/lib/claim-errors";
import { normalizeReceiptText, parseReceiptText } from "@/lib/receipt-parser";
import { detectDuplicates, hashNormalizedText, recordDuplicateMatches } from "@/lib/duplicate-detector";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const CLAIM_INCLUDE = {
  claimant: { select: { id: true, name: true, email: true, role: true, managerId: true } },
  approver: { select: { id: true, name: true, email: true, role: true } },
  paidBy: { select: { id: true, name: true, email: true, role: true } },
  duplicateAcknowledgedBy: { select: { id: true, name: true, email: true, role: true } },
  receipt: true,
  // Includes the actor's name/role (not just actorId) — Phase 7's audit
  // history UI needs to say who did what, not just show an opaque id.
  events: {
    orderBy: { createdAt: "asc" as const },
    include: { actor: { select: { id: true, name: true, role: true } } },
  },
  // Includes the matched claim's own summary fields (not just its id) —
  // Phase 7's duplicate warning needs to show the *previous* claim's
  // merchant/amount/date/status, per CLAUDE.md's example warning copy.
  duplicatesFound: {
    include: {
      matchedClaim: {
        select: { id: true, merchant: true, amount: true, expenseDate: true, status: true, claimantId: true },
      },
    },
  },
} satisfies Prisma.ClaimInclude;

export type ClaimWithRelations = Prisma.ClaimGetPayload<{ include: typeof CLAIM_INCLUDE }>;

export interface CreateClaimInput {
  rawReceiptText: string;
}

/** Fields the claimant may correct on their own PARSED claim before submitting, or on a REJECTED claim when resubmitting. Never includes status, claimantId, approverId, paidById, or anything else the client shouldn't be able to set directly. */
export interface ClaimCorrections {
  merchant?: string;
  amount?: number;
  expenseDate?: Date;
  category?: ExpenseCategory;
  description?: string;
  /** If provided, the receipt is re-parsed and the Receipt row updated; corrections above are then applied on top of the fresh parse. */
  rawReceiptText?: string;
}

export interface ListClaimsFilter {
  status?: ClaimStatus;
}

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

function requireNonEmptyText(value: string, message: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) throw new InvalidClaimDataError(message);
  return trimmed;
}

async function findClaimOrThrow(claimId: string): Promise<ClaimWithRelations> {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, include: CLAIM_INCLUDE });
  if (!claim) throw new ClaimNotFoundError(claimId);
  return claim;
}

/**
 * Resolves who a claim should route to for approval: the claimant's own
 * manager. There is deliberately no fallback here for a manager with no
 * manager of their own (User.managerId null, i.e. the top of the
 * hierarchy) — the seeded demo data resolves that one specific case
 * (Arjun's claims going to Priya) by assigning it directly at seed time,
 * not through this general rule. A *new* claim from a manager with no
 * manager assigned will correctly fail with InvalidClaimDataError here;
 * see the Phase 6 report for why that's a documented limitation rather
 * than a guessed-at fallback.
 */
async function resolveApprover(claimant: Pick<User, "id" | "managerId">): Promise<string> {
  if (!claimant.managerId) {
    throw new InvalidClaimDataError(
      "No manager is assigned to this account, so a claim can't be routed for approval. Ask an administrator to set a manager first."
    );
  }
  return claimant.managerId;
}

/**
 * Re-runs duplicate detection for a claim's current field values and
 * updates duplicateFlag/duplicateScore + DuplicateMatch rows accordingly
 * — reusing lib/duplicate-detector.ts's own detectDuplicates()/
 * recordDuplicateMatches() rather than re-implementing any of that logic
 * here (Phase 5's algorithm is the single source of truth for what
 * counts as a duplicate). Only logs a DUPLICATE_ACKNOWLEDGED-adjacent
 * DUPLICATE_FLAGGED ClaimEvent when the claim is *newly* becoming
 * flagged, so re-checking an already-flagged claim on every resubmit
 * doesn't spam the audit trail.
 */
async function runDuplicateCheck(
  claim: Pick<Claim, "id" | "claimantId" | "merchant" | "amount" | "expenseDate" | "category" | "rawReceiptText" | "duplicateFlag">,
  actorId: string | null
): Promise<{ isDuplicate: boolean; score: number }> {
  const result = await detectDuplicates({
    claimantId: claim.claimantId,
    rawReceiptText: claim.rawReceiptText,
    merchant: claim.merchant,
    amount: claim.amount.toNumber(),
    expenseDate: claim.expenseDate,
    category: claim.category,
    excludeClaimId: claim.id,
  });

  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      duplicateFlag: result.isDuplicate,
      duplicateScore: result.isDuplicate ? result.score : null,
    },
  });

  if (result.isDuplicate) {
    await recordDuplicateMatches(claim.id, result);

    if (!claim.duplicateFlag) {
      await prisma.claimEvent.create({
        data: {
          claimId: claim.id,
          actorId,
          eventType: "DUPLICATE_FLAGGED",
          note: `Flagged as a possible duplicate (score ${result.score.toFixed(2)}).`,
        },
      });
    }
  }

  return { isDuplicate: result.isDuplicate, score: result.score };
}

/**
 * The *only* place Claim.status is ever written. Applies the transition
 * with a conditional `updateMany` — `WHERE id = ? AND status = ?` — so
 * two concurrent requests trying to move the same claim (e.g. two
 * managers double-clicking Approve at once) can't both succeed: only the
 * request that wins the race actually matches a row; the loser's
 * updateMany affects 0 rows and this throws InvalidTransitionError,
 * exactly as if it had raced against a real state change (which, from
 * its perspective, it did). This is a plain `UPDATE ... WHERE status = ?`
 * at the SQL level, so it's atomic without needing a raw query or a
 * SELECT-then-UPDATE that a real concurrent request could still slip
 * between.
 */
async function applyTransition(
  claimId: string,
  from: ClaimStatus,
  to: ClaimStatus,
  data: Prisma.ClaimUncheckedUpdateManyInput,
  event: { actorId: string | null; eventType: ClaimEventType; note?: string | null }
): Promise<void> {
  assertValidTransition(from, to);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.claim.updateMany({
      where: { id: claimId, status: from },
      data: { ...data, status: to },
    });
    if (updated.count === 0) return null;

    await tx.claimEvent.create({
      data: {
        claimId,
        actorId: event.actorId,
        eventType: event.eventType,
        fromStatus: from,
        toStatus: to,
        note: event.note ?? null,
      },
    });
    return updated;
  });

  if (result === null) {
    // Someone else changed the claim's status between our read and this
    // write — report it the same way any other invalid transition is
    // reported, since from the caller's point of view that's exactly
    // what happened.
    throw new InvalidTransitionError(from, to);
  }
}

// ---------------------------------------------------------------------------
// createClaim
// ---------------------------------------------------------------------------

/**
 * Parses raw receipt text server-side (never trusting client-supplied
 * parsed fields — there aren't any accepted here, only the raw text) and
 * creates a new PARSED claim + its Receipt. Runs an early, non-blocking
 * duplicate check: a flagged claim is still created — CLAUDE.md's policy
 * is "flag, don't block" all the way from filing through to payment.
 */
export async function createClaim(actor: SessionUser, input: CreateClaimInput): Promise<ClaimWithRelations> {
  if (actor.role !== "STAFF" && actor.role !== "MANAGER") {
    // Finance isn't a claimant in this model — see CLAUDE.md's role table.
    throw new ForbiddenError("Only staff and managers file expense claims.");
  }

  const rawReceiptText = requireNonEmptyText(input.rawReceiptText, "Receipt text is required.");
  const parsed = parseReceiptText(rawReceiptText);
  const normalizedText = normalizeReceiptText(rawReceiptText);
  const textHash = hashNormalizedText(normalizedText);

  // The parser never invents data it isn't confident about — it returns
  // null instead (see lib/receipt-parser.ts). A claim record still needs
  // *some* value for these required, non-nullable columns, so we fall
  // back to honest placeholders here; submitClaim() below is what
  // actually enforces that a real amount/merchant exists before the
  // claim can move forward, matching CLAUDE.md's parse → review → submit
  // design (the user corrects placeholders, they don't block creation).
  const merchant = parsed.merchant ?? "Unknown merchant";
  const amount = parsed.amount ?? 0;
  const category = parsed.category ?? "OTHER";
  const expenseDate = parsed.date ?? new Date();
  const description = parsed.description;

  const claim = await prisma.$transaction(async (tx) => {
    const created = await tx.claim.create({
      data: {
        claimantId: actor.id,
        status: "PARSED",
        category,
        merchant,
        amount,
        currency: "INR",
        expenseDate,
        description,
        rawReceiptText,
      },
    });

    await tx.receipt.create({
      data: {
        claimId: created.id,
        sourceType: "PASTED_TEXT",
        rawText: rawReceiptText,
        normalizedText,
        textHash,
        parsedMerchant: parsed.merchant,
        parsedDate: parsed.date,
        parsedAmount: parsed.amount,
        parsedCategory: parsed.category,
        parseConfidence: parsed.confidence,
        parseWarnings: parsed.warnings,
      },
    });

    await tx.claimEvent.create({
      data: { claimId: created.id, actorId: actor.id, eventType: "CREATED", toStatus: "PARSED" },
    });
    await tx.claimEvent.create({
      data: {
        claimId: created.id,
        actorId: actor.id,
        eventType: "PARSED",
        fromStatus: "PARSED",
        toStatus: "PARSED",
        note: `Receipt text parsed automatically (confidence ${parsed.confidence.toFixed(2)}).`,
      },
    });

    return created;
  });

  // Duplicate detection reads the claim we just created (to exclude it
  // from its own candidate set) and writes DuplicateMatch rows — both
  // require the claim to already exist, so this runs as an immediately-
  // following step rather than inside the transaction above. Worst case
  // on a crash between the two: the claim exists but isn't flagged yet: a
  // later submit/resubmit re-check (see runDuplicateCheck's call sites)
  // would still catch it.
  await runDuplicateCheck(claim, actor.id);

  return findClaimOrThrow(claim.id);
}

// ---------------------------------------------------------------------------
// updateClaim — correcting a PARSED draft before its first submission
// ---------------------------------------------------------------------------

/**
 * Not one of the phase's required minimum operations, but a small,
 * clearly-scoped addition: CLAUDE.md's whole design is "show the parsed
 * result back to the user... they will correct it sometimes" *before* it
 * goes to a manager, and there is no other way to apply that correction
 * without this. Only touches a PARSED claim owned by the caller; creates
 * an EDITED event (an enum value that otherwise goes unused outside the
 * seed data).
 */
export async function updateClaim(
  actor: SessionUser,
  claimId: string,
  corrections: ClaimCorrections
): Promise<ClaimWithRelations> {
  const claim = await findClaimOrThrow(claimId);

  if (claim.claimantId !== actor.id) {
    throw new ForbiddenError("You can only edit your own claims.");
  }
  if (claim.status !== "PARSED") {
    throw new InvalidClaimDataError("Only a claim that hasn't been submitted yet can be edited.");
  }

  const data: Prisma.ClaimUpdateInput = {};
  let normalizedText: string | undefined;
  let textHash: string | undefined;
  let reparsed: ReturnType<typeof parseReceiptText> | undefined;

  if (corrections.rawReceiptText) {
    const rawReceiptText = requireNonEmptyText(corrections.rawReceiptText, "Receipt text cannot be empty.");
    reparsed = parseReceiptText(rawReceiptText);
    normalizedText = normalizeReceiptText(rawReceiptText);
    textHash = hashNormalizedText(normalizedText);
    data.rawReceiptText = rawReceiptText;
    data.merchant = reparsed.merchant ?? claim.merchant;
    data.amount = reparsed.amount ?? claim.amount;
    data.category = reparsed.category ?? claim.category;
    data.expenseDate = reparsed.date ?? claim.expenseDate;
    data.description = reparsed.description;
  }

  if (corrections.merchant !== undefined) data.merchant = requireNonEmptyText(corrections.merchant, "Merchant cannot be empty.");
  if (corrections.amount !== undefined) {
    if (!Number.isFinite(corrections.amount) || corrections.amount <= 0) {
      throw new InvalidClaimDataError("Amount must be a positive number.");
    }
    data.amount = corrections.amount;
  }
  if (corrections.expenseDate !== undefined) data.expenseDate = corrections.expenseDate;
  if (corrections.category !== undefined) data.category = corrections.category;
  if (corrections.description !== undefined) data.description = requireNonEmptyText(corrections.description, "Description cannot be empty.");

  if (Object.keys(data).length === 0) {
    return claim; // nothing to do
  }

  await prisma.$transaction(async (tx) => {
    await tx.claim.update({ where: { id: claimId }, data });

    if (reparsed && normalizedText && textHash) {
      await tx.receipt.update({
        where: { claimId },
        data: {
          rawText: data.rawReceiptText as string,
          normalizedText,
          textHash,
          parsedMerchant: reparsed.merchant,
          parsedDate: reparsed.date,
          parsedAmount: reparsed.amount,
          parsedCategory: reparsed.category,
          parseConfidence: reparsed.confidence,
          parseWarnings: reparsed.warnings,
        },
      });
    }

    await tx.claimEvent.create({
      data: {
        claimId,
        actorId: actor.id,
        eventType: "EDITED",
        fromStatus: "PARSED",
        toStatus: "PARSED",
        note: "Claimant corrected the parsed details.",
      },
    });
  });

  const updated = await findClaimOrThrow(claimId);
  await runDuplicateCheck(updated, actor.id);
  return findClaimOrThrow(claimId);
}

// ---------------------------------------------------------------------------
// submitClaim
// ---------------------------------------------------------------------------

export async function submitClaim(actor: SessionUser, claimId: string): Promise<ClaimWithRelations> {
  const claim = await findClaimOrThrow(claimId);

  if (claim.claimantId !== actor.id) {
    throw new ForbiddenError("You can only submit your own claims.");
  }
  if (claim.merchant.trim().length === 0 || claim.merchant === "Unknown merchant") {
    throw new InvalidClaimDataError("A merchant is required before this claim can be submitted.");
  }
  if (claim.amount.toNumber() <= 0) {
    throw new InvalidClaimDataError("A valid amount is required before this claim can be submitted.");
  }

  const approverId = await resolveApprover(claim.claimant);

  await applyTransition(
    claimId,
    "PARSED",
    "SUBMITTED",
    { approverId, submittedAt: new Date() },
    { actorId: actor.id, eventType: "SUBMITTED" }
  );

  const submitted = await findClaimOrThrow(claimId);
  await runDuplicateCheck(submitted, actor.id);
  return findClaimOrThrow(claimId);
}

// ---------------------------------------------------------------------------
// approveClaim / rejectClaim
// ---------------------------------------------------------------------------

function assertCanReview(claim: ClaimWithRelations, actor: SessionUser): void {
  if (actor.role !== "MANAGER") {
    throw new ForbiddenError("Only a manager can review claims.");
  }
  // CRITICAL: checked unconditionally, before anything else, independent
  // of whatever approverId happens to be — a manager can never approve or
  // reject their own claim, full stop. See CLAUDE.md and
  // lib/claim-errors.ts's SelfApprovalNotAllowedError.
  if (claim.claimantId === actor.id) {
    throw new SelfApprovalNotAllowedError();
  }
  if (claim.approverId !== actor.id) {
    throw new ForbiddenError("This claim is not assigned to you for review.");
  }
}

export async function approveClaim(actor: SessionUser, claimId: string): Promise<ClaimWithRelations> {
  const claim = await findClaimOrThrow(claimId);
  assertCanReview(claim, actor);

  await applyTransition(
    claimId,
    "SUBMITTED",
    "APPROVED",
    { decidedAt: new Date(), decisionNote: null },
    { actorId: actor.id, eventType: "APPROVED" }
  );

  return findClaimOrThrow(claimId);
}

export async function rejectClaim(actor: SessionUser, claimId: string, note: string): Promise<ClaimWithRelations> {
  const claim = await findClaimOrThrow(claimId);
  assertCanReview(claim, actor);

  const decisionNote = requireNonEmptyText(note, "A note explaining the rejection is required.");

  await applyTransition(
    claimId,
    "SUBMITTED",
    "REJECTED",
    { decidedAt: new Date(), decisionNote },
    { actorId: actor.id, eventType: "REJECTED", note: decisionNote }
  );

  return findClaimOrThrow(claimId);
}

// ---------------------------------------------------------------------------
// resubmitClaim
// ---------------------------------------------------------------------------

export async function resubmitClaim(
  actor: SessionUser,
  claimId: string,
  corrections?: ClaimCorrections
): Promise<ClaimWithRelations> {
  const claim = await findClaimOrThrow(claimId);

  if (claim.claimantId !== actor.id) {
    throw new ForbiddenError("You can only resubmit your own claims.");
  }
  if (claim.status !== "REJECTED") {
    throw new InvalidTransitionError(claim.status, "SUBMITTED");
  }

  if (corrections && Object.keys(corrections).length > 0) {
    // Re-uses the same field-level validation/re-parsing as updateClaim,
    // but a REJECTED claim isn't PARSED, so it can't call updateClaim()
    // directly (that function only allows editing a PARSED draft). Apply
    // the same corrections logic inline instead, ending with an EDITED
    // event, then the SUBMITTED transition below moves it forward.
    const data: Prisma.ClaimUpdateInput = {};
    let normalizedText: string | undefined;
    let textHash: string | undefined;
    let reparsed: ReturnType<typeof parseReceiptText> | undefined;

    if (corrections.rawReceiptText) {
      const rawReceiptText = requireNonEmptyText(corrections.rawReceiptText, "Receipt text cannot be empty.");
      reparsed = parseReceiptText(rawReceiptText);
      normalizedText = normalizeReceiptText(rawReceiptText);
      textHash = hashNormalizedText(normalizedText);
      data.rawReceiptText = rawReceiptText;
      data.merchant = reparsed.merchant ?? claim.merchant;
      data.amount = reparsed.amount ?? claim.amount;
      data.category = reparsed.category ?? claim.category;
      data.expenseDate = reparsed.date ?? claim.expenseDate;
      data.description = reparsed.description;
    }
    if (corrections.merchant !== undefined) data.merchant = requireNonEmptyText(corrections.merchant, "Merchant cannot be empty.");
    if (corrections.amount !== undefined) {
      if (!Number.isFinite(corrections.amount) || corrections.amount <= 0) {
        throw new InvalidClaimDataError("Amount must be a positive number.");
      }
      data.amount = corrections.amount;
    }
    if (corrections.expenseDate !== undefined) data.expenseDate = corrections.expenseDate;
    if (corrections.category !== undefined) data.category = corrections.category;
    if (corrections.description !== undefined) data.description = requireNonEmptyText(corrections.description, "Description cannot be empty.");

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.claim.update({ where: { id: claimId }, data });
      }
      if (reparsed && normalizedText && textHash) {
        await tx.receipt.update({
          where: { claimId },
          data: {
            rawText: data.rawReceiptText as string,
            normalizedText,
            textHash,
            parsedMerchant: reparsed.merchant,
            parsedDate: reparsed.date,
            parsedAmount: reparsed.amount,
            parsedCategory: reparsed.category,
            parseConfidence: reparsed.confidence,
            parseWarnings: reparsed.warnings,
          },
        });
      }
      await tx.claimEvent.create({
        data: {
          claimId,
          actorId: actor.id,
          eventType: "EDITED",
          fromStatus: "REJECTED",
          toStatus: "REJECTED",
          note: "Claimant corrected the claim before resubmitting.",
        },
      });
    });
  }

  const current = await findClaimOrThrow(claimId);
  if (current.merchant.trim().length === 0 || current.merchant === "Unknown merchant") {
    throw new InvalidClaimDataError("A merchant is required before this claim can be resubmitted.");
  }
  if (current.amount.toNumber() <= 0) {
    throw new InvalidClaimDataError("A valid amount is required before this claim can be resubmitted.");
  }

  // Re-resolve the approver (rather than reusing the previous approverId)
  // so resubmission reflects the claimant's *current* manager, in case it
  // changed since the original submission — see resolveApprover's comment.
  const approverId = await resolveApprover(current.claimant);

  // The previous decision (decidedAt/decisionNote) belongs to the
  // rejection that already happened and is permanently preserved on that
  // REJECTED ClaimEvent's own note — clearing it here reflects that this
  // claim has no *current* decision pending review again.
  await applyTransition(
    claimId,
    "REJECTED",
    "SUBMITTED",
    { approverId, submittedAt: new Date(), decidedAt: null, decisionNote: null },
    { actorId: actor.id, eventType: "SUBMITTED" }
  );

  const resubmitted = await findClaimOrThrow(claimId);
  await runDuplicateCheck(resubmitted, actor.id);
  return findClaimOrThrow(claimId);
}

// ---------------------------------------------------------------------------
// acknowledgeDuplicate / payClaim
// ---------------------------------------------------------------------------

export async function acknowledgeDuplicate(actor: SessionUser, claimId: string): Promise<ClaimWithRelations> {
  if (actor.role !== "FINANCE") {
    throw new ForbiddenError("Only Finance can acknowledge a duplicate warning.");
  }

  const claim = await findClaimOrThrow(claimId);
  if (!claim.duplicateFlag) {
    throw new InvalidClaimDataError("This claim is not flagged as a possible duplicate.");
  }
  if (claim.status === "PAID") {
    throw new InvalidClaimDataError("This claim has already been paid.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.claim.update({
      where: { id: claimId },
      data: { duplicateAcknowledgedAt: new Date(), duplicateAcknowledgedById: actor.id },
    });
    await tx.claimEvent.create({
      data: {
        claimId,
        actorId: actor.id,
        eventType: "DUPLICATE_ACKNOWLEDGED",
        note: "Finance acknowledged the duplicate warning.",
      },
    });
  });

  return findClaimOrThrow(claimId);
}

export async function payClaim(actor: SessionUser, claimId: string): Promise<ClaimWithRelations> {
  if (actor.role !== "FINANCE") {
    throw new ForbiddenError("Only Finance can mark a claim as paid.");
  }

  const claim = await findClaimOrThrow(claimId);

  if (claim.duplicateFlag && !claim.duplicateAcknowledgedAt) {
    throw new DuplicateAcknowledgementRequiredError();
  }

  await applyTransition(
    claimId,
    "APPROVED",
    "PAID",
    { paidAt: new Date(), paidById: actor.id },
    { actorId: actor.id, eventType: "PAID" }
  );

  return findClaimOrThrow(claimId);
}

// ---------------------------------------------------------------------------
// Retrieval — authorization enforced here, not left to the caller/UI
// ---------------------------------------------------------------------------

function canViewClaim(claim: { claimantId: string; approverId: string | null; claimant: { managerId: string | null } }, actor: SessionUser): boolean {
  if (actor.role === "FINANCE") return true;
  if (claim.claimantId === actor.id) return true;
  if (actor.role === "MANAGER") {
    if (claim.approverId === actor.id) return true;
    if (claim.claimant.managerId === actor.id) return true;
  }
  return false;
}

export async function getClaim(actor: SessionUser, claimId: string): Promise<ClaimWithRelations> {
  const claim = await findClaimOrThrow(claimId);
  if (!canViewClaim(claim, actor)) {
    throw new ForbiddenError("You do not have access to this claim.");
  }
  return claim;
}

/**
 * Scopes the query itself to what the actor is allowed to see (same
 * approach as lib/duplicate-detector.ts's candidate query) rather than
 * fetching everything and filtering in memory — Staff/Manager/Finance
 * each get a different `where` clause, per CLAUDE.md's role table.
 */
export async function listClaims(actor: SessionUser, filter: ListClaimsFilter = {}): Promise<ClaimWithRelations[]> {
  const statusFilter = filter.status ? { status: filter.status } : {};

  let scope: Prisma.ClaimWhereInput;
  if (actor.role === "FINANCE") {
    scope = {};
  } else if (actor.role === "MANAGER") {
    scope = {
      OR: [{ claimantId: actor.id }, { approverId: actor.id }, { claimant: { managerId: actor.id } }],
    };
  } else {
    scope = { claimantId: actor.id };
  }

  return prisma.claim.findMany({
    where: { ...scope, ...statusFilter },
    include: CLAIM_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Always scoped to the actor's own filed claims, regardless of role —
 * this is what the Staff/employee-facing views (dashboard, "My Claims")
 * use. Deliberately distinct from listClaims(): a manager's listClaims()
 * scope is intentionally *broader* (it also includes their team's claims,
 * for the review UI a later phase builds), which would be wrong for "my
 * claims" — a manager viewing their own dashboard should see exactly what
 * they personally filed, the same as any other claimant.
 */
export async function listMyClaims(actor: SessionUser, filter: ListClaimsFilter = {}): Promise<ClaimWithRelations[]> {
  const statusFilter = filter.status ? { status: filter.status } : {};
  return prisma.claim.findMany({
    where: { claimantId: actor.id, ...statusFilter },
    include: CLAIM_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

/**
 * A manager's review queue: claims *assigned to them* specifically
 * (`approverId === actor.id`) — deliberately narrower than listClaims()'s
 * manager scope (own + assigned + whole team), which is too broad for
 * "what do I need to review." In particular this never includes the
 * manager's own claims, even when SUBMITTED: they can't approve their own
 * claim (see assertCanReview's self-approval guard in approveClaim/
 * rejectClaim above), so surfacing it in their own review queue would be
 * misleading, not just redundant. Phase 8's /manager page filters the
 * result client-side into "awaiting review" (status SUBMITTED) vs.
 * "recently reviewed" (anything else this manager has decided) rather
 * than issuing two separate queries.
 */
export async function listClaimsForReview(
  actor: SessionUser,
  filter: ListClaimsFilter = {}
): Promise<ClaimWithRelations[]> {
  if (actor.role !== "MANAGER") {
    throw new ForbiddenError("Only a manager has a review queue.");
  }
  const statusFilter = filter.status ? { status: filter.status } : {};
  return prisma.claim.findMany({
    where: { approverId: actor.id, ...statusFilter },
    include: CLAIM_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Monthly spend helper — reporting only, never a filing/submission gate
// (see CLAUDE.md: the monthly limit is surfaced to Finance, not enforced
// as a hard cap). The full dashboard/reporting UI is a later phase; this
// is just the underlying figure it will need.
// ---------------------------------------------------------------------------

export interface MonthlySpend {
  committed: number; // APPROVED + PAID — money that will/did leave the company
  pending: number; // SUBMITTED — filed but not yet decided, not "spend" yet
  limit: number;
  isNearLimit: boolean; // >= 80% of limit, per the seed data's demo scenario
  isOverLimit: boolean;
}

export async function getMonthlySpend(userId: string, monthDate: Date = new Date()): Promise<MonthlySpend> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { monthlyLimit: true } });
  if (!user) throw new ForbiddenError("Unknown user.");

  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);

  const claims = await prisma.claim.findMany({
    where: { claimantId: userId, expenseDate: { gte: monthStart, lt: monthEnd } },
    select: { status: true, amount: true },
  });

  const committed = claims
    .filter((c) => c.status === "APPROVED" || c.status === "PAID")
    .reduce((sum, c) => sum + c.amount.toNumber(), 0);
  const pending = claims
    .filter((c) => c.status === "SUBMITTED")
    .reduce((sum, c) => sum + c.amount.toNumber(), 0);

  const limit = user.monthlyLimit.toNumber();

  return {
    committed,
    pending,
    limit,
    isNearLimit: limit > 0 && committed / limit >= 0.8 && committed < limit,
    isOverLimit: limit > 0 && committed > limit,
  };
}

// ---------------------------------------------------------------------------
// Manager team spending — Phase 8's dashboard rollup. Distinct from
// getMonthlySpend() above, which is one claimant's own figure (what the
// Staff dashboard uses, including for a manager's *own* claims). This is
// "what has my team spent" — CLAUDE.md's manager responsibility of
// "reviews the claims filed by their team" — so it's deliberately scoped
// to the manager's *direct reports* only and excludes the manager's own
// claims (those already have a home: getMonthlySpend() on their own
// dashboard, same as any other claimant). Not a limits/over-limit report —
// that reporting need belongs to Finance (CLAUDE.md Section 3.3), a later
// phase; this is just a simple total, per this phase's scope control.
// ---------------------------------------------------------------------------

export interface ManagerTeamSpend {
  committed: number; // APPROVED + PAID this month, across direct reports
  pending: number; // SUBMITTED this month, across direct reports
  claimCount: number; // total claims filed by direct reports this month, any status
}

export async function getManagerTeamSpend(managerId: string, monthDate: Date = new Date()): Promise<ManagerTeamSpend> {
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);

  const claims = await prisma.claim.findMany({
    where: { claimant: { managerId }, expenseDate: { gte: monthStart, lt: monthEnd } },
    select: { status: true, amount: true },
  });

  const committed = claims
    .filter((c) => c.status === "APPROVED" || c.status === "PAID")
    .reduce((sum, c) => sum + c.amount.toNumber(), 0);
  const pending = claims
    .filter((c) => c.status === "SUBMITTED")
    .reduce((sum, c) => sum + c.amount.toNumber(), 0);

  return { committed, pending, claimCount: claims.length };
}

// ---------------------------------------------------------------------------
// Phase 9 — Finance payment queue + org-wide monthly reporting.
//
// listClaimsForPayment mirrors listClaimsForReview's shape (Phase 8): a
// role-scoped, status-defaulted list, Finance-only. It is deliberately
// NOT month-scoped — an APPROVED claim from last month that still hasn't
// been paid belongs in this queue exactly as much as one from today; the
// three getXMonthlySpend() functions below are the month-scoped reporting
// layer, kept separate on purpose.
//
// monthRange() is a small local helper for the three reporting functions
// below only — getMonthlySpend()/getManagerTeamSpend() above already have
// their own identical inline computation and are left untouched (Phase
// 6/8 code, out of this phase's scope to refactor).
// ---------------------------------------------------------------------------

export async function listClaimsForPayment(
  actor: SessionUser,
  filter: ListClaimsFilter = {}
): Promise<ClaimWithRelations[]> {
  if (actor.role !== "FINANCE") {
    throw new ForbiddenError("Only Finance has a payment queue.");
  }
  const status = filter.status ?? "APPROVED";
  return prisma.claim.findMany({
    where: { status },
    include: CLAIM_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

function monthRange(monthDate: Date): { monthStart: Date; monthEnd: Date } {
  return {
    monthStart: new Date(monthDate.getFullYear(), monthDate.getMonth(), 1),
    monthEnd: new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1),
  };
}

function sumAmount(claims: { amount: Prisma.Decimal }[]): number {
  return claims.reduce((sum, c) => sum + c.amount.toNumber(), 0);
}

/**
 * Org-wide monthly totals — CLAUDE.md Section 3.3's "who spent what"
 * headline figures, not scoped to any one employee or team. Same
 * committed/pending definition as getMonthlySpend()/getManagerTeamSpend()
 * (APPROVED+PAID vs. SUBMITTED, keyed by expenseDate) so "this month"
 * means the same thing everywhere in the app.
 */
export interface FinanceMonthlySpend {
  committed: number; // APPROVED + PAID, org-wide, this month
  pending: number; // SUBMITTED, org-wide, this month
  paid: number; // PAID only, org-wide, this month (a subset of committed)
  claimCount: number;
}

export async function getFinanceMonthlySpend(monthDate: Date = new Date()): Promise<FinanceMonthlySpend> {
  const { monthStart, monthEnd } = monthRange(monthDate);
  const claims = await prisma.claim.findMany({
    where: { expenseDate: { gte: monthStart, lt: monthEnd } },
    select: { status: true, amount: true },
  });

  return {
    committed: sumAmount(claims.filter((c) => c.status === "APPROVED" || c.status === "PAID")),
    pending: sumAmount(claims.filter((c) => c.status === "SUBMITTED")),
    paid: sumAmount(claims.filter((c) => c.status === "PAID")),
    claimCount: claims.length,
  };
}

/**
 * Per-employee monthly spend — "who spent what" broken out by person,
 * plus the near/over-limit classification CLAUDE.md Section 3.3 asks
 * Finance to be able to answer. Only STAFF/MANAGER users are claimants
 * (Finance itself never files claims — see CLAUDE.md's role table), so
 * FINANCE users are excluded from this list rather than showing a
 * meaningless all-zero row.
 */
export interface EmployeeMonthlySpend {
  userId: string;
  name: string;
  role: UserRole;
  limit: number;
  committed: number;
  pending: number;
  remaining: number;
  utilizationPct: number; // committed / limit * 100 (0 when limit is 0)
  isNearLimit: boolean;
  isOverLimit: boolean;
}

export async function getEmployeeMonthlySpend(monthDate: Date = new Date()): Promise<EmployeeMonthlySpend[]> {
  const { monthStart, monthEnd } = monthRange(monthDate);

  const claimants = await prisma.user.findMany({
    where: { role: { in: ["STAFF", "MANAGER"] } },
    select: { id: true, name: true, role: true, monthlyLimit: true },
    orderBy: { name: "asc" },
  });

  const claims = await prisma.claim.findMany({
    where: {
      claimantId: { in: claimants.map((c) => c.id) },
      expenseDate: { gte: monthStart, lt: monthEnd },
    },
    select: { claimantId: true, status: true, amount: true },
  });

  return claimants.map((user) => {
    const own = claims.filter((c) => c.claimantId === user.id);
    const committed = sumAmount(own.filter((c) => c.status === "APPROVED" || c.status === "PAID"));
    const pending = sumAmount(own.filter((c) => c.status === "SUBMITTED"));
    const limit = user.monthlyLimit.toNumber();

    return {
      userId: user.id,
      name: user.name,
      role: user.role,
      limit,
      committed,
      pending,
      remaining: Math.max(limit - committed, 0),
      utilizationPct: limit > 0 ? (committed / limit) * 100 : 0,
      isNearLimit: limit > 0 && committed / limit >= 0.8 && committed < limit,
      isOverLimit: limit > 0 && committed > limit,
    };
  });
}

const ALL_CATEGORIES: readonly ExpenseCategory[] = ["TRAVEL", "MEALS", "SUPPLIES", "TAXI", "OTHER"];

/**
 * Monthly spend broken down by category — CLAUDE.md Section 3.3's "under
 * which category" figure. Only APPROVED+PAID claims count toward
 * committed spend, same definition used everywhere else; every category
 * is always present in the result (zero-filled), so the UI never has to
 * special-case a category nobody spent on this month.
 */
export interface CategoryMonthlySpend {
  category: ExpenseCategory;
  amount: number;
  percentage: number; // share of this month's total committed spend, 0–100
}

export async function getCategoryMonthlySpend(monthDate: Date = new Date()): Promise<CategoryMonthlySpend[]> {
  const { monthStart, monthEnd } = monthRange(monthDate);

  const claims = await prisma.claim.findMany({
    where: {
      expenseDate: { gte: monthStart, lt: monthEnd },
      status: { in: ["APPROVED", "PAID"] },
    },
    select: { category: true, amount: true },
  });

  const totals = new Map<ExpenseCategory, number>();
  for (const claim of claims) {
    totals.set(claim.category, (totals.get(claim.category) ?? 0) + claim.amount.toNumber());
  }
  const grandTotal = [...totals.values()].reduce((a, b) => a + b, 0);

  return ALL_CATEGORIES.map((category) => {
    const amount = totals.get(category) ?? 0;
    return { category, amount, percentage: grandTotal > 0 ? (amount / grandTotal) * 100 : 0 };
  });
}
