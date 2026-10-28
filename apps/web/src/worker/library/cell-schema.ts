// The cell's schema, made or checked once per wake inside `blockConcurrencyWhile` with synchronous
// SQL only (https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/):
// one `meta.schema` read, and the library's DDL on an empty database together with the epoch a
// replica pulls against. There are no users, so a schema of another version is not migrated: the
// cell deletes everything and starts over under a new epoch, and every replica pulls again.

import { ensureLibrarySchema } from "@repo/notes/library/library-schema";
import type { SchemaVerdict } from "@repo/notes/library/library-schema";
import { writeMeta } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";

import { cellStorageOf } from "./cell-storage";

const openOnce = (storage: DurableObjectStorage): SchemaVerdict => {
  const port = cellStorageOf(storage);
  return port.transaction(() => {
    const verdict = runPlan(port, ensureLibrarySchema("cell"));
    if (verdict.kind === "created") {
      runPlan(port, writeMeta("epoch", crypto.randomUUID()));
    }
    return verdict;
  });
};

export const openCellSchema = async (storage: DurableObjectStorage): Promise<void> => {
  let verdict = openOnce(storage);
  if (verdict.kind === "mismatch") {
    await storage.deleteAll();
    verdict = openOnce(storage);
  }
  // a wiped cell is empty and takes the schema, and the cell asks no engine version: either
  // verdict here is a fault, never a state to serve
  if (verdict.kind !== "created" && verdict.kind !== "current") {
    throw new Error(`the cell's schema did not open after starting over (${verdict.kind})`);
  }
};
