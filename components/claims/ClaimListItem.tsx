import Link from "next/link";
import { CATEGORY_LABEL, formatCurrency, formatDate } from "@/lib/format";
import type { SerializedClaim } from "@/lib/claim-serialization";
import { StatusBadge } from "@/components/claims/StatusBadge";

/** One row in a claims list — dashboard's "recent claims" and the full "My Claims" page both use this, so the two views can never drift in what they show. */
export function ClaimListItem({ claim }: { claim: SerializedClaim }) {
  return (
    <Link
      href={`/claims/${claim.id}`}
      className="flex flex-col gap-2 px-4 py-3 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-slate-900">{claim.merchant}</p>
          <StatusBadge status={claim.status} />
          {claim.duplicateFlag && (
            <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
              ⚠ Possible duplicate
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-500">
          {CATEGORY_LABEL[claim.category] ?? claim.category} · {formatDate(claim.expenseDate)}
        </p>
      </div>
      <div className="text-right">
        <p className="font-semibold text-slate-900">{formatCurrency(claim.amount)}</p>
        <p className="text-xs text-slate-400">Filed {formatDate(claim.createdAt)}</p>
      </div>
    </Link>
  );
}
