/* oxlint-disable max-classes-per-file, anti-slop/no-module-mocking -- the adapter is the seam to
   two native modules node cannot load, so the stand-ins are those modules: a file and a directory
   constructor, and a hash the test can hold */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const dirs = new Set<string>();
  const files = new Map<string, string>();
  const heldHashes: (() => void)[] = [];
  let holdHashes = false;

  const removeTree = (uri: string): void => {
    const inside = (candidate: string): boolean =>
      candidate === uri || candidate.startsWith(`${uri}/`);
    for (const dir of [...dirs].filter(inside)) {
      dirs.delete(dir);
    }
    for (const file of [...files.keys()].filter(inside)) {
      files.delete(file);
    }
  };

  class FakeDirectory {
    readonly uri: string;
    readonly name: string;

    constructor(parent: FakeDirectory | null, name: string) {
      this.uri = parent === null ? name : `${parent.uri}/${name}`;
      this.name = name;
    }

    get exists(): boolean {
      return dirs.has(this.uri);
    }

    create(): void {
      const parts = this.uri.split("/");
      for (let end = 1; end <= parts.length; end += 1) {
        dirs.add(parts.slice(0, end).join("/"));
      }
    }

    delete(): void {
      removeTree(this.uri);
    }

    list(): { name: string; delete: () => void }[] {
      const prefix = `${this.uri}/`;
      return [...dirs, ...files.keys()]
        .filter((uri) => uri.startsWith(prefix) && !uri.slice(prefix.length).includes("/"))
        .map((uri) => ({
          delete: () => {
            removeTree(uri);
          },
          name: uri.slice(prefix.length),
        }));
    }
  }

  class FakeFile {
    readonly uri: string;
    readonly parentDirectory: FakeDirectory;

    constructor(parent: FakeDirectory, name: string) {
      this.uri = `${parent.uri}/${name}`;
      this.parentDirectory = parent;
    }

    get exists(): boolean {
      return files.has(this.uri);
    }

    write(text: string): void {
      if (!this.parentDirectory.exists) {
        throw new Error(`no directory ${this.parentDirectory.uri}`);
      }
      files.set(this.uri, text);
    }

    async text(): Promise<string> {
      const text = files.get(this.uri);
      if (text === undefined) {
        throw new Error(`no file ${this.uri}`);
      }
      return text;
    }
  }

  return {
    Directory: FakeDirectory,
    File: FakeFile,
    Paths: { cache: new FakeDirectory(null, "cache") },
    digestStringAsync: async (_algorithm: string, value: string): Promise<string> => {
      if (holdHashes) {
        // oxlint-disable-next-line promise/avoid-new -- a deferred: the test releases the hash by hand
        await new Promise<void>((resolve) => {
          heldHashes.push(resolve);
        });
      }
      return value.replaceAll("/", "_");
    },
    files,
    holdHashes: (hold: boolean): void => {
      holdHashes = hold;
    },
    releaseHashes: (): void => {
      holdHashes = false;
      for (const release of heldHashes.splice(0)) {
        release();
      }
    },
    reset: (): void => {
      dirs.clear();
      files.clear();
      heldHashes.length = 0;
      holdHashes = false;
    },
  };
});

vi.mock("expo-file-system", () => ({
  Directory: fake.Directory,
  File: fake.File,
  Paths: fake.Paths,
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: fake.digestStringAsync,
}));

const { createExpoNoteCache } = await import("../expo-note-cache");

const COMMIT = "c".repeat(40);
const NOTE = { commit: COMMIT, content: "# a\n", path: "notes/a.md" };

beforeEach(() => {
  fake.reset();
});

describe("the expo note cache", () => {
  it("writes a row it can read back", async () => {
    const cache = createExpoNoteCache();
    await cache.set(NOTE);
    expect(await cache.get(COMMIT, NOTE.path)).toEqual(NOTE);
  });

  it("a set that started before a clear never lands", async () => {
    const cache = createExpoNoteCache();
    fake.holdHashes(true);
    const pending = cache.set(NOTE);
    await cache.clear();
    fake.releaseHashes();
    await pending;

    expect(fake.files.size).toBe(0);
    expect(await cache.get(COMMIT, NOTE.path)).toBeNull();
  });

  it("a set after a clear lands", async () => {
    const cache = createExpoNoteCache();
    await cache.set(NOTE);
    await cache.clear();
    await cache.set(NOTE);
    expect(await cache.get(COMMIT, NOTE.path)).toEqual(NOTE);
  });
});
