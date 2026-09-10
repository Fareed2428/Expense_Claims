import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getFinanceMonthlySpend, listClaimsForPayment } from "@/lib/claim-service";
import { APP_NAME } from "@/lib/constants";
import { FinanceStatsSummary } from "@/components/finance/FinanceStatsSummary";

export const metadata: Metadata = { title: `Finance — ${APP_NAME}` };

export default async function FinanceDashboardPage() {
  // proxy.ts already blocks unauthenticated requests before this page ever
  // renders; the redirects below are cheap defense-in-depth, not the real
  // gate (same pattern as the Staff/Manager dashboards).
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "FINANCE") redirect("/dashboard");

  // listClaimsForPayment() defaults to status=APPROVED — the same claims
  // /finance/payments lists in full; fetched here too so the headline
  // stats and the queue can never disagree with each other.
  const [awaitingPayment, monthlySpend] = await Promise.all([
    listClaimsForPayment(user),
    getFinanceMonthlySpend(),
  ]);

  const awaitingPaymentAmount = awaitingPayment.reduce((sum, c) => sum + c.amount.toNumber(), 0);
  const duplicatesNeedingAck = awaitingPayment.filter((c) => c.duplicateFlag && !c.duplicateAcknowledgedAt).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Finance</h1>
        <p className="mt-1 text-sm text-slate-500">{user.name} · Finance</p>
      </div>

      <FinanceStatsSummary
        awaitingPaymentCount={awaitingPayment.length}
        awaitingPaymentAmount={awaitingPaymentAmount}
        paidThisMonth={monthlySpend.paid}
        totalMonthlySpending={monthlySpend.committed}
        duplicatesNeedingAcknowledgement={duplicatesNeedingAck}
      />

      <div className="flex flex-wrap gap-3">
        <Link
          href="/finance/payments"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Review claims awaiting payment
        </Link>
        <Link
          href="/finance/spending"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          View monthly spending
        </Link>
      </div>
    </div>
  );
}
