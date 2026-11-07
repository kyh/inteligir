// The file cache's folders in memory, as the phone's suites and its scenarios under node hold them:
// each place its own map, a file's address a `memory://` one naming its place and name.

import type { FileFolders, FilePlace } from "../files/file-cache";

export interface MemoryFolders extends FileFolders {
  readonly held: (place: FilePlace) => readonly string[];
}

export const memoryFolders = (): MemoryFolders => {
  const places = new Map<FilePlace, Map<string, Uint8Array<ArrayBuffer>>>();
  const placeOf = (place: FilePlace): Map<string, Uint8Array<ArrayBuffer>> => {
    const held = places.get(place) ?? new Map<string, Uint8Array<ArrayBuffer>>();
    places.set(place, held);
    return held;
  };
  return {
    clear: async (place) => {
      placeOf(place).clear();
      await Promise.resolve();
    },
    held: (place) => [...placeOf(place).keys()],
    names: async (place) => await Promise.resolve([...placeOf(place).keys()]),
    read: async (place, name) => await Promise.resolve(placeOf(place).get(name) ?? null),
    remove: async (place, name) => {
      placeOf(place).delete(name);
      await Promise.resolve();
    },
    uri: async (place, name) =>
      await Promise.resolve(placeOf(place).has(name) ? `memory://${place}/${name}` : null),
    write: async (place, name, bytes) => {
      placeOf(place).set(name, bytes);
      return await Promise.resolve(`memory://${place}/${name}`);
    },
  };
};
