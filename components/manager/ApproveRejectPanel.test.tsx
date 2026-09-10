// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApproveRejectPanel } from "./ApproveRejectPanel";
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

describe("ApproveRejectPanel", () => {
  it("shows a confirmation naming the amount, category, and claimant before approving", async () => {
    const claim = makeSerializedClaim({
      amount: 1850,
      category: "TRAVEL",
      claimant: { id: "staff-1", name: "Rohan Gupta", email: "r@x.invalid", role: "STAFF", managerId: "m-1" },
    });
    const user = userEvent.setup();
    render(<ApproveRejectPanel claim={claim} />);

    await user.click(screen.getByRole("button", { name: /^approve claim$/i }));
    expect(screen.getByText(/approve.*1,850.*travel claim from rohan/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("approves on confirmation and redirects to the review queue", async () => {
    const claim = makeSerializedClaim({ id: "claim-1" });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ claim: { ...claim, status: "APPROVED" } }));

    const user = userEvent.setup();
    render(<ApproveRejectPanel claim={claim} />);

    await user.click(screen.getByRole("button", { name: /^approve claim$/i }));
    await user.click(screen.getByRole("button", { name: /confirm approval/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/manager"));
    expect(fetch).toHaveBeenCalledWith("/api/claims/claim-1/approve", expect.objectContaining({ method: "POST" }));
  });

  it("cancel returns to the idle state without calling the API", async () => {
    const claim = makeSerializedClaim();
    const user = userEvent.setup();
    render(<ApproveRejectPanel claim={claim} />);

    await user.click(screen.getByRole("button", { name: /^approve claim$/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByRole("button", { name: /^approve claim$/i })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks rejection client-side when the reason is empty, without calling the API", async () => {
    const claim = makeSerializedClaim();
    const user = userEvent.setup();
    render(<ApproveRejectPanel claim={claim} />);

    await user.click(screen.getByRole("button", { name: /^reject claim$/i }));
    await user.click(screen.getByRole("button", { name: /confirm rejection/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/reason is required/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects with the typed reason and redirects on success", async () => {
    const claim = makeSerializedClaim({ id: "claim-1" });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ claim: { ...claim, status: "REJECTED" } }));

    const user = userEvent.setup();
    render(<ApproveRejectPanel claim={claim} />);

    await user.click(screen.getByRole("button", { name: /^reject claim$/i }));
    await user.type(screen.getByLabelText(/reason/i), "Missing itemised bill.");
    await user.click(screen.getByRole("button", { name: /confirm rejection/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/manager"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/claims/claim-1/reject",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "Missing itemised bill." }) })
    );
  });

  it("shows a server-side error inline and does not redirect on failure (e.g. self-approval rejected server-side)", async () => {
    const claim = makeSerializedClaim({ id: "claim-1" });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: "A manager cannot approve or reject their own claim." }, false, 403)
    );

    const user = userEvent.setup();
    render(<ApproveRejectPanel claim={claim} />);

    await user.click(screen.getByRole("button", { name: /^approve claim$/i }));
    await user.click(screen.getByRole("button", { name: /confirm approval/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot approve or reject their own claim/i);
    expect(push).not.toHaveBeenCalled();
  });
});
