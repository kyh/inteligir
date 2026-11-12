// A conversation's SQLite through drizzle, over the tables `@repo/db/thread/schema` declares, its
// DDL applied in its object's constructor (`../object-schema`), as a note's is.

import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import ddl from "@repo/db/thread/ddl.sql";
import * as threadSchema from "@repo/db/thread/schema";
import type { ObjectSchema } from "../object-schema";

const relations = defineRelations(threadSchema);

export type ThreadDb = DrizzleSqliteDODatabase<typeof relations>;

export const threadDbOf = (storage: DurableObjectStorage): ThreadDb =>
  drizzle(storage, { relations });

export const THREAD_SCHEMA: ObjectSchema = { ddl, what: "thread" };
