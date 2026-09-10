import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getManagerTeamSpend, listClaimsForReview } from "@/lib/claim-service";
import { serializeClaims } from "@/lib/claim-serialization";
import { APP_NAME } from "@/lib/constants";
import { TeamSpendSummary } from "@/components/manager/TeamSpendSummary";
import { ManagerClaimList } from "@/components/manager/ManagerClaimList";

export const metadata: Metadata = { title: `Manager Review — ${APP_NAME}` };

const RECENTLY_REVIEWED_LIMIT = 6;

export default async function ManagerDashboardPage() {
  // proxy.ts already blocks unauthenticated requests before this page ever
  // renders; the redirects below are cheap defense-in-depth, not the real
  // gate (same pattern as the Staff dashboard — see app/dashboard/page.tsx).
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "MANAGER") redirect("/dashboard");

  // listClaimsForReview() is scoped strictly to approverId === user.id —
  // never the manager's own claims, never a team member's claim they
  // aren't personally assigned to review (see that function's comment in
  // lib/claim-service.ts). Fetched once and split below for the two
  // sections, rather than issuing two separate queries.
  const [claims, teamSpend] = await Promise.all([listClaimsForReview(user), getManagerTeamSpend(user.id)]);

  const pendingReview = claims.filter((c) => c.status === "SUBMITTED");
  const recentlyReviewed = claims
    .filter((c) => c.status !== "SUBMITTED" && c.decidedAt !== null)
    .slice(0, RECENTLY_REVIEWED_LIMIT);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Manager Review</h1>
        <p className="mt-1 text-sm text-slate-500">
          {user.name} · Manager ·{" "}
          {pendingReview.length === 0
            ? "no claims awaiting your review"
            : `${pendingReview.length} claim${pendingReview.length === 1 ? "" : "s"} awaiting your review`}
        </p>
      </div>

      <TeamSpendSummary spend={teamSpend} />

      <div>
        <h2 className="text-lg font-semibold text-slate-900">Claims awaiting review</h2>
        <div className="mt-3">
          <ManagerClaimList
            claims={serializeClaims(pendingReview)}
            variant="pending"
            emptyMessage="No claims are waiting on your review right now."
          />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">Recently reviewed</h2>
        <div className="mt-3">
          <ManagerClaimList
            claims={serializeClaims(recentlyReviewed)}
            variant="reviewed"
            emptyMessage="You haven't reviewed any claims yet."
          />
        </div>
      </div>
    </div>
  );
}
