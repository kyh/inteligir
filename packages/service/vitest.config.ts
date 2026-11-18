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
  },
});
