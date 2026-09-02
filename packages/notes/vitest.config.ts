import { defineConfig } from "vitest/config";

// no node imports (`fileURLToPath`, aliases): tests import relative paths so the package stays pure.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
  },
});
