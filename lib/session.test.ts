import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from "./session";

const SECRET = "test-session-secret-do-not-use-in-real-env";
const OTHER_SECRET = "a-completely-different-secret";

describe("createSessionToken / verifySessionToken round trip", () => {
  it("verifies a freshly signed token and returns the same userId", async () => {
    const token = await createSessionToken("user-123", SECRET);
    const session = await verifySessionToken(token, SECRET);
    expect(session).not.toBeNull();
    expect(session?.userId).toBe("user-123");
  });

  it("produces a token with exactly two dot-separated parts", async () => {
    const token = await createSessionToken("user-123", SECRET);
    expect(token.split(".")).toHaveLength(2);
  });
});

describe("verifySessionToken — rejects invalid input", () => {
  it("returns null for a missing token", async () => {
    expect(await verifySessionToken(undefined, SECRET)).toBeNull();
    expect(await verifySessionToken(null, SECRET)).toBeNull();
    expect(await verifySessionToken("", SECRET)).toBeNull();
  });

  it("returns null for a malformed token (no signature part)", async () => {
    expect(await verifySessionToken("not-a-real-token", SECRET)).toBeNull();
  });

  it("returns null for garbage input with a dot but no valid structure", async () => {
    expect(await verifySessionToken("abc.def.ghi", SECRET)).toBeNull();
    expect(await verifySessionToken(".", SECRET)).toBeNull();
  });

  it("returns null when the payload has been tampered with", async () => {
    const token = await createSessionToken("user-123", SECRET);
    const [payload, signature] = token.split(".");
    // Flip the payload but keep the original (now-mismatched) signature.
    const tamperedPayload = payload.slice(0, -1) + (payload.at(-1) === "A" ? "B" : "A");
    const tampered = `${tamperedPayload}.${signature}`;
    expect(await verifySessionToken(tampered, SECRET)).toBeNull();
  });

  it("returns null when the signature has been tampered with", async () => {
    const token = await createSessionToken("user-123", SECRET);
    const [payload, signature] = token.split(".");
    // Flip a character in the *middle* of the signature, not the last one:
    // a SHA-256 digest is 32 bytes, and 32 isn't a multiple of 3, so the
    // base64url encoding's final character carries a couple of unused
    // padding bits. Flipping only those bits (which happens for some
    // secret/payload combinations, not others — hence flaky) leaves the
    // decoded byte value unchanged, so verification would still pass by
    // coincidence. A middle character has no such padding ambiguity, so
    // altering it is guaranteed to change the decoded bytes every time.
    const mid = Math.floor(signature.length / 2);
    const tamperedSignature =
      signature.slice(0, mid) + (signature[mid] === "A" ? "B" : "A") + signature.slice(mid + 1);
    const tampered = `${payload}.${tamperedSignature}`;
    expect(await verifySessionToken(tampered, SECRET)).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const token = await createSessionToken("user-123", SECRET);
    expect(await verifySessionToken(token, OTHER_SECRET)).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const issuedAt = Date.parse("2026-01-01T00:00:00Z");
    const token = await createSessionToken("user-123", SECRET, issuedAt, 60 * 60); // 1 hour
    const twoHoursLater = issuedAt + 2 * 60 * 60 * 1000;
    expect(await verifySessionToken(token, SECRET, twoHoursLater)).toBeNull();
  });

  it("accepts a token that has not yet expired", async () => {
    const issuedAt = Date.parse("2026-01-01T00:00:00Z");
    const token = await createSessionToken("user-123", SECRET, issuedAt, 60 * 60);
    const thirtyMinutesLater = issuedAt + 30 * 60 * 1000;
    const session = await verifySessionToken(token, SECRET, thirtyMinutesLater);
    expect(session?.userId).toBe("user-123");
  });
});

describe("SESSION_COOKIE_NAME / SESSION_MAX_AGE_SECONDS", () => {
  it("has a non-empty cookie name", () => {
    expect(SESSION_COOKIE_NAME.length).toBeGreaterThan(0);
  });

  it("defaults to a 7-day max age", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 7);
  });
});

describe("getSessionCookieOptions — security attributes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is always httpOnly, sameSite=lax, and scoped to the whole site", () => {
    const opts = getSessionCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  it("defaults maxAge to SESSION_MAX_AGE_SECONDS", () => {
    expect(getSessionCookieOptions().maxAge).toBe(SESSION_MAX_AGE_SECONDS);
  });

  it("accepts an explicit maxAge (used by logout to clear the cookie with 0)", () => {
    expect(getSessionCookieOptions(0).maxAge).toBe(0);
  });

  it("is not secure outside production, so it still works over local http", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getSessionCookieOptions().secure).toBe(false);
  });

  it("is secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getSessionCookieOptions().secure).toBe(true);
  });
});
