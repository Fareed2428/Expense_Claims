import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getCategoryMonthlySpend, getEmployeeMonthlySpend } from "@/lib/claim-service";
import { APP_NAME } from "@/lib/constants";
import { EmployeeSpendingTable } from "@/components/finance/EmployeeSpendingTable";
import { CategorySpendingTable } from "@/components/finance/CategorySpendingTable";
import { MonthPicker } from "@/components/finance/MonthPicker";

export const metadata: Metadata = { title: `Monthly Spending — ${APP_NAME}` };

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

/**
 * Parses a `?month=YYYY-MM` query param into a Date (the first of that
 * month), falling back to the current month for anything missing,
 * malformed, or outside a sane range — this never throws and never lets
 * an arbitrary/invalid string reach the reporting queries below.
 */
function parseMonthParam(raw: string | undefined): Date {
  const now = new Date();
  if (!raw) return now;
  const match = MONTH_PATTERN.exec(raw);
  if (!match) return now;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return now;
  return new Date(year, month - 1, 1);
}

function monthParamValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default async function FinanceSpendingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "FINANCE") redirect("/dashboard");

  const { month: monthParam } = await searchParams;
  const monthDate = parseMonthParam(monthParam);

  // Both queries use the same validated monthDate — the whole page's
  // figures are always for one consistent month, never a mix.
  const [employees, categories] = await Promise.all([
    getEmployeeMonthlySpend(monthDate),
    getCategoryMonthlySpend(monthDate),
  ]);

  const nearLimitCount = employees.filter((e) => e.isNearLimit).length;
  const overLimitCount = employees.filter((e) => e.isOverLimit).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Monthly Spending</h1>
          <p className="mt-1 text-sm text-slate-500">Who spent what, under which category, and who's near or over their limit.</p>
        </div>
        <MonthPicker month={monthParamValue(monthDate)} />
      </div>

      {(nearLimitCount > 0 || overLimitCount > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {overLimitCount > 0 &&
            `${overLimitCount} employee${overLimitCount === 1 ? " is" : "s are"} over their monthly limit. `}
          {nearLimitCount > 0 &&
            `${nearLimitCount} employee${nearLimitCount === 1 ? " is" : "s are"} near their monthly limit.`}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-slate-900">Employee spending</h2>
        <div className="mt-3">
          <EmployeeSpendingTable rows={employees} />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">Spending by category</h2>
        <div className="mt-3">
          <CategorySpendingTable rows={categories} />
        </div>
      </div>
    </div>
  );
}
