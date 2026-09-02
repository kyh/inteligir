// lives here rather than in packages/notes because that package carries no sqlite binding.

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
    expect(hits(storeWith(VAULT), "how do I stop feeling burnt out at work")).toEqual([
      "burnout.md",
    ]);
  });

  it("leaves a two-word lookup a conjunction", () => {
    // deploy-notes.md carries deploy but not runbook.
    expect(hits(storeWith(VAULT), "deploy runbook")).toEqual(["deploy-runbook.md"]);
  });

  it("ranks a doc matching more of a sentence's terms above one matching fewer", () => {
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
    expect(hits(storeWith(VAULT), "how do I")).toEqual(["how-do-i.md"]);
  });

  it("prefix-matches the token still being typed", () => {
    expect(hits(storeWith(VAULT), "burn")).toEqual(["burnout.md"]);
    expect(hits(storeWith(VAULT), "deploy runb")).toEqual(["deploy-runbook.md"]);
  });

  it("matches a word the note inflects differently", () => {
    const store = storeWith(VAULT);
    expect(hits(store, "deploying the gateway")).toEqual(["deploy-runbook.md"]);
    expect(hits(store, "questioning")).toEqual(["how-do-i.md"]);
  });

  it("keeps the snippet cut from the literal body, never from the stems", () => {
    const [hit] = storeWith(VAULT).search("exhausting", 20);
    expect(hit?.path).toBe("burnout.md");
    expect(hit?.snippet).toContain("exhausted");
  });

  it("reads FTS5 syntax in the box as text, never as syntax", () => {
    const store = storeWith(VAULT);
    // burnout.md carries work, so an injected NOT would exclude the only answer.
    expect(hits(store, 'burnout" NOT "work')).toEqual(["burnout.md"]);
    expect(hits(store, "NEAR(deploy runbook)")).toEqual(["deploy-runbook.md", "deploy-notes.md"]);
    expect(hits(store, "deploy:runbook^ -*")).toEqual(["deploy-runbook.md"]);
    expect(hits(store, '*^:-()"')).toEqual([]);
  });

  it("keeps a tag a CONJUNCTION over the relaxed text", () => {
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
