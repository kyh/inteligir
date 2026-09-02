// a malformed file reads as disabled rather than an error: the only state here
// is a boolean, and refusing boot over it costs more than it protects.

import { readFileSync } from "node:fs";
import { stagedWriteFileSync } from "../staged-write";
import { join } from "node:path";
import { z } from "zod";

const SETTINGS_FILE = "note-intelligence.json";

const settingsSchema = z.object({ enabled: z.boolean() }).strict();

export interface NoteIntelligenceSettingsStore {
  readEnabled(): boolean;
  writeEnabled(enabled: boolean): void;
}

export function createNoteIntelligenceSettingsStore(
  dataDir: string,
): NoteIntelligenceSettingsStore {
  const path = join(dataDir, SETTINGS_FILE);
  return {
    readEnabled(): boolean {
      let raw: string;
      try {
        raw = readFileSync(path, "utf8");
      } catch {
        return false;
      }
      try {
        const parsed = settingsSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data.enabled : false;
      } catch {
        return false;
      }
    },

    writeEnabled(enabled: boolean): void {
      stagedWriteFileSync(path, `${JSON.stringify({ enabled }, null, 2)}\n`, { mode: 0o600 });
    },
  };
}
