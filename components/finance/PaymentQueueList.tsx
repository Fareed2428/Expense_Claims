import type { SerializedClaim } from "@/lib/claim-serialization";
import { PaymentQueueItem } from "@/components/finance/PaymentQueueItem";

/** A card containing Finance's payment queue, with a shared empty state. */
export function PaymentQueueList({
  claims,
  emptyMessage,
}: {
  claims: SerializedClaim[];
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
        <PaymentQueueItem key={claim.id} claim={claim} />
      ))}
    </div>
  );
}
