import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getClaim } from "@/lib/claim-service";
import { serializeClaim } from "@/lib/claim-serialization";
import { ClaimNotFoundError, ForbiddenError } from "@/lib/claim-errors";
import { APP_NAME } from "@/lib/constants";
import { CATEGORY_LABEL, STATUS_LABEL, formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/claims/StatusBadge";
import { DuplicateWarningBanner } from "@/components/claims/DuplicateWarningBanner";
import { ClaimEventTimeline } from "@/components/claims/ClaimEventTimeline";
import { ReceiptParseDetails } from "@/components/claims/ReceiptParseDetails";
import { FinancePaymentPanel } from "@/components/finance/FinancePaymentPanel";
import { canPay } from "@/lib/claim-ui-helpers";

export const metadata: Metadata = { title: `Claim — ${APP_NAME}` };

export default async function FinanceClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Staff/Manager have their own claim detail pages (/claims/[id],
  // /manager/claims/[id]) with the actions appropriate to their role;
  // sending anyone else back to their own dashboard is a UX nicety, not
  // the real gate — getClaim() below and the acknowledge/pay API routes
  // are what actually enforce who may see or act on a given claim.
  if (user.role !== "FINANCE") redirect("/dashboard");

  const { id } = await params;

  let claim;
  try {
    // getClaim() already grants Finance unrestricted visibility (see its
    // canViewClaim() in lib/claim-service.ts: `if (actor.role ===
    // "FINANCE") return true`) — no separate Finance-specific query is
    // needed here, and this deliberately does not narrow that.
    claim = serializeClaim(await getClaim(user, id));
  } catch (err) {
    if (err instanceof ClaimNotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }

  const showPaymentActions = canPay(claim, user);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/finance/payments" className="text-sm text-slate-500 hover:text-slate-700">
          ← Claims awaiting payment
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

      {claim.status === "APPROVED" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Approved{claim.approver ? ` by ${claim.approver.name}` : ""}
          {claim.decidedAt ? ` on ${formatDate(claim.decidedAt)}` : ""}. Ready for payment.
        </div>
      )}

      {claim.status === "PAID" && (
        <div className="rounded-lg border-2 border-violet-300 bg-violet-50 p-4 text-sm text-violet-900">
          <p className="font-semibold">This claim has been paid.</p>
          <p className="mt-1">
            Paid{claim.paidBy ? ` by ${claim.paidBy.name}` : ""}
            {claim.paidAt ? ` on ${formatDateTime(claim.paidAt)}` : ""}. This is final — no further action is possible.
          </p>
        </div>
      )}

      {claim.status !== "APPROVED" && claim.status !== "PAID" && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
          This claim is not yet approved — status: {STATUS_LABEL[claim.status] ?? claim.status}. Only approved claims can be
          paid.
        </div>
      )}

      {claim.duplicateFlag && claim.duplicateAcknowledgedAt && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
          Duplicate acknowledged{claim.duplicateAcknowledgedBy ? ` by ${claim.duplicateAcknowledgedBy.name}` : ""} on{" "}
          {formatDateTime(claim.duplicateAcknowledgedAt)}.
        </div>
      )}

      {showPaymentActions && <FinancePaymentPanel claim={claim} />}

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
