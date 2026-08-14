// ---------------------------------------------------------------------------
// The Durable Object SqlDriver, driven through core's SQL knowledge store. The
// store's own behaviour is @repo/notes' to test, so what is under test HERE is
// only whether this binding can carry it.
//
// Three of these are the reason the driver has members the other two do not:
// Durable Object storage refuses `BEGIN`, refuses `PRAGMA user_version`, and
// shares its database with the vault manifest. Each of those would be a silent
// wrong answer rather than a compile error, so each gets a test.
//
// The fourth is the ranking itself. Cloud search must order hits the way the
// client's does, and the only thing that could make it differ — now that the
// schema, the bm25 weights and the MATCH expression are core's — is workerd's
// own SQLite build. So the tiers are asserted here directly.
// ---------------------------------------------------------------------------

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { StoredDocRow } from "@repo/notes/knowledge/knowledge-store";
import { projectDoc } from "@repo/notes/knowledge/projection";
import {
  createSqlKnowledgeStore,
  KNOWLEDGE_SCHEMA_VERSION,
  type SqlKnowledgeStore,
} from "@repo/notes/knowledge/sql-knowledge-store";

import { userHostName } from "../host/host-address";
import { createDoSqlDriver } from "../host/knowledge/do-sql-driver";

const ROOT = "/Vault";

function row(path: string, content: string, at: number): StoredDocRow {
  return {
    path,
    contentHash: `hash-${at}`,
    projection: projectDoc(path, content),
  };
}

function seed(store: SqlKnowledgeStore, notes: Record<string, string>): void {
  let at = 0;
  store.transaction(() => {
    for (const [path, content] of Object.entries(notes)) {
      at += 1;
      store.upsertDoc(row(path, content, at), content);
    }
  });
}

/** Open a store over a Durable Object's own SQLite, on a name no other test
 * uses so the tables are this test's alone. */
function withStore<T>(
  name: string,
  run: (ctx: { store: SqlKnowledgeStore; sql: SqlStorage; state: DurableObjectState }) => T,
): Promise<T> {
  const stub = env.UserHost.getByName(userHostName(name));
  return runInDurableObject(stub, (_host, state) => {
    const store = createSqlKnowledgeStore(createDoSqlDriver(state.storage), ROOT);
    return run({ store, sql: state.storage.sql, state });
  });
}

describe("the store runs unchanged over Durable Object storage", () => {
  it("round-trips a projection, searches it, and drops it", async () => {
    await withStore("driver-roundtrip", ({ store }) => {
      seed(store, {
        "hub.md": "# Hub\n\nLinks to [[Leaf]] and #topic.\n",
        "leaf.md": "# Leaf\n\nA quiet note.\n",
      });
      store.upsertOther("assets/diagram.png");

      const loaded = store.loadAll();
      expect(loaded.docs.map((doc) => doc.path)).toEqual(["hub.md", "leaf.md"]);
      expect(loaded.others.map((other) => other.path)).toEqual(["assets/diagram.png"]);
      expect(loaded.docs[0]?.projection.links.map((link) => link.target)).toEqual(["Leaf"]);
      expect(loaded.docs[0]?.projection.tags).toEqual(["topic"]);
      expect(store.search("quiet", 5).map((hit) => hit.path)).toEqual(["leaf.md"]);

      // The child rows go with the file — the schema's cascade, over this
      // binding's own foreign-key handling.
      store.remove("hub.md");
      expect(store.loadAll().docs.map((doc) => doc.path)).toEqual(["leaf.md"]);
      expect(store.search("hub", 5)).toEqual([]);
    });
  });

  it("pages hydration into the same rows loadAll returns", async () => {
    await withStore("driver-hydrate", ({ store }) => {
      const notes: Record<string, string> = {};
      for (let index = 0; index < 7; index++) notes[`n${index}.md`] = `# Note ${index}\n`;
      seed(store, notes);
      store.upsertOther("a.png");
      store.upsertOther("b.png");

      const cursor = store.hydrate(2);
      const docs: string[] = [];
      const others: string[] = [];
      for (;;) {
        const page = cursor.next();
        if (page.kind === "done") break;
        if (page.kind === "docs") docs.push(...page.docs.map((doc) => doc.path));
        else others.push(...page.others.map((other) => other.path));
      }
      const drained = store.loadAll();
      expect(docs).toEqual(drained.docs.map((doc) => doc.path));
      expect(others).toEqual(drained.others.map((other) => other.path));
      expect(docs).toHaveLength(7);
    });
  });

  it("rolls a failed transaction back, because the object's API owns it", async () => {
    await withStore("driver-transaction", ({ store }) => {
      seed(store, { "kept.md": "# Kept\n" });
      expect(() =>
        store.transaction(() => {
          store.upsertDoc(row("doomed.md", "# Doomed\n", 9), "# Doomed\n");
          throw new Error("boom");
        }),
      ).toThrow(/boom/);
      // `BEGIN` is refused outright here, so a driver that had not wired
      // `transactionSync` would have thrown on the way IN — and one that
      // swallowed the statement would leave this row behind.
      expect(store.loadAll().docs.map((doc) => doc.path)).toEqual(["kept.md"]);
    });
  });

  it("keeps the schema version where PRAGMA user_version cannot go", async () => {
    await withStore("driver-version", ({ store, sql, state }) => {
      seed(store, { "a.md": "# A\n" });
      // The pragma the store would otherwise use is not merely absent — it is
      // refused, which is why the driver owns the value instead.
      expect(() => sql.exec("PRAGMA user_version").toArray()).toThrow(/not authorized/);
      const stored = sql
        .exec<{ value: string }>("SELECT value FROM knowledge_driver WHERE key = 'schema_version'")
        .toArray()[0];
      expect(stored?.value).toBe(String(KNOWLEDGE_SCHEMA_VERSION));

      // A version the store does not recognize: wipe and start empty.
      sql.exec("UPDATE knowledge_driver SET value = '9999' WHERE key = 'schema_version'");
      const reopened = createSqlKnowledgeStore(createDoSqlDriver(state.storage), ROOT);
      expect(reopened.loadAll()).toEqual({ docs: [], others: [] });
    });
  });

  it("resets only the tables it created", async () => {
    await withStore("driver-reset", ({ store, sql }) => {
      // A table the store knows nothing about, standing in for the vault
      // manifest that shares this database.
      sql.exec("CREATE TABLE IF NOT EXISTS neighbour (id TEXT PRIMARY KEY)");
      sql.exec("INSERT OR REPLACE INTO neighbour (id) VALUES ('durable')");
      seed(store, { "a.md": "# A\n" });

      store.nuke();

      expect(store.loadAll()).toEqual({ docs: [], others: [] });
      expect(sql.exec<{ id: string }>("SELECT id FROM neighbour").toArray()).toEqual([
        { id: "durable" },
      ]);
      // And it serves again immediately — a reset is a rebuild, not a shutdown.
      seed(store, { "b.md": "# B\n" });
      expect(store.search("b", 5).map((hit) => hit.path)).toEqual(["b.md"]);
    });
  });
});

describe("ranking", () => {
  it("orders title over heading over body, with the last token as a prefix", async () => {
    await withStore("driver-ranking", ({ store }) => {
      seed(store, {
        "title.md": "# Migration\n\nUnrelated prose.\n",
        "heading.md": "# Notes\n\n## Migration plan\n\nUnrelated prose.\n",
        "body.md": "# Notes\n\nWe discussed the migration briefly.\n",
        "absent.md": "# Notes\n\nNothing to see.\n",
      });

      expect(store.search("migration", 10).map((hit) => hit.path)).toEqual([
        "title.md",
        "heading.md",
        "body.md",
      ]);
      // Scores come back higher-is-better, whatever bm25's own sign is.
      const scores = store.search("migration", 10).map((hit) => hit.score);
      expect(scores).toEqual([...scores].toSorted((a, b) => b - a));
      // Prefix on the last token only, and every earlier token must match.
      expect(store.search("migra", 10).map((hit) => hit.path)).toEqual([
        "title.md",
        "heading.md",
        "body.md",
      ]);
      expect(store.search("migration nothing", 10)).toEqual([]);
    });
  });
});
