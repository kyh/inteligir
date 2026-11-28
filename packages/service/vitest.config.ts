import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      AI_GATEWAY_API_KEY: "",
      BETTER_AUTH_SECRET: "suite-only-better-auth-secret-000000000000",
    },
    globalSetup: ["@repo/db/test-database"],
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
    provide: { blobReadWriteToken: process.env.BLOB_READ_WRITE_TOKEN ?? "" },
    setupFiles: [
      "@repo/db/test-database-file",
      "./src/test-support/file-store-setup.test-utils.ts",
    ],
    testTimeout: 30_000,
  },
});
