import Link from "next/link";
import type { UserRole } from "@prisma/client";
import { APP_NAME } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "@/components/LogoutButton";

/**
 * Top-level application header.
 *
 * Server Component: reads the current session (if any) directly via
 * getCurrentUser(), so the signed-in user's name/role and the nav links
 * shown are always derived from the database, not from anything the
 * client could edit. Nav destinations below are placeholders — the pages
 * themselves land in later phases (see CLAUDE.md's phase plan) — signed
 * links are still safe to show now since middleware already protects
 * every route they point to.
 */
export async function Header() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold text-slate-900">
          {APP_NAME}
        </Link>

        {user ? (
          <div className="flex items-center gap-4">
            <nav aria-label="Primary" className="flex items-center gap-4">
              {ROLE_NAV_LINKS[user.role].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
              <div className="text-right leading-tight">
                <div className="text-sm font-medium text-slate-900">{user.name}</div>
                <div className="text-xs text-slate-500">{ROLE_LABEL[user.role]}</div>
              </div>
              <LogoutButton />
            </div>
          </div>
        ) : (
          <Link
            href="/login"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

const ROLE_LABEL: Record<UserRole, string> = {
  STAFF: "Staff",
  MANAGER: "Manager",
  FINANCE: "Finance",
};

const ROLE_NAV_LINKS: Record<UserRole, { href: string; label: string }[]> = {
  STAFF: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/claims", label: "My Claims" },
    { href: "/claims/new", label: "New Claim" },
  ],
  MANAGER: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/claims", label: "My Claims" },
    { href: "/claims/new", label: "New Claim" },
    { href: "/manager", label: "Manager Review" },
  ],
  FINANCE: [
    { href: "/finance", label: "Dashboard" },
    { href: "/finance/payments", label: "Finance / Payments" },
    { href: "/finance/spending", label: "Monthly Spending" },
  ],
};
