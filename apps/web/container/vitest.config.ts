import { defineConfig } from "vitest/config";

// The image is a NODE process, so the suite runs on node — the one workspace
// here that is neither a Worker nor a browser. It exercises the daemon's own
// modules directly (the watcher over a temporary directory, the materializer's
// path guard, the reporter against a loopback server); nothing here starts pi
// or reaches a provider.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Monorepo worker budget (see apps/desktop/vitest.config.ts).
    maxWorkers: 2,
  },
});
