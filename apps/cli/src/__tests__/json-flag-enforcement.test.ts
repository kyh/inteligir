// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors —
// apps/cli/src/__tests__/json-flag-enforcement.test.ts, adapted and widened.

import { z } from "zod";

const cliErrorEnvelopeSchema = z.object({ error: z.string().min(1), message: z.string() });
import { describe, expect, it, onTestFinished } from "vitest";
import { argsOf, collectLeafCommands, type LeafCommand } from "../command-tree";
import { LEAF_INVOCATIONS, testProgram } from "./command-tree";
import {
  FIXTURE_REVISION_SHA,
  makeFixtureState,
  makeRevision,
  makeThread,
  serveFixture,
  EMPTY_TIMELINE,
  type FixtureServer,
  type FixtureState,
} from "./fixture-server";
import { runCliForTest } from "./run-cli";

const EXCLUDED_COMMANDS = new Map<string, string>([
  [
    "serve",
    "it IS the server rather than a caller of one — it answers no document, it never returns while it is working, and the fixture it would be run against is the very thing it replaces",
  ],
]);

// re-applied between leaves: they mutate it (rename moves the file delete then wants).
function seedFixture(state: FixtureState): void {
  state.vault.clear();
  state.vault.set("notes/hello.md", "# Hello\n");
  state.revisions.set("notes/hello.md", [
    { revision: makeRevision({ sha: FIXTURE_REVISION_SHA }), content: "# Hello\n" },
  ]);
  state.searchResults = [{ path: "notes/hello.md", title: "hello", snippet: "hi", score: 1 }];
  state.tags = [{ tag: "project", count: 2 }];
  state.backlinks = [
    { sourcePath: "Welcome.md", line: 1, snippet: "[[hello]]", kind: "wiki", embed: false },
  ];
  state.related = [
    { path: "notes/nearby.md", title: "Nearby", score: 3, reasons: ["shares #project"] },
  ];
  state.connectors = {
    servers: [
      {
        name: "context7",
        enabled: true,
        transport: { kind: "http", url: "https://mcp.context7.com/mcp", hasAuth: true },
      },
    ],
  };
  state.threads.length = 0;
  state.comments.set("notes/hello.md", [
    {
      anchored: false,
      replies: [],
      resolved: false,
      root: { createdAt: 1, source: "user", text: "seeded", updatedAt: 1 },
      rootId: "c1",
    },
  ]);
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
  onTestFinished(() => server.close());
  return server;
}

function leaves(): LeafCommand[] {
  return collectLeafCommands(testProgram()).filter((leaf) => !EXCLUDED_COMMANDS.has(leaf.path));
}

function invocationFor(path: string): readonly string[] {
  const argv = LEAF_INVOCATIONS.get(path);
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
      if (argsOf(command).json?.type !== "boolean") {
        missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });

  it("no exclusion outlives its reason", () => {
    const walked = new Set(collectLeafCommands(testProgram()).map((leaf) => leaf.path));
    const stale = [...EXCLUDED_COMMANDS]
      .filter(([path]) => !walked.has(path))
      .map(([path, why]) => `STALE EXCLUSION  ${path}\n  the reason was: ${why}`);
    expect(stale, `\n${stale.join("\n\n")}\n`).toEqual([]);
  });

  it("every leaf command has a registered invocation — the table cannot fall behind", () => {
    expect(
      leaves()
        .map((leaf) => leaf.path)
        .toSorted(),
    ).toEqual([...LEAF_INVOCATIONS.keys()].toSorted());
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
        code: status === 400 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
        message: `fixture refusal ${status}`,
      };
      const broken: string[] = [];
      for (const { path } of leaves()) {
        const result = await runCliForTest({
          argv: [...invocationFor(path)],
          baseUrl: server.baseUrl,
        });
        // no reseed needed: every route refuses, so nothing mutates.
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
        code: status === 400 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
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
        const envelope = cliErrorEnvelopeSchema.safeParse(JSON.parse(result.stderr));
        if (!envelope.success) {
          broken.push(`${path}: stderr is not an {error,message} envelope (${result.stderr})`);
        }
      }
      expect(broken).toEqual([]);
    });
  }
});
