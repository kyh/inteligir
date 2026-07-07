import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Absolute path to the migrations dir, resolved from THIS file — so it works
// whether the config is loaded with CWD at apps/cloud (vitest) or the repo root
// (knip loading configs). `.href` (a string) sidesteps the Workers-runtime `URL`
// type this tsconfig sees for the global `URL`, which isn't the `node:url` one.
const MIGRATIONS_DIR = fileURLToPath(new URL("./src/db/migrations", import.meta.url).href);

// Runs the tests inside a real miniflare Workers runtime (in-process), with the
// same DO + R2 + D1 bindings wrangler.jsonc declares — so the DO's SQLite
// storage, R2 blob store, and the D1 auth database are exercised for real, never
// mocked. (v0.18 plugin API — the pre-vitest-4 `defineWorkersConfig({ test: {
// poolOptions } })` form is gone.)
//
// D1: `wrangler d1 migrations apply` runs the SQL at deploy; here we read the
// SAME migration SQL (`readD1Migrations`, Node side), pass it into the runtime as
// a JSON `TEST_MIGRATIONS` binding, and apply it per test file in
// ./test/apply-migrations.ts (`applyD1Migrations`). One source of truth for the
// schema across deploy + test.
//
// BETTER_AUTH_SECRET is a runtime secret (not in wrangler.jsonc), so it's absent
// from the test env — inject a deterministic dummy so Better Auth can sign/verify.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(MIGRATIONS_DIR);
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: "test-better-auth-secret-000000000000",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
