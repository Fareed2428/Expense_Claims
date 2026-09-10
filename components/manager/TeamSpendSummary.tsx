import { formatCurrency } from "@/lib/format";
import type { ManagerTeamSpend } from "@/lib/claim-service";

/**
 * Team spending summary for the manager dashboard — every number comes
 * straight from lib/claim-service.ts's getManagerTeamSpend(), which is
 * the one place that decides what counts as the team's committed
 * (APPROVED + PAID) vs. pending (SUBMITTED) spend. Nothing is
 * recalculated here. No limit/over-limit indicator by design — that's
 * Finance's reporting job (a later phase), not this dashboard's.
 */
export function TeamSpendSummary({ spend }: { spend: ManagerTeamSpend }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Team spending this month</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <SummaryStat label="Approved + paid" value={formatCurrency(spend.committed)} />
        <SummaryStat label="Pending review" value={formatCurrency(spend.pending)} />
        <SummaryStat label="Claims this month" value={String(spend.claimCount)} />
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
