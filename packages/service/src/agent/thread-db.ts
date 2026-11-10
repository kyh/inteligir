// A conversation's SQLite through drizzle, over the tables `@repo/db/thread/schema` declares, its
// schema brought to this build's in its object's constructor (`../object-schema`), as a note's is.

import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import journal from "@repo/db/thread/migrations";
import * as threadSchema from "@repo/db/thread/schema";
import { migrateObjectSchema } from "../object-schema";

const relations = defineRelations(threadSchema);

export type ThreadDb = DrizzleSqliteDODatabase<typeof relations>;

export const threadDbOf = (storage: DurableObjectStorage): ThreadDb =>
  drizzle(storage, { relations });

export const migrateThread = async (storage: DurableObjectStorage): Promise<void> => {
  await migrateObjectSchema(storage, { db: threadDbOf(storage), journal, what: "thread" });
};
