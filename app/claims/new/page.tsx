import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getClaim } from "@/lib/claim-service";
import { serializeClaim } from "@/lib/claim-serialization";
import { APP_NAME } from "@/lib/constants";
import { NewClaimFlow } from "./NewClaimFlow";

export const metadata: Metadata = { title: `New Claim — ${APP_NAME}` };

export default async function NewClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Optional resume: /claims/new?claim=<id> continues an existing PARSED
  // draft (e.g. the user parsed a receipt, then navigated away before
  // submitting) instead of starting over. Any claim that isn't a PARSED
  // draft the caller owns is silently ignored rather than erroring the
  // whole page — a stale/invalid link just falls back to a fresh start.
  const { claim: claimId } = await searchParams;
  let initialClaim = null;
  if (claimId) {
    try {
      const claim = await getClaim(user, claimId);
      if (claim.status === "PARSED" && claim.claimantId === user.id) {
        initialClaim = serializeClaim(claim);
      }
    } catch {
      // Not found / not authorized / etc — fall back to a fresh claim.
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">New Claim</h1>
        <p className="mt-1 text-sm text-slate-500">
          Paste whatever is written on your receipt — no need to fill in every field by hand.
        </p>
      </div>

      <NewClaimFlow initialClaim={initialClaim} />
    </div>
  );
}
