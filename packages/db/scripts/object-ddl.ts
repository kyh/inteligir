// `pnpm --filter @repo/db ddl`: writes each Durable Object's DDL, which drizzle-kit exports from
// its schema, to src/<object>/ddl.sql, the text the object applies as it wakes
// (packages/service/src/object-schema.ts). Run it after editing a schema and commit what it
// writes; `--check` writes nothing and exits 1 when a file differs from what it would write (the
// workspace's `test` script runs it).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// The search index, which sqlite-core cannot declare. `remove_diacritics 2` and `_` as a token
// character are stated, not defaulted: the search policy's tokenizer folds and splits the same way
// (packages/service/src/knowledge/search-query.ts). Its row id is the item's `rid`, and the cell
// keeps it in code (packages/service/src/library/library-queries.ts), never by a trigger.
const SEARCH_FTS = `
CREATE VIRTUAL TABLE \`search_fts\` USING fts5(
  title, headings, meta, body,
  title_stems, heading_stems, meta_stems, body_stems,
  tokenize='unicode61 remove_diacritics 2 tokenchars ''_'''
);
`;

// each object's schema, and the statements its drizzle schema cannot spell
const OBJECTS = { cell: SEARCH_FTS, note: "", thread: "" };

const dbRoot = path.resolve(import.meta.dirname, "..");

const ddlOf = (object: string, extra: string): string => {
  const exported = execFileSync(
    "drizzle-kit",
    ["export", "--dialect=sqlite", `--schema=./src/${object}/schema.ts`],
    { cwd: dbRoot, encoding: "utf-8" },
  );
  const header = [
    `-- Written by packages/db/scripts/object-ddl.ts from src/${object}/schema.ts: edit the schema,`,
    "-- then run `pnpm --filter @repo/db ddl`.",
  ];
  const statements = [exported, extra].map((part) => part.trim()).filter((part) => part !== "");
  return `${header.join("\n")}\n\n${statements.join("\n\n")}\n`;
};

const readOrNull = (file: string): string | null => {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return null;
  }
};

for (const [object, extra] of Object.entries(OBJECTS)) {
  const relative = `src/${object}/ddl.sql`;
  const file = path.join(dbRoot, relative);
  const text = ddlOf(object, extra);
  if (readOrNull(file) !== text) {
    if (process.argv.includes("--check")) {
      console.error(
        `packages/db/${relative} differs from its schema: run \`pnpm --filter @repo/db ddl\``,
      );
      process.exitCode = 1;
    } else {
      writeFileSync(file, text);
      console.log(`wrote packages/db/${relative}`);
    }
  }
}
