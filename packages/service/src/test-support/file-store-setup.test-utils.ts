import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    blobReadWriteToken: string;
  }
}

const folder = await mkdtemp(path.join(tmpdir(), "inteligir-files-"));

process.env.FILE_STORE_DIR = folder;

process.env.BETTER_AUTH_SECRET ??= "the-suites-own-secret-for-signing-uploads";

process.env.BLOB_READ_WRITE_TOKEN = "";

afterAll(async () => {
  await rm(folder, { force: true, recursive: true });
});
