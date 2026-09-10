import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/session";
import { GET } from "./route";

const TEST_SECRET = "test-secret-for-me-route";

beforeAll(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
});

function requestWithCookie(cookieHeader?: string): NextRequest {
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  return new NextRequest("http://localhost/api/auth/me", { headers });
}

describe("GET /api/auth/me", () => {
  it("returns 401 when there is no session cookie", async () => {
    const res = await GET(requestWithCookie());
    expect(res.status).toBe(401);
  });

  it("returns the current user for a valid session, sourced from the database", async () => {
    const user = { id: "u1", name: "Asha Rao", email: "asha@example.com", role: "MANAGER" };
    const token = await createSessionToken(user.id, TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(user as never);

    const res = await GET(requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toEqual(user);
  });

  it("returns 401 for a tampered session cookie", async () => {
    const token = await createSessionToken("u1", TEST_SECRET);
    const tampered = token.slice(0, -1) + (token.at(-1) === "a" ? "b" : "a");
    const res = await GET(requestWithCookie(`${SESSION_COOKIE_NAME}=${tampered}`));
    expect(res.status).toBe(401);
  });
});
