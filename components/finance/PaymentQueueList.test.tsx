// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentQueueList } from "./PaymentQueueList";
import { makeSerializedClaim } from "@/components/claims/test-fixtures";

describe("PaymentQueueList", () => {
  it("shows the empty message and no rows when there are no claims", () => {
    render(<PaymentQueueList claims={[]} emptyMessage="Nothing to pay." />);
    expect(screen.getByText("Nothing to pay.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the employee's name and links to the Finance claim detail route", () => {
    const claim = makeSerializedClaim({
      id: "claim-77",
      claimant: { id: "staff-1", name: "Rohan Gupta", email: "r@x.invalid", role: "STAFF", managerId: "m-1" },
    });
    render(<PaymentQueueList claims={[claim]} emptyMessage="none" />);
    expect(screen.getByText("Rohan Gupta")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/finance/claims/claim-77");
  });

  it("shows 'needs acknowledgement' for a flagged, unacknowledged claim", () => {
    const claim = makeSerializedClaim({ duplicateFlag: true, duplicateAcknowledgedAt: null });
    render(<PaymentQueueList claims={[claim]} emptyMessage="none" />);
    expect(screen.getByText(/needs acknowledgement/i)).toBeInTheDocument();
  });

  it("shows 'acknowledged' (not 'needs acknowledgement') once the duplicate has been acknowledged", () => {
    const claim = makeSerializedClaim({ duplicateFlag: true, duplicateAcknowledgedAt: "2026-09-09T10:00:00.000Z" as unknown as Date });
    render(<PaymentQueueList claims={[claim]} emptyMessage="none" />);
    expect(screen.getByText(/duplicate acknowledged/i)).toBeInTheDocument();
    expect(screen.queryByText(/needs acknowledgement/i)).not.toBeInTheDocument();
  });

  it("shows no duplicate badge at all for a non-flagged claim", () => {
    const claim = makeSerializedClaim({ duplicateFlag: false });
    render(<PaymentQueueList claims={[claim]} emptyMessage="none" />);
    expect(screen.queryByText(/duplicate/i)).not.toBeInTheDocument();
  });

  it("shows who approved the claim and when", () => {
    const claim = makeSerializedClaim({
      approver: { id: "m-1", name: "Arjun Mehta", email: "a@x.invalid", role: "MANAGER" },
      decidedAt: "2026-09-05T00:00:00.000Z" as unknown as Date,
    });
    render(<PaymentQueueList claims={[claim]} emptyMessage="none" />);
    expect(screen.getByText(/approved by arjun mehta/i)).toBeInTheDocument();
  });
});
