import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";

/**
 * POST /api/auth/demo-login
 * Body: { userId: string }
 *
 * Demo-mode "sign in as" — there is no password. The only thing trusted
 * from the request is which seeded userId to look up; the response (and
 * the session it creates) always reflects what the database says about
 * that user, including their role. Nothing else in the body is read.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const userId = (body as { userId?: unknown } | null)?.userId;
  if (typeof userId !== "string" || userId.trim().length === 0) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error(
      "SESSION_SECRET is not configured — see .env.example. Login cannot proceed."
    );
    return NextResponse.json(
      { error: "Server is not configured for authentication" },
      { status: 500 }
    );
  }

  const response = NextResponse.json({ user });
  await setSessionCookie(response, user.id, secret);
  return response;
}
