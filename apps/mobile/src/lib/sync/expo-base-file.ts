// ---------------------------------------------------------------------------
// The Expo File-API backing for the BaseStore's `JsonFile` port — a single JSON
// file at `${Paths.document}/sync-base.json` holding the last-synced base
// manifest.
//
// The anchor is a pure CACHE of the last sync, so an unreadable file reads the
// same as an absent one: `null`, and the next pass rebuilds from empty. Only a
// store holding the user's own words (the chat outbox) needs the two apart.
// ---------------------------------------------------------------------------

import type { JsonFile } from "@repo/notes/sync/base-store";

import { createExpoJsonFile } from "../expo-json-file";

/** The base-manifest filename under the app's document directory. */
const BASE_FILE = "sync-base.json";

/** A `JsonFile` backed by Expo's synchronous File API. */
export function createExpoBaseFile(): JsonFile {
  const file = createExpoJsonFile(BASE_FILE);
  return {
    read: () => {
      const result = file.read();
      return result.kind === "text" ? result.text : null;
    },
    write: file.write,
  };
}
