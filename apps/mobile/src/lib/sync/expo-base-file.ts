// ---------------------------------------------------------------------------
// The Expo File-API backing for the BaseStore's `JsonFile` port — a single JSON
// file at `${Paths.document}/sync-base.json` holding the last-synced base
// manifest. Uses the synchronous File API; a fresh instance per call so `exists`
// reflects current state.
// ---------------------------------------------------------------------------

import { File, Paths } from "expo-file-system";

import type { JsonFile } from "@repo/domain/sync/base-store";

/** The base-manifest filename under the app's document directory. */
const BASE_FILE = "sync-base.json";

/** A `JsonFile` backed by Expo's synchronous File API. */
export function createExpoBaseFile(): JsonFile {
  const make = () => new File(Paths.document, BASE_FILE);
  return {
    read: () => {
      const file = make();
      return file.exists ? file.textSync() : null;
    },
    write: (text) => {
      const file = make();
      file.create({ intermediates: true, overwrite: true });
      file.write(text);
    },
  };
}
