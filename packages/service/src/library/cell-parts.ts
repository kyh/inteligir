// What a change set keeps of an item: its fields, kept once per item under their content hash, so
// sets that leave the fields alike share one part. A body is no part: an agent's edits to a note are
// its note's turn log, and a person's typing is no change set.

import { contentHash } from "@repo/contract/library/content-hash";
import { canonicalJson } from "@repo/contract/library/canonical-json";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { LibraryRowError } from "./library-sql";
import type { SqlStatements } from "./library-sql";
import { z } from "zod";

import { fieldFilesOf, keepSetFiles } from "./cell-blobs";

const INSERT_PART =
  "INSERT INTO snapshot_parts (item_id, hash, json) VALUES (?, ?, ?) ON CONFLICT DO NOTHING";

// the fields' part, and the files they name kept beside it; answers its hash
export const storeFieldsPart = (
  sql: SqlStatements,
  itemId: string,
  fields: LibraryItemFields,
): string => {
  const json = canonicalJson(fields);
  const hash = contentHash(json);
  sql.run(INSERT_PART, [itemId, hash, json]);
  keepSetFiles(sql, itemId, hash, fieldFilesOf(fields));
  return hash;
};

const partRowSchema = z.object({ json: z.string() });

export const readFieldsPart = (
  sql: SqlStatements,
  itemId: string,
  hash: string,
): LibraryItemFields => {
  const [row] = sql.all("SELECT json FROM snapshot_parts WHERE item_id = ? AND hash = ?", [
    itemId,
    hash,
  ]);
  const part = partRowSchema.safeParse(row);
  if (!part.success) {
    throw new LibraryRowError(`the fields ${hash} of ${itemId} are not kept`);
  }
  let value: unknown;
  try {
    value = JSON.parse(part.data.json);
  } catch (error) {
    throw new LibraryRowError(`the fields ${hash} are not JSON`, { cause: error });
  }
  const parsed = libraryItemFieldsSchema.safeParse(value);
  if (!parsed.success) {
    throw new LibraryRowError(`the fields ${hash} are not what this build writes`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
};
