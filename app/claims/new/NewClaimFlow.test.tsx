// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewClaimFlow } from "./NewClaimFlow";
import { makeSerializedClaim } from "@/components/claims/test-fixtures";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

describe("NewClaimFlow — step 1: paste and parse", () => {
  it("starts on the paste step with no review fields visible yet", () => {
    render(<NewClaimFlow initialClaim={null} />);
    expect(screen.getByLabelText(/paste receipt text/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^parse receipt$/i })).toBeInTheDocument();
    expect(screen.queryByText(/review extracted details/i)).not.toBeInTheDocument();
  });

  it("shows an inline error and does not call the API when submitting empty text", async () => {
    const user = userEvent.setup();
    render(<NewClaimFlow initialClaim={null} />);

    await user.click(screen.getByRole("button", { name: /^parse receipt$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/paste some receipt text/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("parses the receipt and displays the extracted fields", async () => {
    const parsed = makeSerializedClaim({
      id: "claim-1",
      merchant: "Ola",
      amount: 180,
      category: "TAXI",
      receipt: {
        ...makeSerializedClaim().receipt!,
        parseConfidence: 0.7,
        parseWarnings: ["Could not determine the expense date."],
      },
    });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ claim: parsed }));

    const user = userEvent.setup();
    render(<NewClaimFlow initialClaim={null} />);
    await user.type(screen.getByLabelText(/paste receipt text/i), "Ola auto MG Road to office Rs 180");
    await user.click(screen.getByRole("button", { name: /^parse receipt$/i }));

    expect(await screen.findByText(/review extracted details/i)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/claims",
      expect.objectContaining({ method: "POST" })
    );
    expect(screen.getByDisplayValue("Ola")).toBeInTheDocument();
    expect(screen.getByText(/parse confidence: 70%/i)).toBeInTheDocument();
    expect(screen.getByText(/could not determine the expense date/i)).toBeInTheDocument();
    // Nothing has been edited yet — every field's badge reads "Extracted
    // from receipt" (exact match, so this doesn't also match the
    // explanatory paragraph that mentions both phrases in passing).
    expect(screen.getAllByText("Extracted from receipt", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Corrected by you", { exact: true })).not.toBeInTheDocument();
  });

  it("shows a parse error inline without crashing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "Receipt text is required." }, false, 400));

    const user = userEvent.setup();
    render(<NewClaimFlow initialClaim={null} />);
    await user.type(screen.getByLabelText(/paste receipt text/i), "x");
    await user.click(screen.getByRole("button", { name: /^parse receipt$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Receipt text is required.");
    expect(screen.queryByText(/review extracted details/i)).not.toBeInTheDocument();
  });
});

describe("NewClaimFlow — step 2: editable corrections", () => {
  it("marks a field 'Corrected by you' once the employee changes it", async () => {
    const initialClaim = makeSerializedClaim({ id: "claim-1", merchant: "Ola" });
    const user = userEvent.setup();
    render(<NewClaimFlow initialClaim={initialClaim} />);

    const merchantInput = screen.getByLabelText(/merchant/i);
    expect(screen.getAllByText("Extracted from receipt", { exact: true }).length).toBeGreaterThan(0);

    await user.clear(merchantInput);
    await user.type(merchantInput, "Ola Cabs");

    expect(screen.getByText("Corrected by you", { exact: true })).toBeInTheDocument();
  });

  it("shows the duplicate warning banner when the parsed claim is flagged", () => {
    const initialClaim = makeSerializedClaim({
      id: "claim-1",
      duplicateFlag: true,
      duplicateScore: 0.9,
      duplicatesFound: [],
    });
    render(<NewClaimFlow initialClaim={initialClaim} />);
    expect(screen.getByText("Possible duplicate receipt")).toBeInTheDocument();
  });
});

describe("NewClaimFlow — submission", () => {
  it("submits directly (no PATCH) when nothing was corrected, then redirects to the claim detail page", async () => {
    const initialClaim = makeSerializedClaim({ id: "claim-1" });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ claim: { ...initialClaim, status: "SUBMITTED" } }));

    const user = userEvent.setup();
    render(<NewClaimFlow initialClaim={initialClaim} />);
    await user.click(screen.getByRole("button", { name: /submit claim/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/claims/claim-1"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/claims/claim-1/submit", expect.objectContaining({ method: "POST" }));
  });

  it("saves corrections via PATCH before submitting when a field was changed", async () => {
    const initialClaim = makeSerializedClaim({ id: "claim-1", merchant: "Ola" });
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ claim: { ...initialClaim, merchant: "Ola Cabs" } })) // PATCH
      .mockResolvedValueOnce(jsonResponse({ claim: { ...initialClaim, merchant: "Ola Cabs", status: "SUBMITTED" } })); // submit

    const user = userEvent.setup();
    render(<NewClaimFlow initialClaim={initialClaim} />);
    const merchantInput = screen.getByLabelText(/merchant/i);
    await user.clear(merchantInput);
    await user.type(merchantInput, "Ola Cabs");

    await user.click(screen.getByRole("button", { name: /submit claim/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/claims/claim-1"));
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/claims/claim-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ merchant: "Ola Cabs" }) })
    );
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/claims/claim-1/submit", expect.objectContaining({ method: "POST" }));
  });

  it("shows a submit error inline and does not redirect on failure", async () => {
    const initialClaim = makeSerializedClaim({ id: "claim-1" });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: "A valid amount is required before this claim can be submitted." }, false, 400)
    );

    const user = userEvent.setup();
    render(<NewClaimFlow initialClaim={initialClaim} />);
    await user.click(screen.getByRole("button", { name: /submit claim/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/valid amount is required/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("blocks submission client-side with a clear message when the amount is not positive, without an API call", async () => {
    const initialClaim = makeSerializedClaim({ id: "claim-1", amount: 180 });
    const user = userEvent.setup();
    render(<NewClaimFlow initialClaim={initialClaim} />);

    const amountInput = screen.getByLabelText(/amount/i);
    await user.clear(amountInput);
    await user.type(amountInput, "0");
    await user.click(screen.getByRole("button", { name: /submit claim/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/enter a valid amount/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
