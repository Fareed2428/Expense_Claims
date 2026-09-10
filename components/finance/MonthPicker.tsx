/**
 * A plain `<form method="get">` — no client JS needed at all. Submitting
 * navigates to `?month=YYYY-MM`, which app/finance/spending/page.tsx (a
 * Server Component) reads and validates server-side before running any
 * report query — see that file's parseMonthParam().
 */
export function MonthPicker({ month }: { month: string }) {
  return (
    <form method="get" className="flex items-center gap-2 text-sm">
      <label htmlFor="month" className="font-medium text-slate-700">
        Month
      </label>
      <input
        type="month"
        id="month"
        name="month"
        defaultValue={month}
        className="rounded-md border border-slate-300 px-2 py-1 text-slate-900 focus:border-slate-500 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-md border border-slate-300 bg-white px-3 py-1 font-medium text-slate-700 hover:bg-slate-50"
      >
        View
      </button>
    </form>
  );
}
