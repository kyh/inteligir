// under Paths.document, never Paths.cache: a photo waiting to be sent exists nowhere else, and iOS
// purges a cache under storage pressure. only the composition root imports this; it loads native
// modules.

import { Directory, File, Paths } from "expo-file-system";
import { settle } from "../lib/settle";
import type { OutboxFiles } from "./outbox-files";

const OUTBOX_DIR_NAME = "outbox";

// a write lands under this suffix and is moved into place, so a file found is whole
const PARTIAL_SUFFIX = ".partial";

const outboxDir = (): Directory => new Directory(Paths.document, OUTBOX_DIR_NAME);

export const createExpoOutboxFiles = (): OutboxFiles => ({
  clear: async () => {
    await settle(() => {
      const dir = outboxDir();
      if (dir.exists) {
        dir.delete();
      }
    });
  },

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
      const dir = outboxDir();
      dir.create({ idempotent: true, intermediates: true });
      const partial = new File(dir, `${name}${PARTIAL_SUFFIX}`);
      partial.write(bytes);
      partial.moveSync(new File(dir, name), { overwrite: true });
    });
  },
});
