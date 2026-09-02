import { defineConfig } from "vitest/config";

// No self-name alias on purpose: sources/tests import each other with
// relative paths; cross-package imports resolve through workspace exports.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    maxWorkers: 2,
  },
});
