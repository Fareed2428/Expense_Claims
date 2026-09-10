"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SignInButton({
  userId,
  destination,
}: {
  userId: string;
  destination: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Sign in failed");
      }
      router.push(destination);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setPending(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleSignIn}
        disabled={pending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
