import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listClaimsForPayment } from "@/lib/claim-service";
import { serializeClaims } from "@/lib/claim-serialization";
import { APP_NAME } from "@/lib/constants";
import { PaymentQueueList } from "@/components/finance/PaymentQueueList";

export const metadata: Metadata = { title: `Claims Awaiting Payment — ${APP_NAME}` };

export default async function FinancePaymentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "FINANCE") redirect("/dashboard");

  // Only APPROVED claims are actionable for payment — see
  // lib/claim-service.ts's listClaimsForPayment(), which defaults to
  // exactly that status and is Finance-only.
  const claims = await listClaimsForPayment(user);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Claims awaiting payment</h1>
        <p className="mt-1 text-sm text-slate-500">
          {claims.length} approved claim{claims.length === 1 ? "" : "s"} ready for review
        </p>
      </div>

      <PaymentQueueList claims={serializeClaims(claims)} emptyMessage="No claims are currently awaiting payment." />
    </div>
  );
}
