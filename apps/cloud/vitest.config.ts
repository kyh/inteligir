import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Resolve paths from THIS file so it works whether CWD is apps/cloud (vitest) or
// the repo root (knip loading configs).
const HERE = dirname(fileURLToPath(import.meta.url));

// D1 test schema. There are NO migration files — dev uses `drizzle-kit push`
// (see package.json db:push:*). Tests derive the schema DDL straight from
// src/db/schema.ts via `drizzle-kit export` (reads the schema, touches no
// database), inject it as the TEST_SCHEMA binding, and apply it per test file in
// ./test/apply-schema.ts. Always in sync with the schema — zero drift, no
// generate step.
const TEST_SCHEMA = execFileSync(
  "pnpm",
  [
    "exec",
    "drizzle-kit",
    "export",
    "--dialect=sqlite",
    `--schema=${join(HERE, "src/db/schema.ts")}`,
  ],
  { cwd: HERE, encoding: "utf8" },
);

// Runs the tests inside a real miniflare Workers runtime (in-process), with the
// same DO + R2 + D1 bindings wrangler.jsonc declares — so the DO's SQLite
// storage, R2 blob store, and the D1 auth database are exercised for real.
//
// BETTER_AUTH_SECRET is a runtime secret (not in wrangler.jsonc), so it's absent from
// the test env — inject a deterministic dummy so Better Auth can sign/verify.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_SCHEMA,
          BETTER_AUTH_SECRET: "test-better-auth-secret-000000000000",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-schema.ts"],
    // Monorepo worker budget (see apps/desktop/vitest.config.ts).
    maxWorkers: 1,
  },
});
