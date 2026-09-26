// under Paths.cache: iOS may purge it under storage pressure, which costs one download on the next
// open, and a cache is outside the iCloud backup. only the composition root imports this; it loads
// native modules. every call runs synchronously to its end, which is what keeps a save and a
// clear from interleaving.

import { Directory, File, Paths } from "expo-file-system";
import { settle } from "../lib/settle";
import type { AttachmentFiles } from "./attachment-files";

const ATTACHMENTS_DIR_NAME = "attachments";

// a write lands under this suffix and is moved into place, so a file found is whole
const PARTIAL_SUFFIX = ".partial";

const attachmentsDir = (): Directory => new Directory(Paths.cache, ATTACHMENTS_DIR_NAME);

export const createExpoAttachmentFiles = (): AttachmentFiles => ({
  clear: async () => {
    await settle(() => {
      const dir = attachmentsDir();
      if (dir.exists) {
        dir.delete();
      }
    });
  },

  find: async (name) =>
    await settle(() => {
      const file = new File(attachmentsDir(), name);
      return file.exists ? file.uri : null;
    }),

  save: async (name, bytes) =>
    await settle(() => {
      const dir = attachmentsDir();
      dir.create({ idempotent: true, intermediates: true });
      const partial = new File(dir, `${name}${PARTIAL_SUFFIX}`);
      partial.write(bytes);
      const file = new File(dir, name);
      partial.moveSync(file, { overwrite: true });
      return file.uri;
    }),
});
