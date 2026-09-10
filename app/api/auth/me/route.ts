import { NextResponse, type NextRequest } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";

/**
 * GET /api/auth/me
 * Returns the current session's user (id, name, email, role — always read
 * from the database), or 401 if there's no valid session.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return NextResponse.json({ user });
  } catch (err) {
    const res = authErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
