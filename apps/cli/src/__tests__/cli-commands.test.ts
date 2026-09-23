import { spawnSync } from "node:child_process";
import path from "node:path";
import { browserHandoffUrl } from "@repo/api/local/routes";
import type { ThreadTimeline } from "@repo/api/local/thread-timeline";
import { VAULT_MAX_CONTENT_LENGTH } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import {
  FIXTURE_HANDOFF_NONCE,
  FIXTURE_REVISION_SHA,
  makeFixtureState,
  makeRevision,
  makeThread,
  serveFixture,
  EMPTY_TIMELINE,
} from "./fixture-server";
import type { FixtureServer, FixtureState } from "./fixture-server";
import { runCliForTest } from "./run-cli";

const BIN = path.resolve(import.meta.dirname, "..", "..", "bin", "inteligir");

const boxedLines = (stdout: string): string[] =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith(" │"))
    .map((line) => line.replace(/^ │\s*/u, "").replace(/\s*│$/u, ""))
    .filter((line) => line.length > 0);

const boot = async (state: FixtureState): Promise<FixtureServer> => {
  const server = await serveFixture(state);
  onTestFinished(async () => {
    await server.close();
  });
  return server;
};

const seededState = (): FixtureState => {
  const state = makeFixtureState();
  state.vault.set("Welcome.md", "# Welcome\n");
  state.vault.set("notes/hello.md", "# Hello\n\nBody.\n");
  state.revisions.set("notes/hello.md", [
    { content: "# Hello\n", revision: makeRevision({ sha: FIXTURE_REVISION_SHA }) },
  ]);
  state.searchResults = [{ path: "notes/hello.md", score: 1.5, snippet: "…Body…", title: "hello" }];
  state.tags = [
    { count: 3, tag: "project" },
    { count: 1, tag: "idea" },
  ];
  state.backlinks = [
    {
      embed: false,
      kind: "wiki",
      line: 3,
      snippet: "see [[hello]]",
      sourcePath: "Welcome.md",
    },
  ];
  state.related = [
    {
      path: "notes/nearby.md",
      reasons: ["both link to Welcome", "shares #project"],
      score: 3,
      title: "Nearby",
    },
  ];
  return state;
};

const SHOW_TIMELINE: ThreadTimeline = {
  maxSequence: 3,
  rows: [
    {
      createdAt: 1_700_000_000_001,
      id: "user:1",
      kind: "conversation",
      role: "user",
      sourceSeqEnd: 1,
      sourceSeqStart: 1,
      text: "Write me a note",
      threadId: "thr_1",
      turnId: null,
      viewContext: null,
    },
    {
      children: [
        {
          approvalStatus: null,
          changes: [{ diff: null, kind: "add", movePath: null, path: "notes/a.md" }],
          createdAt: 1_700_000_000_002,
          id: "item:turn_1:file",
          kind: "work",
          sourceSeqEnd: 2,
          sourceSeqStart: 2,
          status: "completed",
          threadId: "thr_1",
          turnId: "turn_1",
          workKind: "file-change",
        },
      ],
      completedAt: 1_700_000_000_005,
      createdAt: 1_700_000_000_002,
      id: "turn:turn_1",
      kind: "turn",
      sourceSeqEnd: 3,
      sourceSeqStart: 2,
      status: "completed",
      threadId: "thr_1",
      turnId: "turn_1",
    },
    {
      createdAt: 1_700_000_000_003,
      id: "item:turn_1:msg",
      kind: "conversation",
      role: "assistant",
      sourceSeqEnd: 3,
      sourceSeqStart: 3,
      text: "Done",
      threadId: "thr_1",
      turnId: "turn_1",
      viewContext: null,
    },
  ],
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
      lastError: null,
      lastSyncAt: null,
      state: "no-remote",
    });
  });

  it("lists deleted docs, and restores one that is gone with an exclusive create", async () => {
    const state = seededState();
    state.revisions.set("notes/gone.md", [
      {
        content: "# Gone\n",
        revision: makeRevision({ path: "notes/gone.md", sha: FIXTURE_REVISION_SHA }),
      },
    ]);
    const server = await boot(state);

    const deleted = await runCliForTest({ argv: ["vault", "deleted"], baseUrl: server.baseUrl });
    expect(deleted.stdout).toBe(
      `${FIXTURE_REVISION_SHA}\t2026-08-01T10:00:00+00:00\tnotes/gone.md\n`,
    );

    const restore = await runCliForTest({
      argv: ["vault", "restore", "notes/gone.md", FIXTURE_REVISION_SHA],
      baseUrl: server.baseUrl,
    });
    expect(restore.stdout).toBe(`✔ Restored notes/gone.md to ${FIXTURE_REVISION_SHA}\n`);
    expect(state.vault.get("notes/gone.md")).toBe("# Gone\n");

    const again = await runCliForTest({
      argv: ["vault", "deleted"],
      baseUrl: server.baseUrl,
    });
    expect(again.stdout).toContain("Nothing has been deleted.");
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
      results: [{ path: "notes/hello.md", score: 1.5, snippet: "…Body…", title: "hello" }],
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

  it("renames a tag and names the notes it rewrote, in both voices", async () => {
    const server = await boot(seededState());
    const json = await runCliForTest({
      argv: ["tag", "rename", "project", "work", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(JSON.parse(json.stdout)).toEqual({
      from: "project",
      rewritten: ["notes/hello.md"],
      skipped: [],
      to: "work",
    });

    const human = await runCliForTest({
      argv: ["tag", "rename", "project", "work"],
      baseUrl: server.baseUrl,
    });
    expect(human.stdout).toContain("Renamed #project to #work in 1 note.");
  });

  it("renders a related note with the reasons it is related", async () => {
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
          enabled: true,
          name: "files",
          transport: { args: ["-y", "server-files"], command: "npx", kind: "stdio" },
        },
        {
          enabled: false,
          name: "context7",
          transport: { hasAuth: true, kind: "http", url: "https://mcp.context7.com/mcp" },
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
      pendingInteractions: [],
      thread: makeThread({ id: "thr_1", status: "idle", title: "Note writing" }),
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
      pendingInteractions: [],
      thread: makeThread({ id: "thr_1" }),
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
      pendingInteractions: [
        {
          createdAt: 1_700_000_000_000,
          id: "int_1",
          payload: null,
          requestKey: "req_1",
          resolution: null,
          resolvedAt: null,
          status: "pending",
          threadId: "thr_1",
          turnId: "turn_1",
        },
      ],
      thread: makeThread({ id: "thr_1", status: "active" }),
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
    // the consola box's width follows its widest line and the port is random, so only the rows are pinned.
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

const recordingOpener = (answer: boolean) => {
  const opened: string[] = [];
  const openExternalUrl = async (url: string): Promise<boolean> => {
    opened.push(url);
    return answer;
  };
  return { openExternalUrl, opened };
};

describe("open", () => {
  it("opens a link the server minted and names the server, never the nonce", async () => {
    const server = await boot(seededState());
    const browser = recordingOpener(true);
    const result = await runCliForTest({
      argv: ["open"],
      baseUrl: server.baseUrl,
      openExternalUrl: browser.openExternalUrl,
    });
    expect(result.code).toBe(0);
    expect(browser.opened).toEqual([
      browserHandoffUrl(`${server.baseUrl}/`, FIXTURE_HANDOFF_NONCE),
    ]);
    expect(result.stdout).toContain(server.baseUrl);
    expect(result.stdout).not.toContain(FIXTURE_HANDOFF_NONCE);
  });

  it("prints the link when no browser opens", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["open"],
      baseUrl: server.baseUrl,
      openExternalUrl: recordingOpener(false).openExternalUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `${browserHandoffUrl(`${server.baseUrl}/`, FIXTURE_HANDOFF_NONCE)}\n`,
    );
  });

  it("prints the link under --json and opens nothing", async () => {
    const server = await boot(seededState());
    const browser = recordingOpener(true);
    const result = await runCliForTest({
      argv: ["open", "--json"],
      baseUrl: server.baseUrl,
      openExternalUrl: browser.openExternalUrl,
    });
    expect(result.code).toBe(0);
    expect(browser.opened).toEqual([]);
    expect(JSON.parse(result.stdout)).toEqual({
      url: browserHandoffUrl(`${server.baseUrl}/`, FIXTURE_HANDOFF_NONCE),
    });
  });
});

const sourcesOn = (state: FixtureState) =>
  (state.comments.get("notes/hello.md") ?? []).flatMap((thread) => [
    thread.root.source,
    ...thread.replies.map((reply) => reply.entry.source),
  ]);

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

  it("refuses a word past the last positional instead of dropping it", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["search", "a", "b", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "unexpected argument: b — quote a value that contains spaces",
    });
  });

  it("refuses an unquoted body to vault write before reading stdin", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["vault", "write", "notes/p.md", "text", "--json"],
      baseUrl: server.baseUrl,
      stdin: new Uint8Array(),
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "unexpected argument: text — quote a value that contains spaces",
    });
    expect(state.vault.has("notes/p.md")).toBe(false);
  });

  it("names an undeclared short flag instead of reading it as a boolean", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["vault", "history", "notes/hello.md", "-n", "5", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "unknown option: -n",
    });
  });

  it("counts only the words before `--`, which a leaf reads as its own", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["connectors", "add", "x", "--", "npx", "-y", "srv"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(state.connectors.servers.at(-1)).toEqual({
      enabled: true,
      name: "x",
      transport: { args: ["-y", "srv"], command: "npx", kind: "stdio" },
    });
  });

  it("hands a dash-led value to the flag that takes one", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["vault", "write", "notes/dash.md", "--content", "-x"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(state.vault.get("notes/dash.md")).toBe("-x");
  });
});

describe("a leaf refuses bad usage before it resolves a server", () => {
  it("tag notes checks its --limit first", async () => {
    const result = await runCliForTest({
      argv: ["tag", "notes", "project", "--limit", "0", "--json"],
      baseUrl: null,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "INVALID_USAGE" });
  });

  it("vault attachments checks its location first", async () => {
    const result = await runCliForTest({
      argv: ["vault", "attachments", "nowhere", "--json"],
      baseUrl: null,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "INVALID_USAGE" });
  });

  it("action wait refuses a timeout past what a node timer can hold", async () => {
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_1", "--timeout", "86401", "--json"],
      baseUrl: null,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: '--timeout must be a number above 0 and at most 86400 (got "86401")',
    });
  });

  it("action wait refuses a poll interval over a minute", async () => {
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_1", "--poll-interval", "60001", "--json"],
      baseUrl: null,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "INVALID_USAGE" });
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

  it("refuses a terminal rather than waiting on it", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["vault", "write", "notes/tty.md"],
      baseUrl: server.baseUrl,
      stdin: "terminal",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("stdin is a terminal");
    expect(state.vault.has("notes/tty.md")).toBe(false);
  });

  it("refuses an empty stdin rather than emptying the file", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["vault", "write", "notes/hello.md"],
      baseUrl: server.baseUrl,
      stdin: new Uint8Array(),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("stdin carried no content");
    expect(state.vault.get("notes/hello.md")).toBe("# Hello\n\nBody.\n");

    const emptied = await runCliForTest({
      argv: ["vault", "write", "notes/hello.md", "--content", ""],
      baseUrl: server.baseUrl,
    });
    expect(emptied.code).toBe(0);
    expect(state.vault.get("notes/hello.md")).toBe("");
  });
});

describe("action new never orphans a thread silently", () => {
  it("names the created thread when its first turn fails", async () => {
    const state = seededState();
    const server = await boot(state);
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
      pendingInteractions: [
        {
          createdAt: 1_700_000_000_000,
          id: "int_a",
          payload: {
            availableDecisions: ["allow_once", "deny"],
            kind: "approval",
            reason: null,
            subject: {
              command: "rm -rf /",
              cwd: null,
              itemId: "cmd_1",
              kind: "command",
            },
          },
          requestKey: "req_a",
          resolution: null,
          resolvedAt: null,
          status: "pending",
          threadId: "thr_a",
          turnId: "turn_a",
        },
      ],
      thread: makeThread({ id: "thr_a", status: "active" }),
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

describe("cloud login", () => {
  it("reads the password from stdin under `--password -`, one line and its newline", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["cloud", "login", "--email", "Owner@Example.test", "--password", "-", "--json"],
      baseUrl: server.baseUrl,
      stdin: new TextEncoder().encode("correct horse battery\n"),
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      accountEmail: "owner@example.test",
      state: "signed-in",
    });
  });

  it("refuses to prompt under --json — the agent path has no terminal to wait on", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["cloud", "login", "--email", "owner@example.test", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "INVALID_USAGE" });
  });

  it("refuses an empty stdin rather than sending an empty password", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["cloud", "login", "--email", "owner@example.test", "--password", "-"],
      baseUrl: server.baseUrl,
      stdin: new TextEncoder().encode("\n"),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("stdin carried no password");
  });

  it("resolves the server before prompting, so no password is typed for nothing", async () => {
    const result = await runCliForTest({
      argv: ["cloud", "login", "--email", "owner@example.test"],
      baseUrl: null,
      stdin: "terminal",
    });
    expect(result.code).toBe(3);
    expect(result.stderr).not.toContain("Password:");
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
      message: '--timeout must be a number above 0 and at most 86400 (got "nope")',
    });
  });
});

// citty picks colour once, at import, and vitest's TEST turns it off, so only a fresh process without the
// no-colour signals shows what a pipe would receive.
describe("citty's colour stays out of what a pipe receives", () => {
  const ESC = String.fromCodePoint(0x1b);
  const NO_COLOUR_SIGNALS = new Set(["CI", "NO_COLOR", "TEST"]);
  const runBin = (argv: string[]) =>
    spawnSync(process.execPath, [BIN, ...argv], {
      encoding: "utf-8",
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !NO_COLOUR_SIGNALS.has(name)),
        ),
        TERM: "xterm-256color",
      },
      timeout: 60_000,
    });

  it("keeps the --json envelope free of escapes", () => {
    const result = runBin(["vualt", "--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "Unknown command vualt",
    });
  });

  it("prints usage without escapes", () => {
    const help = runBin(["search", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("USAGE");
    expect(help.stdout).not.toContain(ESC);

    const bare = runBin([]);
    expect(bare.status).toBe(1);
    expect(bare.stderr).toContain("USAGE");
    expect(bare.stderr).not.toContain(ESC);
  });
});

describe("a server that stopped answering", () => {
  it("classifies a refused dial as SERVER_UNREACHABLE / exit 3", async () => {
    // boot then close: a real bound port with nothing listening, the state a stale server.json leaves.
    const server = await serveFixture(makeFixtureState());
    const { baseUrl } = server;
    await server.close();
    const result = await runCliForTest({ argv: ["status", "--json"], baseUrl });
    expect(result.code).toBe(3);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "SERVER_UNREACHABLE" });
  });
});
