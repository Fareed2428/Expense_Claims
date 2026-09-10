/**
 * Shared error → HTTP response mapping for the claims API routes.
 * Tries the auth-layer error type first, then the claim-service error
 * type; anything else is an unexpected failure and is logged server-side
 * but never exposed to the client (no stack traces, no raw Prisma/DB
 * error messages).
 */

import { authErrorResponse } from "@/lib/auth";
import { claimErrorResponse } from "@/lib/claim-errors";

export function handleApiError(err: unknown): Response {
  const res = authErrorResponse(err) ?? claimErrorResponse(err);
  if (res) return res;

  console.error("Unhandled API error:", err);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
