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
import { canContinueEditingDraft, canResubmit } from "@/lib/claim-ui-helpers";
import { ResubmitPanel } from "./ResubmitPanel";

export const metadata: Metadata = { title: `Claim — ${APP_NAME}` };

export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;

  let claim;
  try {
    claim = serializeClaim(await getClaim(user, id));
  } catch (err) {
    // Not found and "not authorized to view" are deliberately shown the
    // same way — a claim you can't see shouldn't be distinguishable from
    // one that doesn't exist.
    if (err instanceof ClaimNotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }

  const showContinueEditing = canContinueEditingDraft(claim, user.id);
  const showResubmit = canResubmit(claim, user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/claims" className="text-sm text-slate-500 hover:text-slate-700">
          ← My Claims
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{claim.merchant}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {CATEGORY_LABEL[claim.category] ?? claim.category} · {formatDate(claim.expenseDate)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-2xl font-bold text-slate-900">{formatCurrency(claim.amount)}</p>
            <StatusBadge status={claim.status} />
          </div>
        </div>
      </div>

      <DuplicateWarningBanner claim={claim} />

      {showContinueEditing && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
          This claim is still a draft — it hasn&apos;t been submitted for review yet.{" "}
          <Link href={`/claims/new?claim=${claim.id}`} className="font-medium text-slate-900 underline">
            Continue editing
          </Link>
        </div>
      )}

      {claim.status === "SUBMITTED" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          Awaiting review by {claim.approver ? claim.approver.name : "your manager"}.
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
          <p className="mt-1 text-sm text-red-800">
            {claim.decisionNote ?? "No reason was recorded."}
          </p>
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

      {showResubmit && <ResubmitPanel claim={claim} />}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Receipt</h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">Merchant</dt>
            <dd className="font-medium text-slate-900">{claim.merchant}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Date</dt>
            <dd className="font-medium text-slate-900">{formatDate(claim.expenseDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Amount</dt>
            <dd className="font-medium text-slate-900">{formatCurrency(claim.amount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Category</dt>
            <dd className="font-medium text-slate-900">{CATEGORY_LABEL[claim.category] ?? claim.category}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <p className="text-xs text-slate-500">Raw receipt text</p>
          <pre className="mt-1 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700">
            {claim.rawReceiptText}
          </pre>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Timeline</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 border-b border-slate-100 pb-4 text-sm sm:grid-cols-4">
          <TimelineDate label="Created" value={claim.createdAt} />
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
