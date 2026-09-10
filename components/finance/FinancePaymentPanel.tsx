"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";
import type { SerializedClaim } from "@/lib/claim-serialization";
import { needsDuplicateAcknowledgement } from "@/lib/claim-ui-helpers";

type Step = "idle" | "confirm-pay";

/**
 * Finance's payment actions for an APPROVED claim.
 *
 * This component only ever *offers* the actions — the Finance claim
 * detail page only renders it when lib/claim-ui-helpers.ts's canPay()
 * says the claim is APPROVED and the viewer is Finance. That is
 * defense-in-depth only: the real enforcement — including the
 * duplicate-acknowledgement gate — lives server-side in
 * lib/claim-service.ts's acknowledgeDuplicate()/payClaim(), called here
 * via the existing Phase 6 API routes (POST
 * /api/claims/[id]/acknowledge-duplicate, POST /api/claims/[id]/pay). If
 * the API rejects the request anyway, this shows that error rather than
 * assuming success.
 *
 * needsDuplicateAcknowledgement(claim) decides which action is offered:
 * a flagged-and-unacknowledged claim gets only "Acknowledge Duplicate"
 * (with an explanatory message, per CLAUDE.md's "Duplicate acknowledgement
 * required before payment" copy); everything else gets "Pay Claim" with
 * an inline confirmation. Acknowledging does not auto-advance to the pay
 * confirmation — it's a second, deliberate click, matching how Approve
 * and Reject are also always separate, explicit actions elsewhere in the
 * app (Phase 8's ApproveRejectPanel).
 */
export function FinancePaymentPanel({ claim }: { claim: SerializedClaim }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [acknowledging, setAcknowledging] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsAck = needsDuplicateAcknowledgement(claim);

  async function handleAcknowledge() {
    setAcknowledging(true);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${claim.id}/acknowledge-duplicate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not acknowledge this duplicate.");
      setStep("idle");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setAcknowledging(false);
    }
  }

  async function handlePay() {
    setPaying(true);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${claim.id}/pay`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not pay this claim.");
      router.push("/finance/payments");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setPaying(false);
    }
  }

  const firstName = claim.claimant.name.split(" ")[0];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Payment</h2>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {needsAck ? (
        <div className="mt-3">
          <p className="text-sm text-amber-800">Duplicate acknowledgement required before payment.</p>
          <button
            type="button"
            disabled={acknowledging}
            onClick={handleAcknowledge}
            className="mt-3 rounded-md border border-amber-400 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-60"
          >
            {acknowledging ? "Acknowledging…" : "Acknowledge Duplicate"}
          </button>
        </div>
      ) : step === "idle" ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setStep("confirm-pay")}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Pay Claim
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-900">
            Pay {formatCurrency(claim.amount)} to {firstName}&apos;s claim?
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={paying}
              onClick={handlePay}
              className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {paying ? "Paying…" : "Confirm Payment"}
            </button>
            <button
              type="button"
              disabled={paying}
              onClick={() => setStep("idle")}
              className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
