// A Durable Object's SQLite schema is its drizzle schema's DDL (`@repo/db/<object>/ddl.sql`),
// applied once per wake inside `blockConcurrencyWhile`, with synchronous SQL only
// (https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/):
// the account's cell, each note's object and each conversation's alike. There are no users, so an
// object another DDL made is wiped and made again from this one. The verdict is the hash of the DDL
// the object applied, never its tables' names, since the Agents SDK's lifecycle keeps a table of
// its own beside a conversation's.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { errorFields } from "./log";

// in the runtime's own key-value table, which no DDL makes
export const SCHEMA_HASH_KEY = "schema-hash";

// the runtime's own tables (`_cf_KV` and its kin) and SQLite's are no schema's
const tableNames = (storage: DurableObjectStorage): string[] =>
  storage.sql
    .exec<{ name: string }>(
      String.raw`SELECT name FROM sqlite_master WHERE type = 'table'
        AND name NOT LIKE '\_cf\_%' ESCAPE '\' AND name NOT LIKE 'sqlite\_%' ESCAPE '\'`,
    )
    .toArray()
    .map((row) => row.name);

export interface ObjectSchema {
  readonly ddl: string;
  // the object's kind as the log names it
  readonly what: string;
}

// A throw leaves the object as it was, or empty after a wipe, since the DDL and its hash land in
// one transaction.
export const applyObjectSchema = async (
  storage: DurableObjectStorage,
  schema: ObjectSchema,
): Promise<void> => {
  const hash = bytesToHex(sha256(utf8ToBytes(schema.ddl)));
  const held = storage.kv.get(SCHEMA_HASH_KEY);
  if (held === hash) {
    return;
  }
  const tables = tableNames(storage);
  if (held !== undefined || tables.length > 0) {
    // the most an object ever deletes, so the log says what it found
    console.warn({ event: `${schema.what}-schema-reset`, found: { hash: held ?? null, tables } });
    await storage.deleteAll();
  }
  storage.transactionSync(() => {
    storage.sql.exec(schema.ddl);
    storage.kv.put(SCHEMA_HASH_KEY, hash);
  });
};

// The schema applied as the object wakes: the runtime holds every event until it settles, and a
// throw resets the object, whose next event opens it again. The one place an object of this Worker
// blocks its own events, so the account's cell never awaits a note under it (`oxlint.config.ts`).
export const openWithSchema = (ctx: DurableObjectState, schema: ObjectSchema): void => {
  void ctx.blockConcurrencyWhile(async () => {
    try {
      await applyObjectSchema(ctx.storage, schema);
    } catch (error) {
      console.error({ event: `${schema.what}-open-failed`, ...errorFields(error) });
      throw error;
    }
  });
};
