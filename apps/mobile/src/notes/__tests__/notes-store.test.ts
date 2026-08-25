import { VAULT_API_PATHS } from "@repo/api/cloud/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { createNotesStore } from "../notes-store";

// The read model's own rules: the credential is the switch, a paged tree
// lands as ONE listing pinned to one commit, the wiki resolver runs the
// vault's own tiers over it, and a note re-read at the same commit costs no
// second request.

const COMMIT = "c".repeat(40);
const CREDENTIAL = { deviceId: "dev_1", credential: `igd_${"a".repeat(64)}` };

interface FakeCloud {
  requests: string[];
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/** Two tree pages plus file bodies, served the way the Worker would. */
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
    store.setCredential(CREDENTIAL);
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
    // The second page carried the first page's commit, so the walk cannot
    // straddle a push.
    const second = cloud.requests[1] ?? "";
    expect(second).toContain(`ref=${COMMIT}`);
  });

  it("resolves wiki targets over the tree with the vault's own tiers", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(CREDENTIAL);
    await store.refresh();
    expect(store.resolveWiki("b")).toBe("notes/b.md");
    expect(store.resolveWiki("deep/c")).toBe("notes/deep/c.md");
    expect(store.resolveWiki("missing")).toBeNull();
  });

  it("caches a note at the tree's commit — one request, many reads", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(CREDENTIAL);
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
    store.setCredential(CREDENTIAL);
    await store.refresh();
    const tree = store.tree.get();
    expect(tree.state).toBe("empty");
  });

  it("unpairing clears everything and answers idle", async () => {
    const cloud = fakeCloud();
    const store = createNotesStore({ cloudUrl: "https://cloud.test", fetch: cloud.fetch });
    store.setCredential(CREDENTIAL);
    await store.refresh();
    store.setCredential(null);
    expect(store.tree.get()).toEqual({ state: "idle" });
    expect(store.resolveWiki("b")).toBeNull();
    expect(await store.readNote("a.md")).toEqual({ ok: false, message: "Not paired." });
  });
});
