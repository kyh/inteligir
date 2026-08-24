// The list's bytes: `<dataDir>/connected-folders.json`, the connectors-store
// discipline without the 0600 (paths are not secrets). A JSON file rather
// than config.json because config.json is read once at boot and never written
// by the app — a Settings-editable list needs a file the app owns whole, and
// connectors.json is the precedent. Malformed is an ERROR, never an empty
// list: an empty list is a claim, and the next write would erase whatever the
// unparseable bytes held.

import { readFileSync } from "node:fs";
import { stagedWriteFileSync } from "../staged-write";
import { join } from "node:path";
import { z } from "zod";

import { connectedFolderPathSchema } from "@repo/api/local/folders/folders-schema";

const CONNECTED_FOLDERS_FILE = "connected-folders.json";

const storeFileSchema = z.object({ folders: z.array(connectedFolderPathSchema) }).strict();

export class FoldersStoreError extends Error {}

export interface FoldersStore {
  read(): string[];
  write(folders: readonly string[]): void;
}

export function createFoldersStore(dataDir: string): FoldersStore {
  const path = join(dataDir, CONNECTED_FOLDERS_FILE);
  return {
    read(): string[] {
      let raw: string;
      try {
        raw = readFileSync(path, "utf8");
      } catch {
        return [];
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new FoldersStoreError(
          `${path} is not valid JSON — fix or remove the file; refusing to read it as empty`,
        );
      }
      const verdict = storeFileSchema.safeParse(parsed);
      if (!verdict.success) {
        throw new FoldersStoreError(
          `${path} does not match the connected-folders shape — fix or remove the file`,
        );
      }
      return verdict.data.folders;
    },
    write(folders: readonly string[]): void {
      // Deliberately modeless: paths are not secrets.
      stagedWriteFileSync(path, `${JSON.stringify({ folders }, null, 2)}\n`);
    },
  };
}
