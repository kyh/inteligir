// The file cache's folders on the phone (expo-file-system's File and Directory objects): what the person's own notes embed and what waits to be uploaded under
// Documents, kept out of the device backup since it downloads again or is sent from here, and the
// discardable copies under Paths.cache, which iOS may purge under storage pressure and keeps out of
// the backup itself. A write lands under a partial name and is moved into place, so a file found is
// whole. Only the composition root imports this: it loads native modules.

import { Directory, File, Paths } from "expo-file-system";
import { settle } from "../lib/settle";
import type { FileFolders, FilePlace } from "./file-cache";

const PARTIAL_SUFFIX = ".partial";

// a Directory names itself by file:// uri; the backup flag takes a filesystem path
const pathOfFileUri = (uri: string): string => decodeURIComponent(uri.replace(/^file:\/\//u, ""));

const folderOf = (place: FilePlace): Directory =>
  place === "cache"
    ? new Directory(Paths.cache, "files")
    : new Directory(Paths.document, "files", place);

export const createExpoFileFolders = (
  excludeFromBackup: (path: string) => Promise<void>,
): FileFolders => {
  let excluded: Promise<void> | null = null;
  // the Documents folder made once, and kept out of the backup before a byte lands in it
  const made = async (place: FilePlace): Promise<Directory> => {
    const dir = folderOf(place);
    await settle(() => {
      dir.create({ idempotent: true, intermediates: true });
    });
    if (place !== "cache") {
      excluded ??= excludeFromBackup(pathOfFileUri(new Directory(Paths.document, "files").uri));
      await excluded;
    }
    return dir;
  };

  return {
    clear: async (place) => {
      await settle(() => {
        const dir = folderOf(place);
        if (dir.exists) {
          dir.delete();
        }
      });
    },
    names: async (place) =>
      await settle(() => {
        const dir = folderOf(place);
        return dir.exists
          ? dir.list().flatMap((entry) => (entry instanceof File ? [entry.name] : []))
          : [];
      }),
    read: async (place, name) => {
      const file = new File(folderOf(place), name);
      return file.exists ? await file.bytes() : null;
    },
    remove: async (place, name) => {
      await settle(() => {
        const file = new File(folderOf(place), name);
        if (file.exists) {
          file.delete();
        }
      });
    },
    uri: async (place, name) =>
      await settle(() => {
        const file = new File(folderOf(place), name);
        return file.exists ? file.uri : null;
      }),
    write: async (place, name, bytes) => {
      const dir = await made(place);
      return await settle(() => {
        const partial = new File(dir, `${name}${PARTIAL_SUFFIX}`);
        partial.write(bytes);
        const file = new File(dir, name);
        partial.moveSync(file, { overwrite: true });
        return file.uri;
      });
    },
  };
};
