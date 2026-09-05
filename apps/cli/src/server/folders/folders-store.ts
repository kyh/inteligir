import { z } from "zod";

import { connectedFolderPathSchema } from "@repo/api/local/folders/folders-schema";
import { JsonFileStore } from "../json-file-store";

const foldersFileSchema = z.object({ folders: z.array(connectedFolderPathSchema) }).strict();

export class FoldersStore {
  private readonly file: JsonFileStore<typeof foldersFileSchema>;

  constructor(dataDir: string) {
    this.file = new JsonFileStore({
      dataDir,
      fileName: "connected-folders.json",
      schema: foldersFileSchema,
      empty: { folders: [] },
    });
  }

  read(): string[] {
    return this.file.read().folders;
  }

  write(folders: readonly string[]): void {
    this.file.write({ folders: [...folders] });
  }
}
