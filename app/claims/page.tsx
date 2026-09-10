import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listMyClaims } from "@/lib/claim-service";
import { serializeClaims } from "@/lib/claim-serialization";
import { APP_NAME } from "@/lib/constants";
import { ClaimList } from "@/components/claims/ClaimList";

export const metadata: Metadata = { title: `My Claims — ${APP_NAME}` };

export default async function MyClaimsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const claims = await listMyClaims(user);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">My Claims</h1>
        <Link
          href="/claims/new"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          New Claim
        </Link>
      </div>

      <ClaimList claims={serializeClaims(claims)} emptyMessage="You haven't filed any claims yet." />
    </div>
  );
}
