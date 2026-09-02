import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// resolved from this file: cwd is apps/web under vitest but the repo root under knip.
const HERE = dirname(fileURLToPath(import.meta.url));

// no migration files exist; the DDL is derived from the schema by db:export. the script rather than
// the command, because the e2e harness derives the same DDL and two spellings drift.
const TEST_SCHEMA = execFileSync("pnpm", ["run", "--silent", "db:export"], {
  cwd: HERE,
  encoding: "utf8",
});

// BETTER_AUTH_SECRET has a value only at runtime (.dev.vars / wrangler secret), so the test env
// supplies one.
const TEST_BETTER_AUTH_SECRET = "test-better-auth-secret-000000000000";

export default defineConfig({
  // this config does not run the start plugin that reads tsconfig paths.
  resolve: {
    alias: { "@": `${HERE}/src` },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // not wrangler's main: the deployed entry also mounts the SSR handler, whose virtual modules
      // only the start plugin supplies.
      main: "./src/worker/index.ts",
      miniflare: {
        bindings: {
          TEST_SCHEMA,
          BETTER_AUTH_SECRET: TEST_BETTER_AUTH_SECRET,
          // every test shares one ip; vault-rate-limit.test.ts flips this per test.
          RATE_LIMIT_DISABLED: "true",
        },
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/worker/__tests__/apply-schema.ts"],
    maxWorkers: 1,
  },
});
