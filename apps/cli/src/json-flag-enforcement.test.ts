// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors —
// its CLI's json-flag-enforcement.test.ts, adapted and widened.

import { realpathSync } from "node:fs";
import type { ApprovalPendingInteractionPayload } from "@repo/domain/pending-interactions";
import { createPendingInteraction } from "@repo/db/pending-interactions";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { argsOf, collectGroupCommands, collectLeafCommands } from "./command-tree";
import type { CommandAtPath } from "./command-tree";
import {
  FAKE_ACCOUNT,
  FakeCloud,
  bootThreadHarness,
  makeTempDir,
  shareBoot,
} from "./server/test-support/boot-app";
import type { ThreadHarness } from "./server/test-support/boot-app";
import { agentTurn, cliOver, pageBundle } from "./test-support/booted-cli";
import type { CliOverServer } from "./test-support/booted-cli";
import {
  FIXTURE_ITEM_PATH,
  FIXTURE_ITEM_URL,
  leafInvocations,
  testProgram,
} from "./test-support/command-tree";
import type { LeafFacts } from "./test-support/command-tree";

const cliErrorEnvelopeSchema = z.object({ error: z.string().min(1), message: z.string() });

const EXCLUDED_COMMANDS = new Map<string, string>([
  [
    "serve",
    "it IS the server rather than a caller of one — it answers no document, it never returns while it is working, and the booted server this table drives every leaf against is the very thing it starts",
  ],
  [
    "vault open",
    "it writes the selector `serve` reads and dials no server: this table drives every leaf against a booted server over a real home, and this one would rewrite the developer's own config.json; vault-open.test.ts drives it over a scratch home instead, refusals included",
  ],
  [
    "native-host",
    "the browser's door: Chrome runs it with its origin and it speaks length-prefixed frames on stdin/stdout for its whole life, so a --json document would be a frame Chrome rejects; apps/cli/src/native-host/run-native-host.test.ts drives both modes",
  ],
]);

const HELLO_PATH = "notes/hello.md";
const HELLO = "---\nid: 5b1d7c9e-2f4a-4c6b-8d0e-1a2b3c4d5e6f\n---\n# Hello\n";
const COPY_PATH = "notes/copy.md";
const COPY = "---\nid: 0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b\n---\n# Copy\n";
const ITEM = [
  "---",
  "kind: link",
  `url: ${FIXTURE_ITEM_URL}`,
  "site: Example",
  "saved: 2026-10-16T08:00:00Z",
  "tags:",
  "  - project",
  "---",
  "",
  "The page's own text.",
  "",
].join("\n");
// what the leaves that create, rename or copy leave behind, so the next leaf's precondition holds
const LEFT_BEHIND = ["notes/written.md", "notes/renamed.md"];

const APPROVAL: ApprovalPendingInteractionPayload = {
  availableDecisions: ["allow_once", "deny"],
  kind: "approval",
  reason: null,
  subject: { command: "npm install", cwd: null, itemId: "cmd_1", kind: "command" },
};

const SUITE = { lifetime: "suite" } as const;

interface Booted {
  over: CliOverServer<ThreadHarness>;
  newFolder: string;
  connectedFolder: string;
}

// one server for the file: every leaf's success run reseeds what the one before it changed, and
// a refusal changes nothing
const shared = shareBoot(async (teardown): Promise<Booted> => {
  const cloud = new FakeCloud();
  const app = await bootThreadHarness(
    { mode: "manual" },
    {
      clientDir: pageBundle(SUITE),
      cloudTransport: { fetch: cloud.fetch, pollIntervalMs: null },
      teardown,
    },
  );
  return {
    // realpathed, as folders.add stores them: on macOS the temp dir sits under the /tmp symlink, so
    // the list would never hold the spelling the reseed asks about
    connectedFolder: realpathSync(makeTempDir("inteligir-json-connected-", SUITE)),
    newFolder: realpathSync(makeTempDir("inteligir-json-new-", SUITE)),
    over: await cliOver(app),
  };
});

let turns = 0;

// an action with a turn that changed the library, and an approval waiting on it
const freshAction = async (
  app: ThreadHarness,
): Promise<{ threadId: string; interactionId: string }> => {
  const { thread } = await app.client.threads.create({});
  turns += 1;
  await agentTurn(app, thread.id, { [`Agent/turn ${String(turns)}.md`]: "# Written by a turn\n" });
  const interaction = createPendingInteraction(app.db, app.bus, {
    payload: APPROVAL,
    requestKey: `req_${String(turns)}`,
    threadId: thread.id,
  });
  return { interactionId: interaction.id, threadId: thread.id };
};

// re-applied between leaves: they change what the next one names (rename moves the note delete
// then wants, remove takes the highlight edit then wants), and a leaf about an action or an
// approval gets an action of its own, since archive, undo and answer each use theirs up.
const reseed = async (
  { over, newFolder, connectedFolder }: Booted,
  leaf: string,
  last: LeafFacts | null,
): Promise<LeafFacts> => {
  const { app } = over;
  const seeds = { [COPY_PATH]: COPY, [FIXTURE_ITEM_PATH]: ITEM, [HELLO_PATH]: HELLO };
  await over.put(
    Object.fromEntries(
      Object.entries(seeds).filter(([path, bytes]) => over.onDisk(path) !== bytes),
    ),
  );
  for (const leftover of LEFT_BEHIND) {
    if (over.onDisk(leftover) !== null) {
      await app.client.vault.remove({ path: leftover });
    }
  }
  const { annotations } = await app.client.annotations.list({ path: HELLO_PATH });
  if (!annotations.some((annotation) => annotation.id === "c1")) {
    await app.client.annotations.add({
      id: "c1",
      path: HELLO_PATH,
      quote: "hello",
      text: "seeded",
    });
  }
  const { folders } = await app.client.folders.list();
  if (folders.includes(newFolder)) {
    await app.client.folders.remove({ path: newFolder });
  }
  if (!folders.includes(connectedFolder)) {
    await app.client.folders.add({ path: connectedFolder });
  }
  await app.vault.git.commitNow();
  // history only grows, so the first revision stays one every later leaf can name
  let revision = last?.revision;
  if (revision === undefined) {
    const [newest] = await app.vault.git.history(HELLO_PATH, { limit: 1, skip: 0 });
    if (newest === undefined) {
      throw new Error(`${HELLO_PATH} has no revision`);
    }
    revision = newest.sha;
  }
  const action =
    last === null || leaf.startsWith("action ") || leaf.startsWith("interactions ")
      ? await freshAction(app)
      : { interactionId: last.interactionId, threadId: last.threadId };
  return { ...action, connectedFolder, newFolder, password: FAKE_ACCOUNT.password, revision };
};

const leaves = (): CommandAtPath[] =>
  collectLeafCommands(testProgram()).filter((leaf) => !EXCLUDED_COMMANDS.has(leaf.path));

const invocationFor = (facts: LeafFacts, path: string): readonly string[] => {
  const argv = leafInvocations(facts).get(path);
  if (argv === undefined) {
    throw new Error(`no invocation registered for leaf "${path}" (add one to leafInvocations)`);
  }
  return argv;
};

describe("CLI --json flag enforcement", { timeout: 120_000 }, () => {
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
    const anyFacts: LeafFacts = {
      connectedFolder: "/connected",
      interactionId: "pint_1",
      newFolder: "/new",
      password: "password",
      revision: "0".repeat(40),
      threadId: "thr_1",
    };
    expect(
      leaves()
        .map((leaf) => leaf.path)
        .toSorted(),
    ).toEqual([...leafInvocations(anyFacts).keys()].toSorted());
  });

  it("every leaf answers parseable JSON on stdout under --json, and nothing else", async () => {
    const booted = shared();
    const broken: string[] = [];
    let facts: LeafFacts | null = null;
    for (const { path } of leaves()) {
      facts = await reseed(booted, path, facts);
      const result = await booted.over.cli([...invocationFor(facts, path), "--json"]);
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

describe("honest exits — no command may print a refusal as an answer", { timeout: 120_000 }, () => {
  for (const status of [400, 500] as const) {
    const refusal = {
      code: status === 400 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
      message: `refused with ${status}`,
    } as const;

    it(`every leaf exits non-zero when the server answers ${status}`, async () => {
      const booted = shared();
      const facts = await reseed(booted, "", null);
      booted.over.refuseEveryCall(refusal);
      const broken: string[] = [];
      try {
        for (const { path } of leaves()) {
          // no reseed needed: every route refuses, so nothing changes.
          const result = await booted.over.cli([...invocationFor(facts, path)]);
          if (result.code === 0) {
            broken.push(`${path}: exited 0 and printed ${JSON.stringify(result.stdout)}`);
            continue;
          }
          if (result.stdout.length > 0) {
            broken.push(`${path}: wrote ${JSON.stringify(result.stdout)} to stdout while failing`);
          }
        }
      } finally {
        booted.over.refuseEveryCall(null);
      }
      expect(broken).toEqual([]);
    });

    it(`every leaf emits a JSON error envelope on stderr under --json (${status})`, async () => {
      const booted = shared();
      const facts = await reseed(booted, "", null);
      booted.over.refuseEveryCall(refusal);
      const broken: string[] = [];
      try {
        for (const { path } of leaves()) {
          const result = await booted.over.cli([...invocationFor(facts, path), "--json"]);
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
      } finally {
        booted.over.refuseEveryCall(null);
      }
      expect(broken).toEqual([]);
    });
  }
});
