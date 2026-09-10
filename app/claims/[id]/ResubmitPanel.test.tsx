// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResubmitPanel } from "./ResubmitPanel";
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

describe("ResubmitPanel", () => {
  it("pre-fills the form with the claim's current values", () => {
    const claim = makeSerializedClaim({ status: "REJECTED", merchant: "Ola", amount: 180 });
    render(<ResubmitPanel claim={claim} />);
    expect(screen.getByLabelText(/merchant/i)).toHaveValue("Ola");
    expect(screen.getByLabelText(/amount/i)).toHaveValue(180);
  });

  it("resubmits with only the changed fields and redirects to the claim on success", async () => {
    const claim = makeSerializedClaim({ id: "claim-1", status: "REJECTED", merchant: "Ola", amount: 180 });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ claim: { ...claim, status: "SUBMITTED" } }));

    const user = userEvent.setup();
    render(<ResubmitPanel claim={claim} />);

    const amountInput = screen.getByLabelText(/amount/i);
    await user.clear(amountInput);
    await user.type(amountInput, "220");
    await user.click(screen.getByRole("button", { name: /resubmit claim/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/claims/claim-1"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/claims/claim-1/resubmit",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ amount: 220 }) })
    );
  });

  it("sends an empty corrections body when nothing was changed", async () => {
    const claim = makeSerializedClaim({ id: "claim-1", status: "REJECTED" });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ claim: { ...claim, status: "SUBMITTED" } }));

    const user = userEvent.setup();
    render(<ResubmitPanel claim={claim} />);
    await user.click(screen.getByRole("button", { name: /resubmit claim/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/claims/claim-1/resubmit",
      expect.objectContaining({ body: JSON.stringify({}) })
    );
  });

  it("shows an API error inline and does not redirect on failure", async () => {
    const claim = makeSerializedClaim({ id: "claim-1", status: "REJECTED" });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "Cannot move a claim from REJECTED to SUBMITTED." }, false, 409));

    const user = userEvent.setup();
    render(<ResubmitPanel claim={claim} />);
    await user.click(screen.getByRole("button", { name: /resubmit claim/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot move a claim/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("blocks resubmission client-side for an invalid amount, without an API call", async () => {
    const claim = makeSerializedClaim({ id: "claim-1", status: "REJECTED", amount: 180 });
    const user = userEvent.setup();
    render(<ResubmitPanel claim={claim} />);

    const amountInput = screen.getByLabelText(/amount/i);
    await user.clear(amountInput);
    await user.type(amountInput, "-5");
    await user.click(screen.getByRole("button", { name: /resubmit claim/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/enter a valid amount/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
