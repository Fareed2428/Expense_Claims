import type { Metadata } from "next";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { APP_NAME } from "@/lib/constants";
import { SignInButton } from "./SignInButton";

export const metadata: Metadata = {
  title: `Sign in — ${APP_NAME}`,
};

const ROLE_LABEL: Record<UserRole, string> = {
  STAFF: "Staff",
  MANAGER: "Manager",
  FINANCE: "Finance",
};

// Managers and Staff first (they're the ones filing claims day-to-day),
// Finance last.
const ROLE_DISPLAY_ORDER: UserRole[] = ["MANAGER", "STAFF", "FINANCE"];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  // Only ever redirect back to a same-site path — never follow an
  // absolute/external `from` value.
  const destination = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  const usersByRole = new Map<UserRole, typeof users>();
  for (const user of users) {
    const bucket = usersByRole.get(user.role) ?? [];
    bucket.push(user);
    usersByRole.set(user.role, bucket);
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold text-slate-900">Sign in to {APP_NAME}</h1>
      <p className="mt-2 text-sm text-slate-600">
        This is a take-home demo build — there are no passwords. Pick one of the
        seeded users below to sign in as them.
      </p>

      {users.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
          <p className="font-medium text-slate-900">No demo users yet</p>
          <p className="mt-1 text-sm text-slate-600">
            The database hasn&apos;t been seeded. Run the seed script to create demo
            Staff, Manager, and Finance users, then refresh this page.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {ROLE_DISPLAY_ORDER.map((role) => {
            const roleUsers = usersByRole.get(role);
            if (!roleUsers?.length) return null;
            return (
              <section key={role}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {ROLE_LABEL[role]}
                </h2>
                <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                  {roleUsers.map((user) => (
                    <li
                      key={user.id}
                      className="flex items-center justify-between gap-4 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {user.name}
                        </p>
                        <p className="truncate text-xs text-slate-500">{user.email}</p>
                      </div>
                      <SignInButton userId={user.id} destination={destination} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
