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

// the page as the person left it, blank or not, null before they wrote one
export const readLibraryRules = (sql: SqlStatements): string | null =>
  rulesSchema.parse(runPlan(sql, readMeta(LIBRARY_RULES_META)));

// the rules the library holds the agent to, null while the page is missing or blank
export const filingRules = (sql: SqlStatements): string | null => {
  const rules = readLibraryRules(sql);
  return rules === null || rules.trim() === "" ? null : rules;
};

export const writeLibraryRules = (sql: SqlStatements, rules: string): void => {
  runPlan(sql, writeMeta(LIBRARY_RULES_META, rules));
};
