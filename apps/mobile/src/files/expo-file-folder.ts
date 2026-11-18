import { Directory, File, Paths } from "expo-file-system";
import { settle } from "../lib/settle";
import type { FileFolder } from "./file-cache";

const PARTIAL_SUFFIX = ".partial";

const folder = () => new Directory(Paths.cache, "files") satisfies Directory;

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
