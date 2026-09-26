// under Paths.document, never Paths.cache: a photo waiting to be sent exists nowhere else, and iOS
// purges a cache under storage pressure. only the composition root imports this; it loads native
// modules.

import { Directory, File, Paths } from "expo-file-system";
import { settle } from "../lib/settle";
import type { OutboxFolder } from "./outbox-files";

const OUTBOX_DIR_NAME = "outbox";

// a write lands under this suffix and is moved into place, so a file found is whole
const PARTIAL_SUFFIX = ".partial";

const outboxDir = (): Directory => new Directory(Paths.document, OUTBOX_DIR_NAME);

const createdOutboxDir = (): Directory => {
  const dir = outboxDir();
  dir.create({ idempotent: true, intermediates: true });
  return dir;
};

// a Directory names itself by file:// uri; the backup flag takes a filesystem path
const pathOfFileUri = (uri: string): string => decodeURIComponent(uri.replace(/^file:\/\//u, ""));

export const createExpoOutboxFolder = (): OutboxFolder => ({
  clear: async () => {
    await settle(() => {
      const dir = outboxDir();
      if (dir.exists) {
        dir.delete();
      }
    });
  },

  ensure: async () => await settle(() => pathOfFileUri(createdOutboxDir().uri)),

  find: async (name) =>
    await settle(() => {
      const file = new File(outboxDir(), name);
      return file.exists ? file.uri : null;
    }),

  read: async (name) => await new File(outboxDir(), name).bytes(),

  remove: async (name) => {
    await settle(() => {
      const file = new File(outboxDir(), name);
      if (file.exists) {
        file.delete();
      }
    });
  },

  stage: async (name, bytes) => {
    await settle(() => {
      const dir = createdOutboxDir();
      const partial = new File(dir, `${name}${PARTIAL_SUFFIX}`);
      partial.write(bytes);
      partial.moveSync(new File(dir, name), { overwrite: true });
    });
  },
});
