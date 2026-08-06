import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Resolve paths from THIS file so it works whether CWD is apps/web (vitest) or
// the repo root (knip loading configs).
const HERE = dirname(fileURLToPath(import.meta.url));

// D1 test schema. There are NO migration files — dev uses `drizzle-kit push`
// (see package.json db:push:*). Tests derive the schema DDL straight from
// src/worker/db/schema.ts via `drizzle-kit export` (reads the schema, touches no
// database), inject it as the TEST_SCHEMA binding, and apply it per test file in
// src/worker/__tests__/apply-schema.ts. Always in sync with the schema — zero
// drift, no generate step.
const TEST_SCHEMA = execFileSync(
  "pnpm",
  [
    "exec",
    "drizzle-kit",
    "export",
    "--dialect=sqlite",
    `--schema=${join(HERE, "src/worker/db/schema.ts")}`,
  ],
  { cwd: HERE, encoding: "utf8" },
);

// Runs the tests inside a real miniflare Workers runtime (in-process), with the
// same DO + R2 + D1 bindings wrangler.jsonc declares — so the DO's SQLite
// storage, R2 blob store, and the D1 auth database are exercised for real.
//
// BETTER_AUTH_SECRET holds a VALUE only at runtime (`wrangler secret put` /
// .dev.vars, never committed), so the test env has to supply a deterministic
// dummy for Better Auth to sign/verify with.
const TEST_BETTER_AUTH_SECRET = "test-better-auth-secret-000000000000";
// wrangler.jsonc declares the secret as required, and its loader checks
// .dev.vars/.env/process.env — not miniflare's bindings. There is no .dev.vars
// here (it's gitignored), so without this the suite prints a "Missing required
// secrets" warning per test file that is purely an artefact of where the value
// comes from. Same value either way; `??=` leaves a real env alone.
process.env.BETTER_AUTH_SECRET ??= TEST_BETTER_AUTH_SECRET;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // `SELF` and the Durable Object binding resolve against THIS module, not
      // wrangler's `main`: the deployed entry (src/worker/server.ts) also mounts
      // the marketing site's SSR handler, whose build-time virtual modules the
      // TanStack Start vite plugin supplies and this config does not load.
      // These tests exercise the API surface, so they enter where it starts.
      main: "./src/worker/index.ts",
      miniflare: {
        bindings: {
          TEST_SCHEMA,
          BETTER_AUTH_SECRET: TEST_BETTER_AUTH_SECRET,
          // Tests hit the in-process Worker from one IP; keep the auth limiter
          // off so multi-user suites don't 429. Rate limiting is covered in prod.
          RATE_LIMIT_DISABLED: "true",
          // The agent runs in the in-memory container (src/worker/agent/
          // fake-sandbox.ts), not a Cloudflare Sandbox: the real one needs the
          // Workers Paid plan and a built image, and neither exists in CI. The
          // runner, the tool executor, the transcript, the confirmation broker
          // and the vault write-back are all the production ones either way —
          // the port is the seam, so the suite drives real code.
          AGENT_RUNTIME: "scripted",
          // A provider is offered only when its whole OAuth trio is configured
          // (src/worker/agent/provider-catalog.ts), so the suites that drive
          // the credential path need one — otherwise every case would be
          // testing the "not configured on this deployment" branch. No token
          // endpoint is ever dialed: ProviderCredentials takes its `fetch`
          // injected.
          ANTHROPIC_OAUTH_AUTHORIZE_URL: "https://provider.test/authorize",
          ANTHROPIC_OAUTH_TOKEN_URL: "https://provider.test/token",
          ANTHROPIC_OAUTH_CLIENT_ID: "test-client",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./src/worker/__tests__/apply-schema.ts"],
    // Monorepo worker budget (see apps/desktop/vitest.config.ts).
    maxWorkers: 1,
  },
});
