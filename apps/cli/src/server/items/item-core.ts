// the primitives every save and fill writes through: one lock per url key, the existing-item
// lookup, free names, the absent-guarded create, content-addressed covers and copies, the original
// a file item wraps, the hash-guarded rewrite, and the engine's git reads. capture, the file save,
// the tag edit and the import all build on these, so a rule about where an item lands or how it is
// rewritten has one spelling.

import { vaultCommitSubject } from "@repo/contract/cloud/vault/vault-git";
import type { ItemFill } from "@repo/contract/local/items/items-schema";
import { attachmentDir } from "@repo/contract/local/vault/attachment-location";
import {
  contentHashBytesHex,
  contentHashHex,
  DEFAULT_ATTACHMENT_LOCATION,
} from "@repo/contract/local/vault/vault-schema";
import { isItemStub, itemFactsOf } from "@repo/notes/items/item-frontmatter";
import { urlKey } from "@repo/notes/items/item-url";
import type { ItemRow } from "@repo/notes/items/library-index";
import { freeDocPath } from "@repo/notes/knowledge/doc-file";
import { joinPath } from "@repo/notes/knowledge/vault-path";

import type { KnowledgeRuntime } from "../knowledge/knowledge-runtime";
import type { GitEngine } from "../vault/git-engine";
import { ENGINE_IDENTITY } from "../vault/git-run";
import type { VaultPrefsStore } from "../vault/vault-prefs-store";
import { VaultServiceError } from "../vault/vault-service";
import type { VaultService } from "../vault/vault-service";
import { ItemsError } from "./items-error";

export interface ItemCoreDeps {
  service: VaultService;
  knowledge: Pick<KnowledgeRuntime, "settle" | "findByUrl" | "itemsAt">;
  git: Pick<GitEngine, "isTracked" | "creatorOf" | "syncNow" | "commitPaths">;
  // the attachments location, read per save
  prefs: VaultPrefsStore;
  // renameNoteWithLinkRewrite with `alias: false`: links rewritten, no alias kept
  renameNote: (from: string, to: string) => Promise<{ path: string; rewritten: string[] }>;
  now: () => Date;
  // crypto.randomUUID
  newId: () => string;
}

// freeDocPath against one listing plus the names it handed out: the import's per-batch namer
export type FolderNamer = (stem: string) => string;

export interface ItemCore {
  now: () => Date;
  newId: () => string;
  // every save of one url key runs one at a time
  withUrlLock: <T>(key: string, run: () => Promise<T>) => Promise<T>;
  // the item already holding this url's key: a non-stub first, then the earliest saved; null when
  // none. `settle: false` skips the settle and the prune of the stubs this core created: the
  // import settles once per batch
  existing: (
    url: string,
    options?: { settle: boolean },
  ) => Promise<{ path: string; fill: ItemFill } | null>;
  // a free doc name for `stem` in `folder`, "" being the root
  freePath: (folder: string, stem: string) => Promise<string>;
  // one listing of `folder`, then names handed out from it: the import's per-batch namer
  folderNamer: (folder: string) => Promise<FolderNamer>;
  // an absent-guarded create that takes the next free name when one is taken, at most 5 tries
  createDoc: (args: {
    folder: string;
    stem: string;
    content: string;
    name?: FolderNamer;
  }) => Promise<{ path: string }>;
  // `<dir>/<sha256hex[0..16]>.<ext>`, reused when it is there; `wrote` false then
  writeContentAddressed: (
    dir: string,
    ext: string,
    bytes: Uint8Array,
  ) => Promise<{ path: string; wrote: boolean }>;
  // where a paste beside the wrapper would land, under the original's own name
  writeOriginal: (
    wrapperPath: string,
    baseName: string,
    bytes: Uint8Array,
  ) => Promise<{ path: string }>;
  // null when nothing is there
  read: (path: string) => Promise<{ content: string; hash: string } | null>;
  // "changed" when the hash moved, "gone" when the file is gone
  write: (
    path: string,
    content: string,
    expectedHash: string,
  ) => Promise<"written" | "changed" | "gone">;
  // best effort: a path already gone is no failure. a save that gives up takes back what it wrote
  remove: (path: string) => Promise<void>;
  isTracked: (path: string) => Promise<boolean>;
  // "phone" when the commit that added the path was the Worker's, else "device"; null when
  // untracked or there is no repo
  creatorOf: (path: string) => Promise<"phone" | "device" | null>;
  rename: (from: string, to: string) => Promise<{ path: string; rewritten: string[] }>;
  // the engine's own pass, for a foreign fill: resolves on any outcome
  syncNow: () => Promise<void>;
  // a commit of exactly these paths as the engine
  commitPaths: (paths: readonly string[]) => Promise<void>;
}

const MAX_CREATE_TRIES = 5;
const CONTENT_ADDRESS_HEX_CHARS = 16;
const PENDING: ItemFill = { state: "pending" };

const fillOf = (row: ItemRow): ItemFill => {
  if (row.pending) {
    return PENDING;
  }
  return row.fetchError === null
    ? { state: "filled" }
    : { message: row.fetchError, state: "failed" };
};

// a stub this core wrote, answered until a settle has indexed it
interface CreatedStub {
  path: string;
  seq: number;
}

export const createItemCore = (deps: ItemCoreDeps): ItemCore => {
  const { service } = deps;
  const urlLocks = new Map<string, Promise<unknown>>();
  const created = new Map<string, CreatedStub>();
  let createdSeq = 0;

  const withUrlLock = async <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const previous = urlLocks.get(key) ?? Promise.resolve();
    const next = (async () => {
      try {
        await previous;
      } catch {
        // the rejection is that save's; the chain only orders the next one.
      }
      return await run();
    })();
    urlLocks.set(key, next);
    try {
      return await next;
    } finally {
      if (urlLocks.get(key) === next) {
        urlLocks.delete(key);
      }
    }
  };

  const pruneCreated = (settledThrough: number): void => {
    for (const [key, stub] of created) {
      if (stub.seq <= settledThrough) {
        created.delete(key);
      }
    }
  };

  const existing: ItemCore["existing"] = async (url, options) => {
    const key = urlKey(url);
    if (key === null) {
      return null;
    }
    if (options?.settle !== false) {
      const mark = createdSeq;
      await deps.knowledge.settle();
      pruneCreated(mark);
    }
    const matches = await deps.knowledge.findByUrl(url, 1);
    const [top] = matches.items;
    if (top !== undefined && !top.pending) {
      return { fill: fillOf(top), path: top.path };
    }
    const mine = created.get(key);
    if (mine !== undefined) {
      return { fill: PENDING, path: mine.path };
    }
    return top === undefined ? null : { fill: fillOf(top), path: top.path };
  };

  // a folder a file stands in refuses every save into it, said once here rather than as the
  // write's conflict
  const listingOf = async (folder: string): Promise<string[]> => {
    if (folder === "") {
      const files = await service.listFileStats();
      return files.map((file) => file.path);
    }
    if ((await service.statEntry(folder)) === "file") {
      throw new ItemsError("folder-is-file", { folder });
    }
    return await service.listFilesUnder(folder);
  };

  const folderNamer = async (folder: string): Promise<FolderNamer> => {
    const taken = await listingOf(folder);
    return (stem) => {
      const path = freeDocPath(folder, stem, taken);
      taken.push(path);
      return path;
    };
  };

  const remember = (path: string, content: string): void => {
    const facts = itemFactsOf(content);
    if (facts.urlKey !== null && isItemStub(facts)) {
      createdSeq += 1;
      created.set(facts.urlKey, { path, seq: createdSeq });
    }
  };

  return {
    async commitPaths(paths) {
      if (paths.length === 0) {
        return;
      }
      await deps.git.commitPaths(paths, ENGINE_IDENTITY, vaultCommitSubject(paths));
    },

    async createDoc({ folder, stem, content, name }) {
      const namer = name ?? (await folderNamer(folder));
      for (let attempt = 0; attempt < MAX_CREATE_TRIES; attempt += 1) {
        const result = await service.writeGuarded(namer(stem), content, { kind: "absent" });
        if (result.applied) {
          remember(result.path, content);
          return { path: result.path };
        }
      }
      throw new ItemsError("names-exhausted");
    },

    async creatorOf(path) {
      return await deps.git.creatorOf(path);
    },

    existing,

    folderNamer,

    async freePath(folder, stem) {
      return freeDocPath(folder, stem, await listingOf(folder));
    },

    async isTracked(path) {
      return await deps.git.isTracked(path);
    },

    newId: deps.newId,

    now: deps.now,

    async read(path) {
      try {
        const { content } = await service.read(path);
        return { content, hash: await contentHashHex(content) };
      } catch (error) {
        if (error instanceof VaultServiceError && error.code === "not_found") {
          return null;
        }
        throw error;
      }
    },

    async remove(path) {
      try {
        await service.remove(path);
      } catch (error) {
        if (!(error instanceof VaultServiceError && error.code === "not_found")) {
          throw error;
        }
      }
    },

    async rename(from, to) {
      return await deps.renameNote(from, to);
    },

    async syncNow() {
      try {
        await deps.git.syncNow();
      } catch {
        // a pass that failed says so on the status; the fill goes on either way.
      }
    },

    async write(path, content, expectedHash) {
      const result = await service.writeGuarded(path, content, {
        hash: expectedHash,
        kind: "expected",
      });
      if (result.applied) {
        return "written";
      }
      return result.reason === "hash_mismatch" && result.current === null ? "gone" : "changed";
    },

    async writeContentAddressed(dir, ext, bytes) {
      const hash = await contentHashBytesHex(new Uint8Array(bytes));
      const name = `${hash.slice(0, CONTENT_ADDRESS_HEX_CHARS)}.${ext}`;
      const path = joinPath(dir, name);
      if ((await service.statEntry(path)) === "file") {
        return { path, wrote: false };
      }
      const written = await service.writeAsset(dir, name, bytes);
      if (written.path !== path) {
        // another writer landed the same bytes under that name meanwhile: keep theirs
        await service.remove(written.path);
        return { path, wrote: false };
      }
      return { path, wrote: true };
    },

    async writeOriginal(wrapperPath, baseName, bytes) {
      const location = deps.prefs.read().attachments ?? DEFAULT_ATTACHMENT_LOCATION;
      return await service.writeAsset(attachmentDir(location, wrapperPath), baseName, bytes);
    },

    withUrlLock,
  };
};
