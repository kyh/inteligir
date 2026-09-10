import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// better-auth's adapter finds each model through `db._.relations[model].table`, which drizzle 1.0
// populates only from `relations`; `schema` alone registers nothing.
const relations = defineRelations(schema);

export const createDb = (d1: D1Database) => drizzle(d1, { relations });
