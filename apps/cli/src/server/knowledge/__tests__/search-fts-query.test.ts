// What the shared query policy MEANS once FTS5 and bm25 run it — the half
// packages/notes cannot test, because the pure package carries no SQLite
// binding. The pure SearchIndex's own suite pins the same policy over the
// other engine.

import { createHash } from "node:crypto";
import { join } from "node:path";
import { projectDoc } from "@repo/notes/knowledge/projection";
import {
  createSqlKnowledgeStore,
  type SqlKnowledgeStore,
} from "@repo/notes/knowledge/sql-knowledge-store";
import { searchVaultNotes } from "@repo/notes/knowledge/vault-search";
import { describe, expect, it, onTestFinished } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createSqliteDriver } from "../sqlite-driver";

function storeWith(docs: Record<string, string>): SqlKnowledgeStore {
  const dbPath = join(makeTempDir("inteligir-fts-query-"), "knowledge.db");
  const store = createSqlKnowledgeStore(createSqliteDriver(dbPath), "/vault");
  onTestFinished(() => store.dispose());
  for (const [path, content] of Object.entries(docs)) {
    store.upsertDoc(
      {
        path,
        contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
        projection: projectDoc(path, content),
      },
      content,
    );
  }
  return store;
}

function hits(store: SqlKnowledgeStore, query: string): string[] {
  return store.search(query, 20).map((hit) => hit.path);
}

const VAULT = {
  "burnout.md": "# Burnout\n\nI have been exhausted lately and cannot focus on anything at work.\n",
  "deploy-runbook.md": "# Deploy runbook\n\nEvery step needed to deploy the gateway.\n",
  "deploy-notes.md": "# Deploy notes\n\nWe deploy on Fridays and never on a Friday evening.\n",
  "how-do-i.md": "# How do I\n\nA scratch page of questions.\n",
  "gateway.md": "# Gateway\n\nThe front door of the whole thing.\n",
};

describe("FTS5 over the shared query policy", () => {
  it("answers a long sentence without requiring every token", () => {
    // Requiring every token, `how` and `do` included, answers nothing.
    expect(hits(storeWith(VAULT), "how do I stop feeling burnt out at work")).toEqual([
      "burnout.md",
    ]);
  });

  it("leaves a two-word lookup a conjunction", () => {
    // `deploy-notes.md` carries `deploy` and not `runbook`, so relaxing this
    // one would have hung it under the answer for nothing.
    expect(hits(storeWith(VAULT), "deploy runbook")).toEqual(["deploy-runbook.md"]);
  });

  it("ranks a doc matching more of a sentence's terms above one matching fewer", () => {
    // bm25 is what makes the disjunction safe, so it is asserted rather than
    // assumed: one term of the four is not worth four of them.
    const store = storeWith({
      "canary.md": "# Canary\n\nRoll out a canary release for the gateway service.\n",
      "gateway.md": "# Gateway\n\nThe front door of the whole thing.\n",
      "release.md": "# Release\n\nWhat shipped last month.\n",
    });
    const ranked = hits(store, "how do I roll out a canary release for the gateway");
    expect(ranked[0]).toBe("canary.md");
    expect(ranked).toHaveLength(3);
  });

  it("answers an all-stopword query with the notes carrying those words", () => {
    // The floor. Dropping every term leaves an empty MATCH expression, which
    // is not "no filter" — it is the whole vault.
    expect(hits(storeWith(VAULT), "how do I")).toEqual(["how-do-i.md"]);
  });

  it("prefix-matches the token still being typed", () => {
    expect(hits(storeWith(VAULT), "burn")).toEqual(["burnout.md"]);
    expect(hits(storeWith(VAULT), "deploy runb")).toEqual(["deploy-runbook.md"]);
  });

  it("matches a word the note inflects differently", () => {
    const store = storeWith(VAULT);
    // `deploying` reaches `deploy`; `Fridays` reaches `Friday`. Neither is a
    // prefix of the other in the direction typed.
    expect(hits(store, "deploying the gateway")).toEqual(["deploy-runbook.md"]);
    // One word IS the typed term, so this is the half a prefix cannot answer.
    expect(hits(store, "questioning")).toEqual(["how-do-i.md"]);
  });

  it("keeps the snippet cut from the literal body, never from the stems", () => {
    const [hit] = storeWith(VAULT).search("exhausting", 20);
    expect(hit?.path).toBe("burnout.md");
    expect(hit?.snippet).toContain("exhausted");
  });

  it("reads FTS5 syntax in the box as text, never as syntax", () => {
    const store = storeWith(VAULT);
    // Unquoted, each of these is an operator, a column filter or a parse
    // error — and a parse error is an exception out of the search box.
    // `burnout.md` carries `work`, so an injected NOT would exclude the one
    // note this answers with.
    expect(hits(store, 'burnout" NOT "work')).toEqual(["burnout.md"]);
    expect(hits(store, "NEAR(deploy runbook)")).toEqual(["deploy-runbook.md", "deploy-notes.md"]);
    expect(hits(store, "deploy:runbook^ -*")).toEqual(["deploy-runbook.md"]);
    // Nothing but metacharacters tokenizes to nothing at all.
    expect(hits(store, '*^:-()"')).toEqual([]);
  });

  it("keeps a tag a CONJUNCTION over the relaxed text", () => {
    // The tag narrows; the text ranks within it. Relaxing the text must not
    // relax that — a `tag:` term is the one part of the box that is a filter.
    const store = storeWith(VAULT);
    const sources = {
      search: (query: string, limit: number) => store.search(query, limit),
      notesWithTag: (tag: string) => (tag === "work" ? ["burnout.md"] : []),
    };
    expect(
      searchVaultNotes(sources, {
        query: "how do I stop feeling burnt out at work",
        limit: 20,
      }).map((hit) => hit.path),
    ).toEqual(["burnout.md"]);
    // Same query, narrowed to a tag no note carries: nothing, not "everything
    // the text matched".
    expect(
      searchVaultNotes(sources, {
        query: "how do I stop feeling burnt out at work",
        tag: "rest",
        limit: 20,
      }),
    ).toEqual([]);
    expect(
      searchVaultNotes(sources, {
        query: "deploy on Fridays",
        tag: "work",
        limit: 20,
      }),
    ).toEqual([]);
  });
});
