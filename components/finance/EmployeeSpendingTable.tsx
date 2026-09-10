import type { ReactNode } from "react";
import { formatCurrency } from "@/lib/format";
import type { EmployeeMonthlySpend } from "@/lib/claim-service";

/**
 * "Who spent what" — one row per claimant (Staff + Manager; Finance never
 * files claims, see lib/claim-service.ts's getEmployeeMonthlySpend), all
 * figures computed server-side. Near/over-limit uses the same >=80%/>100%
 * thresholds as getMonthlySpend()/getManagerTeamSpend() elsewhere in the
 * app — one definition, not reinvented here.
 */
export function EmployeeSpendingTable({ rows }: { rows: EmployeeMonthlySpend[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">No employees to report on.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <Th>Employee</Th>
            <Th align="right">Monthly limit</Th>
            <Th align="right">Approved + paid</Th>
            <Th align="right">Pending</Th>
            <Th align="right">Remaining</Th>
            <Th align="right">Utilization</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.userId}>
              <td className="px-4 py-3 font-medium text-slate-900">{row.name}</td>
              <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.limit)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.committed)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.pending)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.remaining)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{Math.round(row.utilizationPct)}%</td>
              <td className="px-4 py-3">
                {row.isOverLimit ? (
                  <Badge tone="red">Over limit</Badge>
                ) : row.isNearLimit ? (
                  <Badge tone="amber">Near limit</Badge>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Badge({ tone, children }: { tone: "red" | "amber"; children: ReactNode }) {
  const styles = tone === "red" ? "border-red-300 bg-red-50 text-red-700" : "border-amber-300 bg-amber-50 text-amber-800";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}
