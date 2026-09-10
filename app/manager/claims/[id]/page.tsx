import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getClaim } from "@/lib/claim-service";
import { serializeClaim } from "@/lib/claim-serialization";
import { ClaimNotFoundError, ForbiddenError } from "@/lib/claim-errors";
import { APP_NAME } from "@/lib/constants";
import { CATEGORY_LABEL, formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/claims/StatusBadge";
import { DuplicateWarningBanner } from "@/components/claims/DuplicateWarningBanner";
import { ClaimEventTimeline } from "@/components/claims/ClaimEventTimeline";
import { ReceiptParseDetails } from "@/components/claims/ReceiptParseDetails";
import { ApproveRejectPanel } from "@/components/manager/ApproveRejectPanel";
import { canReview } from "@/lib/claim-ui-helpers";

export const metadata: Metadata = { title: `Review Claim — ${APP_NAME}` };

export default async function ManagerClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Staff has no review UI at all (Phase 7's /claims/[id] is their claim
  // detail page); Finance's actions live in a later phase. Sending anyone
  // else back to their own dashboard is a UX nicety, not the real gate —
  // getClaim() below and the approve/reject API routes are what actually
  // enforce who may see or act on a given claim.
  if (user.role !== "MANAGER") redirect("/dashboard");

  const { id } = await params;

  let claim;
  try {
    claim = serializeClaim(await getClaim(user, id));
  } catch (err) {
    // Not found and "not authorized to view" are deliberately shown the
    // same way — an unrelated employee's claim shouldn't be distinguishable
    // from one that doesn't exist (same policy as Phase 7's /claims/[id]).
    if (err instanceof ClaimNotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }

  const showReviewActions = canReview(claim, user);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/manager" className="text-sm text-slate-500 hover:text-slate-700">
          ← Manager Review
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{claim.merchant}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {claim.claimant.name} · {CATEGORY_LABEL[claim.category] ?? claim.category} · {formatDate(claim.expenseDate)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-2xl font-bold text-slate-900">{formatCurrency(claim.amount)}</p>
            <StatusBadge status={claim.status} />
          </div>
        </div>
      </div>

      <DuplicateWarningBanner claim={claim} />

      {claim.status === "PARSED" && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
          This claim is still a draft — {claim.claimant.name.split(" ")[0]} hasn&apos;t submitted it for review yet.
        </div>
      )}

      {claim.status === "SUBMITTED" && !showReviewActions && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          {claim.claimantId === user.id
            ? "This is your own claim — you cannot approve or reject it yourself."
            : `Awaiting review${claim.approver ? ` by ${claim.approver.name}` : ""}.`}
        </div>
      )}

      {claim.status === "APPROVED" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Approved{claim.approver ? ` by ${claim.approver.name}` : ""}
          {claim.decidedAt ? ` on ${formatDate(claim.decidedAt)}` : ""}. Finance will pay this out.
        </div>
      )}

      {claim.status === "REJECTED" && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4">
          <p className="font-semibold text-red-900">Rejected{claim.approver ? ` by ${claim.approver.name}` : ""}</p>
          <p className="mt-1 text-sm text-red-800">{claim.decisionNote ?? "No reason was recorded."}</p>
        </div>
      )}

      {claim.status === "PAID" && (
        <div className="rounded-lg border-2 border-violet-300 bg-violet-50 p-4 text-sm text-violet-900">
          <p className="font-semibold">This claim has been paid.</p>
          <p className="mt-1">
            Paid{claim.paidBy ? ` by ${claim.paidBy.name}` : ""}
            {claim.paidAt ? ` on ${formatDate(claim.paidAt)}` : ""}. This is final — no further action is possible.
          </p>
        </div>
      )}

      {showReviewActions && <ApproveRejectPanel claim={claim} />}

      <ReceiptParseDetails claim={claim} />

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Timeline</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 border-b border-slate-100 pb-4 text-sm sm:grid-cols-4">
          <TimelineDate label="Submitted" value={claim.submittedAt} />
          <TimelineDate label="Decided" value={claim.decidedAt} />
          <TimelineDate label="Paid" value={claim.paidAt} />
        </div>
        <div className="mt-4">
          <ClaimEventTimeline events={claim.events} />
        </div>
      </section>
    </div>
  );
}

function TimelineDate({ label, value }: { label: string; value: string | Date | null }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-medium text-slate-900">{value ? formatDateTime(value) : "—"}</p>
    </div>
  );
}
