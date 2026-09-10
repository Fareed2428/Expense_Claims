/**
 * Global test setup — unmounts whatever React Testing Library rendered
 * after every test. Without this, successive `render()` calls within the
 * same test file pile up in the (shared, jsdom) document body, and a
 * later test's query can match leftover elements from an earlier one.
 * Only affects component tests (anything using jsdom); plain unit tests
 * never call render(), so this is a no-op for them.
 */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
