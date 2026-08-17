import { defineConfig } from "vitest/config";

// The shell is main-process only: the pure policy modules (the origin pin, the
// server target, the path layouts) and the supervisor over a fake child, all
// driven with no Electron environment at all.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Monorepo worker budget (see packages/notes/vitest.config.ts).
    maxWorkers: 2,
  },
});
