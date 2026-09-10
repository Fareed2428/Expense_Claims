import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  it("clears the session cookie and returns ok", async () => {
    const res = await POST();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
  });
});
