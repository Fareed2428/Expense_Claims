import { CATEGORY_LABEL, formatCurrency } from "@/lib/format";
import type { CategoryMonthlySpend } from "@/lib/claim-service";

/**
 * "Under which category" — one row per expense category, every category
 * always present (zero-filled by getCategoryMonthlySpend) so the table
 * never silently omits a category nobody spent on this month. A plain
 * table with an inline percentage bar, per CLAUDE.md's "don't introduce
 * unnecessary chart libraries" guidance — no charting dependency needed
 * for five rows.
 */
export function CategorySpendingTable({ rows }: { rows: CategoryMonthlySpend[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Category</th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Share</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.category}>
              <td className="px-4 py-3 font-medium text-slate-900">{CATEGORY_LABEL[row.category] ?? row.category}</td>
              <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.amount)}</td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-slate-500" style={{ width: `${Math.min(row.percentage, 100)}%` }} />
                  </div>
                  <span className="w-10 text-right text-slate-600">{Math.round(row.percentage)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
