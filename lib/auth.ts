import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME, getSessionFromRequest, verifySessionToken } from "@/lib/session";

/**
 * Safe, client-facing shape of the current user — never includes anything
 * beyond what's listed here.
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

const SAFE_USER_SELECT = { id: true, name: true, email: true, role: true } as const;

async function loadUser(userId: string): Promise<SessionUser | null> {
  return prisma.user.findUnique({ where: { id: userId }, select: SAFE_USER_SELECT });
}

/**
 * For Server Components (layouts/pages): reads the session cookie via
 * next/headers. Read-only, never throws — returns null when signed out or
 * when the session references a user that no longer exists.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null; // misconfigured server fails closed, not open

  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token, secret);
  if (!session) return null;

  // The role always comes from this database lookup, keyed by the userId
  // out of the *verified* cookie — never from the cookie's own contents
  // (which don't carry a role at all) or from anything client-supplied.
  return loadUser(session.userId);
}

/**
 * For Route Handlers: reads the session cookie directly off the request.
 * Same DB-sourced-role guarantee as getCurrentUser(), and easy to unit
 * test since it doesn't depend on Next's request-scoped cookies() context.
 */
export async function getCurrentUserFromRequest(
  request: NextRequest
): Promise<SessionUser | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const session = await getSessionFromRequest(request, secret);
  if (!session) return null;

  return loadUser(session.userId);
}

export class AuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/**
 * Pure authorization check — no cookies, no database. Given whatever user
 * was already resolved (from the database, via getCurrentUser*), throws if
 * there's no user, or if allowedRoles is given and the user's role isn't
 * in it. Kept separate from session/DB lookup specifically so it's
 * trivially unit testable without mocking Next.js or Prisma.
 */
export function authorizeUser(
  user: SessionUser | null,
  allowedRoles?: readonly UserRole[]
): SessionUser {
  if (!user) {
    throw new AuthError(401, "Authentication required");
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    throw new AuthError(403, "You do not have access to this resource");
  }
  return user;
}

/**
 * Authorization helpers for Route Handlers. Later phases' API routes
 * (claims, approvals, payouts, reports) call these instead of
 * re-implementing session/role checks.
 */
export async function requireUser(request: NextRequest): Promise<SessionUser> {
  return authorizeUser(await getCurrentUserFromRequest(request));
}

export async function requireRole(
  request: NextRequest,
  ...roles: UserRole[]
): Promise<SessionUser> {
  return authorizeUser(await getCurrentUserFromRequest(request), roles);
}

export function requireStaffOrManager(request: NextRequest): Promise<SessionUser> {
  return requireRole(request, "STAFF", "MANAGER");
}

export function requireManager(request: NextRequest): Promise<SessionUser> {
  return requireRole(request, "MANAGER");
}

export function requireFinance(request: NextRequest): Promise<SessionUser> {
  return requireRole(request, "FINANCE");
}

/**
 * Converts an AuthError into the NextResponse a route handler should
 * return. Returns null for anything else so the caller can rethrow it.
 *
 * Usage in a route handler:
 *   try {
 *     const user = await requireFinance(request);
 *     ...
 *   } catch (err) {
 *     const res = authErrorResponse(err);
 *     if (res) return res;
 *     throw err;
 *   }
 */
export function authErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return null;
}
