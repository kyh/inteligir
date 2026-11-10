// A note's SQLite through drizzle, over the tables `@repo/db/note/schema` declares, its schema
// brought to this build's as the note wakes (`../object-schema`), as the cell's is.

import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import journal from "@repo/db/note/migrations";
import * as noteSchema from "@repo/db/note/schema";
import { migrateObjectSchema } from "../object-schema";

const relations = defineRelations(noteSchema);

export type NoteDb = DrizzleSqliteDODatabase<typeof relations>;

export const noteDbOf = (storage: DurableObjectStorage): NoteDb => drizzle(storage, { relations });

export const migrateNote = async (storage: DurableObjectStorage): Promise<void> => {
  await migrateObjectSchema(storage, { db: noteDbOf(storage), journal, what: "note" });
};
