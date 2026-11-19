import { format } from "node:util";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";

let errors: MockInstance<typeof console.error> | null = null;

beforeEach(() => {
  errors = vi.spyOn(console, "error");
});

afterEach(() => {
  const logged = (errors?.mock.calls ?? []).map((args) => format(...args));
  errors?.mockRestore();
  errors = null;

  if (logged.length > 0) {
    throw new Error(
      `the test logged ${String(logged.length)} console.error:\n${logged.join("\n")}`,
    );
  }
});
