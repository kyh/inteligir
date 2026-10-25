// every verb against the real composition, over the transport the binary uses (the booted
// server's server.json and its bearer). What a case reads back, the server produced: the seeds go
// in through its own services, the git history is the vault's own, and the action rows come from
// the booted suites' provider through the same ingest a real one reports into.

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importsJobResponseSchema } from "@repo/contract/local/imports/imports-schema";
import { fileTooLargeMessage } from "@repo/contract/local/items/items-schema";
import { BROWSER_HANDOFF_PARAM, browserHandoffUrl } from "@repo/contract/local/routes";
import { DEVICE_API_PATHS } from "@repo/contract/cloud/device/device-schema";
import {
  VAULT_MAX_CONTENT_LENGTH,
  contentHashHex,
  vaultDeletedResponseSchema,
} from "@repo/contract/local/vault/vault-schema";
import { createPendingInteraction } from "@repo/db/pending-interactions";
import type { CreatePendingInteractionInput } from "@repo/db/pending-interactions";
import { ACTION_PRESET_LABELS } from "@repo/domain/action-preset";
import type { ApprovalPendingInteractionPayload } from "@repo/domain/pending-interactions";
import type { ThreadEventItem, ThreadEventItemStatus } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { importCancelOutputSchema } from "./commands/import";
import { itemShowOutputSchema } from "./commands/item";
import { saveStdinOutputSchema } from "./commands/save";
import { tagChangeOutputSchema } from "./commands/tag";
import { agentMessageEvents } from "./server/agents/agent-message-events";
import {
  awaitThreadStatus,
  createThread,
  sendMessage,
} from "./server/agents/test-support/agent-test-harness";
import { fakeFetcher } from "./server/items/capture/test-support/capture-harness";
import {
  FAKE_ACCOUNT,
  FakeCloud,
  TEST_MACHINE_NAME,
  TEST_SERVER_VERSION,
  bootTestApp,
  bootThreadHarness,
  shareBoot,
} from "./server/test-support/boot-app";
import type {
  BootTestAppOptions,
  BootedTestApp,
  ThreadHarness,
} from "./server/test-support/boot-app";
import { makeBareRemote, makeEngine } from "./server/vault/test-support/git-fixtures";
import { agentTurn, cliOver, pageBundle } from "./test-support/booted-cli";
import type { CliOverServer } from "./test-support/booted-cli";
import { FIXTURE_FILE_PATH, FIXTURE_PAGE_PATH } from "./test-support/command-tree";
import { runCliForTest } from "./test-support/run-cli";

const BIN = path.resolve(import.meta.dirname, "..", "bin", "inteligir");

const RAINDROP = path.resolve(
  import.meta.dirname,
  "./server/imports/test-support/fixtures/raindrop-export.csv",
);

const boxedLines = (stdout: string): string[] =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith(" │"))
    .map((line) => line.replace(/^ │\s*/u, "").replace(/\s*│$/u, ""))
    .filter((line) => line.length > 0);

const HELLO = "# Hello\n\nBody.\n";

const boot = async (options: BootTestAppOptions = {}): Promise<CliOverServer<BootedTestApp>> =>
  await cliOver(await bootTestApp(options));

const bootActions = async (
  options: Omit<BootTestAppOptions, "makeDriver"> = {},
): Promise<CliOverServer<ThreadHarness>> =>
  await cliOver(await bootThreadHarness({ mode: "manual" }, options));

// the vault most cases read: a welcome note and one note under notes/
const seeded = async (options: BootTestAppOptions = {}): Promise<CliOverServer<BootedTestApp>> => {
  const over = await boot(options);
  await over.put({ "Welcome.md": "# Welcome\n", "notes/hello.md": HELLO });
  return over;
};

const sharedSeeded = () =>
  shareBoot(async (teardown) => {
    const over = await cliOver(await bootTestApp({ teardown }));
    await over.put({ "Welcome.md": "# Welcome\n", "notes/hello.md": HELLO });
    return over;
  });

// every revision a path holds in history, newest first, with the bytes it held
const revisionsOf = async (app: BootedTestApp, vaultPath: string) => {
  const revisions = await app.vault.git.history(vaultPath, { limit: 50, skip: 0 });
  return await Promise.all(
    revisions.map(async (revision) => {
      const { content } = await app.client.vault.revision({ path: vaultPath, sha: revision.sha });
      return { content, sha: revision.sha };
    }),
  );
};

const deletedSha = async (over: CliOverServer<BootedTestApp>, vaultPath: string) => {
  const listed = await over.cli(["vault", "deleted", "--json"]);
  const entry = vaultDeletedResponseSchema
    .parse(JSON.parse(listed.stdout))
    .entries.find((row) => row.path === vaultPath);
  if (entry === undefined) {
    throw new Error(`${vaultPath} is not in Deleted`);
  }
  return entry;
};

const COMMAND_APPROVAL: ApprovalPendingInteractionPayload = {
  availableDecisions: ["allow_once", "allow_for_session"],
  kind: "approval",
  reason: "installs the dependencies",
  subject: { command: "npm install", cwd: "/Users/me/Library", itemId: "cmd_1", kind: "command" },
};

let requests = 0;

const approve = (
  app: ThreadHarness,
  threadId: string,
  payload: ApprovalPendingInteractionPayload,
  turnId?: string,
): string => {
  requests += 1;
  const input: CreatePendingInteractionInput = {
    payload,
    requestKey: `req_${String(requests)}`,
    threadId,
  };
  if (turnId !== undefined) {
    input.turnId = turnId;
  }
  return createPendingInteraction(app.db, app.bus, input).id;
};

describe("vault commands", { timeout: 60_000 }, () => {
  const shared = sharedSeeded();

  it("lists the tree, dirs marked, and filters by dir", async () => {
    const { cli } = await seeded();
    const all = await cli(["vault", "list"]);
    expect(all.code).toBe(0);
    expect(all.stdout).toBe("notes/\nnotes/hello.md\nWelcome.md\n");

    const scoped = await cli(["vault", "list", "notes"]);
    expect(scoped.stdout).toBe("notes/\nnotes/hello.md\n");
  });

  it("refuses a folder that is not there rather than listing it as empty", async () => {
    const { cli } = shared();
    for (const dir of ["nots", "notes/hello.md"]) {
      const result = await cli(["vault", "list", dir, "--json"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        error: "NOT_FOUND",
        message: `No folder ${dir} in the vault`,
      });
    }
  });

  it("answers the hash of what it read under --json, the base a guarded write carries", async () => {
    const { cli } = shared();
    const read = await cli(["vault", "read", "notes/hello.md", "--json"]);
    expect(JSON.parse(read.stdout)).toEqual({
      content: HELLO,
      hash: await contentHashHex(HELLO),
      path: "notes/hello.md",
    });
  });

  it("writes over the bytes it read with --expected-hash, and refuses a file that moved", async () => {
    const { cli, onDisk, put } = shared();
    await put({ "notes/guarded.md": HELLO });
    const base = await contentHashHex(HELLO);
    const guarded = await cli([
      "vault",
      "write",
      "notes/guarded.md",
      "--content",
      "# Edited\n",
      "--expected-hash",
      base,
    ]);
    expect(guarded.code).toBe(0);
    expect(onDisk("notes/guarded.md")).toBe("# Edited\n");

    const stale = await cli([
      "vault",
      "write",
      "notes/guarded.md",
      "--content",
      "# Again\n",
      "--expected-hash",
      base,
      "--json",
    ]);
    expect(stale.code).toBe(1);
    expect(stale.stdout).toBe("");
    expect(JSON.parse(stale.stderr)).toEqual({
      error: "CAS_MISMATCH",
      message: "notes/guarded.md changed since the base this write was derived from",
    });
    expect(onDisk("notes/guarded.md")).toBe("# Edited\n");
  });

  it("creates with --if-absent, and refuses a path something already holds", async () => {
    const { cli, onDisk } = shared();
    const created = await cli([
      "vault",
      "write",
      "notes/fresh.md",
      "--content",
      "# Fresh\n",
      "--if-absent",
    ]);
    expect(created.code).toBe(0);
    expect(onDisk("notes/fresh.md")).toBe("# Fresh\n");

    const taken = await cli([
      "vault",
      "write",
      "notes/hello.md",
      "--content",
      "# Clobber\n",
      "--if-absent",
      "--json",
    ]);
    expect(taken.code).toBe(1);
    expect(JSON.parse(taken.stderr)).toEqual({
      error: "ALREADY_EXISTS",
      message: "A file already exists at notes/hello.md",
    });
    expect(onDisk("notes/hello.md")).toBe(HELLO);
  });

  it("reads a file byte-exactly and errors 1 on a miss", async () => {
    const { cli } = shared();
    const read = await cli(["vault", "read", "notes/hello.md"]);
    expect(read.code).toBe(0);
    expect(read.stdout).toBe(HELLO);

    const miss = await cli(["vault", "read", "nope.md"]);
    expect(miss.code).toBe(1);
    expect(miss.stderr).toBe("\n ERROR  No such vault entry: nope.md\n\n");
    expect(miss.stdout).toBe("");
  });

  it("writes via --content and reports the path", async () => {
    const { cli, onDisk } = shared();
    const write = await cli([
      "vault",
      "write",
      "notes/new.md",
      "--content",
      "# New\n",
      "--overwrite",
    ]);
    expect(write.code).toBe(0);
    expect(write.stdout).toBe("✔ Wrote notes/new.md\n");
    expect(onDisk("notes/new.md")).toBe("# New\n");
  });

  it("renames, deletes, mkdirs and renders sync status", async () => {
    const { cli, onDisk, put } = shared();
    await put({ "notes/moving.md": "# Moving\n" });
    const rename = await cli(["vault", "rename", "notes/moving.md", "notes/moved.md"]);
    expect(rename.stdout).toBe("✔ Renamed notes/moving.md -> notes/moved.md\n");
    expect(onDisk("notes/moving.md")).toBeNull();
    // the rename keeps the old name as an alias, so a link still spelling it resolves
    expect(onDisk("notes/moved.md")).toBe("---\naliases:\n  - moving\n---\n# Moving\n");

    const remove = await cli(["vault", "delete", "notes/moved.md"]);
    expect(remove.stdout).toBe("✔ Deleted notes/moved.md\n");
    expect(onDisk("notes/moved.md")).toBeNull();

    const mkdir = await cli(["vault", "mkdir", "projects"]);
    expect(mkdir.stdout).toBe("✔ Created projects/\n");

    const status = await cli(["vault", "status"]);
    expect(status.stdout).toBe("state: no-remote\nlast sync: never\n");

    const sync = await cli(["vault", "sync", "--json"]);
    expect(JSON.parse(sync.stdout)).toEqual({
      conflicts: [],
      device: TEST_MACHINE_NAME,
      externalSync: null,
      lastError: null,
      lastSyncAt: null,
      state: "no-remote",
      tooLarge: { count: 0, files: [] },
    });
  });

  it("says each note two devices changed at once in plain words, and --json names this device", async () => {
    const remote = await makeBareRemote();
    const over = await boot({
      remote: () => ({ accountId: "user_a", source: "account", url: remote }),
    });
    const { app, cli } = over;
    const base = { "Ideas.md": "# Ideas\n\nthe base\n", "notes/Plan.md": "# Plan\n\nthe base\n" };
    await over.put(base);
    await app.vault.git.commitNow();
    const first = await app.vault.git.syncNow();
    expect(first.state).toBe("clean");

    const other = await makeEngine({ device: "Kai's MacBook", remoteUrl: remote });
    const joined = await other.engine.syncNow();
    expect(joined.state).toBe("clean");
    await writeFile(path.join(other.root, "notes", "Plan.md"), "# Plan\n\nedited there\n");
    await writeFile(path.join(other.root, "Ideas.md"), "# Ideas\n\nedited there\n");
    await other.engine.commitNow();
    const pushed = await other.engine.syncNow();
    expect(pushed.state).toBe("clean");

    await over.put({ "notes/Plan.md": "# Plan\n\nedited here\n" });
    await app.client.vault.remove({ path: "Ideas.md" });
    await app.vault.git.commitNow();
    await app.vault.git.syncNow();

    const json = await cli(["vault", "status", "--json"]);
    expect(JSON.parse(json.stdout)).toMatchObject({
      conflicts: [
        {
          deletedDevice: TEST_MACHINE_NAME,
          keptDevice: "Kai's MacBook",
          kind: "kept-edit",
          path: "Ideas.md",
        },
        {
          copyDevice: "Kai's MacBook",
          copyPath: "notes/Plan (conflict, Kai's MacBook).md",
          keptDevice: TEST_MACHINE_NAME,
          kind: "copied",
          path: "notes/Plan.md",
        },
      ],
      device: TEST_MACHINE_NAME,
    });

    const status = await cli(["vault", "status"]);
    const [state, named, lastSync, ...said] = status.stdout.split("\n");
    expect([state, named]).toEqual(["state: clean", `remote: ${remote}`]);
    expect(lastSync).toMatch(/^last sync: \d{4}-\d\d-\d\dT/u);
    expect(said).toEqual([
      "“Ideas” was deleted here but edited on Kai's MacBook, so it was kept.",
      "Both versions of “Plan” were kept: yours stays, and the one from Kai's MacBook is in “Plan (conflict, Kai's MacBook)”.",
      "",
    ]);
  });

  it("vault remote prints where the vault syncs, and chooses a server of the user's own or the account", async () => {
    const { cli } = await seeded({ remote: "derived" });
    const signedOut =
      "no remote: the account's hosted vault, once this install signs in (`inteligir cloud login`)";
    const own = `file://${await makeBareRemote()}`;

    const current = await cli(["vault", "remote"]);
    expect(current.stdout).toBe(`${signedOut}\n`);

    const chosen = await cli(["vault", "remote", own]);
    expect(chosen.stdout).toBe(
      `✔ The vault syncs with a git server of your own, with this machine's git credentials.\n  ${own} (the vault's own git origin)\n`,
    );
    const json = await cli(["vault", "remote", own, "--json"]);
    expect(JSON.parse(json.stdout)).toMatchObject({ remote: own, remoteSource: "explicit" });

    const account = await cli(["vault", "remote", "account"]);
    expect(account.stdout).toBe(`  ${signedOut}\n`);
    expect(account.stderr).toContain(
      "Saved: the account's hosted vault is the choice; nothing syncs yet.",
    );

    const icloud = await seeded({
      remote: "derived",
      vaultPath: path.join("Library", "Mobile Documents", "com~apple~CloudDocs", "Notes"),
    });
    const synced = await icloud.cli(["vault", "remote", "account"]);
    expect(synced.stdout).toBe(
      "  no remote: iCloud Drive syncs this folder, so the hosted vault stays off\n",
    );
    expect(synced.stderr).toContain(
      "Saved: the account's hosted vault is the choice; nothing syncs yet.",
    );

    const pinned = await seeded({ pinnedRemote: own });
    const named = await pinned.cli(["vault", "remote"]);
    expect(named.stdout).toBe(`${own} (pinned by INTELIGIR_VAULT_REMOTE)\n`);
  });

  it("lists deleted docs, and restores one that is gone with an exclusive create", async () => {
    const over = await seeded();
    const { app, cli, onDisk } = over;
    await over.put({ "notes/gone.md": "# Gone\n" });
    await app.vault.git.commitNow();
    await app.client.vault.remove({ path: "notes/gone.md" });
    await app.vault.git.commitNow();

    const { deletedAt, sha } = await deletedSha(over, "notes/gone.md");
    const deleted = await cli(["vault", "deleted"]);
    expect(deleted.stdout).toBe(`${sha}\t${deletedAt}\tnotes/gone.md\n`);

    const restore = await cli(["vault", "restore", "notes/gone.md", sha]);
    expect(restore.stdout).toBe(`✔ Restored notes/gone.md to ${sha}\n`);
    expect(onDisk("notes/gone.md")).toBe("# Gone\n");

    const again = await cli(["vault", "deleted"]);
    expect(again.stdout).toContain("Nothing has been deleted.");
  });

  it("restores a note still there over a checkpoint, and refuses one that moved after the read", async () => {
    const over = await boot();
    const { app, cli, onDisk } = over;
    await over.put({ "notes/hello.md": "# Hello\n" });
    await app.vault.git.commitNow();
    const [{ sha } = { sha: "" }] = await revisionsOf(app, "notes/hello.md");
    // edited since, never committed: the restore's checkpoint is what keeps these bytes
    await over.put({ "notes/hello.md": HELLO });

    const restore = await cli(["vault", "restore", "notes/hello.md", sha, "--json"]);
    expect(restore.code).toBe(0);
    expect(JSON.parse(restore.stdout)).toEqual({ annotations: "none", path: "notes/hello.md" });
    expect(onDisk("notes/hello.md")).toBe("# Hello\n");
    const held = await revisionsOf(app, "notes/hello.md");
    expect(held.map((revision) => revision.content)).toContain(HELLO);

    over.landAfterNextRead("notes/hello.md", "# Concurrent\n");
    const stale = await cli(["vault", "restore", "notes/hello.md", sha, "--json"]);
    expect(stale.code).toBe(1);
    expect(stale.stdout).toBe("");
    expect(JSON.parse(stale.stderr)).toEqual({
      error: "CAS_MISMATCH",
      message: "notes/hello.md changed since the base this write was derived from",
    });
    expect(onDisk("notes/hello.md")).toBe("# Concurrent\n");
  });

  it("brings a deleted note's annotations back with it, and fails naming them when they cannot come back", async () => {
    const noteId = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
    const store = `.inteligir/annotations/${noteId}.json`;
    const over = await seeded();
    const { app, cli, onDisk } = over;
    await over.put({ "notes/gone.md": `---\nid: ${noteId}\n---\n# Gone\n` });
    await app.client.annotations.add({
      id: "c1",
      path: "notes/gone.md",
      quote: "Gone",
      text: "kept",
    });
    await app.vault.git.commitNow();
    const storeBytes = onDisk(store);
    expect(storeBytes).not.toBeNull();
    await app.client.vault.remove({ path: "notes/gone.md" });
    await app.vault.git.commitNow();
    const { sha } = await deletedSha(over, "notes/gone.md");

    const restore = await cli(["vault", "restore", "notes/gone.md", sha]);
    expect(restore.stdout).toBe(`✔ Restored notes/gone.md to ${sha}, with its annotations\n`);
    expect(onDisk(store)).toBe(storeBytes);

    await app.client.vault.remove({ path: "notes/gone.md" });
    rmSync(path.join(app.vaultDir, ".inteligir", "annotations"), { force: true, recursive: true });
    writeFileSync(
      path.join(app.vaultDir, ".inteligir", "annotations"),
      "a file where the store's folder goes\n",
    );
    const stranded = await cli(["vault", "restore", "notes/gone.md", sha, "--json"]);
    expect(stranded.code).toBe(1);
    expect(stranded.stdout).toBe("");
    expect(JSON.parse(stranded.stderr)).toEqual({
      error: "CONFLICT",
      message: `Restored notes/gone.md to ${sha}, but not its annotations: A file stands in the way of ${store}`,
    });
    expect(onDisk("notes/gone.md")).not.toBeNull();
    expect(onDisk(store)).toBeNull();
  });

  it("gives a copy its own id with a copy of its annotations, and refuses one that moved after the read", async () => {
    const sharedId = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
    const store = `.inteligir/annotations/${sharedId}.json`;
    const original = `---\ntitle: Original\nid: ${sharedId}\n---\n# Copy\n`;
    const copy = `---\ntitle: Copy\nid: ${sharedId}\n---\n# Copy\n`;
    const over = await seeded();
    const { app, cli, onDisk } = over;
    await over.put({ "notes/original.md": original });
    await app.client.annotations.add({
      id: "c1",
      path: "notes/original.md",
      quote: "Copy",
      text: "kept",
    });
    const storeBytes = onDisk(store);
    await over.put({ "notes/copy.md": copy });

    const given = await cli(["vault", "new-id", "notes/copy.md", "--json"]);
    expect(given.code).toBe(0);
    const { id } = z
      .strictObject({
        annotations: z.literal("copied"),
        id: z.uuid(),
        path: z.literal("notes/copy.md"),
      })
      .parse(JSON.parse(given.stdout));
    expect(onDisk("notes/copy.md")).toBe(copy.replace(sharedId, id));
    expect(onDisk(`.inteligir/annotations/${id}.json`)).toBe(storeBytes);
    expect(onDisk(store)).toBe(storeBytes);

    await over.put({ "notes/twin.md": copy });
    over.landAfterNextRead("notes/twin.md", copy.replace(sharedId, "its-own"));
    const stale = await cli(["vault", "new-id", "notes/twin.md", "--json"]);
    expect(stale.code).toBe(1);
    expect(stale.stdout).toBe("");
    expect(JSON.parse(stale.stderr)).toEqual({
      error: "CAS_MISMATCH",
      message: "notes/twin.md changed since it was read; nothing was written",
    });
    expect(onDisk("notes/twin.md")).toBe(copy.replace(sharedId, "its-own"));

    const plain = await cli(["vault", "new-id", "notes/hello.md"]);
    expect(plain.code).toBe(1);
    expect(plain.stderr).toContain("No id to replace in notes/hello.md");
  });
});

describe("knowledge commands", { timeout: 60_000 }, () => {
  const shared = shareBoot(async (teardown) => {
    const over = await cliOver(await bootTestApp({ teardown }));
    await over.put({
      "Welcome.md": "# Welcome\n\nsee [[hello]]\n",
      "notes/hello.md": "# Hello\n\nBody.\n\nBack to [[Welcome]]. #project\n",
      "notes/lonely.md": "# Lonely\n\nNothing links here. #idea\n",
      "notes/nearby.md": "# Nearby\n\nAlso [[Welcome]]. #project\n",
    });
    return over;
  });

  it("renders search results and their --json twin", async () => {
    const { cli } = shared();
    const json = await cli(["search", "Body", "--json"]);
    const { results } = z
      .object({
        results: z.array(z.object({ path: z.string(), snippet: z.string(), title: z.string() })),
      })
      .parse(JSON.parse(json.stdout));
    expect(results.map((result) => [result.path, result.title])).toEqual([
      ["notes/hello.md", "Hello"],
    ]);

    const human = await cli(["search", "Body"]);
    expect(human.code).toBe(0);
    expect(human.stdout).toBe(
      results.map((result) => `${result.path}  ${result.title}\n  ${result.snippet}\n`).join(""),
    );
  });

  it("says so when nothing matches, and refuses a bad --limit", async () => {
    const { cli } = shared();
    const empty = await cli(["search", "zzz"]);
    expect(empty.stdout).toBe("ℹ No results.\n");

    const bad = await cli(["search", "x", "--limit", "0"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("--limit must be an integer between 1 and 100");
  });

  it("renders backlinks and tags", async () => {
    const { cli } = shared();
    const backlinks = await cli(["backlinks", "notes/hello.md"]);
    expect(backlinks.stdout).toBe("Welcome.md:3  see [[hello]]\n");

    const tags = await cli(["tags"]);
    expect(tags.stdout).toBe("project  2\nidea  1\n");
  });

  it("renames a tag and names the notes it rewrote, in both voices", async () => {
    const over = await boot();
    await over.put({ "notes/hello.md": "# Hello\n\n#project\n", "notes/other.md": "# Other\n" });
    const json = await over.cli(["tag", "rename", "project", "work", "--json"]);
    expect(JSON.parse(json.stdout)).toEqual({
      from: "project",
      rewritten: ["notes/hello.md"],
      skipped: [],
      to: "work",
    });
    expect(over.onDisk("notes/hello.md")).toBe("# Hello\n\n#work\n");

    const human = await over.cli(["tag", "rename", "work", "job"]);
    expect(human.stdout).toContain("Renamed #work to #job in 1 note.");
  });

  it("renders a related note with the reasons it is related", async () => {
    const { cli } = shared();
    const related = await cli(["related", "notes/hello.md"]);
    expect(related.stdout).toBe(
      "notes/nearby.md  Nearby\n  both link to Welcome; shares #project\n",
    );
  });

  it("says a note has no related notes rather than printing nothing", async () => {
    const { cli } = shared();
    const related = await cli(["related", "notes/lonely.md"]);
    expect(related.stdout).toBe("ℹ No related notes.\n");
    expect(related.code).toBe(0);
  });
});

// a turn of the action the provider reports in full: the request, a file it added, its answer
const reportedTurn = async (app: ThreadHarness, threadId: string, text: string) => {
  const turnId = await sendMessage(app.client, threadId, text);
  const scope = turnScope(turnId);
  const changed = (status: ThreadEventItemStatus): ThreadEventItem => ({
    approvalStatus: null,
    changes: [{ kind: "add", path: "notes/a.md" }],
    id: `file_${turnId}`,
    status,
    type: "fileChange",
  });
  app.driver.report(threadId, [
    { item: changed("pending"), scope, threadId, type: "item/started" },
    { item: changed("completed"), scope, threadId, type: "item/completed" },
    ...agentMessageEvents({ itemId: `msg_${turnId}`, scope, text: "Done", threadId }),
  ]);
  app.driver.completeTurn(threadId, turnId, "completed");
  await awaitThreadStatus(app.client, threadId, "idle");
  return turnId;
};

describe("action commands", { timeout: 60_000 }, () => {
  it("lists threads and shows one with the compact timeline", async () => {
    const { app, cli } = await bootActions();
    const { thread } = await app.client.threads.create({ title: "Note writing" });
    await reportedTurn(app, thread.id, "Write me a note");

    const list = await cli(["action", "list"]);
    expect(list.stdout).toBe(`${thread.id}  idle  Note writing\n`);

    const show = await cli(["action", "show", thread.id]);
    expect(show.code).toBe(0);
    expect(show.stdout).toBe(
      [
        `Thread ${thread.id} — idle`,
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
    const { app, cli } = await bootActions();
    const threadId = await createThread(app.client);
    const turnId = await sendMessage(app.client, threadId, "Set it up");
    const waiting = approve(app, threadId, COMMAND_APPROVAL, turnId);
    const show = await cli(["action", "show", threadId]);
    expect(show.stdout).toBe(
      [
        `Thread ${threadId} — active`,
        "Title: Set it up",
        "Pending interactions:",
        `  ${waiting}  ${threadId}  pending`,
        "    $ npm install (in /Users/me/Library) — installs the dependencies",
        "    answer: allow_once, allow_for_session, deny",
        "",
        "── user ──",
        "Set it up",
        "",
        "── turn (pending) ──",
        "",
      ].join("\n"),
    );
  });

  it("creates a thread and sends the first turn", async () => {
    const over = await bootActions();
    const { app, cli } = over;
    await over.put({ "notes/hello.md": HELLO });
    const result = await cli(["action", "new", "Summarize my inbox"]);
    expect(result.code).toBe(0);
    const [started] = app.driver.startedTurns;
    expect(started?.text).toBe("Summarize my inbox");
    expect(result.stdout).toBe(
      `Action ${String(started?.threadId)}\n✔ Turn ${String(started?.turnId)} started\n`,
    );

    const attached = await cli(["action", "new", "x", "--doc", "notes/hello.md", "--json"]);
    expect(attached.code).toBe(0);
    const { thread } = z
      .looseObject({ thread: z.looseObject({ originDocPath: z.string().nullable() }) })
      .parse(JSON.parse(attached.stdout));
    expect(thread.originDocPath).toBe("notes/hello.md");
  });

  it("sends follow-ups and archives", async () => {
    const { app, cli } = await bootActions();
    const threadId = await createThread(app.client);
    const send = await cli(["action", "send", threadId, "and then?"]);
    const sent = app.driver.startedTurns.at(-1);
    expect(sent).toMatchObject({ text: "and then?", threadId });
    expect(send.stdout).toBe(`✔ Turn ${String(sent?.turnId)} started\n`);

    const archive = await cli(["action", "archive", threadId]);
    expect(archive.stdout).toBe(`✔ Archived ${threadId}\n`);
    const { thread } = await app.client.threads.get({ threadId });
    expect(thread.archivedAt).not.toBeNull();
  });

  it("stops a running action, and says so when there is nothing to stop", async () => {
    const { app, cli } = await bootActions();
    const running = await createThread(app.client);
    await sendMessage(app.client, running, "keep going");
    const idle = await createThread(app.client);
    const stop = await cli(["action", "stop", running]);
    expect(stop.code).toBe(0);
    expect(stop.stdout).toBe(`✔ Stopping ${running}\n`);
    expect(app.driver.interruptedThreads).toEqual([running]);

    const nothing = await cli(["action", "stop", idle, "--json"]);
    expect(JSON.parse(nothing.stdout)).toMatchObject({ stop: "not-running", thread: { id: idle } });

    const missing = await cli(["action", "stop", "thr_missing"]);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
  });

  it("lists what each turn changed, oldest first, and says so when none did", async () => {
    const { app, cli } = await bootActions();
    const threadId = await createThread(app.client);
    const first = await agentTurn(app, threadId, {
      "notes/[b].md": "# B\n",
      "notes/a.md": "# A\n\none\n",
    });
    await app.client.threads.undoTurn({ threadId, turnId: first });
    const second = await agentTurn(app, threadId, { "notes/a.md": "# A\n\ntwo\n" });
    const quiet = await createThread(app.client);

    const listed = await cli(["action", "changes", threadId]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toBe(
      [
        `${first}  undone`,
        "  notes/[b].md",
        "  notes/a.md",
        `${second}  applied`,
        "  notes/a.md",
        "",
      ].join("\n"),
    );

    const json = await cli(["action", "changes", threadId, "--json"]);
    expect(JSON.parse(json.stdout)).toEqual(await app.client.threads.turnChanges({ threadId }));

    const none = await cli(["action", "changes", quiet]);
    expect(none.code).toBe(0);
    expect(none.stdout).toBe(`ℹ No turn of ${quiet} changed the vault.\n`);

    const missing = await cli(["action", "changes", "thr_missing"]);
    expect(missing.code).toBe(1);
  });

  it("undoes the newest applied turn unless told which, naming each kept note's reason", async () => {
    const over = await bootActions();
    const { app, cli, onDisk } = over;
    const threadId = await createThread(app.client);
    await agentTurn(app, threadId, {
      "notes/a.md": "# A\n\nfirst\n",
      "notes/b.md": "# B\n\none\n",
    });
    const second = await agentTurn(app, threadId, {
      "notes/a.md": "# A\n\nsecond\n",
      "notes/b.md": "# B\n\ntwo\n",
    });
    const third = await agentTurn(app, threadId, { "notes/c.md": "# C\n" });
    await app.client.threads.undoTurn({ threadId, turnId: third });
    // the person's own edit, on the line the second turn changed
    await over.put({ "notes/b.md": "# B\n\nmine\n" });
    const other = await createThread(app.client);
    const only = await agentTurn(app, other, { "notes/d.md": "# D\n" });

    const newest = await cli(["action", "undo", threadId]);
    expect(newest.code).toBe(0);
    expect(newest.stdout).toBe(
      [
        "reverted  notes/a.md",
        "kept      notes/b.md  (edited since the turn, where the turn changed it)",
        "",
      ].join("\n"),
    );
    expect(newest.stderr).toContain(`Undid what it could of turn ${second}`);
    expect(onDisk("notes/a.md")).toBe("# A\n\nfirst\n");
    expect(onDisk("notes/b.md")).toBe("# B\n\nmine\n");
    const { turns } = await app.client.threads.turnChanges({ threadId });
    expect(turns.map((turn) => turn.state)).toEqual(["applied", "undone", "undone"]);

    const again = await cli(["action", "undo", threadId, "--turn", second]);
    expect(again.code).toBe(1);
    expect(again.stdout).toBe("");

    const json = await cli(["action", "undo", other, "--json"]);
    expect(JSON.parse(json.stdout)).toEqual({ kept: [], reverted: ["notes/d.md"], turnId: only });

    const nothingLeft = await cli(["action", "undo", other]);
    expect(nothingLeft.code).toBe(1);
    expect(nothingLeft.stderr).toContain(`No turn of ${other} has changes left to undo.`);
  });

  it("says a turn whose every note was kept is still the one to undo, and how to reach past it", async () => {
    const over = await bootActions();
    const { app, cli } = over;
    const threadId = await createThread(app.client);
    await agentTurn(app, threadId, { "notes/a.md": "# A\n", "notes/b.md": "# B\n\none\n" });
    const second = await agentTurn(app, threadId, { "notes/b.md": "# B\n\ntwo\n" });
    await over.put({ "notes/b.md": "# B\n\nmine\n" });

    const result = await cli(["action", "undo", threadId]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      "kept      notes/b.md  (edited since the turn, where the turn changed it)\n",
    );
    expect(result.stderr).toContain(
      `Nothing of turn ${second} could be undone; it stays the newest turn to undo, so pass --turn to undo an earlier one.`,
    );
    expect(result.stderr).not.toContain("Undid what it could");
    const { turns } = await app.client.threads.turnChanges({ threadId });
    expect(turns.map((turn) => turn.state)).toEqual(["applied", "applied"]);
  });
});

describe("status, guide and help", { timeout: 60_000 }, () => {
  const shared = sharedSeeded();

  it("renders system status with the thread context", async () => {
    const { app, baseUrl, cli } = shared();
    const result = await cli(["status"], { env: { INTELIGIR_THREAD_ID: "thr_ctx" } });
    expect(result.code).toBe(0);
    // the consola box's width follows its widest line and the port is random, so only the rows are pinned.
    const [title, dataDir, vault, schema, ...rest] = boxedLines(result.stdout);
    expect([title, dataDir, vault]).toEqual([
      `inteligir ${TEST_SERVER_VERSION} — ${baseUrl}`,
      `Data dir: ${app.dataDir}`,
      `Vault: ${app.vaultDir}`,
    ]);
    expect(schema).toMatch(/^Schema: v\d+ — uptime \d+s$/u);
    expect(rest).toEqual(["Agent: off", "Thread context: thr_ctx"]);
  });

  it("prints the served guide verbatim", async () => {
    const { app, cli } = shared();
    const { markdown } = await app.client.system.guide();
    const result = await cli(["guide"]);
    expect(result.stdout).toBe(`${markdown}\n`);
  });

  it("prints the env context in --help", async () => {
    const { cli } = shared();
    const result = await cli(["--help"], { env: { INTELIGIR_THREAD_ID: "thr_ctx" } });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("INTELIGIR_DATA_DIR");
    expect(result.stdout).toContain("INTELIGIR_THREAD_ID:  thr_ctx");
  });

  it("names where an unset data dir derives from, installed or in a checkout", async () => {
    const { cli } = shared();
    const installed = await cli(["--help"], { env: { NODE_ENV: "production" } });
    expect(installed.stdout).toContain("INTELIGIR_DATA_DIR: (unset — derived under ~/.inteligir)");

    const checkout = await cli(["--help"]);
    expect(checkout.stdout).toContain("INTELIGIR_DATA_DIR: (unset — derived from this checkout)");
  });
});

const recordingOpener = (answer: boolean) => {
  const opened: string[] = [];
  const openExternalUrl = async (url: string): Promise<boolean> => {
    opened.push(url);
    return await Promise.resolve(answer);
  };
  return { openExternalUrl, opened };
};

// the nonce a link carries, held to the one shape `open` mints
const nonceOf = (baseUrl: string, url: string): string => {
  const nonce = new URL(url).searchParams.get(BROWSER_HANDOFF_PARAM) ?? "";
  expect(url).toBe(browserHandoffUrl(`${baseUrl}/`, nonce));
  return nonce;
};

describe("open", { timeout: 60_000 }, () => {
  const shared = shareBoot(
    async (teardown) =>
      await cliOver(await bootTestApp({ clientDir: pageBundle({ lifetime: "suite" }), teardown })),
  );

  it("opens a link the server minted and names the server, never the nonce", async () => {
    const { app, baseUrl, cli } = shared();
    const browser = recordingOpener(true);
    const result = await cli(["open"], { openExternalUrl: browser.openExternalUrl });
    expect(result.code).toBe(0);
    const [opened = ""] = browser.opened;
    expect(browser.opened).toHaveLength(1);
    const nonce = nonceOf(baseUrl, opened);
    expect(result.stdout).toContain(baseUrl);
    expect(result.stdout).not.toContain(nonce);
    // the server's own: it trades it once for a session cookie
    const traded = await app.bareRequest(`/?${BROWSER_HANDOFF_PARAM}=${nonce}`);
    expect(traded.headers.get("set-cookie")).not.toBeNull();
  });

  it("prints the link when no browser opens", async () => {
    const { baseUrl, cli } = shared();
    const result = await cli(["open"], { openExternalUrl: recordingOpener(false).openExternalUrl });
    expect(result.code).toBe(0);
    const printed = result.stdout.trimEnd();
    nonceOf(baseUrl, printed);
    expect(result.stdout).toBe(`${printed}\n`);
  });

  it("prints the link under --json and opens nothing", async () => {
    const { baseUrl, cli } = shared();
    const browser = recordingOpener(true);
    const result = await cli(["open", "--json"], { openExternalUrl: browser.openExternalUrl });
    expect(result.code).toBe(0);
    expect(browser.opened).toEqual([]);
    const { url } = z.strictObject({ url: z.string() }).parse(JSON.parse(result.stdout));
    nonceOf(baseUrl, url);
  });

  it("hands out no link from a server with no UI, saying why, and NOT_FOUND under --json", async () => {
    const { cli } = await boot();
    const browser = recordingOpener(true);
    const human = await cli(["open"], { openExternalUrl: browser.openExternalUrl });
    expect(human.code).toBe(1);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("serves no UI");
    expect(browser.opened).toEqual([]);

    const json = await cli(["open", "--json"]);
    expect(json.code).toBe(1);
    expect(json.stdout).toBe("");
    expect(JSON.parse(json.stderr)).toEqual({
      error: "NOT_FOUND",
      message:
        "This server serves no UI (an unbuilt checkout): run `pnpm build`, or open the desktop app.",
    });
  });
});

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

// who signed each entry, roots and replies in order; an entry may name no one
const sourcesOn = async (app: BootedTestApp, notePath: string): Promise<(string | undefined)[]> => {
  const { annotations } = await app.client.annotations.list({ path: notePath });
  return annotations.flatMap((annotation) => [
    annotation.root.source,
    ...annotation.replies.map((reply) => reply.entry.source),
  ]);
};

describe("annotation verbs sign their entries", { timeout: 60_000 }, () => {
  const shared = sharedSeeded();

  it("signs `agent` inside an agent shell and leaves a plain one to the server's `user`", async () => {
    const { app, cli, put } = shared();
    await put({ "notes/signed.md": HELLO });
    const agentShell = { env: { INTELIGIR_THREAD_ID: "thr_ctx" } };

    const fromAgent = await cli(
      ["annotation", "add", "notes/signed.md", "Hello", "--note", "Needs a second pass"],
      agentShell,
    );
    expect(fromAgent.code).toBe(0);
    const fromShell = await cli(["annotation", "add", "notes/signed.md", "Body", "--json"]);
    expect(fromShell.code).toBe(0);
    const rootId = idOfQuote(fromShell.stdout, "Body");

    const replied = await cli(
      ["annotation", "reply", "notes/signed.md", rootId, "and again"],
      agentShell,
    );
    expect(replied.stdout).toBe(`Replied to ${rootId}\n`);

    expect(await sourcesOn(app, "notes/signed.md")).toEqual(["agent", "user", "agent"]);
  });

  it("refuses --source, which an entry's author is never asked for", async () => {
    const { app, cli } = shared();
    const result = await cli(["annotation", "add", "notes/hello.md", "Hello", "--source", "user"]);
    expect(result.code).toBe(1);
    expect(await sourcesOn(app, "notes/hello.md")).toEqual([]);
  });
});

describe("annotation add, edit and remove", { timeout: 60_000 }, () => {
  it("highlights the passage, starts with no note, and takes the note through edit", async () => {
    const { app, cli } = await seeded();

    const added = await cli(["annotation", "add", "notes/hello.md", "Hello"]);
    const {
      annotations: [annotation],
    } = await app.client.annotations.list({ path: "notes/hello.md" });
    const id = annotation?.id ?? "";
    expect(added.stdout).toBe(`Highlighted "Hello" in notes/hello.md (${id})\n`);
    expect(annotation?.state).toBe("anchored");
    expect(annotation?.root.quote).toBe("Hello");
    expect(annotation?.root.text).toBe("");

    const listed = await cli(["annotation", "list", "notes/hello.md"]);
    expect(listed.stdout).toBe(`${id}\tanchored\t"Hello"\t\n`);

    const edited = await cli(["annotation", "edit", "notes/hello.md", id, "Say it louder"]);
    expect(edited.stdout).toBe(`Updated ${id}\n`);
    const { annotations } = await app.client.annotations.list({ path: "notes/hello.md" });
    expect(annotations[0]?.root.text).toBe("Say it louder");

    const removed = await cli(["annotation", "remove", "notes/hello.md", id]);
    expect(removed.stdout).toBe(`Removed highlight ${id}\n`);
    const after = await app.client.annotations.list({ path: "notes/hello.md" });
    expect(after.annotations).toEqual([]);
  });

  it("refuses a passage the text does not hold, and an occurrence below 1 before dialing", async () => {
    const { app, cli } = await seeded();
    const absent = await cli(["annotation", "add", "notes/hello.md", "Goodbye", "--json"]);
    expect(absent.code).toBe(1);
    expect(JSON.parse(absent.stderr)).toMatchObject({ error: "BAD_REQUEST" });

    const zeroth = await runCliForTest({
      argv: ["annotation", "add", "notes/hello.md", "Hello", "--occurrence", "0", "--json"],
      baseUrl: null,
    });
    expect(JSON.parse(zeroth.stderr)).toMatchObject({ error: "INVALID_USAGE" });
    const { annotations } = await app.client.annotations.list({ path: "notes/hello.md" });
    expect(annotations).toEqual([]);
  });
});

describe("argv the CLI refuses", { timeout: 60_000 }, () => {
  const shared = sharedSeeded();

  it("names an undeclared flag instead of ignoring it", async () => {
    const { cli } = shared();
    const result = await cli(["vault", "write", "notes/x.md", "--contentt", "# X\n"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unknown option: --contentt");
  });

  it("reports an undeclared flag as INVALID_USAGE under --json", async () => {
    const { cli } = shared();
    const result = await cli(["tags", "--nope", "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "unknown option: --nope",
    });
  });

  it("refuses a flag written before the command's name, which the leaf would never read", async () => {
    const { cli } = shared();
    const leading = await cli(["--json", "vault", "read", "notes/hello.md"]);
    expect(leading.code).toBe(1);
    expect(leading.stdout).toBe("");
    expect(JSON.parse(leading.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "put flags after the command's name: inteligir <command> … --flag",
    });

    const between = await cli(["action", "--running", "list"]);
    expect(between.code).toBe(1);
    expect(between.stdout).toBe("");
    expect(between.stderr).toContain("put flags after the command's name");
  });

  it("names a missing positional rather than acting on undefined", async () => {
    const { cli } = shared();
    const result = await cli(["vault", "read"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("PATH");
  });

  it("refuses a word past the last positional instead of dropping it", async () => {
    const { cli } = shared();
    const result = await cli(["search", "a", "b", "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "unexpected argument: b — quote a value that contains spaces",
    });
  });

  it("refuses a harness id no harness has, naming the ones there are", async () => {
    const { cli } = shared();
    const result = await cli(["agents", "default", "gemini", "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: 'No harness is called "gemini"; pass one of claude, codex.',
    });
  });

  it("refuses an unquoted body to vault write before reading stdin", async () => {
    const { cli, onDisk } = shared();
    const result = await cli(["vault", "write", "notes/p.md", "text", "--json"], {
      stdin: new Uint8Array(),
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "unexpected argument: text — quote a value that contains spaces",
    });
    expect(onDisk("notes/p.md")).toBeNull();
  });

  it("names an undeclared short flag instead of reading it as a boolean", async () => {
    const { cli } = shared();
    const result = await cli(["vault", "history", "notes/hello.md", "-n", "5", "--json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "unknown option: -n",
    });
  });

  it("checks only the words before `--`, so a dash-led name after it is an operand", async () => {
    const { cli, put } = shared();
    await put({ "-draft.md": "# Draft\n" });
    const result = await cli(["vault", "read", "--", "-draft.md"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("# Draft\n");
  });

  it("counts every word after `--` as an operand, so one past the leaf's arity is refused", async () => {
    const { cli, put } = shared();
    await put({ "a.md": "# A\n", "b.md": "# B\n" });
    for (const operands of [
      ["a.md", "--", "b.md"],
      ["--", "a.md", "b.md"],
    ]) {
      const result = await cli(["vault", "read", "--json", ...operands]);
      expect(result.code, operands.join(" ")).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        error: "INVALID_USAGE",
        message: "unexpected argument: b.md — quote a value that contains spaces",
      });
    }
  });

  it("refuses a connectors verb as an unknown command: Settings owns connectors", async () => {
    const { cli } = shared();
    const result = await cli(["connectors", "list", "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "Unknown command connectors",
    });
  });

  it("hands a dash-led value to the flag that takes one", async () => {
    const { cli, onDisk } = shared();
    const result = await cli(["vault", "write", "notes/dash.md", "--content", "-x", "--overwrite"]);
    expect(result.code).toBe(0);
    expect(onDisk("notes/dash.md")).toBe("-x");
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

describe("vault write reads stdin as BYTES", { timeout: 60_000 }, () => {
  const shared = sharedSeeded();

  it("preserves a BOM and non-ASCII exactly", async () => {
    const { cli, onDisk } = shared();
    const content = "﻿# Héllo 😀\n";
    const result = await cli(["vault", "write", "notes/bytes.md", "--if-absent"], {
      stdin: new TextEncoder().encode(content),
    });
    expect(result.code).toBe(0);
    expect(onDisk("notes/bytes.md")).toBe(content);
  });

  it("refuses invalid UTF-8 instead of substituting U+FFFD", async () => {
    const { cli, onDisk } = shared();
    const result = await cli(["vault", "write", "notes/bad.md", "--if-absent"], {
      // A lone continuation byte: no valid decoding exists.
      stdin: Uint8Array.from([0x23, 0x20, 0xff, 0x0a]),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not valid UTF-8");
    expect(onDisk("notes/bad.md")).toBeNull();
  });

  it("refuses content over the vault's bound before sending it", async () => {
    const { cli, onDisk } = shared();
    const result = await cli(["vault", "write", "notes/big.md", "--if-absent"], {
      stdin: new Uint8Array(VAULT_MAX_CONTENT_LENGTH + 1).fill(0x61),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("refuses anything over");
    expect(onDisk("notes/big.md")).toBeNull();
  });

  it("refuses a terminal rather than waiting on it", async () => {
    const { cli, onDisk } = shared();
    const result = await cli(["vault", "write", "notes/tty.md", "--if-absent"], {
      stdin: "terminal",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("stdin is a terminal");
    expect(onDisk("notes/tty.md")).toBeNull();
  });

  it("refuses an empty stdin rather than emptying the file", async () => {
    const { cli, onDisk, put } = shared();
    await put({ "notes/kept.md": HELLO });
    const result = await cli(["vault", "write", "notes/kept.md", "--overwrite"], {
      stdin: new Uint8Array(),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("stdin carried no content");
    expect(onDisk("notes/kept.md")).toBe(HELLO);

    const emptied = await cli(["vault", "write", "notes/kept.md", "--content", "", "--overwrite"]);
    expect(emptied.code).toBe(0);
    expect(onDisk("notes/kept.md")).toBe("");
  });
});

describe("action new never orphans a thread silently", { timeout: 60_000 }, () => {
  it("names the created thread when its first turn fails", async () => {
    // no agent provider: the thread is made, and its first turn is refused
    const { app, cli } = await boot();
    const result = await cli(["action", "new", "do a thing"]);
    expect(result.code).toBe(1);
    const { threads } = await app.client.threads.list({});
    const [created] = threads;
    expect(threads).toHaveLength(1);
    const id = created?.id ?? "";
    expect(result.stderr).toContain(id);
    expect(result.stderr).toContain("was created but its first turn failed");
    expect(result.stderr).toContain(`inteligir action send ${id}`);
  });
});

describe("cloud login", { timeout: 60_000 }, () => {
  const shared = shareBoot(async (teardown) => {
    const cloud = new FakeCloud();
    return await cliOver(
      await bootTestApp({
        cloudTransport: { fetch: cloud.fetch, pollIntervalMs: null },
        teardown,
      }),
    );
  });

  it("reads the password from stdin under `--password -`, one line and its newline", async () => {
    const { cli } = shared();
    const result = await cli(
      ["cloud", "login", "--email", "Owner@Example.test", "--password", "-", "--json"],
      { stdin: new TextEncoder().encode(`${FAKE_ACCOUNT.password}\n`) },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      accountEmail: FAKE_ACCOUNT.email,
      state: "signed-in",
    });
  });

  it("refuses to prompt under --json — the agent path has no terminal to wait on", async () => {
    const { cli } = shared();
    const result = await cli(["cloud", "login", "--email", FAKE_ACCOUNT.email, "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "INVALID_USAGE" });
  });

  it("refuses an empty stdin rather than sending an empty password", async () => {
    const { cli } = shared();
    const result = await cli(["cloud", "login", "--email", FAKE_ACCOUNT.email, "--password", "-"], {
      stdin: new TextEncoder().encode("\n"),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("stdin carried no password");
  });

  it("resolves the server before prompting, so no password is typed for nothing", async () => {
    const result = await runCliForTest({
      argv: ["cloud", "login", "--email", FAKE_ACCOUNT.email],
      baseUrl: null,
      stdin: "terminal",
    });
    expect(result.code).toBe(3);
    expect(result.stderr).not.toContain("Password:");
  });
});

describe("cloud status", { timeout: 60_000 }, () => {
  it("sends a device its sign-out could not remove to the devices page", async () => {
    const cloud = new FakeCloud();
    let signOutAnswers: number | null = null;
    const { app, cli } = await boot({
      cloudTransport: {
        fetch: async (input, init) =>
          signOutAnswers !== null && input.endsWith(DEVICE_API_PATHS.signOut)
            ? new Response("unavailable", { status: signOutAnswers })
            : await cloud.fetch(input, init),
        pollIntervalMs: null,
      },
    });
    await app.client.cloud.login({ ...FAKE_ACCOUNT, deviceName: "Mac" });
    signOutAnswers = 503;
    await app.client.cloud.logout();
    const revokeError = await vi.waitFor(async () => {
      const status = await app.client.cloud.status();
      if (status.state !== "signed-out" || status.revokeError === null) {
        throw new Error("the sign-out has not failed yet");
      }
      return status.revokeError;
    });

    const result = await cli(["cloud", "status"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(revokeError);
    expect(result.stdout).toContain("https://cloud.test/app/devices");
  });
});

describe("--json failures", { timeout: 60_000 }, () => {
  const shared = sharedSeeded();

  it("puts the error envelope on stderr and leaves stdout empty", async () => {
    const { cli } = shared();
    const result = await cli(["vault", "read", "nope.md", "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "NOT_FOUND",
      message: "No such vault entry: nope.md",
    });
  });

  it("reports a local usage refusal with a CLI-side class", async () => {
    const { cli } = shared();
    const result = await cli(["action", "wait", "thr_1", "--timeout", "nope", "--json"]);
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

describe("a server that stopped answering", { timeout: 60_000 }, () => {
  it("classifies a refused dial as SERVER_UNREACHABLE / exit 3", async () => {
    // the listener closed under a server.json still naming it: the state a crash leaves.
    const { cli, stopListening } = await boot();
    await stopListening();
    const result = await cli(["status", "--json"]);
    expect(result.code).toBe(3);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "SERVER_UNREACHABLE" });
  });
});

const LINK_PATH = "Reading/File over app.md";
const LINK_URL = "https://example.test/file-over-app";
const LINK = [
  "---",
  "kind: link",
  `url: ${LINK_URL}`,
  "site: Example",
  "saved: 2026-10-16T08:00:00Z",
  "fetched: 2026-10-16T08:00:01Z",
  "tags:",
  "  - essay",
  "  - project",
  "---",
  "",
  "The page's own text.",
  "",
].join("\n");

// a saved link and a note; absent a fetcher, a page the server reads never answers, so a fill
// stays pending
const library = async (options: BootTestAppOptions = {}): Promise<CliOverServer<BootedTestApp>> => {
  const over = await boot(options);
  await over.put({ [LINK_PATH]: LINK, "notes/hello.md": HELLO });
  return over;
};

const itemAt = async (app: BootedTestApp, itemPath: string) => {
  const {
    items: [item],
  } = await app.client.knowledge.itemsAt({ paths: [itemPath] });
  if (item === undefined) {
    throw new Error(`${itemPath} is not an item`);
  }
  return item;
};

const saveOutputSchema = z.looseObject({ outcome: z.string(), path: z.string() });

describe("save", { timeout: 60_000 }, () => {
  it("saves a link as a pending stub, and answers an exact path for a link it holds", async () => {
    const { app, cli } = await library();
    const created = await cli([
      "save",
      "https://example.test/new?utm_source=feed",
      "--tags",
      "later,ideas",
      "--no-wait",
    ]);
    expect(created.stdout).toBe(
      "Saved Unsorted/example.test - new.md; its page is still being read\n",
    );
    expect(await itemAt(app, "Unsorted/example.test - new.md")).toMatchObject({
      pending: true,
      tags: ["later", "ideas"],
      url: "https://example.test/new",
    });

    const again = await cli(["save", `${LINK_URL}?utm_source=feed`, "--json"]);
    expect(saveOutputSchema.parse(JSON.parse(again.stdout))).toMatchObject({
      outcome: "exists",
      path: LINK_PATH,
    });
    const human = await cli(["save", LINK_URL]);
    expect(human.stdout).toBe(`Already saved: ${LINK_PATH}\n`);
  });

  it("says why a page could not be read, and saves into the folder named", async () => {
    // every page answers 404, at once
    const { cli } = await library({ items: { fetcher: fakeFetcher() } });
    const failed = await cli(["item", "refresh", LINK_PATH]);
    expect(failed.stdout).toBe(
      `Refreshed ${LINK_PATH}, but its page couldn't be read: The site answered 404 (not found).\n`,
    );

    const filed = await cli([
      "save",
      "https://example.test/elsewhere",
      "--folder",
      "Reading",
      "--json",
    ]);
    expect(saveOutputSchema.parse(JSON.parse(filed.stdout)).path).toBe(
      "Reading/example.test - elsewhere.md",
    );
  });

  it("saves a file on this Mac as a file item, and refuses the flags a file cannot take", async () => {
    const { app, cli } = await library();
    const saved = await cli(["save", FIXTURE_FILE_PATH]);
    expect(saved.stdout).toBe("Saved Unsorted/brochure.md\n");
    expect(await itemAt(app, "Unsorted/brochure.md")).toMatchObject({
      file: "assets/brochure.pdf",
      kind: "pdf",
    });

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
    const fetcher = fakeFetcher();
    const { app, cli } = await library({ items: { fetcher } });
    const saved = await cli([
      "save",
      "https://example.test/given",
      "--html",
      FIXTURE_PAGE_PATH,
      "--json",
    ]);
    expect(saved.code).toBe(0);
    const { path: savedPath } = saveOutputSchema.parse(JSON.parse(saved.stdout));
    const item = await itemAt(app, savedPath);
    expect(item.url).toBe("https://example.test/given");
    expect(fetcher.requests).not.toContain("https://example.test/given");
  });

  it("saves every web link on stdin in order, and refuses a line that is not one", async () => {
    const { cli } = await library({ items: { fetcher: fakeFetcher() } });
    const saved = await cli(["save", "-", "--json"], {
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

describe("items and item", { timeout: 60_000 }, () => {
  const shared = shareBoot(async (teardown) => {
    const over = await cliOver(await bootTestApp({ teardown }));
    await over.put({ [LINK_PATH]: LINK, "notes/hello.md": HELLO });
    return over;
  });

  it("lists one tab-separated line per item, and names the next page when cut", async () => {
    const { cli } = shared();
    // a note has no saved date, so it sorts by when it changed: today, after the link's
    const listed = await cli(["items"]);
    expect(listed.stdout).toBe(
      `notes/hello.md\tnote\t-\t-\t\n${LINK_PATH}\tlink\t2026-10-16\tExample\t#essay #project\n`,
    );

    const page = await cli(["items", "--limit", "1"]);
    expect(page.stdout).toBe(`notes/hello.md\tnote\t-\t-\t\n(1 of 2; more: --offset 1)\n`);

    const notes = await cli(["items", "--kind", "note", "--json"]);
    expect(JSON.parse(notes.stdout)).toMatchObject({
      items: [{ path: "notes/hello.md" }],
      total: 1,
    });
  });

  it("shows an item's facts, and refuses a path that is not one", async () => {
    const { cli } = shared();
    const shown = await cli(["item", "show", LINK_PATH]);
    expect(shown.stdout).toBe(
      [
        "kind: link",
        `url: ${LINK_URL}`,
        "site: Example",
        "saved: 2026-10-16T08:00:00Z",
        "fetched: 2026-10-16T08:00:01Z",
        "folder: Reading",
        "tags: #essay #project",
        "",
      ].join("\n"),
    );
    const json = await cli(["item", "show", LINK_PATH, "--json"]);
    expect(itemShowOutputSchema.parse(JSON.parse(json.stdout)).item.url).toBe(LINK_URL);

    const missing = await cli(["item", "show", "notes/nowhere.md", "--json"]);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(JSON.parse(missing.stderr)).toEqual({
      error: "NOT_FOUND",
      message: "notes/nowhere.md is not an item",
    });
  });

  it("finds where a link is saved, says when it is not, and refuses what is not a web link", async () => {
    const { cli } = shared();
    const found = await cli([
      "item",
      "find",
      `https://www.example.test/file-over-app?utm_campaign=x`,
    ]);
    expect(found.stdout).toBe(`${LINK_PATH}\n`);
    const absent = await cli(["item", "find", "https://example.test/never"]);
    expect(absent.stdout).toContain("Not saved yet");
    const notWeb = await runCliForTest({
      argv: ["item", "find", "ftp://example.test/x", "--json"],
      baseUrl: null,
    });
    expect(JSON.parse(notWeb.stderr)).toMatchObject({ error: "INVALID_USAGE" });
  });
});

describe("tag add and remove", { timeout: 60_000 }, () => {
  it("tags and untags one item, and says when there was nothing to do", async () => {
    const { app, cli } = await library();
    const added = await cli(["tag", "add", "later", LINK_PATH]);
    expect(added.stdout).toBe(`Tagged ${LINK_PATH} #later\n`);
    const again = await cli(["tag", "add", "later", LINK_PATH, "--json"]);
    expect(tagChangeOutputSchema.parse(JSON.parse(again.stdout))).toEqual({
      inline: [],
      outcome: "unchanged",
      path: LINK_PATH,
    });

    const removed = await cli(["tag", "remove", "essay", LINK_PATH]);
    expect(removed.stdout).toBe(`Removed #essay from ${LINK_PATH}\n`);
    const item = await itemAt(app, LINK_PATH);
    expect(item.tags).toEqual(["project", "later"]);
  });

  it("refuses an item that is not there", async () => {
    const { cli } = await library();
    const missing = await cli(["tag", "add", "later", "notes/nowhere.md", "--json"]);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(JSON.parse(missing.stderr)).toEqual({
      error: "NOT_FOUND",
      message: "notes/nowhere.md is not an item",
    });
  });
});

// two of the export's links the library already holds, so the plan leaves them as they are
const heldLink = (url: string): string =>
  [
    "---",
    "kind: link",
    `url: ${url}`,
    "saved: 2026-10-16T08:00:00Z",
    "fetched: 2026-10-16T08:00:01Z",
    "---",
    "",
  ].join("\n");

const HELD = {
  "Reading/Deep.md": heldLink("https://example.com/deep"),
  "Unsorted/Untitled.md": heldLink("https://example.com/untitled"),
};

const mkdirTemp = (): string => {
  const dir = path.join(tmpdir(), `inteligir-import-${String(process.pid)}-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  onTestFinished(() => {
    rmSync(dir, { force: true, recursive: true });
  });
  return dir;
};

// a Raindrop export of `rows` links in one folder
const bigExport = (rows: number): string => {
  const dir = mkdirTemp();
  const file = path.join(dir, "big-export.csv");
  writeFileSync(
    file,
    [
      "id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite",
      ...Array.from(
        { length: rows },
        (_, at) =>
          `${String(at + 1)},Link ${String(at + 1)},,,https://example.test/links/${String(at + 1)},Many,,,,,`,
      ),
    ].join("\n"),
  );
  return file;
};

describe("import", { timeout: 60_000 }, () => {
  it("prints the plan on a dry run and imports nothing", async () => {
    const over = await boot();
    await over.put(HELD);
    const dry = await over.cli(["import", "raindrop", RAINDROP, "--dry-run"]);
    expect(dry.stdout).toBe(
      "4 links in 3 folders, with 6 tags and 4 highlights. 2 are already in your library and stay as they are. Each page's text and picture fill in over the next while.\n",
    );
    expect(await over.app.client.imports.status()).toEqual({ job: null });
  });

  it("runs the import, follows it to its end, and says what it added", async () => {
    const over = await boot();
    await over.put(HELD);
    const run = await over.cli(["import", "raindrop", RAINDROP]);
    expect(run.stdout.split("\n").at(-2)).toBe("Imported 4 items from Raindrop (2 already saved)");
    expect(run.stderr).toMatch(/^(?:Imported \d+ of 6\n)+$/u);

    const status = await over.cli(["import", "status"]);
    expect(status.stdout).toBe("Imported 4 items from Raindrop (2 already saved)\n");
  });

  it("answers a job that ended failed as its final job, in --json and in words", async () => {
    const { app, cli } = await boot();
    // a file where the export's Reading folder goes, so its first batch cannot write
    writeFileSync(path.join(app.vaultDir, "Reading"), "a file, not a folder\n");
    const json = await cli(["import", "raindrop", RAINDROP, "--json"]);
    expect(json.code).toBe(0);
    expect(json.stderr).toBe("");
    const { job } = importsJobResponseSchema.parse(JSON.parse(json.stdout));
    expect(job).toMatchObject({ state: "failed" });
    expect(job.message).toMatch(/^The import stopped: /u);

    const words = await cli(["import", "raindrop", RAINDROP]);
    expect(words.stdout.split("\n").at(-2)).toMatch(/^The import from Raindrop stopped: /u);
  });

  it("refuses a file that is not a Raindrop export in the server's class", async () => {
    const { cli } = await boot();
    const refused = await cli(["import", "raindrop", FIXTURE_PAGE_PATH, "--json"]);
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stderr)).toEqual({
      error: "IMPORT_UNREADABLE",
      message: "This file isn't a Raindrop export",
    });
  });

  it("stops a running import, and says so when none is running", async () => {
    const { app, cli } = await boot();
    const none = await cli(["import", "cancel", "--json"]);
    expect(importCancelOutputSchema.parse(JSON.parse(none.stdout))).toEqual({ job: null });

    // three batches of a hundred: the cancel lands while the first is still writing
    const file = bigExport(300);
    const plan = await app.client.imports.plan({
      file: new Blob([await readFile(file)]),
      source: "raindrop",
    });
    await app.client.imports.start({ planId: plan.planId });
    const stopped = await cli(["import", "cancel"]);
    expect(stopped.stdout).toBe("Stopped the import\n");
    const { job } = await app.client.imports.status();
    expect(job?.state).toBe("cancelled");
  });
});

describe("action new with a preset", { timeout: 60_000 }, () => {
  it("sends the preset with an empty prompt, and refuses neither a prompt nor a preset", async () => {
    const { app, cli } = await bootActions();
    const tidy = await cli(["action", "new", "--preset", "tidy-library"]);
    expect(tidy.stderr).toBe("");
    // sent with no prompt, which the server stores as the preset's label
    expect(app.driver.startedTurns).toMatchObject([
      { preset: "tidy-library", text: ACTION_PRESET_LABELS["tidy-library"] },
    ]);

    const neither = await runCliForTest({ argv: ["action", "new", "--json"], baseUrl: null });
    expect(JSON.parse(neither.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "give a prompt or --preset",
    });
  });
});
