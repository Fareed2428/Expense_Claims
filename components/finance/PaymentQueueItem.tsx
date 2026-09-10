import Link from "next/link";
import { CATEGORY_LABEL, formatCurrency, formatDate } from "@/lib/format";
import type { SerializedClaim } from "@/lib/claim-serialization";
import { StatusBadge } from "@/components/claims/StatusBadge";

/**
 * One row in Finance's "claims awaiting payment" queue. Distinct from
 * ManagerClaimListItem/ClaimListItem: Finance specifically needs to see
 * who approved the claim and when, plus the duplicate *acknowledgement*
 * state (not just the flag) — the acknowledgement gate is this role's
 * own concern (see FinancePaymentPanel), so it's surfaced here too, not
 * just on the detail page.
 */
export function PaymentQueueItem({ claim }: { claim: SerializedClaim }) {
  const needsAck = claim.duplicateFlag && !claim.duplicateAcknowledgedAt;

  return (
    <Link
      href={`/finance/claims/${claim.id}`}
      className="flex flex-col gap-2 px-4 py-3 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-slate-900">{claim.claimant.name}</p>
          <StatusBadge status={claim.status} />
          {claim.duplicateFlag && (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                needsAck ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-300 bg-slate-50 text-slate-600"
              }`}
            >
              {needsAck ? "⚠ Duplicate — needs acknowledgement" : "✓ Duplicate acknowledged"}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-500">
          {claim.merchant} · {CATEGORY_LABEL[claim.category] ?? claim.category} · Receipt {formatDate(claim.expenseDate)}
          {claim.approver ? ` · Approved by ${claim.approver.name}` : ""}
          {claim.decidedAt ? ` on ${formatDate(claim.decidedAt)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <p className="font-semibold text-slate-900">{formatCurrency(claim.amount)}</p>
        <span className="text-sm font-medium text-slate-600">Review / Pay →</span>
      </div>
    </Link>
  );
}
