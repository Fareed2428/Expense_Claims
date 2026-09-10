"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_LABEL, formatCurrency } from "@/lib/format";
import type { SerializedClaim } from "@/lib/claim-serialization";

type Step = "idle" | "confirm-approve" | "confirm-reject";

/**
 * Approve/Reject actions for a manager reviewing a SUBMITTED claim.
 *
 * This component only ever *offers* the actions — the manager claim
 * detail page only renders it when lib/claim-ui-helpers.ts's canReview()
 * says the viewer is allowed to review this specific claim (assigned to
 * them, and never their own). That is defense-in-depth only: the real
 * enforcement, including the self-approval rule, lives server-side in
 * lib/claim-service.ts's approveClaim()/rejectClaim() via the existing
 * Phase 6 API routes (POST /api/claims/[id]/approve,
 * POST /api/claims/[id]/reject) — if the API rejects the request anyway
 * (e.g. a stale page, or a request replayed after someone else already
 * decided this claim), this shows that error rather than assuming
 * success or silently retrying.
 */
export function ApproveRejectPanel({ claim }: { claim: SerializedClaim }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "approve" | "reject") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${claim.id}/${action}`, {
        method: "POST",
        headers: action === "reject" ? { "Content-Type": "application/json" } : undefined,
        body: action === "reject" ? JSON.stringify({ note }) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `Could not ${action} this claim.`);
      }
      router.push("/manager");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  function handleConfirmReject() {
    if (note.trim().length === 0) {
      setError("A rejection reason is required.");
      return;
    }
    void submit("reject");
  }

  const categoryLabel = (CATEGORY_LABEL[claim.category] ?? claim.category).toLowerCase();
  const firstName = claim.claimant.name.split(" ")[0];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Review this claim</h2>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {step === "idle" && (
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setStep("confirm-approve")}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Approve Claim
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep("confirm-reject");
            }}
            className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Reject Claim
          </button>
        </div>
      )}

      {step === "confirm-approve" && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-900">
            Approve {formatCurrency(claim.amount)} {categoryLabel} claim from {firstName}?
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => submit("approve")}
              className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {submitting ? "Approving…" : "Confirm Approval"}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setStep("idle")}
              className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "confirm-reject" && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-900">Reject this claim?</p>
          <label className="mt-2 block text-xs font-medium text-red-800" htmlFor="rejection-note">
            Reason (required)
          </label>
          <textarea
            id="rejection-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-red-300 px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none"
            placeholder="e.g. Missing itemised bill, please resubmit with details."
          />
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={handleConfirmReject}
              className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {submitting ? "Rejecting…" : "Confirm Rejection"}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setStep("idle");
                setNote("");
                setError(null);
              }}
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
