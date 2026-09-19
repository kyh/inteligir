// lives here rather than in packages/notes because that package carries no sqlite binding.

import { createHash } from "node:crypto";
import nodePath from "node:path";
import { projectDoc } from "@repo/notes/knowledge/projection";
import { createSqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import type { SqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import { bodyPrefilter, collectVaultMatches } from "@repo/notes/knowledge/text-matches";
import { describe, expect, it, onTestFinished } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createSqliteDriver } from "../sqlite-driver";

const storeWith = (docs: Record<string, string>): SqlKnowledgeStore => {
  const dbPath = nodePath.join(makeTempDir("inteligir-matches-"), "knowledge.db");
  const store = createSqlKnowledgeStore(createSqliteDriver(dbPath), "/vault");
  onTestFinished(() => {
    store.dispose();
  });
  for (const [path, content] of Object.entries(docs)) {
    store.upsertDoc(
      {
        contentHash: createHash("sha256").update(content, "utf-8").digest("hex"),
        path,
        projection: projectDoc(path, content),
      },
      content,
    );
  }
  return store;
};

const VAULT = {
  "a.md": "# A\n\nDeploy on Friday.\n",
  "b.md": "# B\n\nNothing here.\n",
  "c.md": "# C\n\n50% off_peak\n",
};

const paths = (store: SqlKnowledgeStore, prefilter: string | null): string[] =>
  store.docTexts(prefilter).map((doc) => doc.path);

describe("the doc texts the literal scan reads", () => {
  it("hands over every doc in path order when nothing narrows them", () => {
    expect(paths(storeWith(VAULT), null)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("narrows by an ascii substring, case-insensitively", () => {
    expect(paths(storeWith(VAULT), "friday")).toEqual(["a.md"]);
  });

  it("reads LIKE's own syntax in the needle as text", () => {
    const store = storeWith(VAULT);
    expect(paths(store, "% off_")).toEqual(["c.md"]);
    expect(paths(store, "_peak")).toEqual(["c.md"]);
    expect(paths(store, "%")).toEqual(["c.md"]);
  });

  it("answers the fold the runtime runs, title included", () => {
    const store = storeWith(VAULT);
    const { matches, total } = collectVaultMatches(
      store.docTexts(bodyPrefilter("deploy")),
      "deploy",
      { caseSensitive: false, wholeWord: false },
      10,
    );
    expect(total).toBe(1);
    expect(matches[0]).toMatchObject({
      after: " on Friday.",
      column: 0,
      line: 3,
      path: "a.md",
      text: "Deploy",
      title: "A",
    });
  });
});
