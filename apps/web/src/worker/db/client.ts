import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { authRelations, device, inviteCode } from "./schema";

// drizzle 1.0 registers a table only through `relations`, which is where better-auth's adapter finds
// each model; the generated auth part goes after the app's own tables, as a relations part must.
const relations = { ...defineRelations({ device, inviteCode }), ...authRelations };

export const createDb = (d1: D1Database) => drizzle(d1, { relations });

export type Db = ReturnType<typeof createDb>;
