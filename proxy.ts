import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

/**
 * Coarse authentication gate for protected routes (Next.js "Proxy" —
 * formerly named Middleware; this file was renamed from middleware.ts per
 * Next.js 16's convention).
 *
 * This only checks that a validly-signed, unexpired session cookie is
 * present — it does not look up the user's role (role/ownership checks
 * happen in the page or route handler itself, via lib/auth.ts's
 * requireRole() and friends, which do need the database). This layer's
 * job is just: no valid session → don't let the request through at all.
 */

const PROTECTED_PAGE_PREFIXES = ["/dashboard", "/claims", "/manager", "/finance"];
const PROTECTED_API_PREFIXES = ["/api/claims", "/api/reports"];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtectedApi = matchesPrefix(pathname, PROTECTED_API_PREFIXES);
  const isProtectedPage = matchesPrefix(pathname, PROTECTED_PAGE_PREFIXES);

  if (!isProtectedApi && !isProtectedPage) {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = secret ? await verifySessionToken(token, secret) : null;

  if (session) {
    return NextResponse.next();
  }

  if (isProtectedApi) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/claims/:path*",
    "/manager/:path*",
    "/finance/:path*",
    "/api/claims/:path*",
    "/api/reports/:path*",
  ],
};
