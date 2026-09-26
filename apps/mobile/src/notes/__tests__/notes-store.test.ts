import { createCloudClient } from "@repo/api/cloud/client";
import type { CloudFetch } from "@repo/api/cloud/client";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import { SYNC_API_PATHS } from "@repo/api/cloud/sync/sync-schema";
import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { threadScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import type { SqlDriver } from "../../lib/sql-driver";
import { createSyncRuntime } from "../../sync/sync-runtime";
import { createNotesStore } from "../notes-store";
import type { CommentsRead, NotesStore, SignInSource } from "../notes-store";
import { blobOid, createFakeVault, requestsOf } from "./fake-vault";
import type { FakeVault } from "./fake-vault";
import { openSyncStore, openTempDb, phonePorts } from "./phone-storage";

const CREDENTIAL = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_1" };
const OTHER_CREDENTIAL = { credential: `igd_${"b".repeat(64)}`, deviceId: "dev_2" };
const COMMIT = "c".repeat(40);

const VAULT = {
  "a.md": "# a\n",
  "media/a.png": "png bytes",
  "notes/b.md": "# b\n",
  "notes/deep/c.md": "# c\n",
};

const fakeVault = (extra: Record<string, string> = {}): FakeVault =>
  createFakeVault({ ...VAULT, ...extra });

const nextTask = async (): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- a macrotask: every settled promise has run by then
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

const refusedAs = (code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { status: code === "unauthorized" ? 401 : 404 });

// the store reads under the sync runtime's session, as the composition root wires it
const notesOver = (fetch: CloudFetch, db: SqlDriver = openTempDb()) => {
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
  const ports = phonePorts();
  const { attachments } = ports;
  const store = createNotesStore({ ...ports, db, session: sync.session });
  const signIn = (credential: DeviceCredential, source: SignInSource): void => {
    sync.setCredential(credential);
    store.reset(source);
  };
  const signOut = (): void => {
    sync.setCredential(null);
    store.reset(null);
  };
  return { attachments, signIn, signOut, store, sync };
};

const entry = (path: string, content: string) => ({
  oid: blobOid(content),
  path,
  size: Buffer.byteLength(content),
});

describe("the notes store", () => {
  it("makes no request without a credential — the file is the switch here too", async () => {
    const vault = fakeVault();
    const { store } = notesOver(vault.fetch);
    await store.refresh();
    expect(await store.readNote("a.md")).toEqual({
      message: "Not signed in.",
      notFound: false,
      ok: false,
    });
    expect(vault.requests).toEqual([]);
    expect(store.tree.get()).toEqual({ state: "idle" });
  });

  it("walks every page into one listing pinned to one commit", async () => {
    const vault = fakeVault();
    const { signIn, store } = notesOver(vault.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    expect(store.tree.get()).toEqual({
      entries: Object.entries(VAULT).map(([path, content]) => entry(path, content)),
      progress: null,
      refreshError: null,
      state: "ready",
    });
    expect(requestsOf(vault, "tree")[1]).toContain(`ref=${vault.head()}`);
  });

  it("holds every note's text after a refresh — a read asks nothing more", async () => {
    const vault = fakeVault();
    const { signIn, store } = notesOver(vault.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    const before = vault.requests.length;
    expect(await store.readNote("notes/b.md")).toEqual({
      content: "# b\n",
      ok: true,
      path: "notes/b.md",
    });
    expect(vault.requests).toHaveLength(before);
    // an attachment is not text the mirror wants
    expect(requestsOf(vault, "files").join(" ")).not.toContain("media/a.png");
  });

  it("reads 'no hosted vault' as the empty STATE, not an error", async () => {
    const { signIn, store } = notesOver(async () =>
      refusedAs("not-found", "This account has no hosted vault yet."),
    );
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    expect(store.tree.get().state).toBe("empty");
  });

  it("keeps a ready listing when a later refresh cannot reach the cloud", async () => {
    const vault = fakeVault();
    let offline = false;
    const { signIn, store } = notesOver(async (input, init) => {
      if (offline) {
        throw new Error("offline");
      }
      return await vault.fetch(input, init);
    });
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    const ready = store.tree.get();
    expect(ready.state).toBe("ready");

    offline = true;
    await store.refresh();
    expect(store.tree.get()).toEqual({
      ...ready,
      refreshError: "Could not reach the cloud: offline",
    });
    expect(store.heldFiles().map((file) => file.path)).toContain("notes/b.md");

    offline = false;
    await store.refresh();
    expect(store.tree.get()).toEqual(ready);
  });

  it("keeps a ready listing when the vault grows past what the list pages", async () => {
    const vault = fakeVault();
    let endless = false;
    const { signIn, store } = notesOver(async (input, init) =>
      endless && new URL(input).pathname === VAULT_API_PATHS.tree
        ? Response.json({
            commit: COMMIT,
            entries: [entry("a.md", "# a\n")],
            next: "a.md",
          })
        : await vault.fetch(input, init),
    );
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    const ready = store.tree.get();

    endless = true;
    await store.refresh();

    expect(store.tree.get()).toEqual({
      ...ready,
      refreshError: "This vault is too large for the notes list.",
    });
  });

  it("asks for one page and keeps the listing whole when head has not moved", async () => {
    const vault = fakeVault();
    const { signIn, store } = notesOver(vault.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    const ready = store.tree.get();
    const walked = requestsOf(vault, "tree").length;
    expect(walked).toBeGreaterThan(1);

    await store.refresh();

    expect(requestsOf(vault, "tree")).toHaveLength(walked + 1);
    expect(store.tree.get()).toBe(ready);
    expect(store.heldFiles().map((file) => file.path)).toContain("notes/b.md");
  });

  it("is an error only when there is no listing to keep", async () => {
    const { signIn, store } = notesOver(async () => {
      throw new Error("offline");
    });
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    expect(store.tree.get()).toEqual({
      message: "Could not reach the cloud: offline",
      state: "error",
    });
  });

  it("a refresh asked while one runs joins it, and resolves once the mirror lands", async () => {
    const releases: (() => void)[] = [];
    const vault = fakeVault();
    const { signIn, store } = notesOver(async (input, init) => {
      // oxlint-disable-next-line promise/avoid-new -- a deferred: the test releases the fetch by hand
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      return await vault.fetch(input, init);
    });
    signIn(CREDENTIAL, "restored");
    const settled = { count: 0 };
    const first = (async () => {
      await store.refresh();
      settled.count += 1;
    })();
    const joined = (async () => {
      await store.refresh();
      settled.count += 1;
    })();

    await nextTask();
    expect(settled.count).toBe(0);
    while (settled.count < 2) {
      releases.shift()?.();
      await nextTask();
    }
    await Promise.all([first, joined]);

    expect(requestsOf(vault, "tree")).toHaveLength(2);
    expect(requestsOf(vault, "files")).toHaveLength(1);
  });

  it("a response from the previous sign-in never lands — the session fence", async () => {
    const releases: (() => void)[] = [];
    // oxlint-disable-next-line promise/avoid-new -- a deferred: the test releases the fetch by hand
    const gate = new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    const vault = fakeVault();
    const { signIn, signOut, store } = notesOver(async (input, init) => {
      await gate;
      return await vault.fetch(input, init);
    });
    signIn(CREDENTIAL, "restored");
    const pending = store.refresh();
    signOut();
    releases[0]?.();
    await pending;
    expect(store.tree.get()).toEqual({ state: "idle" });
  });

  it("signing in again resets the previous account's state before the new client serves", async () => {
    const vault = fakeVault();
    const { signIn, store } = notesOver(vault.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    expect(store.tree.get().state).toBe("ready");
    signIn(OTHER_CREDENTIAL, "signed-in");
    expect(store.tree.get()).toEqual({ state: "idle" });
    expect(store.heldFiles()).toEqual([]);
  });

  it("signing out clears everything and answers idle", async () => {
    const vault = fakeVault();
    const { signIn, signOut, store } = notesOver(vault.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    signOut();
    expect(store.tree.get()).toEqual({ state: "idle" });
    expect(store.heldFiles()).toEqual([]);
    expect(await store.readNote("a.md")).toEqual({
      message: "Not signed in.",
      notFound: false,
      ok: false,
    });
  });

  it("downloads an attachment once, named by its blob, and serves the file after", async () => {
    const vault = fakeVault();
    const { attachments, signIn, store } = notesOver(vault.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();

    const name = `${blobOid("png bytes")}.png`;
    expect(await store.attachmentFile("media/a.png")).toEqual({
      ok: true,
      uri: `memory://${name}`,
    });
    expect(await store.attachmentFile("media/a.png")).toEqual({
      ok: true,
      uri: `memory://${name}`,
    });

    expect(requestsOf(vault, "asset")).toHaveLength(1);
    // pinned to the commit its blob arrived at, which a later commit leaving it alone keeps
    expect(requestsOf(vault, "asset")[0]).toContain(`ref=${vault.head()}`);
    expect(attachments.names()).toEqual([name]);
  });
});

describe("the notes store under the sync session", () => {
  it("ends the sign-in when a vault read is refused as unauthorized", async () => {
    const vault = fakeVault();
    const { signIn, store, sync } = notesOver(async (input, init) =>
      new URL(input).pathname === VAULT_API_PATHS.file
        ? refusedAs("unauthorized", "This device was signed out.")
        : await vault.fetch(input, init),
    );
    signIn(CREDENTIAL, "restored");
    await store.refresh();

    const read = await store.readNote("not-yet-mirrored.md");

    expect(read).toEqual({ message: "This device was signed out.", notFound: false, ok: false });
    expect(sync.get()).toMatchObject({ deviceId: CREDENTIAL.deviceId, state: "unauthorized" });
  });

  it("refuses a read once the sync side has heard unauthorized, without asking the cloud", async () => {
    const vault = fakeVault();
    const { signIn, store, sync } = notesOver(async (input, init) =>
      new URL(input).pathname === SYNC_API_PATHS.pull
        ? refusedAs("unauthorized", "This device was signed out.")
        : await vault.fetch(input, init),
    );
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    const before = vault.requests.length;

    await sync.syncNow();

    expect(sync.get().state).toBe("unauthorized");
    expect(await store.readNote("a.md")).toEqual({
      message: "Not signed in.",
      notFound: false,
      ok: false,
    });
    expect(await store.attachmentFile("media/a.png")).toStrictEqual({
      message: "Not signed in.",
      ok: false,
    });
    expect(vault.requests).toHaveLength(before);
  });
});

const GROWN_OID = blobOid("# a\n");

// every object carries a field this build never declared
const grownWorker: CloudFetch = async (input) => {
  const url = new URL(input);
  if (url.pathname === VAULT_API_PATHS.tree) {
    return Response.json({
      commit: COMMIT,
      entries: [{ mode: "100644", oid: GROWN_OID, path: "a.md", size: 4 }],
      next: null,
      walkedAt: 1,
    });
  }
  if (url.pathname === VAULT_API_PATHS.files) {
    return Response.json({
      commit: COMMIT,
      deferred: [],
      files: [{ content: "# a\n", encoding: "utf-8", oid: GROWN_OID, path: "a.md" }],
      missing: [],
      refused: [],
      spent: 4,
    });
  }
  if (url.pathname === SYNC_API_PATHS.pull) {
    return Response.json({
      events: [
        {
          createdAt: 0,
          deviceId: "dev_desktop",
          deviceSeq: 0,
          event: {
            scope: threadScope(),
            text: "from the desktop",
            threadId: "thr_x",
            type: "client/turn/requested",
          },
          lane: "any",
          seq: 1,
          threadId: "thr_x",
        },
      ],
      hasMore: false,
      lastSeq: 1,
      retryAfterMs: 0,
    });
  }
  return refusedAs("not-found", "No such route.");
};

describe("a worker newer than this build", () => {
  it("reads a tree page, a batch of notes and a pull that grew a field, keeping what it declares", async () => {
    const { signIn, store, sync } = notesOver(grownWorker);
    signIn(CREDENTIAL, "restored");

    await store.refresh();
    await sync.syncNow();

    expect(store.tree.get()).toEqual({
      entries: [{ oid: GROWN_OID, path: "a.md", size: 4 }],
      progress: null,
      refreshError: null,
      state: "ready",
    });
    expect(await store.readNote("a.md")).toEqual({ content: "# a\n", ok: true, path: "a.md" });
    expect(sync.get()).toMatchObject({ cursor: 1, lastError: null, state: "signed-in" });
  });

  it("reads a refusal code it does not know as a fault to retry, in the worker's words", async () => {
    const { signIn, sync } = notesOver(async () =>
      Response.json(
        { error: { code: "account-paused", message: "This account is paused." } },
        { status: 403 },
      ),
    );
    signIn(CREDENTIAL, "restored");

    await sync.syncNow();

    expect(sync.get()).toMatchObject({
      lastError: "This account is paused.",
      state: "signed-in",
    });
  });

  it("still ends the sign-in on an unauthorized refusal that grew a field", async () => {
    const { signIn, store, sync } = notesOver(async () =>
      Response.json(
        { error: { code: "unauthorized", hint: "sign in again", message: "Signed out." } },
        { status: 401 },
      ),
    );
    signIn(CREDENTIAL, "restored");

    await store.refresh();

    expect(sync.get()).toMatchObject({ deviceId: CREDENTIAL.deviceId, state: "unauthorized" });
  });
});

const signedInStore = async (extra: Record<string, string>) => {
  const vault = fakeVault(extra);
  const { signIn, store } = notesOver(vault.fetch);
  signIn(CREDENTIAL, "restored");
  await store.refresh();
  return { store, vault };
};

// the screen's order: the note first, then the comments folded against that read
const commentsOf = async (store: NotesStore, path: string): Promise<CommentsRead> => {
  const note = await store.readNote(path);
  if (!note.ok) {
    throw new Error(note.message);
  }
  return await store.readComments(note);
};

describe("a note's comments on the phone", () => {
  const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
  const NOTE = `---\nid: ${NOTE_ID}\n---\nThe %%i:c1:start%%plan%%i:c1:end%% holds.\n`;
  const STORE = JSON.stringify({
    c1: { createdAt: 1, source: "user", text: "Does it?", updatedAt: 1 },
    "c1-r1": { createdAt: 2, parentId: "c1", source: "agent", text: "It does.", updatedAt: 2 },
  });

  it("folds the store at the note's id against the note's own markers, both held offline", async () => {
    const { store, vault } = await signedInStore({
      "notes/d.md": NOTE,
      [`.inteligir/comments/${NOTE_ID}.json`]: STORE,
    });
    const read = await commentsOf(store, "notes/d.md");
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(read.threads.map((thread) => thread.rootId)).toEqual(["c1"]);
    expect(read.threads[0]?.anchored).toBe(true);
    expect(read.threads[0]?.replies.map((reply) => reply.entry.text)).toEqual(["It does."]);
    expect(requestsOf(vault, "file")).toEqual([]);
  });

  it("answers no comments for a note without an id, and for one the tree holds no store for, without asking", async () => {
    const { store, vault } = await signedInStore({ "notes/d.md": NOTE });
    expect(await commentsOf(store, "a.md")).toEqual({ ok: true, threads: [] });
    expect(await commentsOf(store, "notes/d.md")).toEqual({ ok: true, threads: [] });
    expect(vault.requests.filter((line) => line.includes(".inteligir"))).toEqual([]);
  });

  it("asks for the store while no tree has landed, and reads a missing one as none", async () => {
    const vault = fakeVault({ "notes/d.md": NOTE });
    const { signIn, store } = notesOver(vault.fetch);
    signIn(CREDENTIAL, "restored");
    expect(await commentsOf(store, "notes/d.md")).toEqual({ ok: true, threads: [] });
    expect(vault.requests.filter((line) => line.includes(".inteligir"))).toHaveLength(1);
  });

  it("reports an unreadable store rather than showing nothing", async () => {
    const { store } = await signedInStore({
      "notes/d.md": NOTE,
      [`.inteligir/comments/${NOTE_ID}.json`]: "{broken",
    });
    const read = await commentsOf(store, "notes/d.md");
    expect(read.ok).toBe(false);
  });
});
