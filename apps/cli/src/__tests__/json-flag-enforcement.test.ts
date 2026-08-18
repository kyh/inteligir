// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors —
// apps/cli/src/__tests__/json-flag-enforcement.test.ts, adapted and widened.
//
// bb's version reads its parser's METADATA: every leaf declares --json. That
// catches a missing flag and nothing else — a command can declare the flag,
// print prose anyway, and swallow a server refusal while exiting 0. So this
// suite EXECUTES every leaf against a fixture server, three ways:
//
//   1. success, --json      → stdout parses as JSON, and nothing else is on it
//   2. server answers 400   → non-zero exit, no false success
//   3. server answers 500   → non-zero exit, no false success
//
// (2) and (3) are the honest-exit invariant: a body read without a status
// check prints the error envelope as if it were the answer.

import { afterEach, describe, expect, it } from "vitest";
import { argsOf, collectLeafCommands, type LeafCommand } from "../command-tree";
import { LEAF_INVOCATIONS, testProgram } from "./command-tree";
import {
  makeFixtureState,
  makeProposal,
  makeThread,
  serveFixture,
  EMPTY_TIMELINE,
  type FixtureServer,
  type FixtureState,
} from "./fixture-server";
import { runCliForTest } from "./run-cli";

// Commands intentionally excluded from the --json requirement.
const EXCLUDED_COMMANDS = new Set<string>();

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

/** Enough state that every leaf's invocation has something real to act on.
 *  Re-applied BETWEEN leaves, because the leaves mutate it (rename moves the
 *  file delete then wants) and a leaf must be judged on its own behavior. */
function seedFixture(state: FixtureState): void {
  state.vault.clear();
  state.vault.set("notes/hello.md", "# Hello\n");
  state.searchResults = [{ path: "notes/hello.md", title: "hello", snippet: "hi", score: 1 }];
  state.tags = [{ tag: "project", count: 2 }];
  state.backlinks = [
    { sourcePath: "Welcome.md", line: 1, snippet: "[[hello]]", kind: "wiki", embed: false },
  ];
  state.connectors = {
    state: "ready",
    servers: [
      {
        name: "context7",
        enabled: true,
        transport: { kind: "http", url: "https://mcp.context7.com/mcp" },
        authStatus: "not_logged_in",
      },
    ],
  };
  state.proposals.length = 0;
  state.proposals.push(makeProposal({ id: "prp_1" }));
  state.threads.length = 0;
  state.threads.push({
    thread: makeThread({ id: "thr_1", status: "idle" }),
    pendingInteractions: [
      {
        id: "int_1",
        threadId: "thr_1",
        turnId: "turn_1",
        requestKey: "req_1",
        status: "pending",
        payload: null,
        resolution: null,
        createdAt: 1_700_000_000_000,
        resolvedAt: null,
      },
    ],
    timeline: EMPTY_TIMELINE,
  });
}

function driveableState(): FixtureState {
  const state = makeFixtureState();
  seedFixture(state);
  return state;
}

async function boot(state: FixtureState): Promise<FixtureServer> {
  const server = await serveFixture(state);
  cleanups.push(() => server.close());
  return server;
}

function leaves(): LeafCommand[] {
  return collectLeafCommands(testProgram());
}

function invocationFor(path: string): readonly string[] {
  const argv = LEAF_INVOCATIONS[path];
  if (argv === undefined) {
    throw new Error(`no invocation registered for leaf "${path}" (add one to LEAF_INVOCATIONS)`);
  }
  return argv;
}

describe("CLI --json flag enforcement", () => {
  it("every leaf command declares --json", () => {
    const commands = leaves();
    expect(commands.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const { path, command } of commands) {
      if (EXCLUDED_COMMANDS.has(path)) {
        continue;
      }
      if (argsOf(command).json?.type !== "boolean") {
        missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every leaf command has a registered invocation — the table cannot fall behind", () => {
    expect(
      leaves()
        .map((leaf) => leaf.path)
        .toSorted(),
    ).toEqual(Object.keys(LEAF_INVOCATIONS).toSorted());
  });

  it("every leaf answers parseable JSON on stdout under --json, and nothing else", async () => {
    const state = driveableState();
    const server = await boot(state);
    const broken: string[] = [];
    for (const { path } of leaves()) {
      seedFixture(state);
      const result = await runCliForTest({
        argv: [...invocationFor(path), "--json"],
        baseUrl: server.baseUrl,
      });
      if (result.code !== 0) {
        broken.push(`${path}: exited ${result.code} (${result.stderr.trim()})`);
        continue;
      }
      try {
        JSON.parse(result.stdout);
      } catch {
        broken.push(`${path}: stdout is not one JSON document (${JSON.stringify(result.stdout)})`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("honest exits — no command may print a refusal as an answer", () => {
  for (const status of [400, 500] as const) {
    it(`every leaf exits non-zero when the server answers ${status}`, async () => {
      const state = driveableState();
      const server = await boot(state);
      state.failWith = {
        status,
        error: status === 400 ? "invalid_request" : "internal",
        message: `fixture refusal ${status}`,
      };
      const broken: string[] = [];
      for (const { path } of leaves()) {
        const result = await runCliForTest({
          argv: [...invocationFor(path)],
          baseUrl: server.baseUrl,
        });
        // No reseed needed: every route refuses, so nothing mutates.
        if (result.code === 0) {
          broken.push(`${path}: exited 0 and printed ${JSON.stringify(result.stdout)}`);
          continue;
        }
        if (result.stdout.length > 0) {
          broken.push(`${path}: wrote ${JSON.stringify(result.stdout)} to stdout while failing`);
        }
      }
      expect(broken).toEqual([]);
    });

    it(`every leaf emits a JSON error envelope on stderr under --json (${status})`, async () => {
      const state = driveableState();
      const server = await boot(state);
      state.failWith = {
        status,
        error: status === 400 ? "invalid_request" : "internal",
        message: `fixture refusal ${status}`,
      };
      const broken: string[] = [];
      for (const { path } of leaves()) {
        const result = await runCliForTest({
          argv: [...invocationFor(path), "--json"],
          baseUrl: server.baseUrl,
        });
        if (result.code === 0) {
          broken.push(`${path}: exited 0`);
          continue;
        }
        if (result.stdout.length > 0) {
          broken.push(`${path}: wrote to stdout while failing`);
        }
        const envelope: unknown = JSON.parse(result.stderr);
        if (
          typeof envelope !== "object" ||
          envelope === null ||
          !("error" in envelope) ||
          typeof envelope.error !== "string"
        ) {
          broken.push(`${path}: stderr is not an {error,message} envelope (${result.stderr})`);
        }
      }
      expect(broken).toEqual([]);
    });
  }
});
