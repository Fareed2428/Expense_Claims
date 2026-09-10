import Link from "next/link";
import { CATEGORY_LABEL, formatCurrency, formatDate } from "@/lib/format";
import type { SerializedClaim } from "@/lib/claim-serialization";
import { StatusBadge } from "@/components/claims/StatusBadge";

/**
 * One row in a manager's review queue or "recently reviewed" list.
 * Distinct from components/claims/ClaimListItem.tsx (the Staff "My
 * Claims" row): a manager needs to see *whose* claim this is, which the
 * claimant's own view never shows (it's always "you"). Shares the same
 * shape/spacing conventions on purpose, so the manager UI reads as the
 * same product as the Staff UI, not a bolted-on second app.
 */
export function ManagerClaimListItem({
  claim,
  variant,
}: {
  claim: SerializedClaim;
  variant: "pending" | "reviewed";
}) {
  const dateLabel = variant === "pending" ? "Submitted" : "Decided";
  const dateValue = variant === "pending" ? claim.submittedAt : claim.decidedAt;
  const actionLabel = variant === "pending" ? "Review Claim" : "View";

  return (
    <Link
      href={`/manager/claims/${claim.id}`}
      className="flex flex-col gap-2 px-4 py-3 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-slate-900">{claim.claimant.name}</p>
          <StatusBadge status={claim.status} />
          {claim.duplicateFlag && (
            <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
              ⚠ Possible duplicate
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-500">
          {claim.merchant} · {CATEGORY_LABEL[claim.category] ?? claim.category} · Receipt {formatDate(claim.expenseDate)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          <p className="font-semibold text-slate-900">{formatCurrency(claim.amount)}</p>
          <p className="text-xs text-slate-400">
            {dateLabel} {dateValue ? formatDate(dateValue) : "—"}
          </p>
        </div>
        <span className="text-sm font-medium text-slate-600">{actionLabel} →</span>
      </div>
    </Link>
  );
}
