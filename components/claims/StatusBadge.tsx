import { STATUS_LABEL } from "@/lib/format";

const STATUS_STYLES: Record<string, string> = {
  PARSED: "bg-slate-100 text-slate-700 border-slate-200",
  SUBMITTED: "bg-blue-50 text-blue-700 border-blue-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  PAID: "bg-violet-50 text-violet-700 border-violet-200",
};

/** A single, consistent status pill — used everywhere a claim's status is shown (list, detail, dashboard). */
export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
