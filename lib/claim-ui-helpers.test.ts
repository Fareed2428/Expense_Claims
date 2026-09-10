import { describe, expect, it } from "vitest";
import {
  canContinueEditingDraft,
  canPay,
  canResubmit,
  canReview,
  hasNoClaimantAction,
  needsDuplicateAcknowledgement,
} from "./claim-ui-helpers";

const OWNER_ID = "staff-1";
const OTHER_ID = "staff-2";
const MANAGER_ID = "manager-1";
const OTHER_MANAGER_ID = "manager-2";

function claim(status: string, claimantId = OWNER_ID) {
  return { status: status as never, claimantId };
}

function reviewClaim(status: string, claimantId: string, approverId: string | null) {
  return { status: status as never, claimantId, approverId };
}

describe("canResubmit", () => {
  it("true only for the owner of a REJECTED claim", () => {
    expect(canResubmit(claim("REJECTED"), OWNER_ID)).toBe(true);
  });

  it("false for a non-owner, even on a REJECTED claim", () => {
    expect(canResubmit(claim("REJECTED"), OTHER_ID)).toBe(false);
  });

  it.each(["PARSED", "SUBMITTED", "APPROVED", "PAID"])(
    "false for the owner when status is %s (not REJECTED)",
    (status) => {
      expect(canResubmit(claim(status), OWNER_ID)).toBe(false);
    }
  );

  it("is never true for a PAID claim, regardless of owner", () => {
    expect(canResubmit(claim("PAID"), OWNER_ID)).toBe(false);
  });
});

describe("canContinueEditingDraft", () => {
  it("true only for the owner of a PARSED claim", () => {
    expect(canContinueEditingDraft(claim("PARSED"), OWNER_ID)).toBe(true);
  });

  it("false for a non-owner", () => {
    expect(canContinueEditingDraft(claim("PARSED"), OTHER_ID)).toBe(false);
  });

  it.each(["SUBMITTED", "APPROVED", "REJECTED", "PAID"])("false once status is %s", (status) => {
    expect(canContinueEditingDraft(claim(status), OWNER_ID)).toBe(false);
  });
});

describe("hasNoClaimantAction", () => {
  it("true for a PAID claim even if you're the owner", () => {
    expect(hasNoClaimantAction(claim("PAID"), OWNER_ID)).toBe(true);
  });

  it("true for APPROVED and SUBMITTED (nothing to do but wait)", () => {
    expect(hasNoClaimantAction(claim("APPROVED"), OWNER_ID)).toBe(true);
    expect(hasNoClaimantAction(claim("SUBMITTED"), OWNER_ID)).toBe(true);
  });

  it("false for PARSED (can continue editing) and REJECTED (can resubmit) when owned", () => {
    expect(hasNoClaimantAction(claim("PARSED"), OWNER_ID)).toBe(false);
    expect(hasNoClaimantAction(claim("REJECTED"), OWNER_ID)).toBe(false);
  });

  it("true for anyone who isn't the owner, regardless of status", () => {
    expect(hasNoClaimantAction(claim("PARSED"), OTHER_ID)).toBe(true);
    expect(hasNoClaimantAction(claim("REJECTED"), OTHER_ID)).toBe(true);
  });
});

describe("canReview", () => {
  const manager = { id: MANAGER_ID, role: "MANAGER" as const };

  it("true for the assigned manager reviewing a SUBMITTED claim that isn't their own", () => {
    expect(canReview(reviewClaim("SUBMITTED", OWNER_ID, MANAGER_ID), manager)).toBe(true);
  });

  it("CRITICAL — false for a manager's own claim, even if approverId somehow also points at them", () => {
    expect(canReview(reviewClaim("SUBMITTED", MANAGER_ID, MANAGER_ID), manager)).toBe(false);
  });

  it("false for a manager not assigned to this claim (another team's claim)", () => {
    const otherManager = { id: OTHER_MANAGER_ID, role: "MANAGER" as const };
    expect(canReview(reviewClaim("SUBMITTED", OWNER_ID, MANAGER_ID), otherManager)).toBe(false);
  });

  it("false for a claim with no approver assigned yet", () => {
    expect(canReview(reviewClaim("SUBMITTED", OWNER_ID, null), manager)).toBe(false);
  });

  it.each(["PARSED", "APPROVED", "REJECTED", "PAID"])("false once status is %s, even for the assigned manager", (status) => {
    expect(canReview(reviewClaim(status, OWNER_ID, MANAGER_ID), manager)).toBe(false);
  });

  it("false for a staff or finance actor, even if approverId somehow matched", () => {
    expect(canReview(reviewClaim("SUBMITTED", OWNER_ID, OWNER_ID), { id: OWNER_ID, role: "STAFF" as const })).toBe(false);
    expect(canReview(reviewClaim("SUBMITTED", OWNER_ID, "finance-1"), { id: "finance-1", role: "FINANCE" as const })).toBe(
      false
    );
  });
});

describe("needsDuplicateAcknowledgement", () => {
  it("true when flagged and not yet acknowledged", () => {
    expect(needsDuplicateAcknowledgement({ duplicateFlag: true, duplicateAcknowledgedAt: null })).toBe(true);
  });

  it("false once acknowledged, even though still flagged", () => {
    expect(
      needsDuplicateAcknowledgement({ duplicateFlag: true, duplicateAcknowledgedAt: "2026-09-09T10:00:00.000Z" })
    ).toBe(false);
  });

  it("false when not flagged at all", () => {
    expect(needsDuplicateAcknowledgement({ duplicateFlag: false, duplicateAcknowledgedAt: null })).toBe(false);
  });
});

describe("canPay", () => {
  const finance = { role: "FINANCE" as const };

  it("true for Finance viewing an APPROVED claim", () => {
    expect(canPay({ status: "APPROVED" as const }, finance)).toBe(true);
  });

  it.each(["PARSED", "SUBMITTED", "REJECTED", "PAID"])("false once status is %s, even for Finance", (status) => {
    expect(canPay({ status: status as never }, finance)).toBe(false);
  });

  it("false for a non-Finance actor, even on an APPROVED claim", () => {
    expect(canPay({ status: "APPROVED" as const }, { role: "MANAGER" as const })).toBe(false);
    expect(canPay({ status: "APPROVED" as const }, { role: "STAFF" as const })).toBe(false);
  });
});
