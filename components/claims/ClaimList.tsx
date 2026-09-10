import Link from "next/link";
import type { SerializedClaim } from "@/lib/claim-serialization";
import { ClaimListItem } from "@/components/claims/ClaimListItem";

/** A card containing a list of claims, with a shared empty state. Used by both the dashboard's "recent claims" and the full "My Claims" page. */
export function ClaimList({
  claims,
  emptyMessage = "No claims yet.",
}: {
  claims: SerializedClaim[];
  emptyMessage?: string;
}) {
  if (claims.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">{emptyMessage}</p>
        <Link
          href="/claims/new"
          className="mt-3 inline-block rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          File a claim
        </Link>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {claims.map((claim) => (
        <ClaimListItem key={claim.id} claim={claim} />
      ))}
    </div>
  );
}
