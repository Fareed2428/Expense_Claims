import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Demo-auth session utility.
 *
 * The session cookie carries only a signed `userId` (HMAC-SHA256, keyed by
 * SESSION_SECRET) — never a role. Anything that needs to know a user's role
 * re-reads it from the database via lib/auth.ts, so editing the cookie can
 * never grant a different role; at worst a tampered cookie fails signature
 * verification and is treated as "not signed in."
 *
 * Signing uses the Web Crypto API (`crypto.subtle`) rather than Node's
 * `crypto` module so the exact same code works in both the Node runtime
 * (Route Handlers, Server Components) and Next.js Middleware's Edge
 * runtime, without a runtime-specific branch.
 */

export const SESSION_COOKIE_NAME = "ec_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Best-effort constant-time comparison, to avoid short-circuiting on the first differing byte. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Signs a new session token for the given userId. Pure — no cookies, no
 * database, just WebCrypto — which is what makes it easy to unit test.
 */
export async function createSessionToken(
  userId: string,
  secret: string,
  now: number = Date.now(),
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + maxAgeSeconds;
  const payloadJson = JSON.stringify({ uid: userId, iat: issuedAt, exp: expiresAt });
  const payloadB64 = base64UrlEncode(encoder.encode(payloadJson));

  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64));
  const signatureB64 = base64UrlEncode(new Uint8Array(signature));

  return `${payloadB64}.${signatureB64}`;
}

/**
 * Verifies a session token's signature and expiry. Returns null for
 * anything invalid, tampered, expired, malformed, or signed with a
 * different secret — this function never throws.
 */
export async function verifySessionToken(
  token: string | undefined | null,
  secret: string,
  now: number = Date.now()
): Promise<SessionPayload | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signatureB64] = parts;

  try {
    const key = await importHmacKey(secret);
    const expectedSignature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64))
    );
    const providedSignature = base64UrlDecode(signatureB64);

    if (!constantTimeEqual(expectedSignature, providedSignature)) return null;

    const payload = JSON.parse(decoder.decode(base64UrlDecode(payloadB64))) as {
      uid?: unknown;
      iat?: unknown;
      exp?: unknown;
    };

    if (
      typeof payload.uid !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }

    const nowSeconds = Math.floor(now / 1000);
    if (payload.exp <= nowSeconds) return null;

    return { userId: payload.uid, issuedAt: payload.iat, expiresAt: payload.exp };
  } catch {
    // Malformed base64, malformed JSON, WebCrypto rejecting bad input, etc.
    // all collapse to "not a valid session" rather than an unhandled error.
    return null;
  }
}

export function getSessionCookieOptions(maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    // Local dev runs over plain http; only require https in production.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Reads and verifies the session cookie directly off a Route Handler's request. */
export async function getSessionFromRequest(
  request: NextRequest,
  secret: string
): Promise<SessionPayload | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token, secret);
}

/** Signs a session for userId and sets it as the httpOnly cookie on the given response ("create a session"). */
export async function setSessionCookie(
  response: NextResponse,
  userId: string,
  secret: string
): Promise<NextResponse> {
  const token = await createSessionToken(userId, secret);
  response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
  return response;
}

/** Clears the session cookie on the given response ("clear/logout the session"). */
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, "", getSessionCookieOptions(0));
  return response;
}
