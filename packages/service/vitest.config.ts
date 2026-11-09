import { execFileSync } from "node:child_process";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";
import { messagesService } from "./messages-service.ts";

// no migration files exist; the D1 DDL is derived from its schema by @repo/db's export script, the
// one the e2e harness runs too, since two spellings drift. Resolved from this file: cwd is this
// package under vitest but the repo root under knip.
const TEST_SCHEMA = execFileSync("pnpm", ["--filter", "@repo/db", "run", "--silent", "export"], {
  cwd: import.meta.dirname,
  encoding: "utf-8",
});

// the library model's own suites, which run under node: its SQL on SQLite's wasm build, which
// workerd cannot compile, and the pure modules beside it
const MODEL_SUITES = [
  "src/{imports,items,knowledge,text}/**/*.test.ts",
  "src/library/{library-queries,library-schema,library-sql,revert-change}.test.ts",
  "src/test-support/revert-edit.test.ts",
];

// the suites that open the account's socket
const SOCKET_SUITES = [
  "src/account-delete.test.ts",
  "src/library/library-socket.test.ts",
  "src/session-devices.test.ts",
];

const workerd = cloudflareTest({
  // the suites' own Worker (cloudflare.config.ts): its entry, its bindings and its objects, so only
  // what a config cannot hold is stated here
  experimental: { newConfig: true },
  remoteBindings: false,
  miniflare: {
    // every fetch the Worker and its objects make: the scripted Messages API at its address, and
    // nothing else (messages-service.ts)
    outboundService: messagesService,
    // a durable-object binding in cloudflare.config.ts names the config's Worker, which the plugin
    // runs under another name, so the one namespace the suites read by name is declared here, which
    // also makes ctx.exports.LibraryDO a SQLite namespace (test-support/env.d.ts)
    durableObjects: { LIBRARY_CELL: { className: "LibraryDO", useSQLite: true } },
    bindings: { TEST_SCHEMA },
  },
});

export default defineConfig({
  test: {
    maxWorkers: 1,
    projects: [
      {
        test: {
          // this code runs in the account's cell, whose isolate holds 128 MB, so a quadratic
          // allocation must fail its suite rather than pass on a workstation's multi-gigabyte heap
          execArgv: ["--max-old-space-size=512"],
          include: MODEL_SUITES,
          name: "model",
        },
      },
      {
        plugins: [workerd],
        test: {
          exclude: [...configDefaults.exclude, ...MODEL_SUITES, ...SOCKET_SUITES],
          include: ["src/**/*.test.ts"],
          name: "worker",
          setupFiles: ["./src/test-support/apply-schema.ts"],
          // the type claims run as tsc over this package's program, beside the suites workerd runs
          typecheck: {
            enabled: true,
            include: ["src/**/*.test-d.ts"],
            tsconfig: "./tsconfig.json",
          },
        },
      },
      {
        plugins: [workerd],
        // a Durable Object's WebSockets are unsupported under per-file storage isolation
        // (developers.cloudflare.com/workers/testing/vitest-integration/known-issues), so these
        // files share one storage, run one at a time
        test: {
          include: SOCKET_SUITES,
          isolate: false,
          name: "sockets",
          setupFiles: ["./src/test-support/apply-schema.ts"],
        },
      },
    ],
  },
});
