// What the editor page asks of the phone, answered over the notes store and the file verbs, and
// where each thing the page says leads. Platform-free: the native halves (the photo picker, a
// file's bytes, the revision hash, the navigation stack) are handed in, so the store's answers run
// under node against the same fake vault the store's own suites use.

import { bytesFromBase64 } from "@repo/api/cloud/bytes";
import { assetMediaType } from "@repo/api/cloud/vault/vault-schema";
import { docStem, isDocPath, isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import { basenamePath, dirnamePath } from "@repo/notes/knowledge/vault-path";
import type { NativeFrame, RequestResult } from "@repo/mobile-editor/bridge-protocol";
import type { FileOps } from "../notes/file-ops";
import { linksKeptLine } from "../notes/file-ops";
import type { HeldFile, NotesStore } from "../notes/notes-store";
import type { PhotoIngest } from "../notes/photo-ingest";
import type { EditorPageEvent, EditorRequestPorts } from "./editor-host";

type VaultChangedEvent = Extract<NativeFrame, { type: "vaultChanged" }>["event"];

type WikiTargetRow = RequestResult<"wikiTargets">["targets"][number];

// where a page event takes the phone's stack: a note the page opened, or a new thread about the
// note asked from, with the selection it was asked over and the sha-256 of the bytes it held
export type EditorRoute =
  | { kind: "note"; path: string }
  | { kind: "thread"; threadId: string; note: string; quote: string; revision: string | null };

export interface EditorPortsArgs {
  store: Pick<
    NotesStore,
    "attachmentFile" | "create" | "heldFiles" | "readNote" | "tree" | "watchPath" | "write"
  >;
  fileOps: FileOps;
  pickImage: () => Promise<PhotoIngest>;
  // a file the phone holds, as base64
  readBase64: (uri: string) => Promise<string>;
  revisionOf: (content: string) => Promise<string>;
  newThreadId: () => string;
  go: (route: EditorRoute) => void;
  showComments: (ids: readonly string[]) => void;
  // the note the page shows; null once it was deleted and the page shows none
  opened: (path: string | null) => void;
  // a note-level fact the page has no words for: a rename's links that kept the old name
  notify: (title: string, message: string) => void;
}

export interface EditorPorts {
  readonly requests: EditorRequestPorts;
  readonly handle: (event: EditorPageEvent) => void;
  // a new thread about `path`, as the header's Ask agent and the page's both open one
  readonly askAgent: (path: string, selection: string) => Promise<void>;
  // tells `listener` what moved under the page: the listing, and the bytes of every note it read.
  // the returned stop ends every watch this began
  readonly watch: (listener: (event: VaultChangedEvent) => void) => () => void;
}

const NO_FOLDER_MOVES = "A note moves to another folder from your Mac.";

// the resolver's alias and id tiers read these; the title is the name, since the phone holds no
// projection of a note's heading
const targetOf = (file: HeldFile): WikiTargetRow => {
  if (!isDocPath(file.path)) {
    return { path: file.path, title: basenamePath(file.path), type: "asset" };
  }
  const target: WikiTargetRow = { path: file.path, title: docStem(file.path), type: "doc" };
  if (file.aliases.length > 0) {
    target.aliases = [...file.aliases];
  }
  if (file.noteId !== null) {
    target.id = file.noteId;
  }
  return target;
};

// a change to what a listing row says (its path, its id, its aliases) re-lists the page
const factsOf = (files: readonly HeldFile[]): ReadonlyMap<string, string> =>
  new Map(
    files.map((file): [string, string] => [file.path, JSON.stringify([file.noteId, file.aliases])]),
  );

const movedPaths = (
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] => [
  ...[...after].flatMap(([path, facts]) => (before.get(path) === facts ? [] : [path])),
  ...[...before.keys()].filter((path) => !after.has(path)),
];

export const createEditorPorts = (args: EditorPortsArgs): EditorPorts => {
  const { fileOps, store } = args;
  let listener: ((event: VaultChangedEvent) => void) | null = null;
  const readWatches = new Map<string, () => void>();

  const emit = (event: VaultChangedEvent): void => {
    listener?.(event);
  };

  // a read is what the page shows, so a change to those bytes other than its own write is told
  const watchRead = (path: string): void => {
    if (listener !== null && !readWatches.has(path)) {
      readWatches.set(
        path,
        store.watchPath(path, () => {
          emit({ kind: "content", path });
        }),
      );
    }
  };

  const readText = async (path: string): Promise<string> => {
    const read = await store.readNote(path);
    if (!read.ok) {
      throw new Error(read.message);
    }
    return read.content;
  };

  const requests: EditorRequestPorts = {
    list: async () => await Promise.resolve({ paths: store.heldFiles().map((file) => file.path) }),

    pickImage: async () => await args.pickImage(),

    read: async ({ path }) => {
      const content = await readText(path);
      watchRead(path);
      return { content };
    },

    readAsset: async ({ path }) => {
      const held = await store.attachmentFile(path);
      if (!held.ok) {
        throw new Error(held.message);
      }
      return {
        base64: await args.readBase64(held.uri),
        mediaType: assetMediaType(path) ?? "application/octet-stream",
      };
    },

    remove: async ({ path }) => {
      await fileOps.remove(path);
      return {};
    },

    rename: async ({ from, to }) => {
      if (dirnamePath(from) !== dirnamePath(to)) {
        return { error: NO_FOLDER_MOVES, ok: false };
      }
      const renamed = await fileOps.rename(from, basenamePath(to));
      if (renamed.kind === "refused") {
        return { error: renamed.message, ok: false };
      }
      if (renamed.unlinked.length > 0) {
        args.notify("Renamed", linksKeptLine(renamed.unlinked));
      }
      return { ok: true };
    },

    wikiTargets: async () =>
      await Promise.resolve({
        targets: store
          .heldFiles()
          .filter((file) => !isVaultMetadataPath(file.path))
          .map(targetOf),
      }),

    // the page's CAS: its base is compared with the text the phone holds now, so a change a sync
    // landed since the page read is handed back for the page's own merge
    write: async ({ content, guard, path }) => {
      if (guard.kind === "absent") {
        const created = await store.create(path, content);
        return created.kind === "created" ? { kind: "written" } : { kind: "exists" };
      }
      const read = await store.readNote(path);
      if (!read.ok) {
        if (read.notFound) {
          return { kind: "missing" };
        }
        throw new Error(read.message);
      }
      if (read.content !== guard.base) {
        return { current: read.content, kind: "changed" };
      }
      const written = await store.write(path, content);
      if (written.kind === "vanished") {
        return { kind: "missing" };
      }
      // the store merged a landing that raced this write, so the page holds less than the phone
      if (written.content !== content) {
        emit({ kind: "content", path });
      }
      return { kind: "written" };
    },

    writeAsset: async ({ base64, baseName }) => {
      const written = await fileOps.writeAsset(baseName, bytesFromBase64(base64));
      if (written.kind === "refused") {
        throw new Error(written.message);
      }
      return { path: written.path };
    },
  };

  const askAgent = async (path: string, selection: string): Promise<void> => {
    const read = await store.readNote(path);
    args.go({
      kind: "thread",
      note: path,
      quote: selection,
      revision: read.ok ? await args.revisionOf(read.content) : null,
      threadId: args.newThreadId(),
    });
  };

  const handle = (event: EditorPageEvent): void => {
    switch (event.type) {
      // the page says each of these itself: a failed save, a merge that kept its lines, and a
      // tag, which has no screen on the phone
      case "editorState":
      case "mergeConflict":
      case "showTag": {
        return;
      }
      case "navigate": {
        // an attachment has no screen here, and opened as a note it would show its bytes
        if (isDocPath(event.path)) {
          args.go({ kind: "note", path: event.path });
        }
        return;
      }
      case "askAgent": {
        void askAgent(event.path, event.selection);
        return;
      }
      case "showComments": {
        args.showComments(event.ids);
        return;
      }
      case "opened": {
        args.opened(event.path);
      }
      // no default
    }
  };

  const watch: EditorPorts["watch"] = (next) => {
    listener = next;
    let known = store.tree.get().state === "ready" ? factsOf(store.heldFiles()) : null;
    const unsubscribe = store.tree.subscribe(() => {
      if (store.tree.get().state !== "ready") {
        return;
      }
      const facts = factsOf(store.heldFiles());
      // a listing where there was none: nothing can name what it added
      const paths = known === null ? null : movedPaths(known, facts);
      known = facts;
      if (paths === null || paths.length > 0) {
        emit({ kind: "files", paths });
      }
    });
    return () => {
      unsubscribe();
      listener = null;
      for (const stop of readWatches.values()) {
        stop();
      }
      readWatches.clear();
    };
  };

  return { askAgent, handle, requests, watch };
};
