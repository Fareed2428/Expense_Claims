// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClaimList } from "./ClaimList";
import { makeSerializedClaim } from "./test-fixtures";

describe("ClaimList", () => {
  it("shows an empty state with a call to action when there are no claims", () => {
    render(<ClaimList claims={[]} emptyMessage="You haven't filed any claims yet." />);
    expect(screen.getByText("You haven't filed any claims yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /file a claim/i })).toHaveAttribute("href", "/claims/new");
  });

  it("renders one row per claim, with merchant, amount, category, status", () => {
    const claims = [
      makeSerializedClaim({ id: "c1", merchant: "Ola", amount: 180, category: "TAXI", status: "SUBMITTED" }),
      makeSerializedClaim({ id: "c2", merchant: "IRCTC", amount: 1850, category: "TRAVEL", status: "PAID" }),
    ];
    render(<ClaimList claims={claims} />);

    expect(screen.getByText("Ola")).toBeInTheDocument();
    expect(screen.getByText("IRCTC")).toBeInTheDocument();
    expect(screen.getByText(/₹180/)).toBeInTheDocument();
    expect(screen.getByText(/1,850/)).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });

  it("shows a duplicate indicator only for claims that are actually flagged", () => {
    const claims = [
      makeSerializedClaim({ id: "c1", duplicateFlag: true }),
      makeSerializedClaim({ id: "c2", duplicateFlag: false }),
    ];
    render(<ClaimList claims={claims} />);
    expect(screen.getAllByText(/possible duplicate/i)).toHaveLength(1);
  });

  it("each row links to its own claim detail page", () => {
    render(<ClaimList claims={[makeSerializedClaim({ id: "abc123" })]} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/claims/abc123");
  });
});
