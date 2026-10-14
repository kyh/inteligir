import { z } from "zod";

import { connectedFolderPathSchema } from "@repo/contract/local/folders/folders-schema";
import { JsonFileStore } from "../json-file-store";

const foldersFileSchema = z.strictObject({ folders: z.array(connectedFolderPathSchema) });

export class FoldersStore {
  private readonly file: JsonFileStore<typeof foldersFileSchema>;

  constructor(dataDir: string) {
    this.file = new JsonFileStore({
      dataDir,
      empty: { folders: [] },
      fileName: "connected-folders.json",
      schema: foldersFileSchema,
    });
  }

  read(): string[] {
    return this.file.read().folders;
  }

  write(folders: readonly string[]): void {
    this.file.write({ folders: [...folders] });
  }
}
