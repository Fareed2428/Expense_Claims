import { CATEGORY_LABEL, formatCurrency, formatDate } from "@/lib/format";
import type { SerializedClaim } from "@/lib/claim-serialization";

/**
 * The "did the employee change what the parser extracted" view — reads
 * receipt.parsedX (what lib/receipt-parser.ts originally produced)
 * against the claim's current field, purely for display. Shared between
 * the Manager review page (Phase 8) and the Finance claim detail page
 * (Phase 9) — both roles need the same reviewer-facing view of parser vs.
 * corrected values, so it lives in components/claims/ alongside the
 * other cross-role display components (StatusBadge, DuplicateWarningBanner,
 * ClaimEventTimeline) rather than under one role's directory.
 *
 * A field with no parsed value at all (parser had low/no confidence — see
 * createClaim's "honest placeholders" comment in lib/claim-service.ts) is
 * always shown as corrected, since whatever the claim now holds
 * necessarily came from the employee, not the parser. This is read-only
 * comparison logic, not a business rule — nothing here writes anything or
 * decides what the claim record actually says.
 */
function wasCorrected(parsedValue: string | number | null, currentValue: string | number): boolean {
  if (parsedValue === null) return true;
  return String(parsedValue) !== String(currentValue);
}

function wasDateCorrected(parsedDate: string | Date | null, currentDate: string | Date): boolean {
  if (parsedDate === null) return true;
  return new Date(parsedDate).toDateString() !== new Date(currentDate).toDateString();
}

function ExtractedOrCorrected({ corrected }: { corrected: boolean }) {
  return (
    <span
      className={`ml-1.5 inline-flex items-center rounded-full border px-1.5 py-0 align-middle text-[10px] font-medium ${
        corrected
          ? "border-blue-300 bg-blue-50 text-blue-700"
          : "border-slate-300 bg-slate-50 text-slate-600"
      }`}
    >
      {corrected ? "Corrected by employee" : "Extracted from receipt"}
    </span>
  );
}

export function ReceiptParseDetails({ claim }: { claim: SerializedClaim }) {
  const receipt = claim.receipt;
  if (!receipt) return null;

  const merchantCorrected = wasCorrected(receipt.parsedMerchant, claim.merchant);
  const amountCorrected = receipt.parsedAmount === null || receipt.parsedAmount !== claim.amount;
  const categoryCorrected = wasCorrected(receipt.parsedCategory, claim.category);
  const dateCorrected = wasDateCorrected(receipt.parsedDate, claim.expenseDate);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Receipt parsing</h2>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Merchant</dt>
          <dd className="font-medium text-slate-900">
            {claim.merchant}
            <ExtractedOrCorrected corrected={merchantCorrected} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Date</dt>
          <dd className="font-medium text-slate-900">
            {formatDate(claim.expenseDate)}
            <ExtractedOrCorrected corrected={dateCorrected} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Amount</dt>
          <dd className="font-medium text-slate-900">
            {formatCurrency(claim.amount)}
            <ExtractedOrCorrected corrected={amountCorrected} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Category</dt>
          <dd className="font-medium text-slate-900">
            {CATEGORY_LABEL[claim.category] ?? claim.category}
            <ExtractedOrCorrected corrected={categoryCorrected} />
          </dd>
        </div>
      </dl>

      <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
        Parser confidence:{" "}
        <span className="font-medium text-slate-900">
          {receipt.parseConfidence !== null ? `${Math.round(receipt.parseConfidence * 100)}%` : "—"}
        </span>
      </p>

      {receipt.parseWarnings.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">Parser warnings</p>
          <ul className="mt-1 list-inside list-disc text-sm text-amber-800">
            {receipt.parseWarnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <p className="text-xs text-slate-500">Raw receipt text</p>
        <pre className="mt-1 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700">
          {claim.rawReceiptText}
        </pre>
      </div>
    </section>
  );
}
