// The file cache's folder on the phone (expo-file-system's File and Directory objects), under
// Paths.cache, which iOS keeps out of the device backup and may purge under storage pressure. A
// write lands under a partial name and is moved into place, so a file found is whole. Only the
// composition root imports this: it loads native modules.

import { Directory, File, Paths } from "expo-file-system";
import { settle } from "../lib/settle";
import type { FileFolder } from "./file-cache";

const PARTIAL_SUFFIX = ".partial";

const folder = (): Directory => new Directory(Paths.cache, "files");

export const expoFileFolder: FileFolder = {
  clear: async () => {
    await settle(() => {
      const dir = folder();
      if (dir.exists) {
        dir.delete();
      }
    });
  },
  read: async (name) => {
    const file = new File(folder(), name);
    return file.exists ? await file.bytes() : null;
  },
  uri: async (name) =>
    await settle(() => {
      const file = new File(folder(), name);
      return file.exists ? file.uri : null;
    }),
  write: async (name, bytes) =>
    await settle(() => {
      const dir = folder();
      dir.create({ idempotent: true, intermediates: true });
      const partial = new File(dir, `${name}${PARTIAL_SUFFIX}`);
      partial.write(bytes);
      const file = new File(dir, name);
      partial.moveSync(file, { overwrite: true });
      return file.uri;
    }),
};
