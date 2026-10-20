import { createCloudClient } from "@repo/contract/cloud/client";
import type { CloudFetch } from "@repo/contract/cloud/client";
import type { DeviceCredential } from "@repo/contract/cloud/device/device-schema";
import { DEVICE_API_PATHS } from "@repo/contract/cloud/device/device-schema";
import { VAULT_API_PATHS } from "@repo/contract/cloud/vault/vault-schema";
import { TEST_BUILD } from "@repo/contract/cloud/test-support/fake-cloud-client";
import { describe, expect, it, vi } from "vitest";
import { deferred, nextTask } from "../test-support/async";
import type { SignInSource } from "../lib/sign-in-fence";
import type { SqlDriver } from "../lib/sql-driver";
import { createSyncRuntime } from "../sync/sync-runtime";
import { createNotesStore } from "./notes-store";
import type { AnnotationsRead, NotesStore } from "./notes-store";
import { blobOid, createFakeVault, requestsOf } from "./test-support/fake-vault";
import type { FakeVault } from "./test-support/fake-vault";
import { openTempDb, phonePorts } from "./test-support/phone-storage";

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

const refusedAs = (code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { status: code === "unauthorized" ? 401 : 404 });

// the store reads under the sync runtime's session, as the composition root wires it
const notesOver = (fetch: CloudFetch, db: SqlDriver = openTempDb()) => {
  const sync = createSyncRuntime({
    build: TEST_BUILD,
    cloudUrl: "https://cloud.test",
    createClient: (credential) =>
      createCloudClient({
        baseUrl: "https://cloud.test",
        build: TEST_BUILD,
        credential: credential.credential,
        fetch,
      }),
    pollIntervalMs: null,
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
    expect(await store.readNote("a.md")).toEqual({ message: "Not signed in.", ok: false });
    expect(vault.requests).toEqual([]);
    expect(store.tree.get()).toEqual({ state: "idle" });
  });

  it("walks every page into one listing pinned to one commit", async () => {
    const vault = fakeVault();
    const { signIn, store } = notesOver(vault.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    expect(store.tree.get()).toEqual({
      entries: Object.keys(VAULT).map((path) => expect.objectContaining({ path })),
      progress: null,
      refreshError: null,
      state: "ready",
    });
    expect(requestsOf(vault, "tree")[1]).toContain(`"ref":"${vault.head()}"`);
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
      refusedAs("not-found", "This account has no online library yet."),
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
      refreshError: "This library is too large to list on your phone.",
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
      const held = deferred();
      releases.push(held.resolve);
      await held.promise;
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

    // the walk both callers waited on, then one more page that finds the head where it was
    expect(requestsOf(vault, "tree")).toHaveLength(3);
    expect(requestsOf(vault, "files")).toHaveLength(1);
  });

  it("walks again for a refresh asked mid-walk, so a head that moved meanwhile is read", async () => {
    const vault = fakeVault();
    const held = { first: false };
    const asked = deferred();
    const released = deferred();
    const { signIn, store } = notesOver(async (input, init) => {
      const response = await vault.fetch(input, init);
      if (held.first && new URL(input).pathname === VAULT_API_PATHS.tree) {
        held.first = false;
        asked.resolve();
        await released.promise;
      }
      return response;
    });
    signIn(CREDENTIAL, "restored");
    await store.refresh();

    held.first = true;
    const walking = store.refresh();
    await asked.promise;
    vault.change({ "a.md": "# a, from the mac\n" });
    const pinged = store.refresh();
    released.resolve();
    await Promise.all([walking, pinged]);

    expect(await store.readNote("a.md")).toMatchObject({ content: "# a, from the mac\n" });
  });

  it("counts an unsent row this build cannot read, so a sign-out still asks before wiping it", async () => {
    const db = openTempDb();
    await db.exclusive(async (tx) => {
      await tx.run("INSERT INTO outbox (op, state, created_at) VALUES (?, 'pending', 0)", [
        JSON.stringify({ op: "a verb from a later build", path: "a.md" }),
      ]);
    });
    const { signIn, store } = notesOver(fakeVault().fetch, db);
    signIn(CREDENTIAL, "restored");

    expect(await store.unsentCount()).toBe(1);
  });

  it("keeps a photo the vault took, so showing it downloads nothing", async () => {
    const vault = fakeVault();
    const { signIn, store } = notesOver(vault.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();

    expect(await store.putAsset("media/new.png", new TextEncoder().encode("new png"))).toEqual({
      kind: "created",
    });
    await store.drain();
    expect(vault.files()["media/new.png"]).toBe("new png");

    expect(await store.attachmentFile("media/new.png")).toMatchObject({ ok: true });
    expect(requestsOf(vault, "asset")).toEqual([]);
  });

  it("a response from the previous sign-in never lands — the session fence", async () => {
    const gate = deferred();
    const vault = fakeVault();
    const { signIn, signOut, store } = notesOver(async (input, init) => {
      await gate.promise;
      return await vault.fetch(input, init);
    });
    signIn(CREDENTIAL, "restored");
    const pending = store.refresh();
    signOut();
    gate.resolve();
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
    expect(await store.readNote("a.md")).toEqual({ message: "Not signed in.", ok: false });
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
    expect(requestsOf(vault, "asset")[0]).toContain(`"ref":"${vault.head()}"`);
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

    expect(read).toEqual({ message: "This device was signed out.", ok: false });
    expect(sync.get()).toMatchObject({ deviceId: CREDENTIAL.deviceId, state: "unauthorized" });
  });

  it("refuses a read once the sign-in's check has heard unauthorized, without asking the cloud", async () => {
    const vault = fakeVault();
    const { signIn, store, sync } = notesOver(async (input, init) =>
      new URL(input).pathname === DEVICE_API_PATHS.list
        ? refusedAs("unauthorized", "This device was signed out.")
        : await vault.fetch(input, init),
    );
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    const before = vault.requests.length;

    sync.start();
    await vi.waitFor(() => {
      expect(sync.get().state).toBe("unauthorized");
    });
    expect(await store.readNote("a.md")).toEqual({ message: "Not signed in.", ok: false });
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
  if (url.pathname === DEVICE_API_PATHS.list) {
    return Response.json({ devices: [] });
  }
  return refusedAs("not-found", "No such route.");
};

describe("a worker newer than this build", () => {
  it("reads a tree page, a batch of notes and a check that grew a field, keeping what it declares", async () => {
    const { signIn, store, sync } = notesOver(grownWorker);
    signIn(CREDENTIAL, "restored");

    await store.refresh();
    sync.start();
    await nextTask();

    expect(store.tree.get()).toEqual({
      entries: [expect.objectContaining({ path: "a.md" })],
      progress: null,
      refreshError: null,
      state: "ready",
    });
    expect(await store.readNote("a.md")).toEqual({ content: "# a\n", ok: true, path: "a.md" });
    expect(sync.get()).toEqual({ deviceId: CREDENTIAL.deviceId, state: "signed-in" });
  });

  it("reads a refusal code it does not know as a fault to retry, never as the sign-in's end", async () => {
    const { signIn, sync } = notesOver(async () =>
      Response.json(
        { error: { code: "account-paused", message: "This account is paused." } },
        { status: 403 },
      ),
    );
    signIn(CREDENTIAL, "restored");

    sync.start();
    await nextTask();

    expect(sync.get()).toEqual({ deviceId: CREDENTIAL.deviceId, state: "signed-in" });
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

// the screen's order: the note first, then the annotations folded against that read
const annotationsOf = async (store: NotesStore, path: string): Promise<AnnotationsRead> => {
  const note = await store.readNote(path);
  if (!note.ok) {
    throw new Error(note.message);
  }
  return await store.readAnnotations(note);
};

describe("a note's annotations on the phone", () => {
  const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
  const NOTE = `---\nid: ${NOTE_ID}\n---\nThe %%i:c1:start%%plan%%i:c1:end%% holds.\n`;
  const STORE = JSON.stringify({
    c1: { createdAt: 1, source: "user", text: "Does it?", updatedAt: 1 },
    "c1-r1": { createdAt: 2, parentId: "c1", source: "agent", text: "It does.", updatedAt: 2 },
  });

  it("folds the store at the note's id against the note's own markers, both held offline", async () => {
    const { store, vault } = await signedInStore({
      "notes/d.md": NOTE,
      [`.inteligir/annotations/${NOTE_ID}.json`]: STORE,
    });
    const read = await annotationsOf(store, "notes/d.md");
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(read.annotations.map((annotation) => annotation.id)).toEqual(["c1"]);
    expect(read.annotations[0]?.anchored).toBe(true);
    expect(read.annotations[0]?.replies.map((reply) => reply.entry.text)).toEqual(["It does."]);
    expect(requestsOf(vault, "file")).toEqual([]);
  });

  it("answers no annotations for a note without an id, and for one the tree holds no store for, without asking", async () => {
    const { store, vault } = await signedInStore({ "notes/d.md": NOTE });
    expect(await annotationsOf(store, "a.md")).toEqual({ annotations: [], ok: true });
    expect(await annotationsOf(store, "notes/d.md")).toEqual({ annotations: [], ok: true });
    expect(vault.requests.filter((line) => line.includes(".inteligir"))).toEqual([]);
  });

  it("asks for the store while no tree has landed, and reads a missing one as none", async () => {
    const vault = fakeVault({ "notes/d.md": NOTE });
    const { signIn, store } = notesOver(vault.fetch);
    signIn(CREDENTIAL, "restored");
    expect(await annotationsOf(store, "notes/d.md")).toEqual({ annotations: [], ok: true });
    expect(vault.requests.filter((line) => line.includes(".inteligir"))).toHaveLength(1);
  });

  it("reports an unreadable store rather than showing nothing", async () => {
    const { store } = await signedInStore({
      "notes/d.md": NOTE,
      [`.inteligir/annotations/${NOTE_ID}.json`]: "{broken",
    });
    const read = await annotationsOf(store, "notes/d.md");
    expect(read.ok).toBe(false);
  });
});
