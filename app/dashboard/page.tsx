import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getMonthlySpend, listMyClaims } from "@/lib/claim-service";
import { serializeClaims } from "@/lib/claim-serialization";
import { APP_NAME } from "@/lib/constants";
import { MonthlySpendSummary } from "@/components/claims/MonthlySpendSummary";
import { ClaimList } from "@/components/claims/ClaimList";

export const metadata: Metadata = { title: `Dashboard — ${APP_NAME}` };

const RECENT_CLAIMS_LIMIT = 6;

export default async function DashboardPage() {
  // proxy.ts already blocks unauthenticated requests before this page ever
  // renders; this is a cheap defense-in-depth fallback, not the real gate.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [spend, claims] = await Promise.all([getMonthlySpend(user.id), listMyClaims(user)]);
  const recentClaims = claims.slice(0, RECENT_CLAIMS_LIMIT);
  const pendingCount = claims.filter((c) => c.status === "SUBMITTED").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome back, {user.name.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {user.role === "MANAGER" ? "Manager" : "Staff"} · {claims.length} claim{claims.length === 1 ? "" : "s"} filed
          {pendingCount > 0 ? `, ${pendingCount} awaiting review` : ""}
        </p>
      </div>

      <MonthlySpendSummary spend={spend} claimCount={claims.length} />

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Recent claims</h2>
          <div className="flex items-center gap-4">
            {claims.length > RECENT_CLAIMS_LIMIT && (
              <Link href="/claims" className="text-sm font-medium text-slate-600 hover:text-slate-900">
                View all
              </Link>
            )}
            <Link
              href="/claims/new"
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              New Claim
            </Link>
          </div>
        </div>
        <div className="mt-3">
          <ClaimList claims={serializeClaims(recentClaims)} emptyMessage="You haven't filed any claims yet." />
        </div>
      </div>
    </div>
  );
}
