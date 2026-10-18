// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors —
// its CLI's json-flag-enforcement.test.ts, adapted and widened.

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { argsOf, collectGroupCommands, collectLeafCommands } from "./command-tree";
import type { CommandAtPath } from "./command-tree";
import {
  FIXTURE_ITEM_PATH,
  FIXTURE_ITEM_URL,
  LEAF_INVOCATIONS,
  testProgram,
} from "./test-support/command-tree";
import {
  FIXTURE_REVISION_SHA,
  makeFixtureState,
  makeItemRow,
  makeRevision,
  makeThread,
  serveFixture,
  EMPTY_TIMELINE,
} from "./test-support/fixture-server";
import type { FixtureServer, FixtureState } from "./test-support/fixture-server";
import { runCliForTest } from "./test-support/run-cli";

const cliErrorEnvelopeSchema = z.object({ error: z.string().min(1), message: z.string() });

const EXCLUDED_COMMANDS = new Map<string, string>([
  [
    "serve",
    "it IS the server rather than a caller of one — it answers no document, it never returns while it is working, and the fixture it would be run against is the very thing it replaces",
  ],
  [
    "vault open",
    "it writes the selector `serve` reads and dials no server: this table drives every leaf against the fixture over a real home, and this one would rewrite the developer's own config.json; vault-open.test.ts drives it over a scratch home instead, refusals included",
  ],
  [
    "native-host",
    "the browser's door: Chrome runs it with its origin and it speaks length-prefixed frames on stdin/stdout for its whole life, so a --json document would be a frame Chrome rejects; apps/cli/src/native-host/run-native-host.test.ts drives both modes",
  ],
]);

// re-applied between leaves: they mutate it (rename moves the file delete then wants).
const seedFixture = (state: FixtureState): void => {
  state.vault.clear();
  state.vault.set("notes/hello.md", "# Hello\n");
  state.vault.set("notes/copy.md", "---\nid: 0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b\n---\n# Copy\n");
  state.revisions.set("notes/hello.md", [
    { content: "# Hello\n", revision: makeRevision({ sha: FIXTURE_REVISION_SHA }) },
  ]);
  state.searchResults = [{ path: "notes/hello.md", score: 1, snippet: "hi", title: "hello" }];
  state.tags = [{ count: 2, tag: "project" }];
  state.backlinks = [
    { embed: false, kind: "wiki", line: 1, snippet: "[[hello]]", sourcePath: "Welcome.md" },
  ];
  state.related = [
    { path: "notes/nearby.md", reasons: ["shares #project"], score: 3, title: "Nearby" },
  ];
  state.items = [
    makeItemRow(FIXTURE_ITEM_PATH, {
      host: "example.test",
      kind: "link",
      tags: ["project"],
      url: FIXTURE_ITEM_URL,
    }),
  ];
  state.importJob = null;
  state.importPlan = {
    alreadySaved: 0,
    droppedTags: [],
    duplicates: 0,
    estimatedBytes: 65_536,
    folderCount: 1,
    folders: ["Reading"],
    highlights: 0,
    items: 1,
    planId: "plan_1",
    skipped: [],
    skippedCount: 0,
    tags: 1,
  };
  state.threads.length = 0;
  state.annotations.set("notes/hello.md", [
    {
      id: "c1",
      passage: null,
      quote: "hello",
      replies: [],
      root: { createdAt: 1, quote: "hello", source: "user", text: "seeded", updatedAt: 1 },
      state: "missing",
    },
  ]);
  state.threads.push({
    pendingInteractions: [
      {
        createdAt: 1_700_000_000_000,
        decision: null,
        id: "int_1",
        payload: null,
        requestKey: "req_1",
        resolvedAt: null,
        status: "pending",
        threadId: "thr_1",
        turnId: "turn_1",
      },
    ],
    thread: makeThread({ id: "thr_1", status: "idle" }),
    timeline: EMPTY_TIMELINE,
    turnChanges: [
      { items: ["notes/hello.md"], paths: ["notes/hello.md"], state: "applied", turnId: "turn_1" },
    ],
  });
};

const driveableState = (): FixtureState => {
  const state = makeFixtureState();
  seedFixture(state);
  return state;
};

const boot = async (state: FixtureState): Promise<FixtureServer> => {
  const server = await serveFixture(state);
  onTestFinished(async () => {
    await server.close();
  });
  return server;
};

const leaves = (): CommandAtPath[] =>
  collectLeafCommands(testProgram()).filter((leaf) => !EXCLUDED_COMMANDS.has(leaf.path));

const invocationFor = (path: string): readonly string[] => {
  const argv = LEAF_INVOCATIONS.get(path);
  if (argv === undefined) {
    throw new Error(`no invocation registered for leaf "${path}" (add one to LEAF_INVOCATIONS)`);
  }
  return argv;
};

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

  it("no command that routes to others declares args", () => {
    const groups = collectGroupCommands(testProgram());
    expect(groups.length).toBeGreaterThan(1);
    const offenders = groups
      .filter(({ command }) => Object.keys(argsOf(command)).length > 0)
      .map(
        ({ path }) =>
          `GROUP WITH ARGS  ${path}\n  rule: a command with subcommands declares none — resolveCommandPath ` +
          `(src/command-tree.ts) takes the first word that is not a flag as the next name, and a flag's ` +
          `value would be that word`,
      );
    expect(offenders, `\n${offenders.join("\n\n")}\n`).toEqual([]);
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
