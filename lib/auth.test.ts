import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock Prisma before importing anything that transitively imports it, so
// these tests never touch the real database — no seeded users (Phase 3)
// are required for any of this.
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import {
  AuthError,
  authorizeUser,
  getCurrentUserFromRequest,
  requireFinance,
  requireManager,
  requireRole,
  requireStaffOrManager,
  requireUser,
  type SessionUser,
} from "./auth";
import { createSessionToken, SESSION_COOKIE_NAME } from "./session";

const TEST_SECRET = "test-secret-for-lib-auth-tests";

beforeAll(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
});

const staffUser: SessionUser = {
  id: "u-staff",
  name: "Asha Rao",
  email: "asha@example.com",
  role: "STAFF",
};
const managerUser: SessionUser = {
  id: "u-manager",
  name: "Ben Iyer",
  email: "ben@example.com",
  role: "MANAGER",
};
const financeUser: SessionUser = {
  id: "u-finance",
  name: "Cara Shah",
  email: "cara@example.com",
  role: "FINANCE",
};

function requestWithSession(token: string | null): NextRequest {
  const headers = new Headers();
  if (token) headers.set("cookie", `${SESSION_COOKIE_NAME}=${token}`);
  return new NextRequest("http://localhost/api/test", { headers });
}

// ---------------------------------------------------------------------------
// Pure authorization logic — no cookies, no database.
// ---------------------------------------------------------------------------
describe("authorizeUser (pure)", () => {
  it("accepts a valid user when no role restriction is given", () => {
    expect(authorizeUser(staffUser)).toBe(staffUser);
  });

  it("rejects a missing session (null user) with 401", () => {
    expect(() => authorizeUser(null)).toThrow(AuthError);
    expect(() => authorizeUser(null)).toThrow(
      expect.objectContaining({ status: 401 })
    );
  });

  it("accepts a user whose role is in the allowed list", () => {
    expect(authorizeUser(managerUser, ["STAFF", "MANAGER"])).toBe(managerUser);
  });

  it("rejects a user whose role is not in the allowed list, with 403", () => {
    expect(() => authorizeUser(financeUser, ["STAFF", "MANAGER"])).toThrow(
      expect.objectContaining({ status: 403 })
    );
  });
});

describe("role helper role sets, exercised via authorizeUser (pure)", () => {
  it("staff-or-manager set accepts STAFF and MANAGER, rejects FINANCE", () => {
    const roles = ["STAFF", "MANAGER"] as const;
    expect(authorizeUser(staffUser, roles)).toBe(staffUser);
    expect(authorizeUser(managerUser, roles)).toBe(managerUser);
    expect(() => authorizeUser(financeUser, roles)).toThrow(AuthError);
  });

  it("manager-only set accepts only MANAGER", () => {
    const roles = ["MANAGER"] as const;
    expect(authorizeUser(managerUser, roles)).toBe(managerUser);
    expect(() => authorizeUser(staffUser, roles)).toThrow(AuthError);
    expect(() => authorizeUser(financeUser, roles)).toThrow(AuthError);
  });

  it("finance-only set accepts only FINANCE", () => {
    const roles = ["FINANCE"] as const;
    expect(authorizeUser(financeUser, roles)).toBe(financeUser);
    expect(() => authorizeUser(staffUser, roles)).toThrow(AuthError);
    expect(() => authorizeUser(managerUser, roles)).toThrow(AuthError);
  });
});

// ---------------------------------------------------------------------------
// Request/DB-backed helpers — Prisma is mocked (no seeded users required;
// that integration only becomes meaningful once Phase 3 seed data exists,
// and is exercised manually then, not here).
// ---------------------------------------------------------------------------
describe("getCurrentUserFromRequest", () => {
  it("returns null when there is no session cookie", async () => {
    expect(await getCurrentUserFromRequest(requestWithSession(null))).toBeNull();
  });

  it("returns null for a tampered session token", async () => {
    const token = await createSessionToken("u-staff", TEST_SECRET);
    const tampered = token.slice(0, -1) + (token.at(-1) === "a" ? "b" : "a");
    expect(await getCurrentUserFromRequest(requestWithSession(tampered))).toBeNull();
  });

  it("resolves the user's role from the database via the session's userId", async () => {
    const token = await createSessionToken("u-staff", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(staffUser as never);

    const user = await getCurrentUserFromRequest(requestWithSession(token));

    // The lookup is keyed only by the id recovered from the *verified*
    // cookie — there is no code path here that reads a role out of the
    // request at all.
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u-staff" } })
    );
    expect(user).toEqual(staffUser);
  });

  it("returns null if the session references a user no longer in the database", async () => {
    const token = await createSessionToken("deleted-user", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    expect(await getCurrentUserFromRequest(requestWithSession(token))).toBeNull();
  });
});

describe("requireUser", () => {
  it("resolves the user for a valid session", async () => {
    const token = await createSessionToken("u-manager", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(managerUser as never);
    await expect(requireUser(requestWithSession(token))).resolves.toEqual(managerUser);
  });

  it("throws AuthError(401) for a missing session", async () => {
    await expect(requireUser(requestWithSession(null))).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("requireRole and the role-specific helpers", () => {
  it("requireRole throws AuthError(403) when the DB-sourced role isn't allowed", async () => {
    const token = await createSessionToken("u-finance", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(financeUser as never);
    await expect(
      requireRole(requestWithSession(token), "STAFF", "MANAGER")
    ).rejects.toMatchObject({ status: 403 });
  });

  it("requireStaffOrManager accepts a manager", async () => {
    const token = await createSessionToken("u-manager", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(managerUser as never);
    await expect(requireStaffOrManager(requestWithSession(token))).resolves.toEqual(
      managerUser
    );
  });

  it("requireManager rejects a staff user", async () => {
    const token = await createSessionToken("u-staff", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(staffUser as never);
    await expect(requireManager(requestWithSession(token))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("requireFinance rejects a manager, even though the manager also files claims", async () => {
    const token = await createSessionToken("u-manager", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(managerUser as never);
    await expect(requireFinance(requestWithSession(token))).rejects.toMatchObject({
      status: 403,
    });
  });
});
