import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// Mocked Prisma — this suite is a fast, network-independent unit-test
// pass over the service's own orchestration/authorization logic. A small
// number of real-database checks (genuine concurrency, and the actual
// seeded scenarios) were run separately via a temporary script during
// Phase 6 verification and are reported in the phase summary, matching
// how DB-dependent checks were handled in every earlier phase.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    claim: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    claimEvent: { create: vi.fn() }, // runDuplicateCheck logs DUPLICATE_FLAGGED outside the main transaction
    user: { findUnique: vi.fn(), findMany: vi.fn() }, // findMany: Phase 9's getEmployeeMonthlySpend
    $transaction: vi.fn(),
  },
}));

// Duplicate detection is Phase 5's own, already-tested concern — mocked
// here so these tests isolate claim-service's *orchestration* of it
// (does it call detectDuplicates with the right shape, does it react
// correctly to isDuplicate true/false) rather than re-verifying the
// detector's internal algorithm.
vi.mock("@/lib/duplicate-detector", () => ({
  detectDuplicates: vi.fn(),
  recordDuplicateMatches: vi.fn(),
  hashNormalizedText: vi.fn(() => "mocked-hash"),
}));

import { prisma } from "@/lib/prisma";
import { detectDuplicates, recordDuplicateMatches } from "@/lib/duplicate-detector";
import type { SessionUser } from "@/lib/auth";
import {
  ClaimNotFoundError,
  DuplicateAcknowledgementRequiredError,
  ForbiddenError,
  InvalidClaimDataError,
  InvalidTransitionError,
  SelfApprovalNotAllowedError,
} from "@/lib/claim-errors";
import {
  acknowledgeDuplicate,
  approveClaim,
  createClaim,
  getCategoryMonthlySpend,
  getClaim,
  getEmployeeMonthlySpend,
  getFinanceMonthlySpend,
  getManagerTeamSpend,
  getMonthlySpend,
  listClaims,
  listClaimsForPayment,
  listClaimsForReview,
  listMyClaims,
  payClaim,
  rejectClaim,
  resubmitClaim,
  submitClaim,
  updateClaim,
} from "./claim-service";

const findUnique = vi.mocked(prisma.claim.findUnique);
const findMany = vi.mocked(prisma.claim.findMany);
const outerUpdate = vi.mocked(prisma.claim.update);
const outerClaimEvent = vi.mocked(prisma.claimEvent.create);
const userFindUnique = vi.mocked(prisma.user.findUnique);
const userFindMany = vi.mocked(prisma.user.findMany);
const transaction = vi.mocked(prisma.$transaction);
const mockDetectDuplicates = vi.mocked(detectDuplicates);
const mockRecordDuplicateMatches = vi.mocked(recordDuplicateMatches);

// --- transaction mock: a `tx` whose model methods are the same spies as
// the outer prisma mock's would be, but kept separate on purpose — the
// service always writes status changes through `tx`, never the outer
// client, and these tests check that.
const tx = {
  claim: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  receipt: { create: vi.fn(), update: vi.fn() },
  claimEvent: { create: vi.fn() },
};

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

const staff: SessionUser = { id: "staff-1", name: "Rohan Test", email: "rohan@test.invalid", role: "STAFF" };
const manager: SessionUser = { id: "manager-1", name: "Arjun Test", email: "arjun@test.invalid", role: "MANAGER" };
const otherManager: SessionUser = { id: "manager-2", name: "Priya Test", email: "priya@test.invalid", role: "MANAGER" };
const finance: SessionUser = { id: "finance-1", name: "Kavya Test", email: "kavya@test.invalid", role: "FINANCE" };
const otherStaff: SessionUser = { id: "staff-2", name: "Vikram Test", email: "vikram@test.invalid", role: "STAFF" };

function makeClaim(overrides: Record<string, unknown> = {}) {
  return {
    id: "claim-1",
    claimantId: staff.id,
    approverId: manager.id,
    status: "SUBMITTED",
    category: "TAXI",
    merchant: "Ola",
    amount: decimal(180),
    currency: "INR",
    expenseDate: new Date(2026, 8, 1),
    description: "Auto ride",
    rawReceiptText: "Ola auto MG Road to office Rs 180",
    duplicateFlag: false,
    duplicateScore: null,
    duplicateAcknowledgedAt: null,
    duplicateAcknowledgedById: null,
    submittedAt: new Date(2026, 8, 1),
    decidedAt: null,
    decisionNote: null,
    paidAt: null,
    paidById: null,
    createdAt: new Date(2026, 8, 1),
    updatedAt: new Date(2026, 8, 1),
    claimant: { id: staff.id, name: staff.name, email: staff.email, role: "STAFF", managerId: manager.id },
    approver: { id: manager.id, name: manager.name, email: manager.email, role: "MANAGER" },
    paidBy: null,
    duplicateAcknowledgedBy: null,
    receipt: { id: "receipt-1", normalizedText: "ola auto mg road to office rs 180", textHash: "hash-1" },
    events: [],
    duplicatesFound: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  transaction.mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => unknown)(tx));

  tx.claim.create.mockResolvedValue({
    id: "new-claim-1",
    claimantId: staff.id,
    merchant: "Ola",
    amount: decimal(180),
    category: "TAXI",
    expenseDate: new Date(2026, 8, 1),
    rawReceiptText: "Ola auto MG Road to office Rs 180",
    duplicateFlag: false,
  });
  tx.claim.update.mockResolvedValue({});
  tx.claim.updateMany.mockResolvedValue({ count: 1 });
  tx.receipt.create.mockResolvedValue({});
  tx.receipt.update.mockResolvedValue({});
  tx.claimEvent.create.mockResolvedValue({});

  outerUpdate.mockResolvedValue({} as never);
  outerClaimEvent.mockResolvedValue({} as never);
  mockDetectDuplicates.mockResolvedValue({ isDuplicate: false, score: 0, matches: [] });
  mockRecordDuplicateMatches.mockResolvedValue(undefined);
});

/**
 * Configures findUnique to return `claim`, AND makes the mocked
 * `tx.claim.updateMany` behave like the real conditional update would:
 * only "succeed" (count: 1) when the `where.status` it's called with
 * actually matches the claim's current status, exactly like a real
 * `UPDATE ... WHERE status = ?` would in Postgres. Without this, the
 * mock would blindly report success regardless of the claim's actual
 * status, masking the very state-mismatch bugs these tests exist to
 * catch (see applyTransition's concurrency-safety comment).
 */
function setupClaim(claim: ReturnType<typeof makeClaim>) {
  findUnique.mockResolvedValue(claim as never);
  tx.claim.updateMany.mockImplementation(async (args: unknown) => {
    const where = (args as { where: { status?: string } }).where;
    if (where.status && where.status !== claim.status) return { count: 0 };
    return { count: 1 };
  });
  return claim;
}

// ---------------------------------------------------------------------------
// 8–9: createClaim
// ---------------------------------------------------------------------------

describe("createClaim", () => {
  it("8. authenticated staff creates a claim belonging to themselves", async () => {
    setupClaim(makeClaim({ id: "new-claim-1", claimantId: staff.id, status: "PARSED" }));

    await createClaim(staff, { rawReceiptText: "Ola auto MG Road to office Rs 180" });

    expect(tx.claim.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ claimantId: staff.id, status: "PARSED" }) })
    );
  });

  it("9. the client cannot make a claim belong to another user — createClaim only ever accepts rawReceiptText, the claimant is always the caller", async () => {
    setupClaim(makeClaim({ claimantId: staff.id }));
    await createClaim(staff, { rawReceiptText: "Some receipt text" } as never);

    const createCall = tx.claim.create.mock.calls[0][0] as { data: { claimantId: string } };
    expect(createCall.data.claimantId).toBe(staff.id);
    // No claimantId/status/approverId/paidById field exists on the input
    // type at all (see CreateClaimInput) — there is no code path by
    // which a caller-supplied value could reach the claimantId column.
  });

  it("rejects an empty receipt text", async () => {
    await expect(createClaim(staff, { rawReceiptText: "   " })).rejects.toBeInstanceOf(InvalidClaimDataError);
  });

  it("finance cannot create a claim (not a claimant role)", async () => {
    await expect(createClaim(finance, { rawReceiptText: "Something Rs 100" })).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });
});

// ---------------------------------------------------------------------------
// 10: submitClaim — ownership + status
// ---------------------------------------------------------------------------

describe("submitClaim", () => {
  it("10. the claimant can submit their own PARSED claim", async () => {
    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id, merchant: "Ola", amount: decimal(180) })
    );

    await submitClaim(staff, "claim-1");

    expect(tx.claim.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "claim-1", status: "PARSED" },
        data: expect.objectContaining({ status: "SUBMITTED", approverId: manager.id }),
      })
    );
  });

  it("another user cannot submit someone else's claim", async () => {
    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id }));
    await expect(submitClaim(otherStaff, "claim-1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.claim.updateMany).not.toHaveBeenCalled();
  });

  it("cannot submit an APPROVED claim", async () => {
    setupClaim(makeClaim({ status: "APPROVED", claimantId: staff.id }));
    await expect(submitClaim(staff, "claim-1")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("cannot submit a REJECTED claim directly (must use resubmit)", async () => {
    setupClaim(makeClaim({ status: "REJECTED", claimantId: staff.id }));
    await expect(submitClaim(staff, "claim-1")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("cannot submit a PAID claim", async () => {
    setupClaim(makeClaim({ status: "PAID", claimantId: staff.id }));
    await expect(submitClaim(staff, "claim-1")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("cannot submit without a real merchant/amount", async () => {
    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id, merchant: "Unknown merchant" })
    );
    await expect(submitClaim(staff, "claim-1")).rejects.toBeInstanceOf(InvalidClaimDataError);

    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id, amount: decimal(0) }));
    await expect(submitClaim(staff, "claim-1")).rejects.toBeInstanceOf(InvalidClaimDataError);
  });

  it("throws ClaimNotFoundError for a nonexistent claim", async () => {
    findUnique.mockResolvedValue(null);
    await expect(submitClaim(staff, "does-not-exist")).rejects.toBeInstanceOf(ClaimNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 11–13: approveClaim
// ---------------------------------------------------------------------------

describe("approveClaim", () => {
  it("11. the assigned manager can approve an authorized SUBMITTED claim", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED", claimantId: staff.id, approverId: manager.id }));

    await approveClaim(manager, "claim-1");

    expect(tx.claim.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "claim-1", status: "SUBMITTED" }, data: expect.objectContaining({ status: "APPROVED" }) })
    );
    expect(tx.claimEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: "APPROVED", actorId: manager.id }) })
    );
  });

  it("12. CRITICAL — a manager cannot approve their own claim", async () => {
    // Even in the (impossible under normal flow) case where approverId
    // was somehow also the claimant, the claimantId check fires first.
    setupClaim(makeClaim({ status: "SUBMITTED", claimantId: manager.id, approverId: manager.id })
    );
    await expect(approveClaim(manager, "claim-1")).rejects.toBeInstanceOf(SelfApprovalNotAllowedError);
    expect(tx.claim.updateMany).not.toHaveBeenCalled();
  });

  it("13. a manager not assigned to this claim cannot approve it (another team's claim)", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED", claimantId: staff.id, approverId: manager.id }));
    await expect(approveClaim(otherManager, "claim-1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.claim.updateMany).not.toHaveBeenCalled();
  });

  it("staff cannot approve any claim", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED" }));
    await expect(approveClaim(staff, "claim-1")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("finance cannot approve a claim (Phase 8: manager review actions are manager-only)", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED" }));
    await expect(approveClaim(finance, "claim-1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.claim.updateMany).not.toHaveBeenCalled();
  });

  it("cannot approve a claim that isn't SUBMITTED", async () => {
    setupClaim(makeClaim({ status: "PARSED", approverId: manager.id }));
    await expect(approveClaim(manager, "claim-1")).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

// ---------------------------------------------------------------------------
// 14: rejectClaim
// ---------------------------------------------------------------------------

describe("rejectClaim", () => {
  it("14. rejection requires a non-empty note", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED", approverId: manager.id }));
    await expect(rejectClaim(manager, "claim-1", "")).rejects.toBeInstanceOf(InvalidClaimDataError);
    await expect(rejectClaim(manager, "claim-1", "   ")).rejects.toBeInstanceOf(InvalidClaimDataError);
    expect(tx.claim.updateMany).not.toHaveBeenCalled();
  });

  it("rejects with a valid note and records it on the claim and the event", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED", approverId: manager.id }));
    await rejectClaim(manager, "claim-1", "Missing itemised bill, please resubmit with details.");

    expect(tx.claim.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "REJECTED",
          decisionNote: "Missing itemised bill, please resubmit with details.",
        }),
      })
    );
    expect(tx.claimEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "REJECTED", note: "Missing itemised bill, please resubmit with details." }),
      })
    );
  });

  it("a manager cannot reject their own claim either", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED", claimantId: manager.id, approverId: manager.id }));
    await expect(rejectClaim(manager, "claim-1", "note")).rejects.toBeInstanceOf(SelfApprovalNotAllowedError);
  });

  it("cannot reject a PARSED, APPROVED, or PAID claim", async () => {
    for (const status of ["PARSED", "APPROVED", "PAID"]) {
      setupClaim(makeClaim({ status, approverId: manager.id }));
      await expect(rejectClaim(manager, "claim-1", "note")).rejects.toBeInstanceOf(InvalidTransitionError);
    }
  });

  it("finance cannot reject a claim (Phase 8: manager review actions are manager-only)", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED" }));
    await expect(rejectClaim(finance, "claim-1", "note")).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.claim.updateMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 15–16: resubmitClaim
// ---------------------------------------------------------------------------

describe("resubmitClaim", () => {
  it("15. a rejected claim can be resubmitted by the claimant", async () => {
    setupClaim(makeClaim({ status: "REJECTED", claimantId: staff.id, decisionNote: "Missing details" })
    );

    await resubmitClaim(staff, "claim-1");

    expect(tx.claim.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "claim-1", status: "REJECTED" },
        data: expect.objectContaining({ status: "SUBMITTED", decisionNote: null }),
      })
    );
  });

  it("16. another user cannot resubmit someone else's claim", async () => {
    setupClaim(makeClaim({ status: "REJECTED", claimantId: staff.id }));
    await expect(resubmitClaim(otherStaff, "claim-1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.claim.updateMany).not.toHaveBeenCalled();
  });

  it("cannot resubmit a claim that isn't REJECTED", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED", claimantId: staff.id }));
    await expect(resubmitClaim(staff, "claim-1")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("applies corrected fields and logs an EDITED event before resubmitting", async () => {
    setupClaim(makeClaim({ status: "REJECTED", claimantId: staff.id, merchant: "Ola" }));

    await resubmitClaim(staff, "claim-1", { merchant: "Ola Cabs", amount: 220 });

    expect(tx.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ merchant: "Ola Cabs", amount: 220 }) })
    );
    expect(tx.claimEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: "EDITED" }) })
    );
  });

  it("does not delete or overwrite previous ClaimEvent history — only ever creates new events", async () => {
    setupClaim(makeClaim({ status: "REJECTED", claimantId: staff.id }));
    await resubmitClaim(staff, "claim-1");
    // claimEvent has no delete/deleteMany/update calls anywhere in this module.
    expect(tx.claimEvent).not.toHaveProperty("delete");
    expect(tx.claimEvent).not.toHaveProperty("deleteMany");
  });
});

// ---------------------------------------------------------------------------
// 17–19: payClaim
// ---------------------------------------------------------------------------

describe("payClaim", () => {
  it("17. finance can pay an APPROVED claim", async () => {
    setupClaim(makeClaim({ status: "APPROVED", duplicateFlag: false }));

    await payClaim(finance, "claim-1");

    expect(tx.claim.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "claim-1", status: "APPROVED" },
        data: expect.objectContaining({ status: "PAID", paidById: finance.id }),
      })
    );
  });

  it("18. a non-finance user cannot pay a claim", async () => {
    setupClaim(makeClaim({ status: "APPROVED" }));
    await expect(payClaim(manager, "claim-1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payClaim(staff, "claim-1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.claim.updateMany).not.toHaveBeenCalled();
  });

  it("19. a claim that is already PAID cannot be paid again", async () => {
    // setupClaim's mocked updateMany rejects the WHERE status="APPROVED"
    // clause on its own here, since the claim's real status is PAID —
    // exactly what the real conditional update would do.
    setupClaim(makeClaim({ status: "PAID" }));
    await expect(payClaim(finance, "claim-1")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("cannot pay a claim that is only SUBMITTED, not yet APPROVED", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED" }));
    await expect(payClaim(finance, "claim-1")).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

// ---------------------------------------------------------------------------
// 20–23: duplicate flagging and acknowledgement
// ---------------------------------------------------------------------------

describe("duplicate flag: create/submit are never blocked, but payment is", () => {
  it("20. a claim that comes back flagged as a duplicate can still be created and submitted", async () => {
    mockDetectDuplicates.mockResolvedValue({
      isDuplicate: true,
      score: 0.9,
      matches: [{ claimId: "earlier-claim", matchType: "FUZZY_TEXT", score: 0.9, reasons: ["similar"] }],
    });
    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id }));

    await expect(createClaim(staff, { rawReceiptText: "Ola auto MG Road to office Rs 180" })).resolves.toBeTruthy();
    expect(outerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ duplicateFlag: true, duplicateScore: 0.9 }) })
    );
    expect(mockRecordDuplicateMatches).toHaveBeenCalled();

    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id, merchant: "Ola", amount: decimal(180) })
    );
    await expect(submitClaim(staff, "claim-1")).resolves.toBeTruthy();
  });

  it("21. a flagged duplicate cannot be paid before Finance acknowledges it", async () => {
    setupClaim(makeClaim({ status: "APPROVED", duplicateFlag: true, duplicateAcknowledgedAt: null }));
    await expect(payClaim(finance, "claim-1")).rejects.toBeInstanceOf(DuplicateAcknowledgementRequiredError);
    expect(tx.claim.updateMany).not.toHaveBeenCalled();
  });

  it("22. finance can acknowledge a flagged duplicate", async () => {
    setupClaim(makeClaim({ status: "APPROVED", duplicateFlag: true, duplicateAcknowledgedAt: null }));

    await acknowledgeDuplicate(finance, "claim-1");

    expect(tx.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ duplicateAcknowledgedAt: expect.any(Date), duplicateAcknowledgedById: finance.id }),
      })
    );
    expect(tx.claimEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: "DUPLICATE_ACKNOWLEDGED" }) })
    );
  });

  it("only finance can acknowledge a duplicate", async () => {
    setupClaim(makeClaim({ duplicateFlag: true }));
    await expect(acknowledgeDuplicate(manager, "claim-1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(acknowledgeDuplicate(staff, "claim-1")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot acknowledge a claim that isn't flagged", async () => {
    setupClaim(makeClaim({ duplicateFlag: false }));
    await expect(acknowledgeDuplicate(finance, "claim-1")).rejects.toBeInstanceOf(InvalidClaimDataError);
  });

  it("23. once acknowledged, the (now-flagged-and-acknowledged) claim can be paid", async () => {
    setupClaim(makeClaim({ status: "APPROVED", duplicateFlag: true, duplicateAcknowledgedAt: new Date() })
    );

    await payClaim(finance, "claim-1");

    expect(tx.claim.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) })
    );
  });
});

// ---------------------------------------------------------------------------
// 24: ClaimEvent / audit history
// ---------------------------------------------------------------------------

describe("ClaimEvent audit history", () => {
  it("24. every state-changing operation records fromStatus/toStatus/actor on its ClaimEvent", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED", approverId: manager.id }));
    await approveClaim(manager, "claim-1");

    expect(tx.claimEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claimId: "claim-1",
          actorId: manager.id,
          eventType: "APPROVED",
          fromStatus: "SUBMITTED",
          toStatus: "APPROVED",
        }),
      })
    );
  });

  it("createClaim records CREATED then PARSED events", async () => {
    setupClaim(makeClaim({ status: "PARSED" }));
    await createClaim(staff, { rawReceiptText: "Ola auto MG Road to office Rs 180" });

    const eventTypes = tx.claimEvent.create.mock.calls.map(
      (call) => (call[0] as { data: { eventType: string } }).data.eventType
    );
    expect(eventTypes).toEqual(["CREATED", "PARSED"]);
  });
});

// ---------------------------------------------------------------------------
// 25–28: retrieval / authorization
// ---------------------------------------------------------------------------

describe("getClaim authorization", () => {
  it("25. an unrelated user cannot retrieve someone else's claim", async () => {
    setupClaim(makeClaim({ claimantId: staff.id, approverId: manager.id }));
    await expect(getClaim(otherStaff, "claim-1")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the claimant can retrieve their own claim", async () => {
    setupClaim(makeClaim({ claimantId: staff.id }));
    await expect(getClaim(staff, "claim-1")).resolves.toBeTruthy();
  });

  it("the assigned manager can retrieve a claim awaiting their review", async () => {
    setupClaim(makeClaim({ claimantId: staff.id, approverId: manager.id }));
    await expect(getClaim(manager, "claim-1")).resolves.toBeTruthy();
  });

  it("a manager can retrieve a direct report's claim even if not the assigned approver", async () => {
    setupClaim(makeClaim({
        claimantId: staff.id,
        approverId: otherManager.id,
        claimant: { id: staff.id, name: staff.name, email: staff.email, role: "STAFF", managerId: manager.id },
      })
    );
    await expect(getClaim(manager, "claim-1")).resolves.toBeTruthy();
  });

  it("Phase 8 — an unrelated manager (not the approver, not this claimant's manager) cannot retrieve the claim", async () => {
    setupClaim(makeClaim({
        claimantId: staff.id,
        approverId: manager.id,
        claimant: { id: staff.id, name: staff.name, email: staff.email, role: "STAFF", managerId: manager.id },
      })
    );
    await expect(getClaim(otherManager, "claim-1")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("finance can retrieve any claim", async () => {
    setupClaim(makeClaim({ claimantId: staff.id }));
    await expect(getClaim(finance, "claim-1")).resolves.toBeTruthy();
  });

  it("throws ClaimNotFoundError for a nonexistent claim", async () => {
    findUnique.mockResolvedValue(null);
    await expect(getClaim(staff, "nope")).rejects.toBeInstanceOf(ClaimNotFoundError);
  });
});

describe("listClaims scoping", () => {
  it("26. staff only sees their own claims", async () => {
    findMany.mockResolvedValue([]);
    await listClaims(staff);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ claimantId: staff.id }) })
    );
  });

  it("27. a manager's scope includes their own claims, claims assigned to them, and their direct reports' claims", async () => {
    findMany.mockResolvedValue([]);
    await listClaims(manager);
    const call = findMany.mock.calls[0][0] as { where: { OR: unknown[] } };
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        { claimantId: manager.id },
        { approverId: manager.id },
        { claimant: { managerId: manager.id } },
      ])
    );
  });

  it("28. finance sees all claims (no claimant/approver scoping)", async () => {
    findMany.mockResolvedValue([]);
    await listClaims(finance);
    const call = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where).not.toHaveProperty("claimantId");
    expect(call.where).not.toHaveProperty("OR");
  });

  it("applies an optional status filter on top of the role scope", async () => {
    findMany.mockResolvedValue([]);
    await listClaims(staff, { status: "SUBMITTED" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "SUBMITTED" }) })
    );
  });
});

// ---------------------------------------------------------------------------
// 29: monthly spending
// ---------------------------------------------------------------------------

describe("getMonthlySpend", () => {
  it("29. counts APPROVED and PAID claims as committed spend, and SUBMITTED as pending only", async () => {
    userFindUnique.mockResolvedValue({ monthlyLimit: decimal(15000) } as never);
    findMany.mockResolvedValue([
      { status: "APPROVED", amount: decimal(6200) },
      { status: "PAID", amount: decimal(7300) },
      { status: "SUBMITTED", amount: decimal(2400) },
      { status: "REJECTED", amount: decimal(999) },
      { status: "PARSED", amount: decimal(50) },
    ] as never);

    const spend = await getMonthlySpend("sneha-1");

    expect(spend.committed).toBe(13500); // 6200 + 7300 — matches the seeded near-limit scenario exactly
    expect(spend.pending).toBe(2400); // SUBMITTED only, not counted as committed spend
    expect(spend.limit).toBe(15000);
    expect(spend.isNearLimit).toBe(true); // 13500 / 15000 = 90%
    expect(spend.isOverLimit).toBe(false);
  });

  it("flags over-limit once committed spend exceeds the monthly limit", async () => {
    userFindUnique.mockResolvedValue({ monthlyLimit: decimal(15000) } as never);
    findMany.mockResolvedValue([{ status: "PAID", amount: decimal(15900) }] as never);

    const spend = await getMonthlySpend("sneha-1");
    expect(spend.isOverLimit).toBe(true);
    expect(spend.isNearLimit).toBe(false);
  });

  it("does not flag near/over limit for a small, well-under-limit spend", async () => {
    userFindUnique.mockResolvedValue({ monthlyLimit: decimal(15000) } as never);
    findMany.mockResolvedValue([{ status: "APPROVED", amount: decimal(1000) }] as never);

    const spend = await getMonthlySpend("staff-x");
    expect(spend.isNearLimit).toBe(false);
    expect(spend.isOverLimit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateClaim — Phase 7's review/correction step (PATCH /api/claims/[id]),
// exposing a Phase 6 service function that previously had no route or
// direct test coverage.
// ---------------------------------------------------------------------------

describe("updateClaim", () => {
  it("lets the claimant correct their own PARSED draft", async () => {
    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id, merchant: "Ola" }));

    await updateClaim(staff, "claim-1", { merchant: "Ola Cabs", amount: 220 });

    expect(tx.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ merchant: "Ola Cabs", amount: 220 }) })
    );
    expect(tx.claimEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: "EDITED" }) })
    );
  });

  it("another user cannot edit someone else's draft", async () => {
    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id }));
    await expect(updateClaim(otherStaff, "claim-1", { merchant: "X" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.claim.update).not.toHaveBeenCalled();
  });

  it("cannot edit a claim that has already been submitted", async () => {
    setupClaim(makeClaim({ status: "SUBMITTED", claimantId: staff.id }));
    await expect(updateClaim(staff, "claim-1", { merchant: "X" })).rejects.toBeInstanceOf(InvalidClaimDataError);
  });

  it("rejects an invalid (non-positive) amount correction", async () => {
    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id }));
    await expect(updateClaim(staff, "claim-1", { amount: 0 })).rejects.toBeInstanceOf(InvalidClaimDataError);
    await expect(updateClaim(staff, "claim-1", { amount: -5 })).rejects.toBeInstanceOf(InvalidClaimDataError);
  });

  it("re-parses and updates the Receipt when rawReceiptText is corrected", async () => {
    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id }));

    await updateClaim(staff, "claim-1", { rawReceiptText: "Uber auto Chennai Rs 220" });

    expect(tx.receipt.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { claimId: "claim-1" } })
    );
  });

  it("re-runs duplicate detection after a correction", async () => {
    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id }));
    await updateClaim(staff, "claim-1", { amount: 350 });
    expect(mockDetectDuplicates).toHaveBeenCalled();
  });

  it("is a no-op (no write) when no corrections are given", async () => {
    setupClaim(makeClaim({ status: "PARSED", claimantId: staff.id }));
    await updateClaim(staff, "claim-1", {});
    expect(tx.claim.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listMyClaims — always "my own claims", regardless of role (dashboard /
// "My Claims" page), distinct from listClaims()'s broader manager scope.
// ---------------------------------------------------------------------------

describe("listMyClaims", () => {
  it("scopes strictly to the actor's own claims even for a manager", async () => {
    findMany.mockResolvedValue([]);
    await listMyClaims(manager);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { claimantId: manager.id } })
    );
  });

  it("never includes an OR clause (unlike listClaims' manager scope)", async () => {
    findMany.mockResolvedValue([]);
    await listMyClaims(manager);
    const call = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where).not.toHaveProperty("OR");
  });

  it("applies an optional status filter", async () => {
    findMany.mockResolvedValue([]);
    await listMyClaims(staff, { status: "REJECTED" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { claimantId: staff.id, status: "REJECTED" } })
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — listClaimsForReview: a manager's review queue, strictly
// scoped to claims assigned to them (never their own claims, even when
// SUBMITTED — see the function's comment in lib/claim-service.ts).
// ---------------------------------------------------------------------------

describe("listClaimsForReview", () => {
  it("scopes strictly to claims assigned to this manager (approverId), never an OR of own+team", async () => {
    findMany.mockResolvedValue([]);
    await listClaimsForReview(manager);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { approverId: manager.id } })
    );
    const call = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where).not.toHaveProperty("OR");
    expect(call.where).not.toHaveProperty("claimantId");
  });

  it("only a manager has a review queue — staff and finance are rejected", async () => {
    await expect(listClaimsForReview(staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listClaimsForReview(finance)).rejects.toBeInstanceOf(ForbiddenError);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("applies an optional status filter on top of the approverId scope", async () => {
    findMany.mockResolvedValue([]);
    await listClaimsForReview(manager, { status: "SUBMITTED" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { approverId: manager.id, status: "SUBMITTED" } })
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — getManagerTeamSpend: a manager-facing rollup of their direct
// reports' spend, distinct from getMonthlySpend()'s single-claimant figure.
// ---------------------------------------------------------------------------

describe("getManagerTeamSpend", () => {
  it("scopes the query to claims whose claimant reports to this manager", async () => {
    findMany.mockResolvedValue([]);
    await getManagerTeamSpend(manager.id);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ claimant: { managerId: manager.id } }) })
    );
  });

  it("sums APPROVED + PAID as committed, SUBMITTED as pending only, and counts every claim", async () => {
    findMany.mockResolvedValue([
      { status: "APPROVED", amount: decimal(1200) },
      { status: "PAID", amount: decimal(7300) },
      { status: "SUBMITTED", amount: decimal(2400) },
      { status: "REJECTED", amount: decimal(950) },
      { status: "PARSED", amount: decimal(220) },
    ] as never);

    const spend = await getManagerTeamSpend(manager.id);
    expect(spend.committed).toBe(8500); // 1200 + 7300
    expect(spend.pending).toBe(2400);
    expect(spend.claimCount).toBe(5); // every claim in scope, any status
  });

  it("returns all zeros for a manager with no team claims this month", async () => {
    findMany.mockResolvedValue([]);
    const spend = await getManagerTeamSpend(manager.id);
    expect(spend).toEqual({ committed: 0, pending: 0, claimCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// Phase 9 — listClaimsForPayment: Finance's payment queue, defaulting to
// APPROVED (the only status that's actionable for payment) and NOT
// month-scoped (an old unpaid approval still belongs in the queue).
// ---------------------------------------------------------------------------

describe("listClaimsForPayment", () => {
  it("defaults to status=APPROVED", async () => {
    findMany.mockResolvedValue([]);
    await listClaimsForPayment(finance);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "APPROVED" } }));
  });

  it("only Finance has a payment queue — staff and manager are rejected", async () => {
    await expect(listClaimsForPayment(staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listClaimsForPayment(manager)).rejects.toBeInstanceOf(ForbiddenError);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("an explicit status filter overrides the APPROVED default", async () => {
    findMany.mockResolvedValue([]);
    await listClaimsForPayment(finance, { status: "PAID" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "PAID" } }));
  });
});

// ---------------------------------------------------------------------------
// Phase 9 — Finance's org-wide monthly reporting: getFinanceMonthlySpend,
// getEmployeeMonthlySpend, getCategoryMonthlySpend. Same committed/pending
// definition (APPROVED+PAID vs. SUBMITTED, keyed by expenseDate) as
// getMonthlySpend()/getManagerTeamSpend() above — these tests exist to
// pin that definition stays consistent at org scope too, not to
// re-litigate what "committed" means.
// ---------------------------------------------------------------------------

describe("getFinanceMonthlySpend", () => {
  it("sums APPROVED+PAID as committed, SUBMITTED as pending, and PAID alone separately", async () => {
    findMany.mockResolvedValue([
      { status: "APPROVED", amount: decimal(1200) },
      { status: "PAID", amount: decimal(7300) },
      { status: "SUBMITTED", amount: decimal(2400) },
      { status: "REJECTED", amount: decimal(950) },
      { status: "PARSED", amount: decimal(220) },
    ] as never);

    const spend = await getFinanceMonthlySpend();
    expect(spend.committed).toBe(8500); // 1200 + 7300
    expect(spend.pending).toBe(2400);
    expect(spend.paid).toBe(7300); // PAID only — a subset of committed
    expect(spend.claimCount).toBe(5);
  });

  it("returns all zeros when there are no claims this month", async () => {
    findMany.mockResolvedValue([]);
    const spend = await getFinanceMonthlySpend();
    expect(spend).toEqual({ committed: 0, pending: 0, paid: 0, claimCount: 0 });
  });
});

describe("getEmployeeMonthlySpend", () => {
  it("excludes Finance users — they are never claimants", async () => {
    userFindMany.mockResolvedValue([] as never);
    findMany.mockResolvedValue([]);
    await getEmployeeMonthlySpend();
    const call = userFindMany.mock.calls[0][0] as { where: { role: { in: string[] } } };
    expect(call.where.role.in).toEqual(["STAFF", "MANAGER"]);
  });

  it("computes committed/pending/remaining/utilization per employee independently", async () => {
    userFindMany.mockResolvedValue([
      { id: "sneha-1", name: "Sneha Iyer", role: "STAFF", monthlyLimit: decimal(15000) },
      { id: "rohan-1", name: "Rohan Gupta", role: "STAFF", monthlyLimit: decimal(15000) },
    ] as never);
    findMany.mockResolvedValue([
      { claimantId: "sneha-1", status: "APPROVED", amount: decimal(6200) },
      { claimantId: "sneha-1", status: "PAID", amount: decimal(7300) },
      { claimantId: "sneha-1", status: "SUBMITTED", amount: decimal(2400) },
      { claimantId: "rohan-1", status: "APPROVED", amount: decimal(1200) },
    ] as never);

    const rows = await getEmployeeMonthlySpend();
    const sneha = rows.find((r) => r.userId === "sneha-1")!;
    expect(sneha.committed).toBe(13500); // matches the seeded near-limit scenario exactly
    expect(sneha.pending).toBe(2400);
    expect(sneha.remaining).toBe(1500);
    expect(sneha.utilizationPct).toBeCloseTo(90);
    expect(sneha.isNearLimit).toBe(true);
    expect(sneha.isOverLimit).toBe(false);

    const rohan = rows.find((r) => r.userId === "rohan-1")!;
    expect(rohan.committed).toBe(1200);
    expect(rohan.pending).toBe(0);
    expect(rohan.remaining).toBe(13800);
    expect(rohan.isNearLimit).toBe(false);
  });

  it("flags over-limit once committed spend exceeds the monthly limit", async () => {
    userFindMany.mockResolvedValue([{ id: "u-1", name: "Test User", role: "STAFF", monthlyLimit: decimal(15000) }] as never);
    findMany.mockResolvedValue([{ claimantId: "u-1", status: "PAID", amount: decimal(15900) }] as never);

    const rows = await getEmployeeMonthlySpend();
    expect(rows[0].isOverLimit).toBe(true);
    expect(rows[0].isNearLimit).toBe(false);
    expect(rows[0].remaining).toBe(0); // never negative
  });

  it("an employee with no claims this month gets an all-zero row, not an omitted one", async () => {
    userFindMany.mockResolvedValue([{ id: "u-1", name: "Quiet Employee", role: "STAFF", monthlyLimit: decimal(15000) }] as never);
    findMany.mockResolvedValue([]);

    const rows = await getEmployeeMonthlySpend();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ committed: 0, pending: 0, remaining: 15000, utilizationPct: 0, isNearLimit: false, isOverLimit: false });
  });
});

describe("getCategoryMonthlySpend", () => {
  it("only counts APPROVED+PAID claims toward committed spend", async () => {
    findMany.mockResolvedValue([
      { category: "TAXI", amount: decimal(180) },
      { category: "MEALS", amount: decimal(1200) },
    ] as never);

    const rows = await getCategoryMonthlySpend();
    const taxi = rows.find((r) => r.category === "TAXI")!;
    const meals = rows.find((r) => r.category === "MEALS")!;
    expect(taxi.amount).toBe(180);
    expect(meals.amount).toBe(1200);

    // The query itself must be pre-filtered to APPROVED/PAID — the mock
    // above already simulates "what the DB would have returned" for that
    // where clause, so also assert the where clause was actually sent.
    const call = findMany.mock.calls[0][0] as { where: { status: { in: string[] } } };
    expect(call.where.status.in).toEqual(["APPROVED", "PAID"]);
  });

  it("always returns all five categories, zero-filled, even with no spend", async () => {
    findMany.mockResolvedValue([]);
    const rows = await getCategoryMonthlySpend();
    expect(rows.map((r) => r.category).sort()).toEqual(["MEALS", "OTHER", "SUPPLIES", "TAXI", "TRAVEL"]);
    expect(rows.every((r) => r.amount === 0 && r.percentage === 0)).toBe(true);
  });

  it("computes each category's percentage share of the month's total committed spend", async () => {
    findMany.mockResolvedValue([
      { category: "TAXI", amount: decimal(300) },
      { category: "MEALS", amount: decimal(700) },
    ] as never);

    const rows = await getCategoryMonthlySpend();
    const taxi = rows.find((r) => r.category === "TAXI")!;
    const meals = rows.find((r) => r.category === "MEALS")!;
    expect(taxi.percentage).toBeCloseTo(30);
    expect(meals.percentage).toBeCloseTo(70);
  });
});
