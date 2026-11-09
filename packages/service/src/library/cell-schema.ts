// The cell's schema, made or checked once per wake inside `blockConcurrencyWhile` with synchronous
// SQL only (https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/):
// one `meta.schema` read, and the library's DDL on an empty database. There are no users, so a
// schema of another version is not migrated: the cell deletes everything and starts over.

import { ensureLibrarySchema } from "./library-schema";
import type { SchemaVerdict } from "./library-schema";
import { runPlan } from "./library-sql";

import { cellStorageOf } from "./cell-storage";

const openOnce = (storage: DurableObjectStorage): SchemaVerdict => {
  const port = cellStorageOf(storage);
  return port.transaction(() => runPlan(port, ensureLibrarySchema()));
};

export const openCellSchema = async (storage: DurableObjectStorage): Promise<void> => {
  let verdict = openOnce(storage);
  if (verdict.kind === "mismatch") {
    // the most a cell ever deletes, so the log says what it found
    console.warn({ event: "cell-schema-reset", found: verdict.found });
    await storage.deleteAll();
    verdict = openOnce(storage);
  }
  // a wiped cell is empty and takes the schema: a mismatch here is a fault, never a state to serve
  if (verdict.kind === "mismatch") {
    throw new Error(`the cell's schema did not open after starting over (${verdict.kind})`);
  }
};
