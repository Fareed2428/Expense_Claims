import { STATUS_LABEL, formatCurrency, formatDate } from "@/lib/format";
import type { SerializedClaim } from "@/lib/claim-serialization";

/**
 * The duplicate warning banner. Renders nothing when the claim isn't
 * flagged — `duplicateFlag`/`duplicateScore`/`duplicatesFound` all come
 * straight from the server (lib/duplicate-detector.ts via
 * lib/claim-service.ts); nothing here is computed client-side, and there
 * is no way for this component to suppress or override the flag — it
 * only ever reflects what the server already decided.
 */
export function DuplicateWarningBanner({ claim }: { claim: SerializedClaim }) {
  if (!claim.duplicateFlag) return null;

  const best = [...claim.duplicatesFound].sort((a, b) => b.score - a.score)[0];

  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-xl leading-none">⚠️</span>
        <div className="flex-1">
          <p className="font-semibold text-amber-900">Possible duplicate receipt</p>
          <p className="mt-1 text-sm text-amber-800">
            This looks similar to a receipt you already filed
            {claim.duplicateScore !== null ? ` (${Math.round(claim.duplicateScore * 100)}% match)` : ""}.
            You can still submit this claim — Finance must review the duplicate before payment.
          </p>

          {best && (
            <div className="mt-3 rounded-md border border-amber-200 bg-white p-3 text-sm">
              <p className="font-medium text-slate-900">Similar earlier claim</p>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-slate-400">Merchant</dt>
                  <dd className="font-medium text-slate-800">{best.matchedClaim.merchant}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Amount</dt>
                  <dd className="font-medium text-slate-800">{formatCurrency(best.matchedClaim.amount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Date</dt>
                  <dd className="font-medium text-slate-800">{formatDate(best.matchedClaim.expenseDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Status</dt>
                  <dd className="font-medium text-slate-800">
                    {STATUS_LABEL[best.matchedClaim.status] ?? best.matchedClaim.status}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
