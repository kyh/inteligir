import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // the agent's tokens are signed with a key derived from it (src/agent/eve-token.ts)
    env: { BETTER_AUTH_SECRET: "suite-only-better-auth-secret-000000000000" },
    globalSetup: ["@repo/db/test-database"],
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
    setupFiles: ["@repo/db/test-database-file", "./src/test-support/file-store-setup.ts"],
  },
});
