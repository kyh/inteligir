// The file cache's folder in memory, as the phone's suites and its scenarios under node hold it: a
// file's address a `memory://` one naming it.

import type { FileFolder } from "../files/file-cache";

export interface MemoryFolder extends FileFolder {
  readonly held: () => readonly string[];
}

export const memoryFolder = (): MemoryFolder => {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    clear: async () => {
      files.clear();
      await Promise.resolve();
    },
    held: () => [...files.keys()],
    read: async (name) => await Promise.resolve(files.get(name) ?? null),
    uri: async (name) => await Promise.resolve(files.has(name) ? `memory://${name}` : null),
    write: async (name, bytes) => {
      files.set(name, bytes);
      return await Promise.resolve(`memory://${name}`);
    },
  };
};
