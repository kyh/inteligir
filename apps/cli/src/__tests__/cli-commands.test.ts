import { spawnSync } from "node:child_process";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileTooLargeMessage } from "@repo/contract/local/items/items-schema";
import { browserHandoffUrl } from "@repo/contract/local/routes";
import type { ThreadTimeline } from "@repo/contract/local/thread-timeline";
import type { TurnChanges } from "@repo/contract/local/threads/threads-schema";
import { VAULT_MAX_CONTENT_LENGTH, contentHashHex } from "@repo/contract/local/vault/vault-schema";
import type { VaultSyncConflict } from "@repo/contract/local/vault/vault-schema";
import type { ApprovalPendingInteractionPayload } from "@repo/domain/pending-interactions";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { importCancelOutputSchema } from "../commands/import";
import { itemShowOutputSchema } from "../commands/item";
import { saveStdinOutputSchema } from "../commands/save";
import { tagChangeOutputSchema } from "../commands/tag";
import { FIXTURE_FILE_PATH, FIXTURE_PAGE_PATH, FIXTURE_RAINDROP_PATH } from "./command-tree";
import {
  FIXTURE_HANDOFF_NONCE,
  FIXTURE_REVISION_SHA,
  makeFixtureState,
  makeInteraction,
  makeItemRow,
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
      contextPaths: [],
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
      contextPaths: [],
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
};

const COMMAND_APPROVAL: ApprovalPendingInteractionPayload = {
  availableDecisions: ["allow_once", "allow_for_session"],
  kind: "approval",
  reason: "installs the dependencies",
  subject: { command: "npm install", cwd: "/fixture/vault", itemId: "cmd_1", kind: "command" },
};

const FILE_APPROVAL: ApprovalPendingInteractionPayload = {
  availableDecisions: ["allow_once", "deny"],
  kind: "approval",
  reason: null,
  subject: { itemId: "file_1", kind: "file_change", writeScope: null },
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

  it("refuses a folder that is not there rather than listing it as empty", async () => {
    const server = await boot(seededState());
    for (const dir of ["nots", "notes/hello.md"]) {
      const result = await runCliForTest({
        argv: ["vault", "list", dir, "--json"],
        baseUrl: server.baseUrl,
      });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        error: "NOT_FOUND",
        message: `No folder ${dir} in the vault`,
      });
    }
  });

  it("answers the hash of what it read under --json, the base a guarded write carries", async () => {
    const server = await boot(seededState());
    const read = await runCliForTest({
      argv: ["vault", "read", "notes/hello.md", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(JSON.parse(read.stdout)).toEqual({
      content: "# Hello\n\nBody.\n",
      hash: await contentHashHex("# Hello\n\nBody.\n"),
      path: "notes/hello.md",
    });
  });

  it("writes over the bytes it read with --expected-hash, and refuses a file that moved", async () => {
    const state = seededState();
    const server = await boot(state);
    const base = await contentHashHex("# Hello\n\nBody.\n");
    const guarded = await runCliForTest({
      argv: [
        "vault",
        "write",
        "notes/hello.md",
        "--content",
        "# Edited\n",
        "--expected-hash",
        base,
      ],
      baseUrl: server.baseUrl,
    });
    expect(guarded.code).toBe(0);
    expect(state.vault.get("notes/hello.md")).toBe("# Edited\n");

    const stale = await runCliForTest({
      argv: [
        "vault",
        "write",
        "notes/hello.md",
        "--content",
        "# Again\n",
        "--expected-hash",
        base,
        "--json",
      ],
      baseUrl: server.baseUrl,
    });
    expect(stale.code).toBe(1);
    expect(stale.stdout).toBe("");
    expect(JSON.parse(stale.stderr)).toEqual({
      error: "CAS_MISMATCH",
      message: "notes/hello.md changed since the base this write was derived from",
    });
    expect(state.vault.get("notes/hello.md")).toBe("# Edited\n");
  });

  it("creates with --if-absent, and refuses a path something already holds", async () => {
    const state = seededState();
    const server = await boot(state);
    const created = await runCliForTest({
      argv: ["vault", "write", "notes/fresh.md", "--content", "# Fresh\n", "--if-absent"],
      baseUrl: server.baseUrl,
    });
    expect(created.code).toBe(0);
    expect(state.vault.get("notes/fresh.md")).toBe("# Fresh\n");

    const taken = await runCliForTest({
      argv: [
        "vault",
        "write",
        "notes/hello.md",
        "--content",
        "# Clobber\n",
        "--if-absent",
        "--json",
      ],
      baseUrl: server.baseUrl,
    });
    expect(taken.code).toBe(1);
    expect(JSON.parse(taken.stderr)).toEqual({
      error: "ALREADY_EXISTS",
      message: "A file already exists at notes/hello.md",
    });
    expect(state.vault.get("notes/hello.md")).toBe("# Hello\n\nBody.\n");
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
      argv: ["vault", "write", "notes/new.md", "--content", "# New\n", "--overwrite"],
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
      conflicts: [],
      device: "Fixture Mac",
      externalSync: null,
      lastError: null,
      lastSyncAt: null,
      tooLarge: { count: 0, files: [] },
      state: "no-remote",
    });
  });

  it("says each note two devices changed at once in plain words, and --json names this device", async () => {
    const state = seededState();
    const conflicts: VaultSyncConflict[] = [
      {
        at: 1_756_600_000_000,
        copyDevice: "Kai's iPhone",
        copyPath: "notes/Plan (conflict, Kai's iPhone).md",
        keptDevice: "Fixture Mac",
        kind: "copied",
        path: "notes/Plan.md",
      },
      {
        at: 1_756_600_000_000,
        deletedDevice: "Fixture Mac",
        keptDevice: "Kai's iPhone",
        kind: "kept-edit",
        path: "Ideas.md",
      },
    ];
    state.vaultStatus = {
      conflicts,
      device: "Fixture Mac",
      externalSync: null,
      lastError: null,
      lastSyncAt: null,
      tooLarge: { count: 0, files: [] },
      remote: "https://cloud.test/v1/git/vault.git",
      remoteSource: "account",
      state: "clean",
    };
    const server = await boot(state);

    const status = await runCliForTest({ argv: ["vault", "status"], baseUrl: server.baseUrl });
    expect(status.stdout).toBe(
      [
        "state: clean",
        "remote: https://cloud.test/v1/git/vault.git",
        "last sync: never",
        "Both versions of “Plan” were kept: yours stays, and the one from Kai's iPhone is in “Plan (conflict, Kai's iPhone)”.",
        "“Ideas” was deleted here but edited on Kai's iPhone, so it was kept.",
        "",
      ].join("\n"),
    );

    const json = await runCliForTest({
      argv: ["vault", "status", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(JSON.parse(json.stdout)).toMatchObject({ conflicts, device: "Fixture Mac" });
  });

  it("vault remote prints where the vault syncs, and chooses a server of the user's own or the account", async () => {
    const state = seededState();
    const server = await boot(state);
    const signedOut =
      "no remote: the account's hosted vault, once this install signs in (`inteligir cloud login`)";
    const own = "git@git.example.test:me/vault.git";

    const current = await runCliForTest({ argv: ["vault", "remote"], baseUrl: server.baseUrl });
    expect(current.stdout).toBe(`${signedOut}\n`);

    const chosen = await runCliForTest({
      argv: ["vault", "remote", own],
      baseUrl: server.baseUrl,
    });
    expect(chosen.stdout).toBe(
      `✔ The vault syncs with a git server of your own, with this machine's git credentials.\n  ${own} (the vault's own git origin)\n`,
    );
    const json = await runCliForTest({
      argv: ["vault", "remote", own, "--json"],
      baseUrl: server.baseUrl,
    });
    expect(JSON.parse(json.stdout)).toMatchObject({ remote: own, remoteSource: "explicit" });

    const account = await runCliForTest({
      argv: ["vault", "remote", "account"],
      baseUrl: server.baseUrl,
    });
    expect(account.stdout).toBe(`  ${signedOut}\n`);
    expect(account.stderr).toContain(
      "Saved: the account's hosted vault is the choice; nothing syncs yet.",
    );

    state.vaultStatus = { ...state.vaultStatus, externalSync: { kind: "icloud-drive" } };
    const synced = await runCliForTest({
      argv: ["vault", "remote", "account"],
      baseUrl: server.baseUrl,
    });
    expect(synced.stdout).toBe(
      "  no remote: iCloud Drive syncs this folder, so the hosted vault stays off\n",
    );
    expect(synced.stderr).toContain(
      "Saved: the account's hosted vault is the choice; nothing syncs yet.",
    );

    state.vaultStatus = {
      conflicts: [],
      device: "Fixture Mac",
      externalSync: null,
      lastError: null,
      lastSyncAt: null,
      tooLarge: { count: 0, files: [] },
      remote: own,
      remoteSource: "pinned",
      state: "clean",
    };
    const pinned = await runCliForTest({ argv: ["vault", "remote"], baseUrl: server.baseUrl });
    expect(pinned.stdout).toBe(`${own} (pinned by INTELIGIR_VAULT_REMOTE)\n`);
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

  it("restores a note still there over a checkpoint, and refuses one that moved after the read", async () => {
    const state = seededState();
    const server = await boot(state);

    const restore = await runCliForTest({
      argv: ["vault", "restore", "notes/hello.md", FIXTURE_REVISION_SHA, "--json"],
      baseUrl: server.baseUrl,
    });
    expect(restore.code).toBe(0);
    expect(JSON.parse(restore.stdout)).toEqual({ annotations: "none", path: "notes/hello.md" });
    expect(state.vault.get("notes/hello.md")).toBe("# Hello\n");
    expect(state.vaultLog).toEqual(["commitNow notes/hello.md", "write notes/hello.md"]);

    state.concurrentWrite = { content: "# Concurrent\n", path: "notes/hello.md" };
    const stale = await runCliForTest({
      argv: ["vault", "restore", "notes/hello.md", FIXTURE_REVISION_SHA, "--json"],
      baseUrl: server.baseUrl,
    });
    expect(stale.code).toBe(1);
    expect(stale.stdout).toBe("");
    expect(JSON.parse(stale.stderr)).toEqual({
      error: "CAS_MISMATCH",
      message: "notes/hello.md changed since the base this write was derived from",
    });
    expect(state.vault.get("notes/hello.md")).toBe("# Concurrent\n");
  });

  it("brings a deleted note's annotations back with it, and fails naming them when they cannot come back", async () => {
    const noteId = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
    const store = `.inteligir/annotations/${noteId}.json`;
    const state = seededState();
    state.revisions.set("notes/gone.md", [
      {
        content: `---\nid: ${noteId}\n---\n# Gone\n`,
        revision: makeRevision({ path: "notes/gone.md", sha: FIXTURE_REVISION_SHA }),
      },
    ]);
    state.revisions.set(store, [
      {
        content: '{"threads":[]}\n',
        revision: makeRevision({ path: store, sha: FIXTURE_REVISION_SHA }),
      },
    ]);
    const server = await boot(state);

    const restore = await runCliForTest({
      argv: ["vault", "restore", "notes/gone.md", FIXTURE_REVISION_SHA],
      baseUrl: server.baseUrl,
    });
    expect(restore.stdout).toBe(
      `✔ Restored notes/gone.md to ${FIXTURE_REVISION_SHA}, with its annotations\n`,
    );
    expect(state.vault.get(store)).toBe('{"threads":[]}\n');

    state.vault.delete("notes/gone.md");
    state.vault.delete(store);
    state.vault.set(".inteligir/annotations", "a file where the store's folder goes\n");
    const stranded = await runCliForTest({
      argv: ["vault", "restore", "notes/gone.md", FIXTURE_REVISION_SHA, "--json"],
      baseUrl: server.baseUrl,
    });
    expect(stranded.code).toBe(1);
    expect(stranded.stdout).toBe("");
    expect(JSON.parse(stranded.stderr)).toEqual({
      error: "CONFLICT",
      message: `Restored notes/gone.md to ${FIXTURE_REVISION_SHA}, but not its annotations: A file shadows a parent folder of ${store}`,
    });
    expect(state.vault.has("notes/gone.md")).toBe(true);
    expect(state.vault.has(store)).toBe(false);
  });

  it("gives a copy its own id with a copy of its annotations, and refuses one that moved after the read", async () => {
    const shared = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
    const store = `.inteligir/annotations/${shared}.json`;
    const storeBytes = '{\n  "c1": { "text": "kept", "createdAt": 1, "updatedAt": 1 }\n}\n';
    const copy = `---\ntitle: Copy\nid: ${shared}\n---\n# Copy\n`;
    const state = seededState();
    state.vault.set("notes/copy.md", copy);
    state.vault.set(store, storeBytes);
    const server = await boot(state);

    const given = await runCliForTest({
      argv: ["vault", "new-id", "notes/copy.md", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(given.code).toBe(0);
    const { id } = z
      .strictObject({
        annotations: z.literal("copied"),
        id: z.uuid(),
        path: z.literal("notes/copy.md"),
      })
      .parse(JSON.parse(given.stdout));
    expect(state.vault.get("notes/copy.md")).toBe(copy.replace(shared, id));
    expect(state.vault.get(`.inteligir/annotations/${id}.json`)).toBe(storeBytes);
    expect(state.vault.get(store)).toBe(storeBytes);

    state.vault.set("notes/twin.md", copy);
    state.concurrentWrite = { content: copy.replace(shared, "its-own"), path: "notes/twin.md" };
    const stale = await runCliForTest({
      argv: ["vault", "new-id", "notes/twin.md", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(stale.code).toBe(1);
    expect(stale.stdout).toBe("");
    expect(JSON.parse(stale.stderr)).toEqual({
      error: "CAS_MISMATCH",
      message: "notes/twin.md changed since it was read; nothing was written",
    });
    expect(state.vault.get("notes/twin.md")).toBe(copy.replace(shared, "its-own"));

    const plain = await runCliForTest({
      argv: ["vault", "new-id", "notes/hello.md"],
      baseUrl: server.baseUrl,
    });
    expect(plain.code).toBe(1);
    expect(plain.stderr).toContain("No id to replace in notes/hello.md");
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

  it("shows what a pending approval would allow", async () => {
    const state = seededState();
    state.threads.push({
      pendingInteractions: [
        makeInteraction({ id: "int_cmd", payload: COMMAND_APPROVAL, threadId: "thr_1" }),
      ],
      thread: makeThread({ id: "thr_1", status: "active" }),
      timeline: EMPTY_TIMELINE,
    });
    const server = await boot(state);
    const show = await runCliForTest({
      argv: ["action", "show", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(show.stdout).toBe(
      [
        "Thread thr_1 — active",
        "Pending interactions:",
        "  int_cmd  thr_1  pending",
        "    $ npm install (in /fixture/vault) — installs the dependencies",
        "    answer: allow_once, allow_for_session, deny",
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

  it("stops a running action, and says so when there is nothing to stop", async () => {
    const state = seededState();
    state.threads.push(
      {
        pendingInteractions: [],
        thread: makeThread({ activeTurnId: "turn_1", id: "thr_1", status: "active" }),
        timeline: SHOW_TIMELINE,
      },
      { pendingInteractions: [], thread: makeThread({ id: "thr_2" }), timeline: EMPTY_TIMELINE },
    );
    const server = await boot(state);
    const stop = await runCliForTest({
      argv: ["action", "stop", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(stop.code).toBe(0);
    expect(stop.stdout).toBe("✔ Stopping thr_1\n");

    const idle = await runCliForTest({
      argv: ["action", "stop", "thr_2", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(JSON.parse(idle.stdout)).toMatchObject({ stop: "not-running", thread: { id: "thr_2" } });

    const missing = await runCliForTest({
      argv: ["action", "stop", "thr_missing"],
      baseUrl: server.baseUrl,
    });
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
  });

  it("lists what each turn changed, oldest first, and says so when none did", async () => {
    const state = seededState();
    const turnChanges: TurnChanges[] = [
      { paths: ["notes/a.md", "notes/[b].md"], state: "undone", turnId: "turn_1" },
      { paths: ["notes/a.md"], state: "applied", turnId: "turn_2" },
    ];
    state.threads.push(
      {
        pendingInteractions: [],
        thread: makeThread({ id: "thr_1" }),
        timeline: EMPTY_TIMELINE,
        turnChanges,
      },
      { pendingInteractions: [], thread: makeThread({ id: "thr_2" }), timeline: EMPTY_TIMELINE },
    );
    const server = await boot(state);

    const listed = await runCliForTest({
      argv: ["action", "changes", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(listed.code).toBe(0);
    expect(listed.stdout).toBe(
      [
        "turn_1  undone",
        "  notes/a.md",
        "  notes/[b].md",
        "turn_2  applied",
        "  notes/a.md",
        "",
      ].join("\n"),
    );

    const json = await runCliForTest({
      argv: ["action", "changes", "thr_1", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(JSON.parse(json.stdout)).toEqual({ turns: turnChanges });

    const none = await runCliForTest({
      argv: ["action", "changes", "thr_2"],
      baseUrl: server.baseUrl,
    });
    expect(none.code).toBe(0);
    expect(none.stdout).toBe("ℹ No turn of thr_2 changed the vault.\n");

    const missing = await runCliForTest({
      argv: ["action", "changes", "thr_missing"],
      baseUrl: server.baseUrl,
    });
    expect(missing.code).toBe(1);
  });

  it("undoes the newest applied turn unless told which, naming each kept note's reason", async () => {
    const state = seededState();
    state.threads.push(
      {
        pendingInteractions: [],
        thread: makeThread({ id: "thr_1" }),
        timeline: EMPTY_TIMELINE,
        turnChanges: [
          { paths: ["notes/a.md"], state: "applied", turnId: "turn_1" },
          { paths: ["notes/a.md", "notes/b.md"], state: "applied", turnId: "turn_2" },
          { paths: ["notes/c.md"], state: "undone", turnId: "turn_3" },
        ],
        turnUndo: {
          kept: [{ path: "notes/b.md", reason: "edited-since" }],
          reverted: ["notes/a.md"],
        },
      },
      {
        pendingInteractions: [],
        thread: makeThread({ id: "thr_2" }),
        timeline: EMPTY_TIMELINE,
        turnChanges: [{ paths: ["notes/d.md"], state: "applied", turnId: "turn_4" }],
      },
    );
    const server = await boot(state);

    const newest = await runCliForTest({
      argv: ["action", "undo", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(newest.code).toBe(0);
    expect(newest.stdout).toBe(
      [
        "reverted  notes/a.md",
        "kept      notes/b.md  (edited since the turn, where the turn changed it)",
        "",
      ].join("\n"),
    );
    expect(newest.stderr).toContain("Undid what it could of turn turn_2");
    expect(state.threads[0]?.turnChanges?.map((turn) => turn.state)).toEqual([
      "applied",
      "undone",
      "undone",
    ]);

    const again = await runCliForTest({
      argv: ["action", "undo", "thr_1", "--turn", "turn_2"],
      baseUrl: server.baseUrl,
    });
    expect(again.code).toBe(1);
    expect(again.stdout).toBe("");

    const json = await runCliForTest({
      argv: ["action", "undo", "thr_2", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(JSON.parse(json.stdout)).toEqual({
      kept: [],
      reverted: ["notes/d.md"],
      turnId: "turn_4",
    });

    const nothingLeft = await runCliForTest({
      argv: ["action", "undo", "thr_2"],
      baseUrl: server.baseUrl,
    });
    expect(nothingLeft.code).toBe(1);
    expect(nothingLeft.stderr).toContain("No turn of thr_2 has changes left to undo.");
  });

  it("says a turn whose every note was kept is still the one to undo, and how to reach past it", async () => {
    const state = seededState();
    state.threads.push({
      pendingInteractions: [],
      thread: makeThread({ id: "thr_1" }),
      timeline: EMPTY_TIMELINE,
      turnChanges: [
        { paths: ["notes/a.md"], state: "applied", turnId: "turn_1" },
        { paths: ["notes/b.md"], state: "applied", turnId: "turn_2" },
      ],
      turnUndo: { kept: [{ path: "notes/b.md", reason: "edited-since" }], reverted: [] },
    });
    const server = await boot(state);

    const result = await runCliForTest({
      argv: ["action", "undo", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      "kept      notes/b.md  (edited since the turn, where the turn changed it)\n",
    );
    expect(result.stderr).toContain(
      "Nothing of turn turn_2 could be undone; it stays the newest turn to undo, so pass --turn to undo an earlier one.",
    );
    expect(result.stderr).not.toContain("Undid what it could");
    expect(state.threads[0]?.turnChanges?.map((turn) => turn.state)).toEqual([
      "applied",
      "applied",
    ]);
  });
});

describe("interactions commands", () => {
  it("lists across threads and answers by scanning for the owner", async () => {
    const state = seededState();
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
      thread: makeThread({ id: "thr_1", status: "active" }),
      timeline: SHOW_TIMELINE,
    });
    const server = await boot(state);

    const list = await runCliForTest({
      argv: ["interactions", "list"],
      baseUrl: server.baseUrl,
    });
    expect(list.stdout).toBe("int_1  thr_1  pending\n  (no details)\n");

    const answer = await runCliForTest({
      argv: ["interactions", "answer", "int_1", "allow_once"],
      baseUrl: server.baseUrl,
    });
    expect(answer.code).toBe(0);
    expect(answer.stdout).toBe("✔ Interaction int_1 resolved\n");
  });

  it("says what each approval would allow, and the answers it takes, before anyone answers", async () => {
    const state = seededState();
    state.threads.push({
      pendingInteractions: [
        makeInteraction({ id: "int_cmd", payload: COMMAND_APPROVAL, threadId: "thr_1" }),
        makeInteraction({ id: "int_file", payload: FILE_APPROVAL, threadId: "thr_1" }),
      ],
      thread: makeThread({ id: "thr_1", status: "active" }),
      timeline: EMPTY_TIMELINE,
    });
    const server = await boot(state);
    const list = await runCliForTest({
      argv: ["interactions", "list"],
      baseUrl: server.baseUrl,
    });
    expect(list.stdout).toBe(
      [
        "int_cmd  thr_1  pending",
        "  $ npm install (in /fixture/vault) — installs the dependencies",
        "  answer: allow_once, allow_for_session, deny",
        "int_file  thr_1  pending",
        "  write unscoped",
        "  answer: allow_once, deny",
        "",
      ].join("\n"),
    );
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
      "Agent: acp",
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

  it("names where an unset data dir derives from, installed or in a checkout", async () => {
    const server = await boot(seededState());
    const installed = await runCliForTest({
      argv: ["--help"],
      baseUrl: server.baseUrl,
      env: { NODE_ENV: "production" },
    });
    expect(installed.stdout).toContain("INTELIGIR_DATA_DIR: (unset — derived under ~/.inteligir)");

    const checkout = await runCliForTest({ argv: ["--help"], baseUrl: server.baseUrl });
    expect(checkout.stdout).toContain("INTELIGIR_DATA_DIR: (unset — derived from this checkout)");
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

  it("hands out no link from a server with no UI, saying why, and NOT_FOUND under --json", async () => {
    const state = seededState();
    state.servesUi = false;
    const server = await boot(state);
    const browser = recordingOpener(true);
    const human = await runCliForTest({
      argv: ["open"],
      baseUrl: server.baseUrl,
      openExternalUrl: browser.openExternalUrl,
    });
    expect(human.code).toBe(1);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("serves no UI");
    expect(browser.opened).toEqual([]);

    const json = await runCliForTest({ argv: ["open", "--json"], baseUrl: server.baseUrl });
    expect(json.code).toBe(1);
    expect(json.stdout).toBe("");
    expect(JSON.parse(json.stderr)).toEqual({
      error: "NOT_FOUND",
      message: "This server serves no UI (an unbuilt checkout).",
    });
  });
});

const sourcesOn = (state: FixtureState) =>
  (state.annotations.get("notes/hello.md") ?? []).flatMap((annotation) => [
    annotation.root.source,
    ...annotation.replies.map((reply) => reply.entry.source),
  ]);

const annotationsOutputSchema = z.looseObject({
  annotations: z.array(z.looseObject({ id: z.string(), quote: z.string().nullable() })),
});

const idOfQuote = (stdout: string, quote: string): string => {
  const found = annotationsOutputSchema
    .parse(JSON.parse(stdout))
    .annotations.find((annotation) => annotation.quote === quote);
  if (found === undefined) {
    throw new Error(`no annotation quotes "${quote}"`);
  }
  return found.id;
};

describe("annotation verbs sign their entries", () => {
  it("signs `agent` inside an agent shell and leaves a plain one to the server's `user`", async () => {
    const state = seededState();
    const server = await boot(state);

    const fromAgent = await runCliForTest({
      argv: ["annotation", "add", "notes/hello.md", "Hello", "--note", "Needs a second pass"],
      baseUrl: server.baseUrl,
      env: { INTELIGIR_THREAD_ID: "thr_ctx" },
    });
    expect(fromAgent.code).toBe(0);
    const fromShell = await runCliForTest({
      argv: ["annotation", "add", "notes/hello.md", "Body", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(fromShell.code).toBe(0);
    const rootId = idOfQuote(fromShell.stdout, "Body");

    const replied = await runCliForTest({
      argv: ["annotation", "reply", "notes/hello.md", rootId, "and again"],
      baseUrl: server.baseUrl,
      env: { INTELIGIR_THREAD_ID: "thr_ctx" },
    });
    expect(replied.stdout).toBe(`Replied to ${rootId}\n`);

    expect(sourcesOn(state)).toEqual(["agent", "user", "agent"]);
  });

  it("refuses --source, which an entry's author is never asked for", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["annotation", "add", "notes/hello.md", "Hello", "--source", "user"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(sourcesOn(state)).toEqual([]);
  });
});

describe("annotation add, edit and remove", () => {
  it("highlights the passage, starts with no note, and takes the note through edit", async () => {
    const state = seededState();
    const server = await boot(state);

    const added = await runCliForTest({
      argv: ["annotation", "add", "notes/hello.md", "Hello"],
      baseUrl: server.baseUrl,
    });
    const [annotation] = state.annotations.get("notes/hello.md") ?? [];
    const id = annotation?.id ?? "";
    expect(added.stdout).toBe(`Highlighted "Hello" in notes/hello.md (${id})\n`);
    expect(annotation?.state).toBe("anchored");
    expect(annotation?.root.quote).toBe("Hello");
    expect(annotation?.root.text).toBe("");

    const listed = await runCliForTest({
      argv: ["annotation", "list", "notes/hello.md"],
      baseUrl: server.baseUrl,
    });
    expect(listed.stdout).toBe(`${id}\tanchored\t"Hello"\t\n`);

    const edited = await runCliForTest({
      argv: ["annotation", "edit", "notes/hello.md", id, "Say it louder"],
      baseUrl: server.baseUrl,
    });
    expect(edited.stdout).toBe(`Updated ${id}\n`);
    expect(state.annotations.get("notes/hello.md")?.[0]?.root.text).toBe("Say it louder");

    const removed = await runCliForTest({
      argv: ["annotation", "remove", "notes/hello.md", id],
      baseUrl: server.baseUrl,
    });
    expect(removed.stdout).toBe(`Removed highlight ${id}\n`);
    expect(state.annotations.get("notes/hello.md")).toEqual([]);
  });

  it("refuses a passage the text does not hold, and an occurrence below 1 before dialing", async () => {
    const state = seededState();
    const server = await boot(state);
    const absent = await runCliForTest({
      argv: ["annotation", "add", "notes/hello.md", "Goodbye", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(absent.code).toBe(1);
    expect(JSON.parse(absent.stderr)).toMatchObject({ error: "BAD_REQUEST" });

    const zeroth = await runCliForTest({
      argv: ["annotation", "add", "notes/hello.md", "Hello", "--occurrence", "0", "--json"],
      baseUrl: null,
    });
    expect(JSON.parse(zeroth.stderr)).toMatchObject({ error: "INVALID_USAGE" });
    expect(state.annotations.get("notes/hello.md") ?? []).toEqual([]);
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

  it("refuses a flag written before the command's name, which the leaf would never read", async () => {
    const server = await boot(seededState());
    const leading = await runCliForTest({
      argv: ["--json", "vault", "read", "notes/hello.md"],
      baseUrl: server.baseUrl,
    });
    expect(leading.code).toBe(1);
    expect(leading.stdout).toBe("");
    expect(JSON.parse(leading.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "put flags after the command's name: inteligir <command> … --flag",
    });

    const between = await runCliForTest({
      argv: ["action", "--running", "list"],
      baseUrl: server.baseUrl,
    });
    expect(between.code).toBe(1);
    expect(between.stdout).toBe("");
    expect(between.stderr).toContain("put flags after the command's name");
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

  it("refuses a harness id no harness has, naming the ones there are", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["agents", "default", "gemini", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: 'No harness is called "gemini"; pass one of claude, codex.',
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

  it("checks only the words before `--`, so a dash-led name after it is an operand", async () => {
    const state = seededState();
    state.vault.set("-draft.md", "# Draft\n");
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["vault", "read", "--", "-draft.md"],
      baseUrl: server.baseUrl,
    });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("# Draft\n");
  });

  it("counts every word after `--` as an operand, so one past the leaf's arity is refused", async () => {
    const state = seededState();
    state.vault.set("a.md", "# A\n");
    state.vault.set("b.md", "# B\n");
    const server = await boot(state);
    for (const operands of [
      ["a.md", "--", "b.md"],
      ["--", "a.md", "b.md"],
    ]) {
      const result = await runCliForTest({
        argv: ["vault", "read", "--json", ...operands],
        baseUrl: server.baseUrl,
      });
      expect(result.code, operands.join(" ")).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        error: "INVALID_USAGE",
        message: "unexpected argument: b.md — quote a value that contains spaces",
      });
    }
  });

  it("refuses a connectors verb as an unknown command: Settings owns connectors", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["connectors", "list", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "Unknown command connectors",
    });
  });

  it("hands a dash-led value to the flag that takes one", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["vault", "write", "notes/dash.md", "--content", "-x", "--overwrite"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(state.vault.get("notes/dash.md")).toBe("-x");
  });
});

describe("a leaf refuses bad usage before it resolves a server", () => {
  it("items checks its --limit, --kind, --since and tag filters first", async () => {
    for (const argv of [
      ["items", "--limit", "0"],
      ["items", "--kind", "link,tweet"],
      ["items", "--since", "last week"],
      ["items", "--tag", "project", "--untagged"],
    ]) {
      const result = await runCliForTest({ argv: [...argv, "--json"], baseUrl: null });
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ error: "INVALID_USAGE" });
    }
  });

  it("vault write checks its guard first: none, a malformed hash, and two at once", async () => {
    for (const guard of [
      [],
      ["--expected-hash", "ABC123"],
      ["--if-absent", "--expected-hash", "0".repeat(64)],
      ["--overwrite", "--if-absent"],
    ]) {
      const result = await runCliForTest({
        argv: ["vault", "write", "notes/x.md", "--content", "x", ...guard, "--json"],
        baseUrl: null,
      });
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ error: "INVALID_USAGE" });
    }
  });

  it("vault remote refuses a url git would read as a command, an option or a path before any request", async () => {
    // vitest types its asymmetric matchers `any`; naming one keeps the assertion typed.
    const grammarRefusal: unknown = expect.stringMatching(/^the remote URL /u);
    for (const operand of [["ext::sh"], ["--", "--upload-pack=x"], ["/plain/local/path"]]) {
      const result = await runCliForTest({
        argv: ["vault", "remote", "--json", ...operand],
        baseUrl: null,
      });
      expect(result.code, operand.join(" ")).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: "INVALID_USAGE",
        message: grammarRefusal,
      });
    }
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
      argv: ["vault", "write", "notes/bytes.md", "--if-absent"],
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
      argv: ["vault", "write", "notes/bad.md", "--if-absent"],
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
      argv: ["vault", "write", "notes/big.md", "--if-absent"],
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
      argv: ["vault", "write", "notes/tty.md", "--if-absent"],
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
      argv: ["vault", "write", "notes/hello.md", "--overwrite"],
      baseUrl: server.baseUrl,
      stdin: new Uint8Array(),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("stdin carried no content");
    expect(state.vault.get("notes/hello.md")).toBe("# Hello\n\nBody.\n");

    const emptied = await runCliForTest({
      argv: ["vault", "write", "notes/hello.md", "--content", "", "--overwrite"],
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

describe("interactions answer validates the decision locally", () => {
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
          decision: null,
          requestKey: "req_a",
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

  it("refuses a word that names no decision, before asking the server", async () => {
    const result = await runCliForTest({
      argv: ["interactions", "answer", "int_a", "allow_always", "--json"],
      baseUrl: null,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "INVALID_USAGE" });
    expect(result.stderr).toContain("allow_once, allow_for_session, deny");
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

describe("cloud status", () => {
  it("says how many events never reached the cloud", async () => {
    const state = seededState();
    state.cloud = {
      accountEmail: "owner@example.test",
      cloudUrl: "https://cloud.test",
      connected: true,
      cursor: 4,
      deviceId: "dev_1",
      dropped: 2,
      lastError: null,
      lastSyncedAt: null,
      pending: 0,
      state: "signed-in",
    };
    const server = await boot(state);
    const result = await runCliForTest({ argv: ["cloud", "status"], baseUrl: server.baseUrl });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("2 events never reached the cloud");
  });

  it("sends a device its sign-out could not remove to the devices page", async () => {
    const state = seededState();
    state.cloud = {
      cloudUrl: "https://cloud.test",
      revokeError: "Could not reach the cloud: HTTP 503",
      state: "signed-out",
    };
    const server = await boot(state);
    const result = await runCliForTest({ argv: ["cloud", "status"], baseUrl: server.baseUrl });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("HTTP 503");
    expect(result.stdout).toContain("https://cloud.test/app/devices");
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

const LINK_PATH = "Reading/File over app.md";
const LINK_URL = "https://example.test/file-over-app";

const libraryState = (): FixtureState => {
  const state = seededState();
  state.items = [
    makeItemRow(LINK_PATH, {
      host: "example.test",
      kind: "link",
      saved: "2026-10-16T08:00:00Z",
      site: "Example",
      tags: ["essay", "project"],
      url: LINK_URL,
    }),
    makeItemRow("notes/hello.md", { saved: null }),
  ];
  return state;
};

const saveOutputSchema = z.looseObject({ outcome: z.string(), path: z.string() });

describe("save", () => {
  it("saves a link as a pending stub, and answers an exact path for a link it holds", async () => {
    const state = libraryState();
    const server = await boot(state);
    const created = await runCliForTest({
      argv: ["save", "https://example.test/new?utm_source=feed", "--tags", "later,ideas"],
      baseUrl: server.baseUrl,
    });
    expect(created.stdout).toBe(
      "Saved Unsorted/example.test - new.md; its page is still being read\n",
    );
    expect(state.items.at(-1)).toMatchObject({
      pending: true,
      tags: ["later", "ideas"],
      url: "https://example.test/new",
    });

    const again = await runCliForTest({
      argv: ["save", `${LINK_URL}?utm_source=feed`, "--json"],
      baseUrl: server.baseUrl,
    });
    expect(saveOutputSchema.parse(JSON.parse(again.stdout))).toMatchObject({
      outcome: "exists",
      path: LINK_PATH,
    });
    const human = await runCliForTest({ argv: ["save", LINK_URL], baseUrl: server.baseUrl });
    expect(human.stdout).toBe(`Already saved: ${LINK_PATH}\n`);
  });

  it("says why a page could not be read, and saves into the folder named", async () => {
    const state = libraryState();
    const [link] = state.items;
    if (link !== undefined) {
      link.fetchError = "The site answered 404.";
      link.fetched = "2026-10-16T08:00:01Z";
    }
    const server = await boot(state);
    const failed = await runCliForTest({
      argv: ["item", "refresh", LINK_PATH],
      baseUrl: server.baseUrl,
    });
    expect(failed.stdout).toBe(
      `Refreshed ${LINK_PATH}, but its page couldn't be read: The site answered 404.\n`,
    );

    const filed = await runCliForTest({
      argv: ["save", "https://example.test/elsewhere", "--folder", "Reading", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(saveOutputSchema.parse(JSON.parse(filed.stdout)).path).toBe(
      "Reading/example.test - elsewhere.md",
    );
  });

  it("saves a file on this Mac as a file item, and refuses the flags a file cannot take", async () => {
    const state = libraryState();
    const server = await boot(state);
    const saved = await runCliForTest({
      argv: ["save", FIXTURE_FILE_PATH],
      baseUrl: server.baseUrl,
    });
    expect(saved.stdout).toBe("Saved Unsorted/brochure.md\n");
    expect(state.items.at(-1)).toMatchObject({ file: "assets/brochure.pdf", kind: "pdf" });

    for (const flags of [["--copy"], ["--html", FIXTURE_PAGE_PATH]]) {
      const refused = await runCliForTest({
        argv: ["save", FIXTURE_FILE_PATH, ...flags, "--json"],
        baseUrl: null,
      });
      expect(JSON.parse(refused.stderr)).toMatchObject({ error: "INVALID_USAGE" });
    }
  });

  it("refuses a file over 10 MB and a target that is neither a link nor a file, before dialing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "inteligir-save-"));
    onTestFinished(async () => {
      await rm(dir, { force: true, recursive: true });
    });
    const big = path.join(dir, "film.mov");
    await writeFile(big, "");
    await truncate(big, 11 * 1024 * 1024);
    const tooLarge = await runCliForTest({ argv: ["save", big, "--json"], baseUrl: null });
    expect(JSON.parse(tooLarge.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: fileTooLargeMessage("film.mov", 11 * 1024 * 1024),
    });

    const neither = await runCliForTest({ argv: ["save", "not a link", "--json"], baseUrl: null });
    expect(JSON.parse(neither.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "not a link is not a web link or a file on this Mac",
    });
  });

  it("hands over the page's HTML instead of fetching it", async () => {
    const state = libraryState();
    const server = await boot(state);
    const saved = await runCliForTest({
      argv: ["save", "https://example.test/given", "--html", FIXTURE_PAGE_PATH],
      baseUrl: server.baseUrl,
    });
    expect(saved.code).toBe(0);
    expect(state.items.at(-1)?.url).toBe("https://example.test/given");
  });

  it("saves every web link on stdin in order, and refuses a line that is not one", async () => {
    const state = libraryState();
    const server = await boot(state);
    const saved = await runCliForTest({
      argv: ["save", "-", "--json"],
      baseUrl: server.baseUrl,
      stdin: new TextEncoder().encode(`https://example.test/one\n\n${LINK_URL}\n`),
    });
    expect(
      saveStdinOutputSchema.parse(JSON.parse(saved.stdout)).results.map((row) => row.outcome),
    ).toEqual(["created", "exists"]);

    const refused = await runCliForTest({
      argv: ["save", "-", "--json"],
      baseUrl: null,
      stdin: new TextEncoder().encode("https://example.test/two\nnot a link\n"),
    });
    expect(JSON.parse(refused.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "line 2 of stdin is not a web link",
    });
    const empty = await runCliForTest({
      argv: ["save", "-", "--json"],
      baseUrl: null,
      stdin: new TextEncoder().encode("\n\n"),
    });
    expect(JSON.parse(empty.stderr)).toMatchObject({ message: "stdin holds no web link" });
    const html = await runCliForTest({
      argv: ["save", "-", "--html", FIXTURE_PAGE_PATH, "--json"],
      baseUrl: null,
    });
    expect(JSON.parse(html.stderr)).toMatchObject({ error: "INVALID_USAGE" });
  });
});

describe("items and item", () => {
  it("lists one tab-separated line per item, and names the next page when cut", async () => {
    const server = await boot(libraryState());
    const listed = await runCliForTest({ argv: ["items"], baseUrl: server.baseUrl });
    expect(listed.stdout).toBe(
      `${LINK_PATH}\tlink\t2026-10-16\tExample\t#essay #project\nnotes/hello.md\tnote\t-\t-\t\n`,
    );

    const page = await runCliForTest({ argv: ["items", "--limit", "1"], baseUrl: server.baseUrl });
    expect(page.stdout).toBe(
      `${LINK_PATH}\tlink\t2026-10-16\tExample\t#essay #project\n(1 of 2; more: --offset 1)\n`,
    );

    const links = await runCliForTest({
      argv: ["items", "--kind", "note", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(JSON.parse(links.stdout)).toMatchObject({
      items: [{ path: "notes/hello.md" }],
      total: 1,
    });
  });

  it("shows an item's facts, and refuses a path that is not one", async () => {
    const server = await boot(libraryState());
    const shown = await runCliForTest({
      argv: ["item", "show", LINK_PATH],
      baseUrl: server.baseUrl,
    });
    expect(shown.stdout).toBe(
      [
        "kind: link",
        `url: ${LINK_URL}`,
        "site: Example",
        "saved: 2026-10-16T08:00:00Z",
        "folder: Reading",
        "tags: #essay #project",
        "",
      ].join("\n"),
    );
    const json = await runCliForTest({
      argv: ["item", "show", LINK_PATH, "--json"],
      baseUrl: server.baseUrl,
    });
    expect(itemShowOutputSchema.parse(JSON.parse(json.stdout)).item.url).toBe(LINK_URL);

    const missing = await runCliForTest({
      argv: ["item", "show", "notes/nowhere.md", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(JSON.parse(missing.stderr)).toEqual({
      error: "NOT_FOUND",
      message: "notes/nowhere.md is not an item",
    });
  });

  it("finds where a link is saved, says when it is not, and refuses what is not a web link", async () => {
    const server = await boot(libraryState());
    const found = await runCliForTest({
      argv: ["item", "find", `https://www.example.test/file-over-app?utm_campaign=x`],
      baseUrl: server.baseUrl,
    });
    expect(found.stdout).toBe(`${LINK_PATH}\n`);
    const absent = await runCliForTest({
      argv: ["item", "find", "https://example.test/never"],
      baseUrl: server.baseUrl,
    });
    expect(absent.stdout).toContain("Not saved yet");
    const notWeb = await runCliForTest({
      argv: ["item", "find", "ftp://example.test/x", "--json"],
      baseUrl: null,
    });
    expect(JSON.parse(notWeb.stderr)).toMatchObject({ error: "INVALID_USAGE" });
  });
});

describe("tag add and remove", () => {
  it("tags and untags one item, and says when there was nothing to do", async () => {
    const state = libraryState();
    const server = await boot(state);
    const added = await runCliForTest({
      argv: ["tag", "add", "later", LINK_PATH],
      baseUrl: server.baseUrl,
    });
    expect(added.stdout).toBe(`Tagged ${LINK_PATH} #later\n`);
    const again = await runCliForTest({
      argv: ["tag", "add", "later", LINK_PATH, "--json"],
      baseUrl: server.baseUrl,
    });
    expect(tagChangeOutputSchema.parse(JSON.parse(again.stdout))).toEqual({
      inline: [],
      outcome: "unchanged",
      path: LINK_PATH,
    });

    const removed = await runCliForTest({
      argv: ["tag", "remove", "essay", LINK_PATH],
      baseUrl: server.baseUrl,
    });
    expect(removed.stdout).toBe(`Removed #essay from ${LINK_PATH}\n`);
    expect(state.items[0]?.tags).toEqual(["project", "later"]);
  });

  it("refuses an item that is not there", async () => {
    const server = await boot(libraryState());
    const missing = await runCliForTest({
      argv: ["tag", "add", "later", "notes/nowhere.md", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(JSON.parse(missing.stderr)).toEqual({
      error: "NOT_FOUND",
      message: "notes/nowhere.md is not an item",
    });
  });
});

const RAINDROP_PLAN = {
  alreadySaved: 96,
  droppedTags: [],
  duplicates: 0,
  estimatedBytes: 8416 * 65_536,
  folderCount: 34,
  folders: ["Reading"],
  highlights: 1240,
  items: 8416,
  planId: "plan_raindrop",
  skipped: [],
  skippedCount: 0,
  tags: 210,
};

describe("import", () => {
  it("prints the plan on a dry run and imports nothing", async () => {
    const state = libraryState();
    state.imports.plan = RAINDROP_PLAN;
    const server = await boot(state);
    const dry = await runCliForTest({
      argv: ["import", "raindrop", FIXTURE_RAINDROP_PATH, "--dry-run"],
      baseUrl: server.baseUrl,
    });
    expect(dry.stdout).toBe(
      "8,416 links in 34 folders, with 210 tags and 1,240 highlights. 96 are already in your library and stay as they are.\n",
    );
    expect(state.imports.job).toBeNull();
  });

  it("runs the import, follows it to its end, and says what it added", async () => {
    const state = libraryState();
    state.imports.plan = RAINDROP_PLAN;
    const server = await boot(state);
    const run = await runCliForTest({
      argv: ["import", "raindrop", FIXTURE_RAINDROP_PATH],
      baseUrl: server.baseUrl,
    });
    expect(run.stdout.split("\n").at(-2)).toBe(
      "Imported 8,416 items from Raindrop (96 already saved)",
    );
    expect(run.stderr).toContain("Imported 8,416 of 8,416");

    const status = await runCliForTest({ argv: ["import", "status"], baseUrl: server.baseUrl });
    expect(status.stdout).toBe("Imported 8,416 items from Raindrop (96 already saved)\n");
  });

  it("refuses a file that is not a Raindrop export in the server's class", async () => {
    const server = await boot(libraryState());
    const refused = await runCliForTest({
      argv: ["import", "raindrop", FIXTURE_RAINDROP_PATH, "--json"],
      baseUrl: server.baseUrl,
    });
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stderr)).toMatchObject({ error: "IMPORT_UNREADABLE" });
  });

  it("stops a running import, and says so when none is running", async () => {
    const state = libraryState();
    const server = await boot(state);
    const none = await runCliForTest({
      argv: ["import", "cancel", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(importCancelOutputSchema.parse(JSON.parse(none.stdout))).toEqual({ job: null });

    state.imports.job = {
      added: 1200,
      alreadySaved: 0,
      finishedAt: null,
      highlights: 0,
      id: "import_1",
      message: null,
      source: "raindrop",
      startedAt: 1_700_000_000_000,
      state: "running",
      total: 8512,
    };
    const stopped = await runCliForTest({ argv: ["import", "cancel"], baseUrl: server.baseUrl });
    expect(stopped.stdout).toBe("Stopped the import\n");
    expect(state.imports.job.state).toBe("cancelled");
  });
});

describe("action new with a preset", () => {
  it("sends the preset with an empty prompt, and refuses neither a prompt nor a preset", async () => {
    const state = seededState();
    const server = await boot(state);
    const tidy = await runCliForTest({
      argv: ["action", "new", "--preset", "tidy-library"],
      baseUrl: server.baseUrl,
    });
    expect(tidy.stderr).toBe("");
    expect(state.sent).toEqual([{ preset: "tidy-library", text: "", threadId: "thr_created_1" }]);

    const neither = await runCliForTest({ argv: ["action", "new", "--json"], baseUrl: null });
    expect(JSON.parse(neither.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "give a prompt or --preset",
    });
  });
});
