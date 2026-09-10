import { formatCurrency } from "@/lib/format";
import type { MonthlySpend } from "@/lib/claim-service";

/**
 * Monthly spend summary — every number here comes straight from
 * lib/claim-service.ts's getMonthlySpend(), which is the one place that
 * decides what counts as "spending" (APPROVED + PAID) vs. "pending"
 * (SUBMITTED). Nothing is recalculated in this component.
 */
export function MonthlySpendSummary({ spend, claimCount }: { spend: MonthlySpend; claimCount: number }) {
  const remaining = Math.max(spend.limit - spend.committed, 0);
  const pct = spend.limit > 0 ? Math.min((spend.committed / spend.limit) * 100, 100) : 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">This month's spending</h2>
        {(spend.isNearLimit || spend.isOverLimit) && (
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              spend.isOverLimit
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-amber-300 bg-amber-50 text-amber-800"
            }`}
          >
            {spend.isOverLimit ? "Over monthly limit" : "Near monthly limit"}
          </span>
        )}
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${spend.isOverLimit ? "bg-red-500" : spend.isNearLimit ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <SummaryStat label="Monthly limit" value={formatCurrency(spend.limit)} />
        <SummaryStat label="Spent (approved + paid)" value={formatCurrency(spend.committed)} />
        <SummaryStat label="Remaining" value={formatCurrency(remaining)} />
        <SummaryStat label="Pending review" value={formatCurrency(spend.pending)} />
        <SummaryStat label="Total claims" value={String(claimCount)} />
      </dl>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
