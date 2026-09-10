// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReceiptParseDetails } from "./ReceiptParseDetails";
import { makeSerializedClaim } from "@/components/claims/test-fixtures";

describe("ReceiptParseDetails", () => {
  it("labels an untouched field as 'Extracted from receipt'", () => {
    const claim = makeSerializedClaim({
      merchant: "Ola",
      receipt: {
        ...makeSerializedClaim().receipt!,
        parsedMerchant: "Ola",
      },
    });
    render(<ReceiptParseDetails claim={claim} />);
    expect(screen.getAllByText("Extracted from receipt").length).toBeGreaterThan(0);
  });

  it("labels a field that differs from the parser's output as 'Corrected by employee'", () => {
    const claim = makeSerializedClaim({
      amount: 250,
      receipt: {
        ...makeSerializedClaim().receipt!,
        parsedAmount: 180, // the reviewer is looking at a claim the employee corrected
      },
    });
    render(<ReceiptParseDetails claim={claim} />);
    expect(screen.getAllByText("Corrected by employee").length).toBeGreaterThan(0);
  });

  it("shows the parser's confidence percentage", () => {
    const claim = makeSerializedClaim({
      receipt: { ...makeSerializedClaim().receipt!, parseConfidence: 0.55 },
    });
    render(<ReceiptParseDetails claim={claim} />);
    expect(screen.getByText("55%")).toBeInTheDocument();
  });

  it("shows parser warnings when present", () => {
    const claim = makeSerializedClaim({
      receipt: { ...makeSerializedClaim().receipt!, parseWarnings: ["Could not determine the expense date"] },
    });
    render(<ReceiptParseDetails claim={claim} />);
    expect(screen.getByText("Could not determine the expense date")).toBeInTheDocument();
  });

  it("shows the raw receipt text verbatim", () => {
    const claim = makeSerializedClaim({ rawReceiptText: "uber auto chennai 3 sept 220" });
    render(<ReceiptParseDetails claim={claim} />);
    expect(screen.getByText("uber auto chennai 3 sept 220")).toBeInTheDocument();
  });
});
