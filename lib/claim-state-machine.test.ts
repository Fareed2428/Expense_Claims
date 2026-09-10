import { describe, expect, it } from "vitest";
import type { ClaimStatus } from "@prisma/client";
import { allowedNextStatuses, assertValidTransition, canTransition } from "./claim-state-machine";
import { InvalidTransitionError } from "./claim-errors";

const ALL_STATUSES: ClaimStatus[] = ["PARSED", "SUBMITTED", "APPROVED", "REJECTED", "PAID"];

describe("claim state machine — allowed transitions", () => {
  it("1. PARSED → SUBMITTED is allowed", () => {
    expect(canTransition("PARSED", "SUBMITTED")).toBe(true);
  });

  it("2. SUBMITTED → APPROVED is allowed", () => {
    expect(canTransition("SUBMITTED", "APPROVED")).toBe(true);
  });

  it("3. SUBMITTED → REJECTED is allowed", () => {
    expect(canTransition("SUBMITTED", "REJECTED")).toBe(true);
  });

  it("4. REJECTED → SUBMITTED is allowed", () => {
    expect(canTransition("REJECTED", "SUBMITTED")).toBe(true);
  });

  it("5. APPROVED → PAID is allowed", () => {
    expect(canTransition("APPROVED", "PAID")).toBe(true);
  });
});

describe("claim state machine — PAID is terminal", () => {
  it("6. PAID → anything is rejected", () => {
    for (const to of ALL_STATUSES) {
      expect(canTransition("PAID", to)).toBe(to === "PAID" ? false : false);
    }
  });

  it("PAID → PARSED / SUBMITTED / APPROVED / REJECTED are all explicitly rejected", () => {
    expect(canTransition("PAID", "PARSED")).toBe(false);
    expect(canTransition("PAID", "SUBMITTED")).toBe(false);
    expect(canTransition("PAID", "APPROVED")).toBe(false);
    expect(canTransition("PAID", "REJECTED")).toBe(false);
  });

  it("assertValidTransition throws InvalidTransitionError for any transition out of PAID", () => {
    for (const to of ALL_STATUSES) {
      expect(() => assertValidTransition("PAID", to)).toThrow(InvalidTransitionError);
    }
  });
});

describe("claim state machine — other invalid transitions are rejected", () => {
  it.each([
    ["APPROVED", "REJECTED"],
    ["REJECTED", "APPROVED"],
    ["SUBMITTED", "PAID"],
    ["PARSED", "APPROVED"],
    ["PARSED", "PAID"],
    ["PARSED", "REJECTED"],
    ["APPROVED", "SUBMITTED"],
    ["REJECTED", "PAID"],
  ] as const)("7. %s → %s is rejected", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertValidTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it("a transition to the same status is not allowed unless explicitly listed", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});

describe("allowedNextStatuses", () => {
  it("reports the exact allowed set for each status", () => {
    expect(allowedNextStatuses("PARSED")).toEqual(["SUBMITTED"]);
    expect(allowedNextStatuses("SUBMITTED")).toEqual(["APPROVED", "REJECTED"]);
    expect(allowedNextStatuses("APPROVED")).toEqual(["PAID"]);
    expect(allowedNextStatuses("REJECTED")).toEqual(["SUBMITTED"]);
    expect(allowedNextStatuses("PAID")).toEqual([]);
  });
});

describe("assertValidTransition — happy path", () => {
  it("does not throw for a valid transition", () => {
    expect(() => assertValidTransition("PARSED", "SUBMITTED")).not.toThrow();
    expect(() => assertValidTransition("SUBMITTED", "APPROVED")).not.toThrow();
    expect(() => assertValidTransition("SUBMITTED", "REJECTED")).not.toThrow();
    expect(() => assertValidTransition("REJECTED", "SUBMITTED")).not.toThrow();
    expect(() => assertValidTransition("APPROVED", "PAID")).not.toThrow();
  });

  it("the thrown error carries the from/to statuses in its message", () => {
    try {
      assertValidTransition("PAID", "PARSED");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      expect((err as InvalidTransitionError).message).toContain("PAID");
      expect((err as InvalidTransitionError).message).toContain("PARSED");
      expect((err as InvalidTransitionError).status).toBe(409);
    }
  });
});
