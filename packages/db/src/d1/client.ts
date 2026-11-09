import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { authRelations, inviteCode } from "./schema";

// drizzle 1.0 registers a table only through `relations`, which is where better-auth's adapter finds
// each model; the generated auth part goes after the app's own tables, as a relations part must.
const relations = { ...defineRelations({ inviteCode }), ...authRelations };

// drizzle's own name for the binding, workerd's D1Database in the program that runs it: this
// package names no runtime, since drizzle-kit loads it under node
export const createDb = (d1: AnyD1Database) => drizzle(d1, { relations });

export type Db = ReturnType<typeof createDb>;
