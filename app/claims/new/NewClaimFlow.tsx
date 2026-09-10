"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseCategory } from "@prisma/client";
import type { SerializedClaim } from "@/lib/claim-serialization";
import { CATEGORY_LABEL } from "@/lib/format";
import { DuplicateWarningBanner } from "@/components/claims/DuplicateWarningBanner";

const CATEGORIES: ExpenseCategory[] = ["TRAVEL", "MEALS", "SUPPLIES", "TAXI", "OTHER"];

interface FormFields {
  merchant: string;
  expenseDate: string; // yyyy-mm-dd, for <input type="date">
  amount: string;
  category: ExpenseCategory;
}

/** expenseDate is stored as a date-only value — read it with UTC getters so the date input never shifts a day from a timezone conversion. */
function toDateInputValue(date: string | Date): string {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fieldsFromClaim(claim: SerializedClaim): FormFields {
  return {
    merchant: claim.merchant,
    expenseDate: toDateInputValue(claim.expenseDate),
    amount: String(claim.amount),
    category: claim.category as ExpenseCategory,
  };
}

/** Only the fields that differ from what the server last confirmed — sent to PATCH so the server only ever sees an explicit, intentional correction, never a value manufactured client-side for fields the user didn't touch. */
function diffFields(fields: FormFields, original: FormFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields.merchant !== original.merchant) out.merchant = fields.merchant;
  if (fields.expenseDate !== original.expenseDate) out.expenseDate = fields.expenseDate;
  if (fields.amount !== original.amount) out.amount = Number(fields.amount);
  if (fields.category !== original.category) out.category = fields.category;
  return out;
}

async function readJson(res: Response): Promise<{ error?: string; claim?: SerializedClaim }> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export function NewClaimFlow({ initialClaim }: { initialClaim: SerializedClaim | null }) {
  const router = useRouter();
  const [rawText, setRawText] = useState(initialClaim?.rawReceiptText ?? "");
  const [claim, setClaim] = useState<SerializedClaim | null>(initialClaim);
  const [fields, setFields] = useState<FormFields | null>(initialClaim ? fieldsFromClaim(initialClaim) : null);
  const [original, setOriginal] = useState<FormFields | null>(initialClaim ? fieldsFromClaim(initialClaim) : null);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleParse() {
    setError(null);
    if (rawText.trim().length === 0) {
      setError("Paste some receipt text first.");
      return;
    }
    setParsing(true);
    try {
      const res = await fetch(claim ? `/api/claims/${claim.id}` : "/api/claims", {
        method: claim ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawReceiptText: rawText }),
      });
      const data = await readJson(res);
      if (!res.ok || !data.claim) throw new Error(data.error ?? "Could not parse this receipt.");
      setClaim(data.claim);
      const f = fieldsFromClaim(data.claim);
      setFields(f);
      setOriginal(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse this receipt.");
    } finally {
      setParsing(false);
    }
  }

  async function handleSubmit() {
    if (!claim || !fields || !original) return;
    if (fields.merchant.trim().length === 0) {
      setError("Merchant is required before this claim can be submitted.");
      return;
    }
    if (!Number.isFinite(Number(fields.amount)) || Number(fields.amount) <= 0) {
      setError("Enter a valid amount before submitting.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      let current = claim;
      const dirty = diffFields(fields, original);
      if (Object.keys(dirty).length > 0) {
        const res = await fetch(`/api/claims/${claim.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dirty),
        });
        const data = await readJson(res);
        if (!res.ok || !data.claim) throw new Error(data.error ?? "Could not save your corrections.");
        current = data.claim;
        setClaim(current);
      }

      const submitRes = await fetch(`/api/claims/${current.id}/submit`, { method: "POST" });
      const submitData = await readJson(submitRes);
      if (!submitRes.ok) throw new Error(submitData.error ?? "Could not submit this claim.");

      router.push(`/claims/${current.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit this claim.");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <label htmlFor="rawText" className="block text-sm font-medium text-slate-900">
          Paste receipt text
        </label>
        <textarea
          id="rawText"
          rows={5}
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={"OLA auto MG Road to office INR 180\n3 Sep 2026"}
          className="mt-2 w-full rounded-md border border-slate-300 p-3 font-mono text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleParse}
            disabled={parsing}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {parsing ? "Parsing…" : claim ? "Re-parse receipt" : "Parse Receipt"}
          </button>
          {claim && (
            <span className="text-xs text-slate-500">
              You&apos;re editing a draft — paste different text and re-parse if this isn&apos;t the right receipt.
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {error}
          </p>
        )}
      </section>

      {claim && fields && original && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Review extracted details</h2>
            <ConfidenceBadge confidence={claim.receipt?.parseConfidence ?? null} />
          </div>

          {claim.receipt && claim.receipt.parseWarnings.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {claim.receipt.parseWarnings.map((warning) => (
                <li key={warning}>⚠ {warning}</li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field id="merchant" label="Merchant" corrected={fields.merchant !== original.merchant}>
              <input
                id="merchant"
                type="text"
                value={fields.merchant}
                onChange={(e) => setFields({ ...fields, merchant: e.target.value })}
                className={INPUT_CLASS}
              />
            </Field>

            <Field id="expenseDate" label="Receipt date" corrected={fields.expenseDate !== original.expenseDate}>
              <input
                id="expenseDate"
                type="date"
                value={fields.expenseDate}
                onChange={(e) => setFields({ ...fields, expenseDate: e.target.value })}
                className={INPUT_CLASS}
              />
            </Field>

            <Field id="amount" label="Amount (₹)" corrected={fields.amount !== original.amount}>
              <input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                value={fields.amount}
                onChange={(e) => setFields({ ...fields, amount: e.target.value })}
                className={INPUT_CLASS}
              />
            </Field>

            <Field id="category" label="Category" corrected={fields.category !== original.category}>
              <select
                id="category"
                value={fields.category}
                onChange={(e) => setFields({ ...fields, category: e.target.value as ExpenseCategory })}
                className={INPUT_CLASS}
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABEL[category]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <p className="mt-3 text-xs text-slate-400">
            Fields the parser extracted automatically are marked &ldquo;Extracted from receipt&rdquo;. Anything
            you change is marked &ldquo;Corrected by you&rdquo; and is saved when you submit.
          </p>

          <div className="mt-4">
            <DuplicateWarningBanner claim={claim} />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit Claim"}
            </button>
            <span className="text-xs text-slate-500">This sends the claim to your manager for review.</span>
          </div>
        </section>
      )}
    </div>
  );
}

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

function Field({
  id,
  label,
  corrected,
  children,
}: {
  id: string;
  label: string;
  corrected: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-700">
          {label}
        </label>
        <span
          className={`text-[10px] font-medium uppercase tracking-wide ${corrected ? "text-blue-600" : "text-slate-400"}`}
        >
          {corrected ? "Corrected by you" : "Extracted from receipt"}
        </span>
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null;
  const pct = Math.round(confidence * 100);
  const tone =
    confidence >= 0.7
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : confidence >= 0.4
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-red-200 bg-red-50 text-red-700";
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      Parse confidence: {pct}%
    </span>
  );
}
