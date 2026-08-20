// Drizzle's own `meta/_journal.json`, parsed. The file is generated data on
// disk, so every field this package reads is established before it is read,
// and the fields it has no reading for are carried through untouched — a
// caller that rewrites the journal must not drop what drizzle wrote.

import { asMapping, isNumber, isText, type JsonObject, type JsonValue } from "./json-source";

interface MigrationJournalEntry {
  idx: number;
  tag: string;
  /** The entry as written, for a caller that rewrites the journal. */
  source: JsonObject;
}

export interface MigrationJournal {
  /** The document as written, for the same reason. */
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
