import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { createMemoryNoteCache, type NoteCache } from "../note-cache";
import { createNotesStore } from "../notes-store";

const COMMIT = "c".repeat(40);
const CREDENTIAL = { deviceId: "dev_1", credential: `igd_${"a".repeat(64)}` };
const OTHER_CREDENTIAL = { deviceId: "dev_2", credential: `igd_${"b".repeat(64)}` };

function restored(credential: typeof CREDENTIAL) {
  return { credential, source: "restored" } as const;
}

function paired(credential: typeof CREDENTIAL) {
  return { credential, source: "paired" } as const;
}

interface FakeCloud {
  requests: string[];
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

function fakeCloud(): FakeCloud {
  const files = new Map([
    ["a.md", "# a\n"],
    ["notes/b.md", "# b\n"],
    ["notes/deep/c.md", "# c\n"],
  ]);
  const paths = [...files.keys()].toSorted();
  const requests: string[] = [];
  return {
    requests,
    fetch: (input) => {
      const url = new URL(input);
      requests.push(`${url.pathname}${url.search}`);
      if (url.pathname === VAULT_API_PATHS.tree) {
        const after = url.searchParams.get("after");
        const from = after === null ? paths : paths.filter((path) => path > after);
        const page = from.slice(0, 2);
        const last = page.at(-1);
        return Promise.resolve(
          Response.json({
            commit: COMMIT,
            entries: page.map((path) => ({ path, size: 4 })),
            next: from.length > page.length && last !== undefined ? last : null,
          }),
        );
      }
      if (url.pathname === VAULT_API_PATHS.file) {
        const path = url.searchParams.get("path") ?? "";
        const content = files.get(path);
        if (content === undefined) {
          return Promise.resolve(
            Response.json(
              { error: { code: "not-found", message: "That revision does not carry the path." } },
              { status: 404 },
            ),
          );
        }
        return Promise.resolve(
          Response.json({ commit: COMMIT, path, oid: "d".repeat(40), content }),
        );
      }
      return Promise.resolve(
        Response.json({ error: { code: "not-found", message: "No such route." } }, { status: 404 }),
      );
    },
  };
}

describe("the notes store", () => {
  it("makes no request without a credential — the file is the switch here too", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    await store.refresh();
    expect(await store.readNote("a.md")).toEqual({ ok: false, message: "Not paired." });
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
      state: "ready",
      commit: COMMIT,
      entries: [
        { path: "a.md", size: 4 },
        { path: "notes/b.md", size: 4 },
        { path: "notes/deep/c.md", size: 4 },
      ],
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
    expect(first).toEqual({ ok: true, path: "notes/b.md", commit: COMMIT, content: "# b\n" });
    expect(again).toEqual(first);
    const fileRequests = cloud.requests.filter((line) => line.startsWith(VAULT_API_PATHS.file));
    expect(fileRequests).toHaveLength(1);
  });

  it("reads 'no hosted vault' as the empty STATE, not an error", async () => {
    const store = createNotesStore({
      cloudUrl: "https://cloud.test",
      fetch: () =>
        Promise.resolve(
          Response.json(
            { error: { code: "not-found", message: "This account has no hosted vault yet." } },
            { status: 404 },
          ),
        ),
    });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    const tree = store.tree.get();
    expect(tree.state).toBe("empty");
  });

  it("a response from the previous pairing never lands — the generation fence", async () => {
    const releases: Array<() => void> = [];
    const gate = new Promise<void>((resolve) => releases.push(resolve));
    const inner = fakeCloud();
    const store = createNotesStore({
      cloudUrl: "https://cloud.test",
      fetch: async (input, init) => {
        await gate;
        return inner.fetch(input, init);
      },
    });
    store.setCredential(restored(CREDENTIAL));
    const pending = store.refresh();
    store.setCredential(null);
    releases[0]?.();
    await pending;
    expect(store.tree.get()).toEqual({ state: "idle" });
  });

  it("re-pairing resets the previous account's state before the new client serves", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    expect(store.tree.get().state).toBe("ready");
    store.setCredential(paired(OTHER_CREDENTIAL));
    expect(store.tree.get()).toEqual({ state: "idle" });
    expect(store.resolveWiki("b")).toBeNull();
  });

  it("unpairing clears everything and answers idle", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    store.setCredential(null);
    expect(store.tree.get()).toEqual({ state: "idle" });
    expect(store.resolveWiki("b")).toBeNull();
    expect(await store.readNote("a.md")).toEqual({ ok: false, message: "Not paired." });
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

function recordingCache() {
  const inner = createMemoryNoteCache(100);
  const calls: string[] = [];
  return {
    calls,
    cache: {
      get: (commit, path) => {
        calls.push(`get ${path}`);
        return inner.get(commit, path);
      },
      set: (note) => {
        calls.push(`set ${note.path}@${note.commit}`);
        return inner.set(note);
      },
      sweep: (keepCommit) => {
        calls.push(`sweep ${keepCommit}`);
        return inner.sweep(keepCommit);
      },
      clear: () => {
        calls.push("clear");
        return inner.clear();
      },
    } satisfies NoteCache,
  };
}

describe("the notes store over a durable cache", () => {
  it("serves a cached note across a relaunch — no second request", async () => {
    const { cache } = recordingCache();
    const firstLaunch = fakeCloud();
    const first = createNotesStore({
      cloudUrl: "https://cloud.test",
      fetch: firstLaunch.fetch,
      cache,
    });
    first.setCredential(restored(CREDENTIAL));
    await first.refresh();
    await first.readNote("notes/b.md");

    const secondLaunch = fakeCloud();
    const second = createNotesStore({
      cloudUrl: "https://cloud.test",
      fetch: secondLaunch.fetch,
      cache,
    });
    second.setCredential(restored(CREDENTIAL));
    await second.refresh();
    const read = await second.readNote("notes/b.md");
    expect(read).toEqual({ ok: true, path: "notes/b.md", commit: COMMIT, content: "# b\n" });
    const fileRequests = secondLaunch.requests.filter((line) =>
      line.startsWith(VAULT_API_PATHS.file),
    );
    expect(fileRequests).toEqual([]);
  });

  it("never caches a read the tree did not pin — 'head' moves", async () => {
    const { cache, calls } = recordingCache();
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch, cache });
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
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch, cache });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    expect(calls).toContain(`sweep ${COMMIT}`);
  });

  it("a cache hit landing after an unpair is refused — the fence covers the disk too", async () => {
    const inner = createMemoryNoteCache(100);
    const releases: Array<() => void> = [];
    const cache: NoteCache = {
      ...inner,
      get: async (commit, path) => {
        await new Promise<void>((resolve) => releases.push(resolve));
        return inner.get(commit, path);
      },
    };
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch, cache });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    await inner.set({ commit: COMMIT, path: "a.md", content: "# a\n" });

    const pending = store.readNote("a.md");
    store.setCredential(null);
    releases[0]?.();
    expect(await pending).toEqual({ ok: false, message: "Not paired." });
  });

  it("wipes on a pairing and on unpair; the boot restore keeps its rows", () => {
    const { cache, calls } = recordingCache();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", cache });
    store.setCredential(restored(CREDENTIAL));
    expect(calls).toEqual([]);
    store.setCredential(paired(CREDENTIAL));
    expect(calls).toEqual(["clear"]);
    store.setCredential(paired(OTHER_CREDENTIAL));
    expect(calls).toEqual(["clear", "clear"]);
    store.setCredential(null);
    expect(calls).toEqual(["clear", "clear", "clear"]);
  });

  it("swallows a cache that throws — the guarantee is the store's, not the adapter's", async () => {
    const angry: NoteCache = {
      get: () => Promise.reject(new Error("disk")),
      set: () => Promise.reject(new Error("disk")),
      sweep: () => Promise.reject(new Error("disk")),
      clear: () => Promise.reject(new Error("disk")),
    };
    const cloud = fakeCloud();
    const store = createNotesStore({
      cloudUrl: "https://cloud.test",
      fetch: cloud.fetch,
      cache: angry,
    });
    store.setCredential(restored(CREDENTIAL));
    await store.refresh();
    expect(store.tree.get().state).toBe("ready");
    expect(await store.readNote("notes/b.md")).toEqual({
      ok: true,
      path: "notes/b.md",
      commit: COMMIT,
      content: "# b\n",
    });
  });
});
