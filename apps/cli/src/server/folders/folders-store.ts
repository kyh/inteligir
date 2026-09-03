// not config.json: that is read once at boot and never written by the app.
// malformed bytes are an error, not an empty list — the next write would erase them.

import { readFileSync } from "node:fs";
import { stagedWriteFileSync } from "../staged-write";
import { join } from "node:path";
import { z } from "zod";

import { connectedFolderPathSchema } from "@repo/api/local/folders/folders-schema";

const CONNECTED_FOLDERS_FILE = "connected-folders.json";

const storeFileSchema = z.object({ folders: z.array(connectedFolderPathSchema) }).strict();

export class FoldersStoreError extends Error {}

export class FoldersStore {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, CONNECTED_FOLDERS_FILE);
  }

  read(): string[] {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new FoldersStoreError(
        `${this.path} is not valid JSON — fix or remove the file; refusing to read it as empty`,
      );
    }
    const verdict = storeFileSchema.safeParse(parsed);
    if (!verdict.success) {
      throw new FoldersStoreError(
        `${this.path} does not match the connected-folders shape — fix or remove the file`,
      );
    }
    return verdict.data.folders;
  }

  write(folders: readonly string[]): void {
    // no 0600: paths are not secrets.
    stagedWriteFileSync(this.path, `${JSON.stringify({ folders }, null, 2)}\n`);
  }
}
