"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseCategory } from "@prisma/client";
import type { SerializedClaim } from "@/lib/claim-serialization";
import { CATEGORY_LABEL } from "@/lib/format";

const CATEGORIES: ExpenseCategory[] = ["TRAVEL", "MEALS", "SUPPLIES", "TAXI", "OTHER"];

function toDateInputValue(date: string | Date): string {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Edit-and-resubmit form for a claimant's own REJECTED claim. Unlike the
 * new-claim flow, there's no separate "parse" step here: a REJECTED claim
 * isn't PARSED, so updateClaim() (PATCH) won't accept it — corrections and
 * the REJECTED → SUBMITTED transition are applied together in one call to
 * resubmitClaim(), exactly as the service is built (see lib/claim-
 * service.ts's resubmitClaim). This form just collects what changed and
 * sends it in that one shape; it never decides the transition itself.
 */
export function ResubmitPanel({ claim }: { claim: SerializedClaim }) {
  const router = useRouter();
  const [rawReceiptText, setRawReceiptText] = useState(claim.rawReceiptText);
  const [merchant, setMerchant] = useState(claim.merchant);
  const [expenseDate, setExpenseDate] = useState(toDateInputValue(claim.expenseDate));
  const [amount, setAmount] = useState(String(claim.amount));
  const [category, setCategory] = useState<ExpenseCategory>(claim.category as ExpenseCategory);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResubmit() {
    if (merchant.trim().length === 0) {
      setError("Merchant is required before this claim can be resubmitted.");
      return;
    }
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      setError("Enter a valid amount before resubmitting.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const corrections: Record<string, unknown> = {};
      if (rawReceiptText !== claim.rawReceiptText) corrections.rawReceiptText = rawReceiptText;
      if (merchant !== claim.merchant) corrections.merchant = merchant;
      if (expenseDate !== toDateInputValue(claim.expenseDate)) corrections.expenseDate = expenseDate;
      if (Number(amount) !== claim.amount) corrections.amount = Number(amount);
      if (category !== claim.category) corrections.category = category;

      const res = await fetch(`/api/claims/${claim.id}/resubmit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corrections),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not resubmit this claim.");

      router.push(`/claims/${claim.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resubmit this claim.");
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Edit &amp; Resubmit</h2>
      <p className="mt-1 text-xs text-slate-500">
        Fix whatever your manager flagged, then resubmit. Your rejection history stays on this claim.
      </p>

      <div className="mt-4">
        <label htmlFor="resubmit-rawText" className="text-xs font-medium text-slate-700">
          Receipt text
        </label>
        <textarea
          id="resubmit-rawText"
          rows={3}
          value={rawReceiptText}
          onChange={(e) => setRawReceiptText(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 p-3 font-mono text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="resubmit-merchant" className="text-xs font-medium text-slate-700">
            Merchant
          </label>
          <input
            id="resubmit-merchant"
            type="text"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="resubmit-date" className="text-xs font-medium text-slate-700">
            Receipt date
          </label>
          <input
            id="resubmit-date"
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="resubmit-amount" className="text-xs font-medium text-slate-700">
            Amount (₹)
          </label>
          <input
            id="resubmit-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="resubmit-category" className="text-xs font-medium text-slate-700">
            Category
          </label>
          <select
            id="resubmit-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            className={INPUT_CLASS}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={handleResubmit}
          disabled={submitting}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? "Resubmitting…" : "Resubmit Claim"}
        </button>
      </div>
    </section>
  );
}

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
