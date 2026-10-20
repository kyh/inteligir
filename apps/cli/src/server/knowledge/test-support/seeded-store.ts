// a knowledge store over a real sqlite file, its rows projected as the worker projects them.
// lives here rather than in packages/notes because that package carries no sqlite binding.

import { createHash } from "node:crypto";
import nodePath from "node:path";
import { projectForIndex } from "@repo/notes/knowledge/search-columns";
import { createSqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import type { SqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import { onTestFinished } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir";
import { createSqliteDriver } from "../sqlite-driver";

type Docs = Readonly<Record<string, string>>;

export const docRow = (path: string, content: string) => {
  const { projection, search } = projectForIndex(path, content);
  return {
    row: {
      contentHash: createHash("sha256").update(content, "utf-8").digest("hex"),
      fingerprint: null,
      path,
      projection,
    },
    search,
  };
};

export const seedDocs = (store: SqlKnowledgeStore, docs: Docs): void => {
  for (const [path, content] of Object.entries(docs)) {
    const { row, search } = docRow(path, content);
    store.upsertDoc(row, search);
  }
};

export const storeWith = (docs: Docs): SqlKnowledgeStore => {
  const dbPath = nodePath.join(makeTempDir("inteligir-knowledge-store-"), "knowledge.db");
  const store = createSqlKnowledgeStore(createSqliteDriver(dbPath), "/vault");
  onTestFinished(() => {
    store.dispose();
  });
  seedDocs(store, docs);
  return store;
};
