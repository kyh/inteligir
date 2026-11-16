// What a change set keeps of an item: its fields, kept once per item under their content hash, so
// sets that leave the fields alike share one part. A body is no part: an agent's edits to a note are
// its note's turn log, and a person's typing is no change set.

import { contentHash } from "@repo/contract/library/content-hash";
import { canonicalJson } from "@repo/contract/library/canonical-json";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { and, eq } from "drizzle-orm";

import { snapshotParts } from "@repo/db/cell/schema";
import { LibraryRowError } from "./library-sql";
import { fieldFilesOf, keepSetFiles } from "./cell-blobs";
import type { CellDb } from "./cell-db";
import { jsonTextSchema } from "./sql-value";

// a part is the text its hash is of, so its column stays text and is read back here
const fieldsText = jsonTextSchema.pipe(libraryItemFieldsSchema);

// the fields' part, and the files they name kept beside it; answers its hash
export const storeFieldsPart = (db: CellDb, itemId: string, fields: LibraryItemFields): string => {
  const json = canonicalJson(fields);
  const hash = contentHash(json);
  db.insert(snapshotParts).values({ hash, itemId, json }).onConflictDoNothing().run();
  keepSetFiles(db, itemId, hash, fieldFilesOf(fields));
  return hash;
};

export const readFieldsPart = (db: CellDb, itemId: string, hash: string): LibraryItemFields => {
  const part = db
    .select({ json: snapshotParts.json })
    .from(snapshotParts)
    .where(and(eq(snapshotParts.itemId, itemId), eq(snapshotParts.hash, hash)))
    .get();
  if (part === undefined) {
    throw new LibraryRowError(`the fields ${hash} of ${itemId} are not kept`);
  }
  return fieldsText.parse(part.json);
};
