// The person's filing rules: one meta row of their own prose, which every turn of the built-in
// agent sends after the person's message whenever it is new to the conversation
// (`../agent/turn-message.ts`). Only the person writes it, from Settings
// (`library.agent.setRules`); an export writes it out, and an import reads that file as a note.

import { readMeta, writeMeta } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

const LIBRARY_RULES_META = "library_rules";

const rulesSchema = z.string().nullable();

// the filing rules the library keeps, null while it keeps none
export const readLibraryRules = (sql: SqlStatements): string | null =>
  rulesSchema.parse(runPlan(sql, readMeta(LIBRARY_RULES_META)));

export const writeLibraryRules = (sql: SqlStatements, rules: string): void => {
  runPlan(sql, writeMeta(LIBRARY_RULES_META, rules));
};
