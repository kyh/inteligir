// The person's filing rules: one meta row of their own prose, which every turn of the built-in
// agent sends after the person's message whenever it is new to the conversation
// (`../agent/turn-message.ts`). Only the person writes it, from Settings
// (`library.agent.setRules`); an export writes it out, and an import passes over that file while
// it says what the row says, and reads it as a note otherwise.

import { z } from "zod";

import { readMeta, writeMeta } from "./library-queries";
import type { CellDb } from "./cell-db";

const LIBRARY_RULES_META = "library_rules";

const rulesSchema = z.string().nullable();

// the page as the person left it, blank or not, null before they wrote one
export const readLibraryRules = (db: CellDb): string | null =>
  rulesSchema.parse(readMeta(db, LIBRARY_RULES_META));

// the rules the library holds the agent to, null while the page is missing or blank
export const filingRules = (db: CellDb): string | null => {
  const rules = readLibraryRules(db);
  return rules === null || rules.trim() === "" ? null : rules;
};

export const writeLibraryRules = (db: CellDb, rules: string): void => {
  writeMeta(db, LIBRARY_RULES_META, rules);
};
