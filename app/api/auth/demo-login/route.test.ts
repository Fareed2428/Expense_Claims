import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import { POST } from "./route";

const TEST_SECRET = "test-secret-for-demo-login-route";

beforeAll(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
});

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/demo-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/demo-login", () => {
  it("rejects a request with no userId", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects a non-string userId", async () => {
    const res = await POST(postRequest({ userId: 12345 }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown userId with 404 and sets no session cookie", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

    const res = await POST(postRequest({ userId: "does-not-exist" }));

    expect(res.status).toBe(404);
    expect(res.cookies.get("ec_session")).toBeUndefined();
  });

  it("signs in a known user and sets a valid, correctly-scoped session cookie", async () => {
    const user = { id: "u1", name: "Asha Rao", email: "asha@example.com", role: "STAFF" };
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(user as never);

    const res = await POST(postRequest({ userId: "u1" }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toEqual(user);

    const cookie = res.cookies.get("ec_session");
    expect(cookie?.value).toBeTruthy();
    const session = await verifySessionToken(cookie!.value, TEST_SECRET);
    expect(session?.userId).toBe("u1");
  });

  it("ignores any client-supplied role — the response role always comes from the database lookup", async () => {
    const dbUser = { id: "u1", name: "Asha Rao", email: "asha@example.com", role: "STAFF" };
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(dbUser as never);

    const res = await POST(postRequest({ userId: "u1", role: "FINANCE" }));
    const data = await res.json();

    expect(data.user.role).toBe("STAFF");
  });
});
