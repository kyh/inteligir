// fields this package has no reading for ride through in `source` / `document`: a caller that
// rewrites the journal must not drop what drizzle wrote.

import { asMapping, isNumber, isText, type JsonObject, type JsonValue } from "./json-source";

interface MigrationJournalEntry {
  idx: number;
  tag: string;
  source: JsonObject;
}

export interface MigrationJournal {
  document: JsonObject;
  entries: MigrationJournalEntry[];
}

export function parseMigrationJournal(raw: string, source: string): MigrationJournal {
  const parsed: JsonValue = JSON.parse(raw);
  const document = asMapping(parsed);
  const entries = document?.["entries"];
  if (!document || !Array.isArray(entries)) {
    throw new Error(`${source} has no "entries" array`);
  }
  return {
    document,
    entries: entries.map((entry) => {
      const fields = asMapping(entry);
      const idx = fields?.["idx"];
      const tag = fields?.["tag"];
      if (!fields || !isNumber(idx) || !isText(tag)) {
        throw new Error(`${source} has an entry missing idx/tag`);
      }
      return { idx, tag, source: fields };
    }),
  };
}
