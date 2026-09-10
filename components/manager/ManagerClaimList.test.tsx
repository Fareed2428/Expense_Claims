// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ManagerClaimList } from "./ManagerClaimList";
import { makeSerializedClaim } from "@/components/claims/test-fixtures";

describe("ManagerClaimList", () => {
  it("shows the empty message and no rows when there are no claims", () => {
    render(<ManagerClaimList claims={[]} variant="pending" emptyMessage="Nothing to review." />);
    expect(screen.getByText("Nothing to review.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the employee's name (not just 'you') for each claim — the whole point of the manager view", () => {
    const claim = makeSerializedClaim({
      id: "claim-1",
      claimant: { id: "staff-1", name: "Rohan Gupta", email: "rohan@x.invalid", role: "STAFF", managerId: "manager-1" },
    });
    render(<ManagerClaimList claims={[claim]} variant="pending" emptyMessage="none" />);
    expect(screen.getByText("Rohan Gupta")).toBeInTheDocument();
  });

  it("shows a duplicate warning badge only for a flagged claim", () => {
    const flagged = makeSerializedClaim({ id: "claim-1", duplicateFlag: true });
    const clean = makeSerializedClaim({ id: "claim-2", duplicateFlag: false });
    render(<ManagerClaimList claims={[flagged, clean]} variant="pending" emptyMessage="none" />);
    expect(screen.getAllByText(/possible duplicate/i)).toHaveLength(1);
  });

  it("links each row to the manager claim detail route, not the staff route", () => {
    const claim = makeSerializedClaim({ id: "claim-77" });
    render(<ManagerClaimList claims={[claim]} variant="pending" emptyMessage="none" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/manager/claims/claim-77");
  });

  it("labels the action 'Review Claim' for pending items and 'View' for already-reviewed items", () => {
    const claim = makeSerializedClaim({ id: "claim-1" });
    const { rerender } = render(<ManagerClaimList claims={[claim]} variant="pending" emptyMessage="none" />);
    expect(screen.getByText(/review claim/i)).toBeInTheDocument();

    rerender(<ManagerClaimList claims={[claim]} variant="reviewed" emptyMessage="none" />);
    expect(screen.getByText("View →")).toBeInTheDocument();
    expect(screen.queryByText(/review claim/i)).not.toBeInTheDocument();
  });
});
