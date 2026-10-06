import { execFileSync } from "node:child_process";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { compatibilityDate, compatibilityFlags } from "./compatibility.ts";

// resolved from this file: cwd is apps/web under vitest but the repo root under knip.
const HERE = import.meta.dirname;

// no migration files exist; the DDL is derived from the schema by db:export. the script rather than
// the command, because the e2e harness derives the same DDL and two spellings drift.
const TEST_SCHEMA = execFileSync("pnpm", ["run", "--silent", "db:export"], {
  cwd: HERE,
  encoding: "utf-8",
});

// BETTER_AUTH_SECRET has a value only at runtime (.dev.vars / a Worker secret), so the test env
// supplies one.
const TEST_BETTER_AUTH_SECRET = "test-better-auth-secret-000000000000";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // not cloudflare.config.ts's entrypoint: the deployed entry also mounts the SSR handler,
      // whose virtual modules only the start plugin supplies.
      main: "./src/worker/index.ts",
      // the pool reads only wrangler's config format, so the bindings cloudflare.config.ts declares
      // are restated here
      miniflare: {
        compatibilityDate,
        compatibilityFlags,
        d1Databases: ["DB"],
        r2Buckets: ["PACK_CACHE"],
        durableObjects: {
          THREAD_SYNC: { className: "ThreadSyncDO", useSQLite: true },
          REPO: { className: "RepoCell", useSQLite: true },
          REGISTRY: { className: "Registry", useSQLite: true },
        },
        bindings: {
          BETTER_AUTH_SECRET: TEST_BETTER_AUTH_SECRET,
          // every test shares one ip; vault-rate-limit.test.ts flips this per test.
          RATE_LIMIT_DISABLED: "true",
          TEST_SCHEMA,
          // small enough that a test fills a vault with a few pushes
          VAULT_STORAGE_CAP_BYTES: String(1024 * 1024),
        },
      },
    }),
  ],
  // this config does not run the start plugin that reads tsconfig paths.
  resolve: {
    alias: { "@": `${HERE}/src` },
  },
  test: {
    include: ["src/**/*.test.ts"],
    maxWorkers: 1,
    setupFiles: ["./src/worker/__tests__/apply-schema.ts"],
  },
});
