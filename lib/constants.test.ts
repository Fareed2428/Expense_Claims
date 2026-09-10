import { describe, expect, it } from "vitest";
import { APP_NAME, APP_TAGLINE } from "./constants";

// Phase 0 sanity test: confirms the Vitest setup itself works end-to-end
// (config, TS resolution, test runner) against real project code. Business
// rule tests (parsing, duplicates, state machine, permissions) are added
// in their own phases, not here.
describe("app constants", () => {
  it("has a non-empty app name", () => {
    expect(APP_NAME).toBe("Expense Claims");
  });

  it("has a non-empty tagline", () => {
    expect(APP_TAGLINE.length).toBeGreaterThan(0);
  });
});
