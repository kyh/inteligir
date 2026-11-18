import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // the agent's tokens are signed with a key derived from it (src/agent/eve-token.ts)
    env: { BETTER_AUTH_SECRET: "suite-only-better-auth-secret-000000000000" },
    globalSetup: ["@repo/db/test-database"],
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
    // the Blob store's key a run is given, for the store's contract alone
    // (src/files/file-store.contract.test.ts): src/test-support/file-store-setup.ts takes it from
    // every suite's environment
    provide: { blobReadWriteToken: process.env.BLOB_READ_WRITE_TOKEN ?? "" },
    setupFiles: ["@repo/db/test-database-file", "./src/test-support/file-store-setup.ts"],
    // a suite's Postgres round trips, a lock held past its 5s wait and the page reader's whole-site
    // corpus share a full run's cores with every suite turbo starts beside them, where the 5s
    // default is a coin-flip
    testTimeout: 30_000,
  },
});
