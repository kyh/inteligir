// Command output goldens against an in-process served contract app: exact
// stdout bytes for the human renderings, parsed JSON for --json, and the
// error paths' exit codes. The timeline fixture exercises the shared
// the timeline renderer end to end through `thread show`.

import type { ThreadTimeline } from "@repo/api/local/thread-timeline";
import { VAULT_MAX_CONTENT_LENGTH } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";
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

/** The rows inside a consola box, stripped of its border and its padding. */
function boxedLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith(" │"))
    .map((line) => line.replace(/^ │\s*/u, "").replace(/\s*│$/u, ""))
    .filter((line) => line.length > 0);
}

async function boot(state: FixtureState): Promise<FixtureServer> {
  const server = await serveFixture(state);
  onTestFinished(() => server.close());
  return server;
}

function seededState(): FixtureState {
  const state = makeFixtureState();
  state.vault.set("Welcome.md", "# Welcome\n");
  state.vault.set("notes/hello.md", "# Hello\n\nBody.\n");
  state.revisions.set("notes/hello.md", [
    { revision: makeRevision({ sha: FIXTURE_REVISION_SHA }), content: "# Hello\n" },
  ]);
  state.searchResults = [{ path: "notes/hello.md", title: "hello", snippet: "…Body…", score: 1.5 }];
  state.tags = [
    { tag: "project", count: 3 },
    { tag: "idea", count: 1 },
  ];
  state.backlinks = [
    {
      sourcePath: "Welcome.md",
      line: 3,
      snippet: "see [[hello]]",
      kind: "wiki",
      embed: false,
    },
  ];
  state.related = [
    {
      path: "notes/nearby.md",
      title: "Nearby",
      score: 3,
      reasons: ["both link to Welcome", "shares #project"],
    },
  ];
  return state;
}

const SHOW_TIMELINE: ThreadTimeline = {
  rows: [
    {
      kind: "conversation",
      role: "user",
      id: "user:1",
      threadId: "thr_1",
      turnId: null,
      text: "Write me a note",
      viewContext: null,
      sourceSeqStart: 1,
      sourceSeqEnd: 1,
      createdAt: 1_700_000_000_001,
    },
    {
      kind: "turn",
      id: "turn:turn_1",
      threadId: "thr_1",
      turnId: "turn_1",
      status: "completed",
      completedAt: 1_700_000_000_005,
      children: [
        {
          kind: "work",
          workKind: "file-change",
          id: "item:turn_1:file",
          threadId: "thr_1",
          turnId: "turn_1",
          status: "completed",
          changes: [{ path: "notes/a.md", kind: "add", movePath: null, diff: null }],
          approvalStatus: null,
          sourceSeqStart: 2,
          sourceSeqEnd: 2,
          createdAt: 1_700_000_000_002,
        },
      ],
      sourceSeqStart: 2,
      sourceSeqEnd: 3,
      createdAt: 1_700_000_000_002,
    },
    {
      kind: "conversation",
      role: "assistant",
      id: "item:turn_1:msg",
      threadId: "thr_1",
      turnId: "turn_1",
      text: "Done",
      viewContext: null,
      sourceSeqStart: 3,
      sourceSeqEnd: 3,
      createdAt: 1_700_000_000_003,
    },
  ],
  maxSequence: 3,
  tokenUsage: null,
};

describe("vault commands", () => {
  it("lists the tree, dirs marked, and filters by dir", async () => {
    const server = await boot(seededState());
    const all = await runCliForTest({ argv: ["vault", "list"], baseUrl: server.baseUrl });
    expect(all.code).toBe(0);
    expect(all.stdout).toBe("notes/\nWelcome.md\nnotes/hello.md\n");

    const scoped = await runCliForTest({
      argv: ["vault", "list", "notes"],
      baseUrl: server.baseUrl,
    });
    expect(scoped.stdout).toBe("notes/\nnotes/hello.md\n");
  });

  it("reads a file byte-exactly and errors 1 on a miss", async () => {
    const server = await boot(seededState());
    const read = await runCliForTest({
      argv: ["vault", "read", "notes/hello.md"],
      baseUrl: server.baseUrl,
    });
    expect(read.code).toBe(0);
    expect(read.stdout).toBe("# Hello\n\nBody.\n");

    const miss = await runCliForTest({
      argv: ["vault", "read", "nope.md"],
      baseUrl: server.baseUrl,
    });
    expect(miss.code).toBe(1);
    expect(miss.stderr).toBe("\n ERROR  No file at nope.md\n\n");
    expect(miss.stdout).toBe("");
  });

  it("writes via --content and reports the path", async () => {
    const state = seededState();
    const server = await boot(state);
    const write = await runCliForTest({
      argv: ["vault", "write", "notes/new.md", "--content", "# New\n"],
      baseUrl: server.baseUrl,
    });
    expect(write.code).toBe(0);
    expect(write.stdout).toBe("✔ Wrote notes/new.md\n");
    expect(state.vault.get("notes/new.md")).toBe("# New\n");
  });

  it("renames, deletes, mkdirs and renders sync status", async () => {
    const state = seededState();
    const server = await boot(state);
    const rename = await runCliForTest({
      argv: ["vault", "rename", "notes/hello.md", "notes/renamed.md"],
      baseUrl: server.baseUrl,
    });
    expect(rename.stdout).toBe("✔ Renamed notes/hello.md -> notes/renamed.md\n");
    expect(state.vault.has("notes/renamed.md")).toBe(true);

    const remove = await runCliForTest({
      argv: ["vault", "delete", "notes/renamed.md"],
      baseUrl: server.baseUrl,
    });
    expect(remove.stdout).toBe("✔ Deleted notes/renamed.md\n");

    const mkdir = await runCliForTest({
      argv: ["vault", "mkdir", "projects"],
      baseUrl: server.baseUrl,
    });
    expect(mkdir.stdout).toBe("✔ Created projects/\n");

    const status = await runCliForTest({ argv: ["vault", "status"], baseUrl: server.baseUrl });
    expect(status.stdout).toBe("state: no-remote\nlast sync: never\n");

    const sync = await runCliForTest({
      argv: ["vault", "sync", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(JSON.parse(sync.stdout)).toEqual({
      state: "no-remote",
      lastSyncAt: null,
      lastError: null,
    });
  });
});

describe("knowledge commands", () => {
  it("renders search results and their --json twin", async () => {
    const server = await boot(seededState());
    const human = await runCliForTest({
      argv: ["search", "Body"],
      baseUrl: server.baseUrl,
    });
    expect(human.code).toBe(0);
    expect(human.stdout).toBe("notes/hello.md  hello\n  …Body…\n");

    const json = await runCliForTest({
      argv: ["search", "Body", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(JSON.parse(json.stdout)).toEqual({
      results: [{ path: "notes/hello.md", title: "hello", snippet: "…Body…", score: 1.5 }],
    });
  });

  it("says so when nothing matches, and refuses a bad --limit", async () => {
    const state = seededState();
    state.searchResults = [];
    const server = await boot(state);
    const empty = await runCliForTest({ argv: ["search", "zzz"], baseUrl: server.baseUrl });
    expect(empty.stdout).toBe("ℹ No results.\n");

    const bad = await runCliForTest({
      argv: ["search", "x", "--limit", "0"],
      baseUrl: server.baseUrl,
    });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("--limit must be an integer between 1 and 100");
  });

  it("renders backlinks and tags", async () => {
    const server = await boot(seededState());
    const backlinks = await runCliForTest({
      argv: ["backlinks", "notes/hello.md"],
      baseUrl: server.baseUrl,
    });
    expect(backlinks.stdout).toBe("Welcome.md:3  see [[hello]]\n");

    const tags = await runCliForTest({ argv: ["tags"], baseUrl: server.baseUrl });
    expect(tags.stdout).toBe("project  3\nidea  1\n");
  });

  it("renders a related note with the reasons it is related", async () => {
    // The reasons are the row's second line, verbatim — a bare list of paths
    // would throw away the only part a reader can check.
    const server = await boot(seededState());
    const related = await runCliForTest({
      argv: ["related", "notes/hello.md"],
      baseUrl: server.baseUrl,
    });
    expect(related.stdout).toBe(
      "notes/nearby.md  Nearby\n  both link to Welcome; shares #project\n",
    );
  });

  it("says a note has no related notes rather than printing nothing", async () => {
    const state = seededState();
    state.related = [];
    const server = await boot(state);
    const related = await runCliForTest({
      argv: ["related", "notes/hello.md"],
      baseUrl: server.baseUrl,
    });
    // An outcome, so consola writes it — not a silent zero-line answer.
    expect(related.stdout).toBe("ℹ No related notes.\n");
    expect(related.code).toBe(0);
  });
});

describe("connectors", () => {
  it("names each server, what it runs, and its auth state", async () => {
    const state = seededState();
    state.connectors = {
      servers: [
        {
          name: "files",
          enabled: true,
          transport: { kind: "stdio", command: "npx", args: ["-y", "server-files"] },
        },
        {
          name: "context7",
          enabled: false,
          transport: { kind: "http", url: "https://mcp.context7.com/mcp", hasAuth: true },
        },
      ],
    };
    const server = await boot(state);

    const listed = await runCliForTest({ argv: ["connectors", "list"], baseUrl: server.baseUrl });

    expect(listed.stdout).toBe(
      "files  npx -y server-files  [enabled]\n" +
        "context7  https://mcp.context7.com/mcp  [disabled authenticated]\n",
    );
  });

  it("adds and removes through the registry routes", async () => {
    const server = await boot(seededState());

    const added = await runCliForTest({
      argv: [
        "connectors",
        "add",
        "exa",
        "--url",
        "https://mcp.exa.ai/mcp",
        "--header",
        "x-api-key=sk-test",
        "--json",
      ],
      baseUrl: server.baseUrl,
    });
    expect(added.code).toBe(0);
    expect(added.stdout).not.toContain("sk-test");

    const removed = await runCliForTest({
      argv: ["connectors", "remove", "exa", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(removed.code).toBe(0);

    const ghost = await runCliForTest({
      argv: ["connectors", "remove", "exa", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(ghost.code).toBe(1);
  });
});

describe("action commands", () => {
  it("lists threads and shows one with the compact timeline", async () => {
    const state = seededState();
    state.threads.push({
      thread: makeThread({ id: "thr_1", title: "Note writing", status: "idle" }),
      pendingInteractions: [],
      timeline: SHOW_TIMELINE,
    });
    const server = await boot(state);

    const list = await runCliForTest({ argv: ["action", "list"], baseUrl: server.baseUrl });
    expect(list.stdout).toBe("thr_1  idle  Note writing\n");

    const show = await runCliForTest({
      argv: ["action", "show", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(show.code).toBe(0);
    expect(show.stdout).toBe(
      [
        "Thread thr_1 — idle",
        "Title: Note writing",
        "",
        "── user ──",
        "Write me a note",
        "",
        "── turn (completed) ──",
        "  ~ add notes/a.md",
        "",
        "── agent ──",
        "Done",
        "",
      ].join("\n"),
    );
  });

  it("creates a thread and sends the first turn", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["action", "new", "Summarize my inbox"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("Action thr_created_1\n✔ Turn turn_for_thr_created_1 started\n");

    const attached = await runCliForTest({
      argv: ["action", "new", "x", "--doc", "notes/hello.md"],
      baseUrl: server.baseUrl,
    });
    expect(attached.code).toBe(0);
  });

  it("sends follow-ups and archives", async () => {
    const state = seededState();
    state.threads.push({
      thread: makeThread({ id: "thr_1" }),
      pendingInteractions: [],
      timeline: SHOW_TIMELINE,
    });
    const server = await boot(state);
    const send = await runCliForTest({
      argv: ["action", "send", "thr_1", "and then?"],
      baseUrl: server.baseUrl,
    });
    expect(send.stdout).toBe("✔ Turn turn_for_thr_1 started\n");

    const archive = await runCliForTest({
      argv: ["action", "archive", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(archive.stdout).toBe("✔ Archived thr_1\n");
  });
});

describe("interactions commands", () => {
  it("lists across threads and answers by scanning for the owner", async () => {
    const state = seededState();
    state.threads.push({
      thread: makeThread({ id: "thr_1", status: "active" }),
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
      timeline: SHOW_TIMELINE,
    });
    const server = await boot(state);

    const list = await runCliForTest({
      argv: ["interactions", "list"],
      baseUrl: server.baseUrl,
    });
    expect(list.stdout).toBe("int_1  thr_1  pending\n");

    const answer = await runCliForTest({
      argv: ["interactions", "answer", "int_1", "allow_once"],
      baseUrl: server.baseUrl,
    });
    expect(answer.code).toBe(0);
    expect(answer.stdout).toBe("✔ Interaction int_1 resolved\n");
  });
});

describe("status, guide and help", () => {
  it("renders system status with the thread context", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["status"],
      baseUrl: server.baseUrl,
      env: { INTELIGIR_THREAD_ID: "thr_ctx" },
    });
    expect(result.code).toBe(0);
    // `status` is the one surface printed as a consola box, whose width is
    // derived from its widest line — and the fixture's port is random, so the
    // chrome cannot be pinned. The FACTS still are, in order: the assertion
    // reads the box's own rows back out.
    expect(boxedLines(result.stdout)).toEqual([
      `inteligir 9.9.9-fixture — ${server.baseUrl}`,
      "Data dir: /fixture/data",
      "Vault: /fixture/vault",
      "Schema: v3 — uptime 65s",
      "Agent: acp (mode auto)",
      "Thread context: thr_ctx",
    ]);
  });

  it("prints the served guide verbatim", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({ argv: ["guide"], baseUrl: server.baseUrl });
    expect(result.stdout).toBe("# Fixture guide\n\nBe kind to the vault.\n\n");
  });

  it("prints the env context in --help", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["--help"],
      baseUrl: server.baseUrl,
      env: { INTELIGIR_THREAD_ID: "thr_ctx" },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("INTELIGIR_DATA_DIR");
    expect(result.stdout).toContain("INTELIGIR_THREAD_ID:  thr_ctx");
  });
});

/** Every source the fixture recorded on the seeded note, roots then replies,
 *  in the order they were written. */
function sourcesOn(state: FixtureState) {
  return (state.comments.get("notes/hello.md") ?? []).flatMap((thread) =>
    [thread.root.source].concat(thread.replies.map((reply) => reply.entry.source)),
  );
}

const addedIdSchema = z.object({ id: z.string() });

describe("comment verbs sign their entries", () => {
  it("signs `agent` inside an agent shell and `user` from a plain one", async () => {
    const state = seededState();
    const server = await boot(state);

    const fromAgent = await runCliForTest({
      argv: ["comment", "add", "notes/hello.md", "Needs a second pass"],
      baseUrl: server.baseUrl,
      env: { INTELIGIR_THREAD_ID: "thr_ctx" },
    });
    expect(fromAgent.code).toBe(0);
    const fromShell = await runCliForTest({
      argv: ["comment", "add", "notes/hello.md", "I agree"],
      baseUrl: server.baseUrl,
    });
    expect(fromShell.code).toBe(0);

    expect(sourcesOn(state)).toEqual(["agent", "user"]);
  });

  it("takes --source over the shell's own answer, on replies too", async () => {
    const state = seededState();
    const server = await boot(state);

    const added = await runCliForTest({
      argv: ["comment", "add", "notes/hello.md", "scripted", "--source", "external", "--json"],
      baseUrl: server.baseUrl,
      env: { INTELIGIR_THREAD_ID: "thr_ctx" },
    });
    expect(added.code).toBe(0);
    const rootId = addedIdSchema.parse(JSON.parse(added.stdout)).id;

    const replied = await runCliForTest({
      argv: ["comment", "reply", "notes/hello.md", rootId, "and again", "--source", "user"],
      baseUrl: server.baseUrl,
      env: { INTELIGIR_THREAD_ID: "thr_ctx" },
    });
    expect(replied.code).toBe(0);

    expect(sourcesOn(state)).toEqual(["external", "user"]);
  });

  it("refuses a source outside the vocabulary before dialing", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["comment", "add", "notes/hello.md", "x", "--source", "robot"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).not.toBe(0);
    expect(sourcesOn(state)).toEqual([]);
  });
});

describe("argv the CLI refuses", () => {
  // citty parses with node's `parseArgs` in non-strict mode, so an undeclared
  // flag is dropped rather than refused: `--contentt` would leave `vault write`
  // reading stdin and exiting 0. commander refused this for free.
  it("names an undeclared flag instead of ignoring it", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["vault", "write", "notes/x.md", "--contentt", "# X\n"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unknown option: --contentt");
  });

  it("reports an undeclared flag as INVALID_USAGE under --json", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["tags", "--nope", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "unknown option: --nope",
    });
  });

  it("names a missing positional rather than acting on undefined", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({ argv: ["vault", "read"], baseUrl: server.baseUrl });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("PATH");
  });
});

describe("vault write reads stdin as BYTES", () => {
  it("preserves a BOM and non-ASCII exactly", async () => {
    const state = seededState();
    const server = await boot(state);
    const content = "﻿# Héllo 😀\n";
    const result = await runCliForTest({
      argv: ["vault", "write", "notes/bytes.md"],
      baseUrl: server.baseUrl,
      stdin: new TextEncoder().encode(content),
    });
    expect(result.code).toBe(0);
    expect(state.vault.get("notes/bytes.md")).toBe(content);
  });

  it("refuses invalid UTF-8 instead of substituting U+FFFD", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["vault", "write", "notes/bad.md"],
      baseUrl: server.baseUrl,
      // A lone continuation byte: no valid decoding exists.
      stdin: Uint8Array.from([0x23, 0x20, 0xff, 0x0a]),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not valid UTF-8");
    expect(state.vault.has("notes/bad.md")).toBe(false);
  });

  it("refuses content over the vault's bound before sending it", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["vault", "write", "notes/big.md"],
      baseUrl: server.baseUrl,
      stdin: new Uint8Array(VAULT_MAX_CONTENT_LENGTH + 1).fill(0x61),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("refuses anything over");
    expect(state.vault.has("notes/big.md")).toBe(false);
  });
});

describe("action new never orphans a thread silently", () => {
  it("names the created thread when its first turn fails", async () => {
    const state = seededState();
    const server = await boot(state);
    // The thread is created, THEN the send refuses — exactly the window where
    // the id would otherwise be lost.
    state.refuseSend = { code: "PROVIDER_UNAVAILABLE", message: "no agent" };
    const result = await runCliForTest({
      argv: ["action", "new", "do a thing"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("thr_created_1");
    expect(result.stderr).toContain("was created but its first turn failed");
    expect(result.stderr).toContain("inteligir action send thr_created_1");
  });
});

describe("interactions answer validates the resolution locally", () => {
  it("refuses a decision the request never offered, naming the ones it did", async () => {
    const state = seededState();
    state.threads.push({
      thread: makeThread({ id: "thr_a", status: "active" }),
      pendingInteractions: [
        {
          id: "int_a",
          threadId: "thr_a",
          turnId: "turn_a",
          requestKey: "req_a",
          status: "pending",
          payload: {
            kind: "approval",
            subject: {
              kind: "command",
              itemId: "cmd_1",
              command: "rm -rf /",
              cwd: null,
            },
            reason: null,
            availableDecisions: ["allow_once", "deny"],
          },
          resolution: null,
          createdAt: 1_700_000_000_000,
          resolvedAt: null,
        },
      ],
      timeline: EMPTY_TIMELINE,
    });
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["interactions", "answer", "int_a", "allow_for_session"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("allow_once, deny");
    expect(state.threads.at(-1)?.pendingInteractions[0]?.status).toBe("pending");
  });
});

describe("--json failures", () => {
  it("puts the error envelope on stderr and leaves stdout empty", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["vault", "read", "nope.md", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "NOT_FOUND",
      message: "No file at nope.md",
    });
  });

  it("reports a local usage refusal with a CLI-side class", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_1", "--timeout", "nope", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: '--timeout must be a positive number (got "nope")',
    });
  });
});

describe("a server that stopped answering", () => {
  it("classifies a refused dial as SERVER_UNREACHABLE / exit 3", async () => {
    // The stale-file path #611 states: a crash leaves server.json behind, so
    // discovery finds a row and the dial reaches a DEAD port. The refused
    // connection must read as SERVER_UNREACHABLE (exit 3) — the class the served
    // guide teaches agents to branch on — not the raw ECONNREFUSED it rests on,
    // nor UNEXPECTED/exit 1. Booting then closing a fixture is exactly that
    // state: a real bound port, then nothing listening on it.
    const server = await serveFixture(makeFixtureState());
    const { baseUrl } = server;
    await server.close();
    const result = await runCliForTest({ argv: ["status", "--json"], baseUrl });
    expect(result.code).toBe(3);
    expect(JSON.parse(result.stderr).error).toBe("SERVER_UNREACHABLE");
  });
});
