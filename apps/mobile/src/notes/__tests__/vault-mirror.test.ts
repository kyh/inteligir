import { createCloudClient } from "@repo/api/cloud/client";
import type { CloudFetch } from "@repo/api/cloud/client";
import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { SqlDriver } from "../../lib/sql-driver";
import { createSyncRuntime } from "../../sync/sync-runtime";
import { createNotesStore } from "../notes-store";
import type { MirrorProgress } from "../vault-mirror";
import { createVaultMirror } from "../vault-mirror";
import { blobOid, clientOver, createFakeVault, requestsOf } from "./fake-vault";
import { openSyncStore, openTempDb, phonePorts, tempDbPath } from "./phone-storage";

const CREDENTIAL = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_1" };
const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";

const VAULT = {
  "a.md": "# a\n",
  "media/a.png": "png bytes",
  "notes/b.md": "# b\n",
  "notes/c.md": "# c\n",
};

const offline: CloudFetch = async () => {
  throw new Error("offline");
};

// one launch of the phone: a store over the database file, signed in as the boot restore does
const launch = (fetch: CloudFetch, db: SqlDriver) => {
  const sync = createSyncRuntime({
    cloudUrl: "https://cloud.test",
    createClient: (credential) =>
      createCloudClient({
        baseUrl: "https://cloud.test",
        credential: credential.credential,
        fetch,
      }),
    pollIntervalMs: null,
    store: openSyncStore(db),
  });
  const store = createNotesStore({ ...phonePorts(), db, session: sync.session });
  sync.setCredential(CREDENTIAL);
  store.reset("restored");
  return { store, sync };
};

const mirroredCommit = async (db: SqlDriver): Promise<string | null> => {
  const [row] = await db.all("SELECT mirrored_commit FROM mirror_meta");
  return row === undefined
    ? null
    : z.object({ mirrored_commit: z.string().nullable() }).parse(row).mirrored_commit;
};

const heldPaths = async (db: SqlDriver): Promise<string[]> => {
  const rows = await db.all(
    "SELECT path FROM mirror_entries WHERE content IS NOT NULL ORDER BY path",
  );
  return rows.map((row) => z.object({ path: z.string() }).parse(row).path);
};

const listedPaths = (store: ReturnType<typeof launch>["store"]): string[] => {
  const tree = store.tree.get();
  return tree.state === "ready" ? tree.entries.map((entry) => entry.path) : [];
};

const until = async (done: () => boolean): Promise<void> => {
  while (!done()) {
    // oxlint-disable-next-line promise/avoid-new -- a macrotask: every settled promise has run by then
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

describe("the vault mirror", () => {
  it("serves the list and every body on a relaunch that cannot reach the cloud", async () => {
    const file = tempDbPath();
    const vault = createFakeVault(VAULT);
    const first = launch(vault.fetch, openTempDb(file));
    await first.store.refresh();

    const second = launch(offline, openTempDb(file));
    await until(() => second.store.tree.get().state === "ready");

    expect(listedPaths(second.store)).toEqual(Object.keys(VAULT));
    const notes = Object.entries(VAULT).filter(([listed]) => listed.endsWith(".md"));
    for (const [path, content] of notes) {
      expect(await second.store.readNote(path)).toEqual({ content, ok: true, path });
    }
    await second.store.refresh();
    expect(second.store.tree.get()).toMatchObject({
      refreshError: "Could not reach the cloud: offline",
      state: "ready",
    });
    expect(listedPaths(second.store)).toEqual(Object.keys(VAULT));
  });

  it("walks the tree once and fetches only the note that changed", async () => {
    const vault = createFakeVault(VAULT);
    const { store } = launch(vault.fetch, openTempDb());
    await store.refresh();
    vault.requests.length = 0;

    const head = vault.change({ "notes/b.md": "# b, edited\n" });
    await store.refresh();

    expect(requestsOf(vault, "tree")).toEqual(["tree ", `tree ?after=media%2Fa.png&ref=${head}`]);
    expect(requestsOf(vault, "files")).toEqual([`files notes/b.md @${head}`]);
    expect(await store.readNote("notes/b.md")).toMatchObject({ content: "# b, edited\n" });
  });

  it("fetches nothing for a moved note, and drops a deleted path", async () => {
    const db = openTempDb();
    const vault = createFakeVault(VAULT);
    const { store } = launch(vault.fetch, db);
    await store.refresh();
    vault.requests.length = 0;

    vault.change({ "archive/b.md": "# b\n", "notes/b.md": null, "notes/c.md": null });
    await store.refresh();

    expect(requestsOf(vault, "files")).toEqual([]);
    expect(listedPaths(store)).toEqual(["a.md", "archive/b.md", "media/a.png"]);
    expect(await heldPaths(db)).toEqual(["a.md", "archive/b.md"]);
    expect(await launch(offline, db).store.readNote("archive/b.md")).toMatchObject({
      content: "# b\n",
      ok: true,
    });
  });

  it("keeps its commit when a batch fails, and asks only for the texts still missing", async () => {
    const db = openTempDb();
    const names = Array.from({ length: 45 }, (_, index) => `n${String(index).padStart(2, "0")}.md`);
    const vault = createFakeVault(Object.fromEntries(names.map((name) => [name, "first\n"])), {
      pageSize: 500,
    });
    const failing = { batch: 0 };
    let batches = 0;
    const { store } = launch(async (input, init) => {
      if (new URL(input).pathname === VAULT_API_PATHS.files) {
        batches += 1;
        if (batches === failing.batch) {
          throw new Error("offline");
        }
      }
      return await vault.fetch(input, init);
    }, db);
    await store.refresh();
    const mirrored = vault.head();
    expect(await mirroredCommit(db)).toBe(mirrored);

    vault.change(Object.fromEntries(names.map((name) => [name, `${name} second\n`])));
    failing.batch = batches + 2;
    await store.refresh();
    expect(await mirroredCommit(db)).toBe(mirrored);
    expect(store.tree.get()).toMatchObject({
      progress: null,
      refreshError: "Could not reach the cloud: offline",
    });
    expect(await store.readNote("n00.md")).toMatchObject({ content: "n00.md second\n" });

    vault.requests.length = 0;
    await store.refresh();
    expect(requestsOf(vault, "files")).toEqual([
      `files n40.md,n41.md,n42.md,n43.md,n44.md @${vault.head()}`,
    ]);
    expect(await mirroredCommit(db)).toBe(vault.head());
    expect(store.tree.get()).toMatchObject({ refreshError: null });
  });

  it("shows a first mirror cut short with its count, and resumes it", async () => {
    const db = openTempDb();
    const vault = createFakeVault(
      Object.fromEntries(
        Array.from({ length: 45 }, (_, index) => [`n${String(index)}.md`, `${String(index)}\n`]),
      ),
      { pageSize: 500 },
    );
    let batches = 0;
    const { store } = launch(async (input, init) => {
      if (new URL(input).pathname === VAULT_API_PATHS.files) {
        batches += 1;
        if (batches === 2) {
          throw new Error("offline");
        }
      }
      return await vault.fetch(input, init);
    }, db);

    await store.refresh();
    expect(await mirroredCommit(db)).toBeNull();
    expect(await heldPaths(db)).toHaveLength(40);
    expect(store.tree.get()).toMatchObject({
      progress: { fetched: 40, total: 45 },
      refreshError: "Could not reach the cloud: offline",
    });

    await store.refresh();
    expect(await mirroredCommit(db)).toBe(vault.head());
    expect(store.tree.get()).toMatchObject({ progress: null, refreshError: null });
  });

  it("writes nothing from a batch whose sign-in ended while it was in flight", async () => {
    const db = openTempDb();
    const vault = createFakeVault(VAULT);
    const mirror = createVaultMirror(db);
    let signedIn = true;
    const fence = (): boolean => signedIn;
    const releases: (() => void)[] = [];
    const client = clientOver(async (input, init) => {
      if (new URL(input).pathname === VAULT_API_PATHS.files) {
        // oxlint-disable-next-line promise/avoid-new -- a deferred: the test releases the batch by hand
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      }
      return await vault.fetch(input, init);
    });

    const walked = await mirror.walkHead(client, fence);
    expect(walked).toMatchObject({ commit: vault.head(), kind: "applied" });
    const filling = mirror.fillTexts(client, vault.head(), fence, () => {
      // progress is the store's to show
    });
    await until(() => releases.length > 0);
    signedIn = false;
    releases[0]?.();

    expect(await filling).toEqual({ kind: "fenced" });
    expect(await heldPaths(db)).toEqual([]);
    expect(await mirroredCommit(db)).toBeNull();
  });

  it("resolves a note by its alias and by its id", async () => {
    const vault = createFakeVault({
      ...VAULT,
      "projects/plan.md": `---\nid: ${NOTE_ID}\naliases:\n  - Some Alias\n---\n# Plan\n`,
    });
    const { store } = launch(vault.fetch, openTempDb());
    await store.refresh();

    expect(store.resolveWiki("Some Alias")).toBe("projects/plan.md");
    expect(store.resolveWiki("Old Title", NOTE_ID)).toBe("projects/plan.md");
  });

  it("keeps an unchanged image's asset url across a commit, and moves a changed one's", async () => {
    const vault = createFakeVault({ ...VAULT, "media/b.png": "other png" });
    const { store } = launch(vault.fetch, openTempDb());
    await store.refresh();
    const kept = store.assetSource("media/a.png")?.uri;
    const changed = store.assetSource("media/b.png")?.uri;

    vault.change({ "media/b.png": "other png, redrawn", "notes/b.md": "# b, edited\n" });
    await store.refresh();

    expect(store.assetSource("media/a.png")?.uri).toBe(kept);
    expect(store.assetSource("media/b.png")?.uri).not.toBe(changed);
    expect(store.assetSource("media/b.png")?.uri).toContain(`ref=${vault.head()}`);
  });

  it("reads a note it has not filled at the commit that named it, and keeps the text", async () => {
    const db = openTempDb();
    const vault = createFakeVault(VAULT);
    const { store } = launch(async (input, init) => {
      if (new URL(input).pathname === VAULT_API_PATHS.files) {
        throw new Error("offline");
      }
      return await vault.fetch(input, init);
    }, db);
    await store.refresh();
    const named = vault.head();
    vault.change({ "a.md": "# a, later\n" });

    expect(await store.readNote("notes/b.md")).toMatchObject({ content: "# b\n", ok: true });
    expect(requestsOf(vault, "file")).toEqual([`file ?path=notes%2Fb.md&ref=${named}`]);
    expect(await heldPaths(db)).toEqual(["notes/b.md"]);
  });

  it("counts a first mirror in, and never a later one", async () => {
    const vault = createFakeVault(
      Object.fromEntries(
        Array.from({ length: 45 }, (_, index) => [`n${String(index)}.md`, `${String(index)}\n`]),
      ),
      { pageSize: 500 },
    );
    const { store } = launch(vault.fetch, openTempDb());
    const seen: (MirrorProgress | null)[] = [];
    store.tree.subscribe(() => {
      const tree = store.tree.get();
      if (tree.state === "ready") {
        seen.push(tree.progress);
      }
    });

    await store.refresh();
    expect(seen).toContainEqual({ fetched: 40, total: 45 });
    expect(seen.at(-1)).toBeNull();

    seen.length = 0;
    vault.change({ "n1.md": "edited\n" });
    await store.refresh();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((progress) => progress === null)).toBe(true);
  });

  it("holds each changed blob's text under its own oid", async () => {
    const db = openTempDb();
    const vault = createFakeVault({ "x.md": "one\n", "y.md": "two\n" });
    const { store } = launch(vault.fetch, db);
    await store.refresh();

    vault.change({ "x.md": "two\n", "y.md": "one\n" });
    await store.refresh();

    expect(requestsOf(vault, "files")).toHaveLength(1);
    expect(await store.readNote("x.md")).toMatchObject({ content: "two\n" });
    expect(await store.readNote("y.md")).toMatchObject({ content: "one\n" });
    const rows = await db.all("SELECT path, oid FROM mirror_entries ORDER BY path");
    expect(rows).toEqual([
      { oid: blobOid("two\n"), path: "x.md" },
      { oid: blobOid("one\n"), path: "y.md" },
    ]);
  });
});
