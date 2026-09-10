import type { SerializedClaim } from "@/lib/claim-serialization";
import { ManagerClaimListItem } from "@/components/manager/ManagerClaimListItem";

/** A card containing a manager's list of claims (review queue or recently-reviewed), with a shared empty state. */
export function ManagerClaimList({
  claims,
  variant,
  emptyMessage,
}: {
  claims: SerializedClaim[];
  variant: "pending" | "reviewed";
  emptyMessage: string;
}) {
  if (claims.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {claims.map((claim) => (
        <ManagerClaimListItem key={claim.id} claim={claim} variant={variant} />
      ))}
    </div>
  );
}
