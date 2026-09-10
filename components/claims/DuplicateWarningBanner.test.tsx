// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DuplicateWarningBanner } from "./DuplicateWarningBanner";
import { makeSerializedClaim } from "./test-fixtures";

describe("DuplicateWarningBanner", () => {
  it("renders nothing when the claim is not flagged", () => {
    const claim = makeSerializedClaim({ duplicateFlag: false });
    const { container } = render(<DuplicateWarningBanner claim={claim} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a clearly visible warning, the flag-not-block explanation, and the earlier claim's details when flagged", () => {
    const claim = makeSerializedClaim({
      duplicateFlag: true,
      duplicateScore: 0.9,
      duplicatesFound: [
        {
          id: "dm-1",
          claimId: "claim-1",
          matchedClaimId: "earlier-claim",
          matchType: "FUZZY_TEXT",
          score: 0.9,
          createdAt: "2026-08-10T00:00:00.000Z",
          matchedClaim: {
            id: "earlier-claim",
            merchant: "Ola",
            amount: 180,
            expenseDate: "2026-08-10T00:00:00.000Z",
            status: "PAID",
            claimantId: "staff-1",
          },
        },
      ] as never,
    });

    render(<DuplicateWarningBanner claim={claim} />);

    expect(screen.getByText("Possible duplicate receipt")).toBeInTheDocument();
    expect(screen.getByText(/You can still submit this claim/i)).toBeInTheDocument();
    expect(screen.getByText(/Finance must review the duplicate before payment/i)).toBeInTheDocument();
    // Previous claim's details.
    expect(screen.getByText("Ola")).toBeInTheDocument();
    expect(screen.getAllByText(/₹180/).length).toBeGreaterThan(0);
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });

  it("never overrides or hides the flag — it only ever reflects what was passed in", () => {
    // There is no prop/mechanism on this component that can suppress
    // duplicateFlag=true; this test documents that by construction.
    const claim = makeSerializedClaim({ duplicateFlag: true, duplicatesFound: [] });
    render(<DuplicateWarningBanner claim={claim} />);
    expect(screen.getByText("Possible duplicate receipt")).toBeInTheDocument();
  });
});
