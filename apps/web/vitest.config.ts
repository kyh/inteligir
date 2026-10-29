import { execFileSync } from "node:child_process";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";
import { compatibilityDate, compatibilityFlags } from "./compatibility.ts";
import { FILL_QUEUE } from "./src/worker/fill/fill-queues.ts";
import { ORIGIN } from "./src/worker/test-support/test-origin.ts";

// resolved from this file: cwd is apps/web under vitest but the repo root under knip.
const HERE = import.meta.dirname;

// no migration files exist; the DDL is derived from the schema by db:export. the script rather than
// the command, because the e2e harness derives the same DDL and two spellings drift.
const TEST_SCHEMA = execFileSync("pnpm", ["run", "--silent", "db:export"], {
  cwd: HERE,
  encoding: "utf-8",
});

// the suites that open the account's socket
const SOCKET_SUITES = [
  "src/worker/account-delete.test.ts",
  "src/worker/device-manage.test.ts",
  "src/worker/library/library-socket.test.ts",
  "src/worker/vault-git.test.ts",
];

// BETTER_AUTH_SECRET has a value only at runtime (.dev.vars / a Worker secret), so the test env
// supplies one.
const TEST_BETTER_AUTH_SECRET = "test-better-auth-secret-000000000000";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // not cloudflare.config.ts's entrypoint: the deployed entry also mounts the SSR handler,
      // whose virtual modules only the start plugin supplies.
      main: "./src/worker/index.ts",
      // the plugin documents reading only a Wrangler file (developers.cloudflare.com/workers/
      // testing/vitest-integration/configuration), so the bindings cloudflare.config.ts declares are
      // restated here
      miniflare: {
        compatibilityDate,
        compatibilityFlags,
        d1Databases: ["DB"],
        // the connector's OAuth store
        kvNamespaces: ["OAUTH_KV"],
        r2Buckets: ["BLOBS", "PACK_CACHE"],
        // the producer alone: a suite hands the consumer its batch itself (createMessageBatch), so
        // no message a test's save sends is read behind its back
        queueProducers: { FILLS: { queueName: FILL_QUEUE } },
        durableObjects: {
          // the plugin reads ctx.exports' classes from the source and their storage from here, so
          // this row is what makes ctx.exports.LibraryDO a SQLite namespace; only the suites read it
          // by name (test-support/env.d.ts)
          LIBRARY_CELL: { className: "LibraryDO", useSQLite: true },
          REPO: { className: "RepoCell", useSQLite: true },
          REGISTRY: { className: "Registry", useSQLite: true },
        },
        bindings: {
          BETTER_AUTH_SECRET: TEST_BETTER_AUTH_SECRET,
          // not the deployed floor, so a test that passes reads the binding: every test client sends
          // this version (buildHeaders in cloud-helpers.ts), and client-floor.test.ts goes under it
          MIN_CLIENT_BUILD: "1.2.0",
          // every test shares one ip; vault-rate-limit.test.ts flips this per test.
          RATE_LIMIT_DISABLED: "true",
          // the origin every suite addresses the Worker at, as the deployment's own
          SITE_ORIGIN: ORIGIN,
          TEST_SCHEMA,
          // small enough that a test fills a vault with a few pushes
          VAULT_STORAGE_CAP_BYTES: String(1024 * 1024),
          LIBRARY_STORAGE_CAP_BYTES: String(1024 * 1024 * 1024),
        },
      },
    }),
  ],
  // the site's `@/` alias, which tsconfig.json declares: neither cloudflareTest nor vitest reads
  // tsconfig paths, and the start plugin that does is not in this config
  resolve: {
    alias: { "@": `${HERE}/src` },
  },
  test: {
    maxWorkers: 1,
    setupFiles: ["./src/worker/test-support/apply-schema.ts"],
    projects: [
      {
        extends: true,
        test: {
          exclude: [...configDefaults.exclude, ...SOCKET_SUITES],
          include: ["src/**/*.test.ts"],
          name: "worker",
          // the type claims run as tsc over the Worker's own program, beside the suites workerd runs
          typecheck: {
            enabled: true,
            include: ["src/worker/**/*.test-d.ts"],
            tsconfig: "./src/worker/tsconfig.json",
          },
        },
      },
      {
        extends: true,
        // a Durable Object's WebSockets are unsupported under per-file storage isolation
        // (developers.cloudflare.com/workers/testing/vitest-integration/known-issues), so these
        // files share one storage, run one at a time
        test: { include: SOCKET_SUITES, isolate: false, name: "sockets" },
      },
    ],
  },
});
