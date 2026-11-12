// A note's SQLite through drizzle, over the tables `@repo/db/note/schema` declares, its DDL
// applied as the note wakes (`../object-schema`), as the cell's is.

import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import ddl from "@repo/db/note/ddl.sql";
import * as noteSchema from "@repo/db/note/schema";
import type { ObjectSchema } from "../object-schema";

const relations = defineRelations(noteSchema);

export type NoteDb = DrizzleSqliteDODatabase<typeof relations>;

export const noteDbOf = (storage: DurableObjectStorage): NoteDb => drizzle(storage, { relations });

export const NOTE_SCHEMA: ObjectSchema = { ddl, what: "note" };
