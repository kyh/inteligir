// fields this package has no reading for ride through in `source` / `document`: a caller that
// rewrites the journal must not drop what drizzle wrote.

import { asMapping, isMapping, isNumber, isText } from "./json-source";
import type { JsonObject } from "./json-source";

interface MigrationJournalEntry {
  idx: number;
  tag: string;
  source: JsonObject;
}

export interface MigrationJournal {
  document: JsonObject;
  entries: MigrationJournalEntry[];
}

export const parseMigrationJournal = (raw: string, source: string): MigrationJournal => {
  const parsed: unknown = JSON.parse(raw);
  const entries = isMapping(parsed) ? parsed.entries : undefined;
  if (!isMapping(parsed) || !Array.isArray(entries)) {
    throw new Error(`${source} has no "entries" array`);
  }
  return {
    document: parsed,
    entries: entries.map((entry) => {
      const fields = asMapping(entry);
      const idx = fields?.idx;
      const tag = fields?.tag;
      if (!fields || !isNumber(idx) || !isText(tag)) {
        throw new Error(`${source} has an entry missing idx/tag`);
      }
      return { idx, source: fields, tag };
    }),
  };
};
