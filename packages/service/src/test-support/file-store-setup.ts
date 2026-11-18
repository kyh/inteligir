// vitest's setupFiles: each suite file's own file store, a folder of its own that goes when the file
// ends, and a secret to sign uploads with when the run sets none, both before `../env` is read. A
// Blob key the run was given reaches the store's contract alone, by vitest's `provide`
// (`../../vitest.config.ts`), so no suite's own store is the real one.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    // blank when the run was given none
    blobReadWriteToken: string;
  }
}

const folder = await mkdtemp(path.join(tmpdir(), "inteligir-files-"));
process.env.FILE_STORE_DIR = folder;
process.env.BETTER_AUTH_SECRET ??= "the-suites-own-secret-for-signing-uploads";
// blank reads as unset
process.env.BLOB_READ_WRITE_TOKEN = "";

afterAll(async () => {
  await rm(folder, { force: true, recursive: true });
});
