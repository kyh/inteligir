// oxlint-disable eslint/require-await -- the stand-ins here answer async NoteCache and fetch ports
// synchronously; `async` is the contract, and dropping it trips promise-function-async
import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { createMemoryNoteCache } from "../note-cache";
import type { NoteCache } from "../note-cache";
import { createNotesStore } from "../notes-store";

const COMMIT = "c".repeat(40);
const CREDENTIAL = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_1" };
const OTHER_CREDENTIAL = { credential: `igd_${"b".repeat(64)}`, deviceId: "dev_2" };

const restored = (credential: typeof CREDENTIAL) => ({ credential, source: "restored" }) as const;

const signedIn = (credential: typeof CREDENTIAL) => ({ credential, source: "signed-in" }) as const;

interface FakeCloud {
  requests: string[];
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
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

describe("the notes store", () => {
  it("makes no request without a credential — the file is the switch here too", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    await store.refresh();
    expect(await store.readNote("a.md")).toEqual({ message: "Not signed in.", ok: false });
    expect(cloud.requests).toEqual([]);
    expect(store.tree.get()).toEqual({ state: "idle" });
  });

  it("walks every page into one listing pinned to one commit", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
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
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    expect(store.resolveWiki("b")).toBe("notes/b.md");
    expect(store.resolveWiki("deep/c")).toBe("notes/deep/c.md");
    expect(store.resolveWiki("missing")).toBeNull();
  });

  it("caches a note at the tree's commit — one request, many reads", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    const first = await store.readNote("notes/b.md");
    const again = await store.readNote("notes/b.md");
    expect(first).toEqual({ commit: COMMIT, content: "# b\n", ok: true, path: "notes/b.md" });
    expect(again).toEqual(first);
    const fileRequests = cloud.requests.filter((line) => line.startsWith(VAULT_API_PATHS.file));
    expect(fileRequests).toHaveLength(1);
  });

  it("reads 'no hosted vault' as the empty STATE, not an error", async () => {
    const store = createNotesStore({
      cloudUrl: "https://cloud.test",
      fetch: async () =>
        Response.json(
          { error: { code: "not-found", message: "This account has no hosted vault yet." } },
          { status: 404 },
        ),
    });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    const tree = store.tree.get();
    expect(tree.state).toBe("empty");
  });

  it("a response from the previous sign-in never lands — the generation fence", async () => {
    const releases: (() => void)[] = [];
    // oxlint-disable-next-line promise/avoid-new -- a deferred: the test releases the fetch by hand
    const gate = new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    const inner = fakeCloud();
    const store = createNotesStore({
      cloudUrl: "https://cloud.test",
      fetch: async (input, init) => {
        await gate;
        return await inner.fetch(input, init);
      },
    });
    store.setCredential(restored(CREDENTIAL));
    const pending = store.refresh();
    store.setCredential(null);
    releases[0]?.();
    await pending;
    expect(store.tree.get()).toEqual({ state: "idle" });
  });

  it("signing in again resets the previous account's state before the new client serves", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    expect(store.tree.get().state).toBe("ready");
    store.setCredential(signedIn(OTHER_CREDENTIAL));
    expect(store.tree.get()).toEqual({ state: "idle" });
    expect(store.resolveWiki("b")).toBeNull();
  });

  it("signing out clears everything and answers idle", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    store.setCredential(null);
    expect(store.tree.get()).toEqual({ state: "idle" });
    expect(store.resolveWiki("b")).toBeNull();
    expect(await store.readNote("a.md")).toEqual({ message: "Not signed in.", ok: false });
  });

  it("composes an asset source pinned to the tree's commit, credential in a header", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
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
    store.setCredential(null);
    expect(store.assetSource("media/a.png")).toBeNull();
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
    const first = createNotesStore({
      cache,
      cloudUrl: "https://cloud.test",
      fetch: firstLaunch.fetch,
    });
    first.setCredential(restored(CREDENTIAL));
    await first.refresh();
    await first.readNote("notes/b.md");

    const secondLaunch = fakeCloud();
    const second = createNotesStore({
      cache,
      cloudUrl: "https://cloud.test",
      fetch: secondLaunch.fetch,
    });
    second.setCredential(restored(CREDENTIAL));
    await second.refresh();
    const read = await second.readNote("notes/b.md");
    expect(read).toEqual({ commit: COMMIT, content: "# b\n", ok: true, path: "notes/b.md" });
    const fileRequests = secondLaunch.requests.filter((line) =>
      line.startsWith(VAULT_API_PATHS.file),
    );
    expect(fileRequests).toEqual([]);
  });

  it("never caches a read the tree did not pin — 'head' moves", async () => {
    const { cache, calls } = recordingCache();
    const cloud = fakeCloud();
    const store = createNotesStore({ cache, cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
    // no refresh on purpose: the read must be unpinned.
    const read = await store.readNote("a.md");
    expect(read.ok).toBe(true);
    expect(calls.filter((line) => line.startsWith("get"))).toEqual([]);
    expect(calls.filter((line) => line.startsWith("set"))).toEqual([]);
  });

  it("sweeps to the tree's commit on every refresh", async () => {
    const { cache, calls } = recordingCache();
    const cloud = fakeCloud();
    const store = createNotesStore({ cache, cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
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
    const store = createNotesStore({ cache, cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    await inner.set({ commit: COMMIT, content: "# a\n", path: "a.md" });

    const pending = store.readNote("a.md");
    store.setCredential(null);
    releases[0]?.();
    expect(await pending).toEqual({ message: "Not signed in.", ok: false });
  });

  it("wipes on a sign-in and on sign-out; the boot restore keeps its rows", () => {
    const { cache, calls } = recordingCache();
    const store = createNotesStore({ cache, cloudUrl: "https://cloud.test" });
    store.setCredential(restored(CREDENTIAL));
    expect(calls).toEqual([]);
    store.setCredential(signedIn(CREDENTIAL));
    expect(calls).toEqual(["clear"]);
    store.setCredential(signedIn(OTHER_CREDENTIAL));
    expect(calls).toEqual(["clear", "clear"]);
    store.setCredential(null);
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
    const store = createNotesStore({
      cache: angry,
      cloudUrl: "https://cloud.test",
      fetch: cloud.fetch,
    });
    store.setCredential(restored(CREDENTIAL));
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

describe("a note's comments on the phone", () => {
  const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
  const NOTE = `---\nid: ${NOTE_ID}\n---\nThe %%i:c1:start%%plan%%i:c1:end%% holds.\n`;
  const STORE = JSON.stringify({
    c1: { createdAt: 1, source: "user", text: "Does it?", updatedAt: 1 },
    "c1-r1": { createdAt: 2, parentId: "c1", source: "agent", text: "It does.", updatedAt: 2 },
  });

  const signedInStore = async (extra: Record<string, string>) => {
    const cloud = fakeCloud(extra);
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    return { cloud, store };
  };

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
