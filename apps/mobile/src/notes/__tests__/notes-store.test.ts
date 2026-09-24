import { createCloudClient } from "@repo/api/cloud/client";
import type { CloudFetch } from "@repo/api/cloud/client";
import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import { SYNC_API_PATHS } from "@repo/api/cloud/sync/sync-schema";
import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { threadScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import { createMemorySyncStore } from "../../sync/memory-sync-store";
import { createSyncRuntime } from "../../sync/sync-runtime";
import { createMemoryNoteCache } from "../note-cache";
import type { NoteCache } from "../note-cache";
import { createNotesStore } from "../notes-store";
import type { SignInSource } from "../notes-store";

const COMMIT = "c".repeat(40);
const CREDENTIAL = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_1" };
const OTHER_CREDENTIAL = { credential: `igd_${"b".repeat(64)}`, deviceId: "dev_2" };

interface FakeCloud {
  requests: string[];
  fetch: CloudFetch;
}

const fakeCloud = (extra: Record<string, string> = {}): FakeCloud => {
  const files = new Map([
    ["a.md", "# a\n"],
    ["notes/b.md", "# b\n"],
    ["notes/deep/c.md", "# c\n"],
    ...Object.entries(extra),
  ]);
  const paths = [...files.keys()].toSorted();
  const requests: string[] = [];
  return {
    fetch: async (input) => {
      const url = new URL(input);
      requests.push(`${url.pathname}${url.search}`);
      if (url.pathname === VAULT_API_PATHS.tree) {
        const after = url.searchParams.get("after");
        const from = after === null ? paths : paths.filter((path) => path > after);
        const page = from.slice(0, 2);
        const last = page.at(-1);
        return Response.json({
          commit: COMMIT,
          entries: page.map((path) => ({ path, size: 4 })),
          next: from.length > page.length && last !== undefined ? last : null,
        });
      }
      if (url.pathname === VAULT_API_PATHS.file) {
        const path = url.searchParams.get("path") ?? "";
        const content = files.get(path);
        if (content === undefined) {
          return Response.json(
            { error: { code: "not-found", message: "That revision does not carry the path." } },
            { status: 404 },
          );
        }
        return Response.json({ commit: COMMIT, content, oid: "d".repeat(40), path });
      }
      return Response.json(
        { error: { code: "not-found", message: "No such route." } },
        { status: 404 },
      );
    },
    requests,
  };
};

const refusedAs = (code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { status: code === "unauthorized" ? 401 : 404 });

// the store reads under the sync runtime's session, as the composition root wires it
const notesOver = (fetch: CloudFetch, cache?: NoteCache) => {
  const sync = createSyncRuntime({
    cloudUrl: "https://cloud.test",
    createClient: (credential) =>
      createCloudClient({
        baseUrl: "https://cloud.test",
        credential: credential.credential,
        fetch,
      }),
    pollIntervalMs: null,
    store: createMemorySyncStore(),
  });
  const store = createNotesStore(
    cache === undefined ? { session: sync.session } : { cache, session: sync.session },
  );
  const signIn = (credential: DeviceCredential, source: SignInSource): void => {
    sync.setCredential(credential);
    store.reset(source);
  };
  const signOut = (): void => {
    sync.setCredential(null);
    store.reset(null);
  };
  return { signIn, signOut, store, sync };
};

describe("the notes store", () => {
  it("makes no request without a credential — the file is the switch here too", async () => {
    const cloud = fakeCloud();
    const { store } = notesOver(cloud.fetch);
    await store.refresh();
    expect(await store.readNote("a.md")).toEqual({ message: "Not signed in.", ok: false });
    expect(cloud.requests).toEqual([]);
    expect(store.tree.get()).toEqual({ state: "idle" });
  });

  it("walks every page into one listing pinned to one commit", async () => {
    const cloud = fakeCloud();
    const { signIn, store } = notesOver(cloud.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    const tree = store.tree.get();
    expect(tree).toEqual({
      commit: COMMIT,
      entries: [
        { path: "a.md", size: 4 },
        { path: "notes/b.md", size: 4 },
        { path: "notes/deep/c.md", size: 4 },
      ],
      state: "ready",
    });
    const second = cloud.requests[1] ?? "";
    expect(second).toContain(`ref=${COMMIT}`);
  });

  it("resolves wiki targets over the tree with the vault's own tiers", async () => {
    const cloud = fakeCloud();
    const { signIn, store } = notesOver(cloud.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    expect(store.resolveWiki("b")).toBe("notes/b.md");
    expect(store.resolveWiki("deep/c")).toBe("notes/deep/c.md");
    expect(store.resolveWiki("missing")).toBeNull();
  });

  it("caches a note at the tree's commit — one request, many reads", async () => {
    const cloud = fakeCloud();
    const { signIn, store } = notesOver(cloud.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    const first = await store.readNote("notes/b.md");
    const again = await store.readNote("notes/b.md");
    expect(first).toEqual({ commit: COMMIT, content: "# b\n", ok: true, path: "notes/b.md" });
    expect(again).toEqual(first);
    const fileRequests = cloud.requests.filter((line) => line.startsWith(VAULT_API_PATHS.file));
    expect(fileRequests).toHaveLength(1);
  });

  it("reads 'no hosted vault' as the empty STATE, not an error", async () => {
    const { signIn, store } = notesOver(async () =>
      refusedAs("not-found", "This account has no hosted vault yet."),
    );
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    const tree = store.tree.get();
    expect(tree.state).toBe("empty");
  });

  it("keeps a ready listing when a later refresh cannot reach the cloud", async () => {
    const cloud = fakeCloud();
    let offline = false;
    const { signIn, store } = notesOver(async (input, init) => {
      if (offline) {
        throw new Error("offline");
      }
      return await cloud.fetch(input, init);
    });
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    const ready = store.tree.get();
    expect(ready.state).toBe("ready");

    offline = true;
    await store.refresh();
    expect(store.tree.get()).toBe(ready);
  });

  it("a response from the previous sign-in never lands — the session fence", async () => {
    const releases: (() => void)[] = [];
    // oxlint-disable-next-line promise/avoid-new -- a deferred: the test releases the fetch by hand
    const gate = new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    const inner = fakeCloud();
    const { signIn, signOut, store } = notesOver(async (input, init) => {
      await gate;
      return await inner.fetch(input, init);
    });
    signIn(CREDENTIAL, "restored");
    const pending = store.refresh();
    signOut();
    releases[0]?.();
    await pending;
    expect(store.tree.get()).toEqual({ state: "idle" });
  });

  it("signing in again resets the previous account's state before the new client serves", async () => {
    const cloud = fakeCloud();
    const { signIn, store } = notesOver(cloud.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    expect(store.tree.get().state).toBe("ready");
    signIn(OTHER_CREDENTIAL, "signed-in");
    expect(store.tree.get()).toEqual({ state: "idle" });
    expect(store.resolveWiki("b")).toBeNull();
  });

  it("signing out clears everything and answers idle", async () => {
    const cloud = fakeCloud();
    const { signIn, signOut, store } = notesOver(cloud.fetch);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    signOut();
    expect(store.tree.get()).toEqual({ state: "idle" });
    expect(store.resolveWiki("b")).toBeNull();
    expect(await store.readNote("a.md")).toEqual({ message: "Not signed in.", ok: false });
  });

  it("composes an asset source pinned to the tree's commit, credential in a header", async () => {
    const cloud = fakeCloud();
    const { signIn, signOut, store } = notesOver(cloud.fetch);
    signIn(CREDENTIAL, "restored");
    expect(store.assetSource("media/a.png")).toBeNull();
    await store.refresh();
    const source = store.assetSource("media/a.png");
    expect(source).not.toBeNull();
    const url = new URL(source?.uri ?? "");
    expect(url.pathname).toBe("/v1/vault/asset");
    expect(url.searchParams.get("path")).toBe("media/a.png");
    expect(url.searchParams.get("ref")).toBe(COMMIT);
    expect(source?.headers).toEqual({ authorization: `Bearer ${CREDENTIAL.credential}` });
    expect(store.assetSource("media/a.png")).toBe(source);
    signOut();
    expect(store.assetSource("media/a.png")).toBeNull();
  });
});

describe("the notes store under the sync session", () => {
  it("ends the sign-in when a vault read is refused as unauthorized", async () => {
    const cloud = fakeCloud();
    const { signIn, store, sync } = notesOver(async (input, init) =>
      new URL(input).pathname === VAULT_API_PATHS.file
        ? refusedAs("unauthorized", "This device was signed out.")
        : await cloud.fetch(input, init),
    );
    signIn(CREDENTIAL, "restored");
    await store.refresh();

    const read = await store.readNote("a.md");

    expect(read).toEqual({ message: "This device was signed out.", ok: false });
    expect(sync.get()).toMatchObject({ deviceId: CREDENTIAL.deviceId, state: "unauthorized" });
  });

  it("refuses a read once the sync side has heard unauthorized, without asking the cloud", async () => {
    const cloud = fakeCloud();
    const { signIn, store, sync } = notesOver(async (input, init) =>
      new URL(input).pathname === SYNC_API_PATHS.pull
        ? refusedAs("unauthorized", "This device was signed out.")
        : await cloud.fetch(input, init),
    );
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    const before = cloud.requests.length;

    await sync.syncNow();

    expect(sync.get().state).toBe("unauthorized");
    expect(await store.readNote("a.md")).toEqual({ message: "Not signed in.", ok: false });
    expect(store.assetSource("media/a.png")).toBeNull();
    expect(cloud.requests).toHaveLength(before);
  });
});

// every object carries a field this build never declared
const grownWorker: CloudFetch = async (input) => {
  const url = new URL(input);
  if (url.pathname === VAULT_API_PATHS.tree) {
    return Response.json({
      commit: COMMIT,
      entries: [{ mode: "100644", path: "a.md", size: 4 }],
      next: null,
      walkedAt: 1,
    });
  }
  if (url.pathname === VAULT_API_PATHS.file) {
    return Response.json({
      commit: COMMIT,
      content: "# a\n",
      encoding: "utf-8",
      oid: "d".repeat(40),
      path: "a.md",
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
  it("reads a tree page, a note and a pull that grew a field, keeping what it declares", async () => {
    const { signIn, store, sync } = notesOver(grownWorker);
    signIn(CREDENTIAL, "restored");

    await store.refresh();
    await sync.syncNow();

    expect(store.tree.get()).toEqual({
      commit: COMMIT,
      entries: [{ path: "a.md", size: 4 }],
      state: "ready",
    });
    expect(await store.readNote("a.md")).toEqual({
      commit: COMMIT,
      content: "# a\n",
      ok: true,
      path: "a.md",
    });
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

const recordingCache = () => {
  const inner = createMemoryNoteCache(100);
  const calls: string[] = [];
  return {
    cache: {
      clear: async () => {
        calls.push("clear");
        await inner.clear();
      },
      get: async (commit, path) => {
        calls.push(`get ${path}`);
        return await inner.get(commit, path);
      },
      set: async (note) => {
        calls.push(`set ${note.path}@${note.commit}`);
        await inner.set(note);
      },
      sweep: async (keepCommit) => {
        calls.push(`sweep ${keepCommit}`);
        await inner.sweep(keepCommit);
      },
    } satisfies NoteCache,
    calls,
  };
};

describe("the notes store over a durable cache", () => {
  it("serves a cached note across a relaunch — no second request", async () => {
    const { cache } = recordingCache();
    const firstLaunch = fakeCloud();
    const first = notesOver(firstLaunch.fetch, cache);
    first.signIn(CREDENTIAL, "restored");
    await first.store.refresh();
    await first.store.readNote("notes/b.md");

    const secondLaunch = fakeCloud();
    const second = notesOver(secondLaunch.fetch, cache);
    second.signIn(CREDENTIAL, "restored");
    await second.store.refresh();
    const read = await second.store.readNote("notes/b.md");
    expect(read).toEqual({ commit: COMMIT, content: "# b\n", ok: true, path: "notes/b.md" });
    const fileRequests = secondLaunch.requests.filter((line) =>
      line.startsWith(VAULT_API_PATHS.file),
    );
    expect(fileRequests).toEqual([]);
  });

  it("never caches a read the tree did not pin — 'head' moves", async () => {
    const { cache, calls } = recordingCache();
    const cloud = fakeCloud();
    const { signIn, store } = notesOver(cloud.fetch, cache);
    signIn(CREDENTIAL, "restored");
    // no refresh on purpose: the read must be unpinned.
    const read = await store.readNote("a.md");
    expect(read.ok).toBe(true);
    expect(calls.filter((line) => line.startsWith("get"))).toEqual([]);
    expect(calls.filter((line) => line.startsWith("set"))).toEqual([]);
  });

  it("sweeps to the tree's commit on every refresh", async () => {
    const { cache, calls } = recordingCache();
    const cloud = fakeCloud();
    const { signIn, store } = notesOver(cloud.fetch, cache);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    expect(calls).toContain(`sweep ${COMMIT}`);
  });

  it("a cache hit landing after a sign-out is refused — the fence covers the disk too", async () => {
    const inner = createMemoryNoteCache(100);
    const releases: (() => void)[] = [];
    const cache: NoteCache = {
      ...inner,
      get: async (commit, path) => {
        // oxlint-disable-next-line promise/avoid-new -- a deferred: the test releases the read by hand
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return await inner.get(commit, path);
      },
    };
    const cloud = fakeCloud();
    const { signIn, signOut, store } = notesOver(cloud.fetch, cache);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    await inner.set({ commit: COMMIT, content: "# a\n", path: "a.md" });

    const pending = store.readNote("a.md");
    signOut();
    releases[0]?.();
    expect(await pending).toEqual({ message: "Not signed in.", ok: false });
  });

  it("wipes on a sign-in and on sign-out; the boot restore keeps its rows", () => {
    const { cache, calls } = recordingCache();
    const { signIn, signOut } = notesOver(fakeCloud().fetch, cache);
    signIn(CREDENTIAL, "restored");
    expect(calls).toEqual([]);
    signIn(CREDENTIAL, "signed-in");
    expect(calls).toEqual(["clear"]);
    signIn(OTHER_CREDENTIAL, "signed-in");
    expect(calls).toEqual(["clear", "clear"]);
    signOut();
    expect(calls).toEqual(["clear", "clear", "clear"]);
  });

  it("swallows a cache that throws — the guarantee is the store's, not the adapter's", async () => {
    const angry: NoteCache = {
      clear: async () => {
        throw new Error("disk");
      },
      get: async () => {
        throw new Error("disk");
      },
      set: async () => {
        throw new Error("disk");
      },
      sweep: async () => {
        throw new Error("disk");
      },
    };
    const cloud = fakeCloud();
    const { signIn, store } = notesOver(cloud.fetch, angry);
    signIn(CREDENTIAL, "restored");
    await store.refresh();
    expect(store.tree.get().state).toBe("ready");
    expect(await store.readNote("notes/b.md")).toEqual({
      commit: COMMIT,
      content: "# b\n",
      ok: true,
      path: "notes/b.md",
    });
  });
});

const signedInStore = async (extra: Record<string, string>) => {
  const cloud = fakeCloud(extra);
  const { signIn, store } = notesOver(cloud.fetch);
  signIn(CREDENTIAL, "restored");
  await store.refresh();
  return { cloud, store };
};

describe("a note's comments on the phone", () => {
  const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
  const NOTE = `---\nid: ${NOTE_ID}\n---\nThe %%i:c1:start%%plan%%i:c1:end%% holds.\n`;
  const STORE = JSON.stringify({
    c1: { createdAt: 1, source: "user", text: "Does it?", updatedAt: 1 },
    "c1-r1": { createdAt: 2, parentId: "c1", source: "agent", text: "It does.", updatedAt: 2 },
  });

  it("folds the store at the note's id against the note's own markers", async () => {
    const { store } = await signedInStore({
      "notes/d.md": NOTE,
      [`.inteligir/comments/${NOTE_ID}.json`]: STORE,
    });
    const read = await store.readComments("notes/d.md");
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(read.threads.map((thread) => thread.rootId)).toEqual(["c1"]);
    expect(read.threads[0]?.anchored).toBe(true);
    expect(read.threads[0]?.replies.map((reply) => reply.entry.text)).toEqual(["It does."]);
  });

  it("answers no comments for a note without an id, and for one whose store is absent", async () => {
    const { store, cloud } = await signedInStore({ "notes/d.md": NOTE });
    expect(await store.readComments("a.md")).toEqual({ ok: true, threads: [] });
    expect(await store.readComments("notes/d.md")).toEqual({ ok: true, threads: [] });
    const storeRequests = cloud.requests.filter((line) => line.includes(".inteligir"));
    expect(storeRequests).toHaveLength(1);
  });

  it("reports an unreadable store rather than showing nothing", async () => {
    const { store } = await signedInStore({
      "notes/d.md": NOTE,
      [`.inteligir/comments/${NOTE_ID}.json`]: "{broken",
    });
    const read = await store.readComments("notes/d.md");
    expect(read.ok).toBe(false);
  });
});
