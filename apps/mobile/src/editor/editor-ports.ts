// What the editor page asks of the phone, answered over the notes store and the file verbs, and
// where each thing the page says leads. Platform-free: the native halves (the photo picker, a
// file's bytes, the revision hash, the navigation stack) are handed in, so the store's answers run
// under node against the same fake vault the store's own suites use.

import { bytesFromBase64 } from "@repo/contract/cloud/bytes";
import { assetMediaType } from "@repo/contract/cloud/vault/vault-schema";
import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import { docStem, isDocPath, isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import { basenamePath, dirnamePath } from "@repo/notes/knowledge/vault-path";
import type { RequestResult } from "@repo/mobile-editor/bridge-protocol";
import type { AnnotationOps } from "../notes/annotation-ops";
import type { FileOps } from "../notes/file-ops";
import { linksKeptLine } from "../notes/file-ops";
import type { HeldFile, NotesStore } from "../notes/notes-store";
import type { PhotoIngest } from "../notes/photo-ingest";
import type { EditorNativeEvent, EditorPageEvent, EditorRequestPorts } from "./editor-host";

type VaultChangedEvent = Extract<EditorNativeEvent, { type: "vaultChanged" }>["event"];

type AnnotationMetaEvent = Extract<EditorNativeEvent, { type: "annotationMeta" }>;

type WikiTargetRow = RequestResult<"wikiTargets">["targets"][number];

// whether the page holds edits it has not written, and why its last save failed
export type PageEditorState = Pick<
  Extract<EditorPageEvent, { type: "editorState" }>,
  "dirty" | "saveError"
>;

// where a page event takes the phone's stack: a note the page opened, or a new thread about the
// note asked from, with the selection it was asked over and the sha-256 of the bytes it held
export type EditorRoute =
  | { kind: "note"; path: string }
  | { kind: "thread"; threadId: string; note: string; quote: string; revision: string | null };

export interface EditorPortsArgs {
  store: Pick<
    NotesStore,
    "attachmentFile" | "heldFiles" | "readAnnotations" | "readNote" | "tree" | "watchPath" | "write"
  >;
  fileOps: FileOps;
  annotations: AnnotationOps;
  pickImage: () => Promise<PhotoIngest>;
  readBase64: (uri: string) => Promise<string>;
  revisionOf: (content: string) => Promise<string>;
  newThreadId: () => string;
  go: (route: EditorRoute) => void;
  showAnnotations: (ids: readonly string[]) => void;
  // the note the page shows; null once it was deleted and the page shows none
  opened: (path: string | null) => void;
  // the note the page was opened on could not be read, in the phone's words
  openFailed: (message: string) => void;
  editorState: (state: PageEditorState) => void;
  // a note-level fact the page has no words for: a rename's links that kept the old name
  notify: (title: string, message: string) => void;
}

export interface EditorPorts {
  readonly requests: EditorRequestPorts;
  readonly handle: (event: EditorPageEvent) => void;
  // a new thread about `path`, as the header's Ask agent and the page's both open one
  readonly askAgent: (path: string, selection: string) => Promise<void>;
  // the annotation sheet's verbs, each telling the page what its ranges are drawn by once it lands,
  // and a deleted annotation's markers to take out
  readonly annotations: Pick<AnnotationOps, "reply" | "remove">;
  // tells `listener` what moved under the page: the listing, the bytes of every note it read, and
  // the open note's annotations. the returned stop ends every watch this began
  readonly watch: (listener: (event: EditorNativeEvent) => void) => () => void;
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
  let listener: ((event: EditorNativeEvent) => void) | null = null;
  const readWatches = new Map<string, () => void>();

  const emit = (event: VaultChangedEvent): void => {
    listener?.({ event, type: "vaultChanged" });
  };

  // the note the page shows, the annotations last sent for it, and the watches that send them again
  let openPath: string | null = null;
  let sentMeta: string | null = null;
  let metaSeq = 0;
  let metaWatches: (() => void)[] = [];

  // an unreadable store sends nothing, so the ranges keep what they last showed
  const sendAnnotationMeta = async (): Promise<void> => {
    const path = openPath;
    if (path === null || listener === null) {
      return;
    }
    metaSeq += 1;
    const seq = metaSeq;
    let meta: AnnotationMetaEvent;
    try {
      const read = await store.readNote(path);
      const annotations = read.ok ? await store.readAnnotations(read) : null;
      if (annotations === null || !annotations.ok) {
        return;
      }
      meta = {
        knownIds: annotations.annotations.map((annotation) => annotation.id),
        path,
        type: "annotationMeta",
      };
    } catch {
      return;
    }
    const key = JSON.stringify(meta);
    if (seq === metaSeq && key !== sentMeta) {
      sentMeta = key;
      listener?.(meta);
    }
  };

  const stopMetaWatches = (): void => {
    for (const stop of metaWatches) {
      stop();
    }
    metaWatches = [];
  };

  const noteIdOf = (path: string): string | null =>
    store.heldFiles().find((file) => file.path === path)?.noteId ?? null;

  // the annotations are the store's that the note's id names: a change to that store from elsewhere
  // reads them again, and a note whose id changed is followed to its new store. an edit of the
  // note's text alone changes neither. an edit made here is no change to a watcher, so each of the
  // phone's own annotation verbs tells the page itself
  const followAnnotations = (): void => {
    stopMetaWatches();
    const path = openPath;
    if (path === null || listener === null) {
      return;
    }
    const noteId = noteIdOf(path);
    metaWatches.push(
      store.watchPath(path, () => {
        if (noteIdOf(path) !== noteId) {
          followAnnotations();
          void sendAnnotationMeta();
        }
      }),
    );
    if (noteId !== null) {
      metaWatches.push(
        store.watchPath(annotationsStorePath(noteId), () => {
          void sendAnnotationMeta();
        }),
      );
    }
  };

  const refreshAnnotations = (): void => {
    followAnnotations();
    void sendAnnotationMeta();
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
    // the page's write under the `expected` guard, with the new annotation its markers anchor; a
    // first annotation mints the note an id, which the page is told of as a change to the note
    addAnnotation: async ({ base, content, id, path, quote }) => {
      const added = await args.annotations.add({
        anchor: { content, expected: base },
        id,
        path,
        quote,
      });
      switch (added.kind) {
        case "edited": {
          if (added.note !== content) {
            emit({ kind: "content", path });
          }
          refreshAnnotations();
          return { kind: "written" };
        }
        case "changed": {
          return { current: added.current, kind: "changed" };
        }
        case "vanished": {
          return { kind: "missing" };
        }
        case "refused": {
          throw new Error(added.message);
        }
        // no default
      }
    },

    // the note on an annotation the store holds, which leaves the note's text alone
    editAnnotation: async ({ id, path, text }) => {
      const edited = await args.annotations.edit(path, id, text);
      if (edited.kind === "done") {
        refreshAnnotations();
      }
      return edited;
    },
    list: async () => await Promise.resolve({ paths: store.heldFiles().map((file) => file.path) }),

    pickImage: async () => await args.pickImage(),

    // watched even when the read fails, so a landing of the note later reaches the page
    read: async ({ path }) => {
      try {
        return { content: await readText(path) };
      } finally {
        watchRead(path);
      }
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

    write: async ({ content, guard, path }) => await store.write(path, content, guard),

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

  const annotations: EditorPorts["annotations"] = {
    remove: async (path, rootId) => {
      const removed = await args.annotations.remove(path, rootId);
      if (removed.kind === "done") {
        if (removed.removedIds.length > 0) {
          listener?.({ ids: [...removed.removedIds], type: "annotationsRemoved" });
        }
        refreshAnnotations();
      }
      return removed;
    },
    reply: async (path, rootId, text) => {
      const replied = await args.annotations.reply(path, rootId, text);
      if (replied.kind === "done") {
        refreshAnnotations();
      }
      return replied;
    },
  };

  const handle = (event: EditorPageEvent): void => {
    switch (event.type) {
      case "editorState": {
        args.editorState({ dirty: event.dirty, saveError: event.saveError });
        return;
      }
      case "openFailed": {
        args.openFailed(event.message);
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
      case "showAnnotations": {
        args.showAnnotations(event.ids);
        return;
      }
      case "opened": {
        // a page loaded again holds no annotations until it is told them
        openPath = event.path;
        sentMeta = null;
        refreshAnnotations();
        args.opened(event.path);
      }
      // no default
    }
  };

  const watch: EditorPorts["watch"] = (next) => {
    listener = next;
    followAnnotations();
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
      stopMetaWatches();
      for (const stop of readWatches.values()) {
        stop();
      }
      readWatches.clear();
    };
  };

  return { askAgent, annotations, handle, requests, watch };
};
