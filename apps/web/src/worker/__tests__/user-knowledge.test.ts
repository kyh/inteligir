// ---------------------------------------------------------------------------
// The knowledge index inside the UserHost Durable Object, against the real
// substrate: this object's own SQLite (FTS5 and all), the real R2 bucket, real
// hibernation.
//
// The assertions worth having here are the ones that only exist BECAUSE the
// index lives in a Durable Object: that the in-memory graph comes back from
// persisted rows after an eviction rather than from the blob store, that a
// version mismatch drops the index and rebuilds it WITHOUT touching the vault
// manifest sharing the same database, and that a rename reads the notes that
// link to its target instead of the vault.
// ---------------------------------------------------------------------------

import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { userHostName } from "../host/host-address";
import { UserKnowledge } from "../host/knowledge/user-knowledge";
import { UserVault } from "../host/vault/user-vault";
import { renameWithLinkRewrite } from "../host/vault/vault-rename";
import { authenticated, invoke, signUp, type Account } from "./host-helpers";

/** Drive the object's OWN vault and index — the pair the host wires together,
 * so a write announces itself exactly as it does in production. */
function withHost<T>(
  name: string,
  run: (ctx: {
    vault: UserVault;
    knowledge: UserKnowledge;
    state: DurableObjectState;
  }) => Promise<T>,
): Promise<T> {
  const stub = env.UserHost.getByName(userHostName(name));
  return runInDurableObject(stub, (host, state) =>
    run({ vault: host.vault, knowledge: host.knowledge, state }),
  );
}

/** Write every note, then let the index catch up — one flush, exactly as the
 * host does at the end of an inbound path. */
async function seed(
  vault: UserVault,
  knowledge: UserKnowledge,
  notes: Record<string, string>,
): Promise<void> {
  for (const [path, content] of Object.entries(notes)) await vault.writeText(path, content);
  await knowledge.flush();
}

describe("projection follows the vault", () => {
  it("indexes a write, follows a rename, and forgets a delete", async () => {
    await withHost("knowledge-lifecycle", async ({ vault, knowledge }) => {
      await seed(vault, knowledge, {
        "notes/alpha.md": "# Alpha\n\nSee [[Beta]] for more.\n",
        "beta.md": "# Beta\n",
      });

      expect(await knowledge.backlinks("beta.md")).toEqual([
        {
          sourcePath: "notes/alpha.md",
          line: 3,
          snippet: "See [[Beta]] for more.",
          kind: "wiki",
          embed: false,
        },
      ]);

      // A rename retargets the link in the source note AND moves the backlink.
      expect(await renameWithLinkRewrite(vault, knowledge, "beta.md", "gamma.md")).toEqual({
        ok: true,
      });
      await knowledge.flush();
      expect(await vault.readText("notes/alpha.md")).toContain("[[gamma]]");
      expect(await knowledge.backlinks("beta.md")).toEqual([]);
      expect((await knowledge.backlinks("gamma.md")).map((entry) => entry.sourcePath)).toEqual([
        "notes/alpha.md",
      ]);

      // A delete drops the note from the index; the link that pointed at it is
      // reported as dangling, never silently dropped.
      await vault.trash(["gamma.md"]);
      await knowledge.flush();
      expect((await knowledge.wikiTargets()).map((target) => target.path)).toEqual([
        "notes/alpha.md",
      ]);
      expect(await knowledge.backlinks("gamma.md")).toEqual([]);
    });
  });

  it("surfaces an unresolved forward link rather than dropping it", async () => {
    await withHost("knowledge-dangling", async ({ vault, knowledge }) => {
      await seed(vault, knowledge, {
        "hub.md": "# Hub\n\n[[Real]] and [[Nowhere]] and [text](./real.md).\n",
        "real.md": "# Real\n",
      });

      const links = await knowledge.forwardLinks("hub.md");
      expect(links.map(({ target, targetPath }) => ({ target, targetPath }))).toEqual([
        { target: "Real", targetPath: "real.md" },
        { target: "Nowhere", targetPath: null },
        { target: "./real.md", targetPath: "real.md" },
      ]);
    });
  });

  it("keeps an attachment out of the doc index but inside link resolution", async () => {
    await withHost("knowledge-assets", async ({ vault, knowledge }) => {
      await vault.writeAsset("assets", "diagram.png", new TextEncoder().encode("png"));
      await seed(vault, knowledge, { "note.md": "# Note\n\n![[diagram.png]]\n" });

      const targets = await knowledge.wikiTargets();
      expect(targets.map(({ path, type }) => ({ path, type }))).toEqual([
        { path: "note.md", type: "doc" },
        { path: "assets/diagram.png", type: "asset" },
      ]);
      expect((await knowledge.forwardLinks("note.md"))[0]?.targetPath).toBe("assets/diagram.png");
    });
  });
});

describe("a doc the store cannot hold", () => {
  // The projection is ONE column, so a link- or task-dense note big enough to
  // pass SQLite's per-value ceiling answers SQLITE_TOOBIG on write. That throw
  // used to escape `project()` and be read one level up as a corrupt cache,
  // which nukes the whole store — and since the note stays in the vault, every
  // later query re-read it and nuked again. One unindexable doc must cost that
  // doc, never the account's search, backlinks, tags and tasks.
  it("skips it and leaves every other doc indexed", { timeout: 30_000 }, async () => {
    await withHost("knowledge-toobig", async ({ vault, knowledge }) => {
      // Task-dense: `raw` + `text` are stored per item, so this amplifies well
      // past the ceiling while the file itself stays far under the read cap.
      // Fewer, LONGER items: the ceiling is about stored bytes, and per-item
      // parse cost is what makes this test slow — so the padding does the work.
      const item = `- [ ] a task that links [[Target]] and carries ${"x".repeat(240)}\n`;
      const huge = `# Huge\n\n${item.repeat(4000)}`;
      await seed(vault, knowledge, {
        "target.md": "# Target\n",
        "ordinary.md": "# Ordinary\n\nLinks [[Target]].\n",
        "huge.md": huge,
      });

      // The oversized doc is absent from the index...
      expect(await knowledge.search({ query: "Huge" })).toEqual([]);
      // ...and everything else still answers.
      expect((await knowledge.search({ query: "Ordinary" })).map((r) => r.path)).toEqual([
        "ordinary.md",
      ]);
      expect((await knowledge.backlinks("target.md")).map((b) => b.sourcePath)).toEqual([
        "ordinary.md",
      ]);

      // And it stays that way: a second pass must not re-throw and re-nuke.
      await knowledge.flush();
      expect((await knowledge.search({ query: "Ordinary" })).map((r) => r.path)).toEqual([
        "ordinary.md",
      ]);
    });
  });
});

describe("search", () => {
  it("ranks a title hit above a body hit and prefix-matches the last token", async () => {
    await withHost("knowledge-search", async ({ vault, knowledge }) => {
      await seed(vault, knowledge, {
        "quarterly.md": "# Quarterly review\n\nNothing else here.\n",
        "mentions.md": "# Standup\n\nWe should schedule the quarterly review soon.\n",
        "unrelated.md": "# Gardening\n\nTomatoes need staking.\n",
      });

      // Title tier outranks body tier — core's bm25 weights, over workerd's own
      // FTS5 build.
      expect((await knowledge.search({ query: "quarterly" })).map((hit) => hit.path)).toEqual([
        "quarterly.md",
        "mentions.md",
      ]);
      // Tokens AND together, and the last one is a prefix (search-as-you-type).
      expect((await knowledge.search({ query: "quarterly rev" })).map((hit) => hit.path)).toEqual([
        "quarterly.md",
        "mentions.md",
      ]);
      expect(await knowledge.search({ query: "quarterly gardening" })).toEqual([]);
      // A hit carries the matched line, not just the path.
      expect((await knowledge.search({ query: "staking" }))[0]?.snippet).toContain("staking");
    });
  });

  it("narrows a search to one tag, and lists a tag with no text at all", async () => {
    await withHost("knowledge-tags", async ({ vault, knowledge }) => {
      await seed(vault, knowledge, {
        "work-plan.md": "# Plan\n\n#work the roadmap review.\n",
        "home-plan.md": "# Plan\n\n#home the roadmap review.\n",
      });

      expect((await knowledge.search({ query: "roadmap" })).map((hit) => hit.path)).toEqual([
        "home-plan.md",
        "work-plan.md",
      ]);
      expect(
        (await knowledge.search({ query: "roadmap", tag: "work" })).map((hit) => hit.path),
      ).toEqual(["work-plan.md"]);
      // Tag alone is a listing, not a search for nothing.
      expect((await knowledge.search({ query: "", tag: "home" })).map((hit) => hit.path)).toEqual([
        "home-plan.md",
      ]);
      expect(await knowledge.search({ query: "", tag: "" })).toEqual([]);
    });
  });
});

describe("the index is a cache over a database it shares", () => {
  it("rebuilds from the vault on a projection-version mismatch, manifest intact", async () => {
    await withHost("knowledge-wipe", async ({ vault, knowledge, state }) => {
      await seed(vault, knowledge, {
        "one.md": "# One\n\n[[Two]]\n",
        "two.md": "# Two\n",
      });
      expect(await knowledge.backlinks("two.md")).toHaveLength(1);

      // The version guard's own trigger, exactly as a core bump would set it.
      state.storage.sql.exec("UPDATE meta SET value = '9999' WHERE key = 'projection_version'");

      // A fresh index over the same storage discards the rows at open…
      const rebuilt = new UserKnowledge({
        storage: state.storage,
        vault,
        onUpdated: () => {},
        onDeadlineChanged: () => {},
      });
      // …and rebuilds from the manifest and R2, with no vault change to prompt it.
      expect((await rebuilt.backlinks("two.md")).map((entry) => entry.sourcePath)).toEqual([
        "one.md",
      ]);
      // The wipe dropped the index's tables and NOTHING else: the manifest
      // lives in the same database.
      expect(vault.list().map((entry) => entry.path)).toEqual(["one.md", "two.md"]);
      expect(await vault.readText("one.md")).toBe("# One\n\n[[Two]]\n");
    });
  });

  it("comes back from persisted rows after the object is evicted", async () => {
    const name = "knowledge-hydrate";
    const stub = env.UserHost.getByName(userHostName(name));
    await runInDurableObject(stub, async (host) => {
      await seed(host.vault, host.knowledge, {
        "anchor.md": "# Anchor\n\n[[Target]]\n",
        "target.md": "# Target\n",
      });
      expect(await host.knowledge.backlinks("target.md")).toHaveLength(1);
    });

    // Hibernation drops the in-memory graph; the rows stay.
    await evictDurableObject(stub);

    // Remove the bytes the index would need to re-read. Answering correctly
    // now can only mean the graph was rebuilt from the persisted projection —
    // which is the whole point of hydration in an object that hibernates.
    const prefix = userHostName(name);
    await env.VAULT_FILES.delete([`${prefix}/anchor.md`, `${prefix}/target.md`]);

    await runInDurableObject(stub, async (host) => {
      expect(
        (await host.knowledge.backlinks("target.md")).map((entry) => entry.sourcePath),
      ).toEqual(["anchor.md"]);
      expect((await host.knowledge.search({ query: "anchor" })).map((hit) => hit.path)).toEqual([
        "anchor.md",
      ]);
    });
  });
});

describe("a rebuild larger than one pass", () => {
  it("says a deadline moved, so the host's alarm comes back for the rest", async () => {
    // Write-time projection cannot cover a wipe-and-rebuild, and a rebuild is
    // capped at 100 body reads per pass. Whatever is left is only ever finished
    // because the index ANNOUNCES that it is owed one — nothing else would wake
    // an idle object, and the vault would stay half-indexed until the user
    // happened to click.
    const stub = env.UserHost.getByName(userHostName("knowledge-continuation"));
    await runInDurableObject(stub, async (_host, state) => {
      let deadlines = 0;
      const vault = new UserVault({
        sql: state.storage.sql,
        bucket: env.VAULT_FILES,
        prefix: "test:knowledge-continuation",
        onChanged: () => {},
      });
      for (let index = 0; index < 101; index++) {
        await vault.writeText(`bulk/note-${index}.md`, `# Note ${index}\n`);
      }

      // A FRESH index over a vault it has never seen: every doc is stale and
      // none of their bytes are in hand, which is the rebuild shape.
      const knowledge = new UserKnowledge({
        storage: state.storage,
        vault,
        onUpdated: () => {},
        onDeadlineChanged: () => {
          deadlines += 1;
        },
      });

      // Any query settles a pass, which is where the reconcile finds them.
      await knowledge.wikiTargets();
      expect(knowledge.hasPendingWork(), "the read budget should have held some back").toBe(true);
      expect(deadlines).toBeGreaterThan(0);

      // And the next pass finishes it, with nothing left to wake for.
      deadlines = 0;
      await knowledge.flush();
      expect(knowledge.hasPendingWork()).toBe(false);
      expect(deadlines).toBe(0);
    });
  });
});

/** The real bucket with `get` counted — an R2Bucket for the vault's purposes,
 * which only ever calls these five verbs. */
function countGets(counter: { gets: number }): R2Bucket {
  const real = env.VAULT_FILES;
  return {
    head: (key: string) => real.head(key),
    get: (key: string, options: never) => {
      counter.gets += 1;
      return real.get(key, options);
    },
    put: (key: string, value: never, options: never) => real.put(key, value, options),
    delete: (keys: string | string[]) => real.delete(keys),
    list: (options: never) => real.list(options),
  } as unknown as R2Bucket;
}

describe("rename reads what links, not the vault", () => {
  it("rewrites the linking note and reads only the notes it had to", async () => {
    const stub = env.UserHost.getByName(userHostName("knowledge-rename-scope"));
    await runInDurableObject(stub, async (_host, state) => {
      const counter = { gets: 0 };
      let knowledge: UserKnowledge | null = null;
      const vault = new UserVault({
        sql: state.storage.sql,
        bucket: countGets(counter),
        prefix: "test:knowledge-rename-scope",
        onChanged: (change) => knowledge?.record(change),
      });
      knowledge = new UserKnowledge({
        storage: state.storage,
        vault,
        onUpdated: () => {},
        onDeadlineChanged: () => {},
      });

      await vault.writeText("target.md", "# Target\n");
      await vault.writeText("linker.md", "# Linker\n\nSee [[Target]].\n");
      for (let index = 0; index < 40; index++) {
        await vault.writeText(`filler/note-${index}.md`, `# Filler ${index}\n\nNo links here.\n`);
      }
      await knowledge.flush();

      counter.gets = 0;
      expect(await renameWithLinkRewrite(vault, knowledge, "target.md", "renamed.md")).toEqual({
        ok: true,
      });
      // Counted before the assertion below reads a file of its own: two
      // candidate docs (the linking note and the moved one), the move's copy of
      // the blob, and the alias write's read-back. Forty-two docs in the vault,
      // and the scan never grew with them — which is what retired the cap.
      const readsForRename = counter.gets;
      expect(await vault.readText("linker.md")).toBe("# Linker\n\nSee [[renamed]].\n");
      expect(readsForRename).toBeLessThanOrEqual(4);
    });
  });

  it("qualifies a link the new name would have stolen", async () => {
    await withHost("knowledge-rename-shadow", async ({ vault, knowledge }) => {
      await seed(vault, knowledge, {
        "archive/note.md": "# Archive note\n",
        "reader.md": "# Reader\n\nSee [[note]].\n",
        "draft.md": "# Draft\n",
      });
      // `[[note]]` reaches archive/note.md today. Renaming draft.md to note.md
      // makes the root file win the tie-break, so the existing link has to be
      // qualified — and `reader.md` is a candidate through the SHADOW rule, not
      // through backlinks of the renamed file.
      expect(await renameWithLinkRewrite(vault, knowledge, "draft.md", "note.md")).toEqual({
        ok: true,
      });
      expect(await vault.readText("reader.md")).toBe("# Reader\n\nSee [[archive/note]].\n");
    });
  });
});

// ---------------------------------------------------------------------------
// The socket-driven half: the seven Bridge channels, over a real session.
// ---------------------------------------------------------------------------

let account: Account;

beforeAll(async () => {
  account = await signUp("knowledge-user@example.com");
});

describe("knowledge over the bridge", () => {
  it("answers the index channels and toggles a task, guarded", async () => {
    const { ws, frames } = await authenticated(account);

    // The seeded Welcome note carries one task and links to nothing.
    const tasks = await invoke(ws, frames, 1, "listVaultTasks");
    expect(tasks).toMatchObject({ ok: true });
    const rows = tasks.ok ? tasks.result : null;
    expect(rows).toEqual([
      expect.objectContaining({
        path: "Welcome.md",
        checked: false,
        ordinal: 0,
        text: "Ask the agent to summarize this note",
      }),
    ]);
    const task = Array.isArray(rows) ? rows[0] : null;
    const raw: unknown =
      task !== null && typeof task === "object" ? Reflect.get(task, "raw") : null;

    // A guard that does not match refuses and writes nothing.
    expect(
      await invoke(ws, frames, 2, "toggleVaultTask", {
        path: "Welcome.md",
        ordinal: 0,
        expectedRaw: "- [ ] something else entirely",
      }),
    ).toMatchObject({ ok: true, result: { ok: false, reason: "line-changed" } });

    // The recorded bytes do match, so the marker flips — and only the marker.
    expect(
      await invoke(ws, frames, 3, "toggleVaultTask", {
        path: "Welcome.md",
        ordinal: 0,
        expectedRaw: raw,
      }),
    ).toMatchObject({ ok: true, result: { ok: true, checked: true } });

    const reread = await invoke(ws, frames, 4, "listVaultTasks");
    expect(reread.ok ? reread.result : null).toEqual([
      expect.objectContaining({ path: "Welcome.md", checked: true }),
    ]);

    // The rest of the group answers over the same session.
    expect(await invoke(ws, frames, 5, "listWikiTargets")).toMatchObject({
      ok: true,
      result: expect.arrayContaining([expect.objectContaining({ path: "Welcome.md" })]),
    });
    const search = await invoke(ws, frames, 6, "searchVault", { query: "delegate" });
    expect(search.ok ? search.result : null).toEqual([
      expect.objectContaining({ path: "Welcome.md" }),
    ]);
    expect(await invoke(ws, frames, 7, "getBacklinks", { path: "Welcome.md" })).toMatchObject({
      ok: true,
      result: [],
    });
    expect(await invoke(ws, frames, 8, "getForwardLinks", { path: "Welcome.md" })).toMatchObject({
      ok: true,
    });

    const graph = await invoke(ws, frames, 9, "getLinkGraph", {});
    expect(graph).toMatchObject({ ok: true, result: { totalNodes: expect.any(Number) } });
    ws.close(1000, "done");
  });

  it("broadcasts onKnowledgeUpdated after a write is projected", async () => {
    const { ws, frames } = await authenticated(account);
    ws.send(
      JSON.stringify({
        t: "req",
        id: 20,
        method: "writeVaultFile",
        payload: { path: "linked.md", content: "# Linked\n\n[[Welcome]]\n" },
      }),
    );
    const events: string[] = [];
    for (;;) {
      const frame = await frames.next();
      if (frame.t === "evt") {
        events.push(frame.method);
        if (frame.method === "onKnowledgeUpdated") break;
        continue;
      }
      expect(frame).toMatchObject({ t: "res", id: 20, ok: true });
    }
    expect(events).toContain("onVaultChanged");
    expect(events).toContain("onKnowledgeUpdated");

    expect(await invoke(ws, frames, 21, "getBacklinks", { path: "Welcome.md" })).toMatchObject({
      ok: true,
      result: [expect.objectContaining({ sourcePath: "linked.md" })],
    });
    ws.close(1000, "done");
  });
});
