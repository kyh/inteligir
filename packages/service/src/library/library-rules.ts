// The person's filing rules: their own prose in the cell's one row, which every turn of the built-in
// agent is sent under, after its prompt (`../agent/thread-request.ts`). Only the person writes
// it, from Settings (`library.agent.setRules`); an export writes it out, and an import passes
// over that file while it says what the row says, and reads it as a note otherwise.

import { readCellState, writeCellState } from "./library-queries";
import type { CellDb } from "./cell-db";

// the page as the person left it, blank or not, null before they wrote one
export const readLibraryRules = (db: CellDb): string | null => readCellState(db)?.rules ?? null;

// the rules the library holds the agent to, null while the page is missing or blank
export const filingRules = (db: CellDb): string | null => {
  const rules = readLibraryRules(db);
  return rules === null || rules.trim() === "" ? null : rules;
};

export const writeLibraryRules = (db: CellDb, rules: string): void => {
  writeCellState(db, { rules });
};
