// The person's filing rules: one meta row of their own prose, which every turn of the built-in
// agent sends after the person's message whenever it is new to the conversation
// (`../agent/turn-message.ts`). The person writes it from Settings (`library.agent.setRules`); an
// import that brings a vault's own fills it only while the library keeps none, and an export
// writes it back out.

import { FILING_RULES_MAX } from "@repo/contract/cloud/library/library-wire";
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

// the rules an import brings, kept only while the library keeps none and only within the cap the
// person's own are held to
export const adoptImportedRules = (sql: SqlStatements, rules: string): void => {
  if (rules.length <= FILING_RULES_MAX && readLibraryRules(sql) === null) {
    writeLibraryRules(sql, rules);
  }
};
