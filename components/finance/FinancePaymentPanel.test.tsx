// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinancePaymentPanel } from "./FinancePaymentPanel";
import { makeSerializedClaim } from "@/components/claims/test-fixtures";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body } as Response;
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

describe("FinancePaymentPanel", () => {
  it("a non-duplicate claim gets a Pay Claim button directly, no acknowledgement step", () => {
    const claim = makeSerializedClaim({ status: "APPROVED", duplicateFlag: false });
    render(<FinancePaymentPanel claim={claim} />);
    expect(screen.getByRole("button", { name: /^pay claim$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /acknowledge duplicate/i })).not.toBeInTheDocument();
  });

  it("a flagged, unacknowledged claim shows the acknowledgement-required message and only the Acknowledge action", () => {
    const claim = makeSerializedClaim({ status: "APPROVED", duplicateFlag: true, duplicateAcknowledgedAt: null });
    render(<FinancePaymentPanel claim={claim} />);
    expect(screen.getByText(/duplicate acknowledgement required before payment/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /acknowledge duplicate/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^pay claim$/i })).not.toBeInTheDocument();
  });

  it("a flagged but already-acknowledged claim gets the normal Pay Claim button", () => {
    const claim = makeSerializedClaim({
      status: "APPROVED",
      duplicateFlag: true,
      duplicateAcknowledgedAt: "2026-09-09T10:00:00.000Z" as unknown as Date,
    });
    render(<FinancePaymentPanel claim={claim} />);
    expect(screen.getByRole("button", { name: /^pay claim$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /acknowledge duplicate/i })).not.toBeInTheDocument();
  });

  it("acknowledging calls the acknowledge-duplicate endpoint and refreshes (does not redirect away)", async () => {
    const claim = makeSerializedClaim({ id: "claim-1", status: "APPROVED", duplicateFlag: true, duplicateAcknowledgedAt: null });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ claim: { ...claim, duplicateAcknowledgedAt: "now" } }));

    const user = userEvent.setup();
    render(<FinancePaymentPanel claim={claim} />);
    await user.click(screen.getByRole("button", { name: /acknowledge duplicate/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/api/claims/claim-1/acknowledge-duplicate", expect.objectContaining({ method: "POST" }));
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a confirmation naming the amount and claimant before paying, then pays on confirm and redirects", async () => {
    const claim = makeSerializedClaim({
      id: "claim-1",
      status: "APPROVED",
      duplicateFlag: false,
      amount: 1850,
      claimant: { id: "staff-1", name: "Rohan Gupta", email: "r@x.invalid", role: "STAFF", managerId: "m-1" },
    });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ claim: { ...claim, status: "PAID" } }));

    const user = userEvent.setup();
    render(<FinancePaymentPanel claim={claim} />);

    await user.click(screen.getByRole("button", { name: /^pay claim$/i }));
    expect(screen.getByText(/pay.*1,850.*to rohan's claim/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /confirm payment/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/finance/payments"));
    expect(fetch).toHaveBeenCalledWith("/api/claims/claim-1/pay", expect.objectContaining({ method: "POST" }));
  });

  it("shows a server-side error inline and does not redirect on payment failure", async () => {
    const claim = makeSerializedClaim({ id: "claim-1", status: "APPROVED", duplicateFlag: false });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: "This claim is flagged as a possible duplicate and must be acknowledged by Finance before it can be paid." }, false, 409)
    );

    const user = userEvent.setup();
    render(<FinancePaymentPanel claim={claim} />);
    await user.click(screen.getByRole("button", { name: /^pay claim$/i }));
    await user.click(screen.getByRole("button", { name: /confirm payment/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/must be acknowledged/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("cancel returns to the idle state without calling the API", async () => {
    const claim = makeSerializedClaim({ status: "APPROVED", duplicateFlag: false });
    const user = userEvent.setup();
    render(<FinancePaymentPanel claim={claim} />);

    await user.click(screen.getByRole("button", { name: /^pay claim$/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByRole("button", { name: /^pay claim$/i })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
