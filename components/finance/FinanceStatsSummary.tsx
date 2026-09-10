import { formatCurrency } from "@/lib/format";

/**
 * Headline stats for the Finance dashboard. Every value is passed in
 * already-computed from lib/claim-service.ts (listClaimsForPayment,
 * getFinanceMonthlySpend) — nothing is calculated here, matching the
 * same "one place to compute, many places to display" pattern as
 * MonthlySpendSummary (Phase 7) and TeamSpendSummary (Phase 8).
 */
export function FinanceStatsSummary({
  awaitingPaymentCount,
  awaitingPaymentAmount,
  paidThisMonth,
  totalMonthlySpending,
  duplicatesNeedingAcknowledgement,
}: {
  awaitingPaymentCount: number;
  awaitingPaymentAmount: number;
  paidThisMonth: number;
  totalMonthlySpending: number;
  duplicatesNeedingAcknowledgement: number;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Overview</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Awaiting payment" value={String(awaitingPaymentCount)} />
        <Stat label="Amount awaiting payment" value={formatCurrency(awaitingPaymentAmount)} />
        <Stat label="Paid this month" value={formatCurrency(paidThisMonth)} />
        <Stat label="Total monthly spending" value={formatCurrency(totalMonthlySpending)} />
        <Stat
          label="Duplicates needing acknowledgement"
          value={String(duplicatesNeedingAcknowledgement)}
          highlight={duplicatesNeedingAcknowledgement > 0}
        />
      </dl>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`mt-0.5 font-semibold ${highlight ? "text-amber-700" : "text-slate-900"}`}>{value}</dd>
    </div>
  );
}
