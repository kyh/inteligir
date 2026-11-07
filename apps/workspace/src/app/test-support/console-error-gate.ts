// React reports a real defect — a setState during another component's render, a missing key —
// as a console.error and nothing else, so the test around it passes. Any console.error fails the
// test that logged it; a test that provokes one on purpose silences it with its own
// `vi.spyOn(console, "error").mockImplementation(...)`, which stands in for this wrapper.

import { format } from "node:util";
import { afterEach, beforeEach } from "vitest";

const original = console.error;
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  console.error = (...args: unknown[]) => {
    logged.push(format(...args));
    original(...args);
  };
});

afterEach(() => {
  console.error = original;
  if (logged.length > 0) {
    throw new Error(
      `the test logged ${String(logged.length)} console.error:\n${logged.join("\n")}`,
    );
  }
});
