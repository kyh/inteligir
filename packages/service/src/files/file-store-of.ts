// Which store the deployment keeps files in, chosen once from its keys as mail's mode is
// (`../auth/send-email`): Blob when its key is set, which Vercel sets on a project the store is
// connected to; nowhere on Vercel without one, where a folder would be an instance's own and gone
// with it; and a folder on disk everywhere else.

import path from "node:path";

import { env } from "../env";
import { blobFileStore } from "./blob-file-store";
import { diskFileStore } from "./disk-file-store";
import type { DiskFileStore } from "./disk-file-store";
import type { FileStore } from "./file-store";

type FileStoreMode =
  | { readonly kind: "blob"; readonly token: string }
  | { readonly kind: "disk"; readonly dir: string }
  | { readonly kind: "off" };

type FileStoreSettings = Pick<typeof env, "BLOB_READ_WRITE_TOKEN" | "FILE_STORE_DIR">;

export const fileStoreModeOf = (
  { BLOB_READ_WRITE_TOKEN, FILE_STORE_DIR }: FileStoreSettings,
  onVercel: boolean,
): FileStoreMode => {
  if (BLOB_READ_WRITE_TOKEN !== undefined) {
    return { kind: "blob", token: BLOB_READ_WRITE_TOKEN };
  }
  return onVercel ? { kind: "off" } : { dir: path.resolve(FILE_STORE_DIR), kind: "disk" };
};

const MODE = fileStoreModeOf(env, process.env.VERCEL !== undefined);

const NO_STORE =
  "This deployment keeps no files: connect a Blob store, which sets BLOB_READ_WRITE_TOKEN.";

const refused = async (): Promise<never> => await Promise.reject(new Error(NO_STORE));

const OFF: FileStore = {
  head: refused,
  keep: refused,
  put: refused,
  read: refused,
  remove: refused,
  removePrefix: refused,
  uploadTicket: refused,
};

const DISK = MODE.kind === "disk" ? diskFileStore(MODE.dir) : null;

export const FILE_STORE: FileStore =
  MODE.kind === "blob" ? blobFileStore(MODE.token) : (DISK ?? OFF);

// the store when it is a folder, which takes an upload on the cloud's own origin; null for any other
export const DISK_FILE_STORE: DiskFileStore | null = DISK;
