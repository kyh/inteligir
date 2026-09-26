// The editor's host on the phone: every port the editor asks through is a bridge frame to the
// native screen, which owns the phone's store, its queue and its navigation stack. The page shows
// one note for its whole life; opening another is the native stack's push, so the back gesture
// stays the phone's own.

import { z } from "zod";

import { setAgentRequestActions } from "@repo/editor/agent-request";
import { setCommentActions } from "@repo/editor/comments/comment-store";
import { createGuardedVaultIo } from "@repo/editor/guarded-vault-io";
import type { GuardedVaultPort } from "@repo/editor/guarded-vault-io";
import type {
  EditorHostIo,
  VaultActions,
  VaultChangedEvent,
  VaultEntry,
} from "@repo/editor/host-io";
import { createLinkResolverStore } from "@repo/editor/link-resolver-store";
import { createNoteFormulas } from "@repo/editor/note-formulas";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";
import { createVaultSession } from "@repo/editor/note/vault-session";
import type { SaveError, VaultEditorState } from "@repo/editor/vault-editor";
import { newCommentRefusal } from "@repo/notes/comments/comment-key";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";

import type { NativeEvent, PageBridge } from "../bridge/page-bridge";

export interface PageHost {
  readonly io: EditorHostIo;
  readonly start: () => void;
  readonly stop: () => void;
}

export interface PageHostInputs {
  readonly bridge: PageBridge;
  // the note this page was opened on
  readonly path: string;
  readonly store: OpenNoteStore;
}

const entryOf = (path: string): VaultEntry => ({
  kind: isDocPath(path) ? "doc" : "other",
  name: basenamePath(path),
  path,
});

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const blobOf = (base64: string, mediaType: string): Blob =>
  new Blob([Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0)], {
    type: mediaType,
  });

// the platform's own encoder, so no hand-rolled codec rides beside it
const base64Of = async (blob: Blob): Promise<string> => {
  const read = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const url = z.string().safeParse(reader.result);
    if (url.success) {
      read.resolve(url.data.slice(url.data.indexOf(",") + 1));
    } else {
      read.reject(new Error("the image was not read as a data url"));
    }
  });
  reader.addEventListener("error", () => {
    read.reject(reader.error ?? new Error("the image could not be read"));
  });
  reader.readAsDataURL(blob);
  return await read.promise;
};

// `sent` once a write carrying it landed; the next write of the note goes as an ordinary one
interface PendingComment {
  readonly id: string;
  readonly path: string;
  readonly text: string;
  sent: boolean;
}

interface EditorStateFrame {
  readonly dirty: boolean;
  readonly saveError: SaveError | null;
}

const editorStateFrame = (state: VaultEditorState): EditorStateFrame =>
  state.kind === "open"
    ? { dirty: state.dirty, saveError: state.saveError }
    : { dirty: false, saveError: null };

// the buffer's bytes change on every keystroke and the native end needs none of them, so only a
// change to what it shows (unsaved, or why a save failed) is sent
const editorStateKey = ({ dirty, saveError }: EditorStateFrame): string =>
  `${String(dirty)}:${saveError?.kind ?? ""}:${saveError?.kind === "refused" ? saveError.message : ""}`;

export const createPageHost = ({ bridge, path, store }: PageHostInputs): PageHost => {
  const linkResolver = createLinkResolverStore();
  const changeListeners = new Set<(event: VaultChangedEvent) => void>();

  const readFile = async (notePath: string): Promise<string> => {
    const { content } = await bridge.request("read", { path: notePath });
    return content;
  };

  // a new comment waiting on the save that writes its markers, which carries it, so the phone lands
  // the two as one change set and no pull ever finds markers with no comment behind them
  let anchoring: PendingComment | null = null;

  const port: GuardedVaultPort = {
    read: readFile,
    remove: async (notePath) => {
      await bridge.request("remove", { path: notePath });
    },
    write: async (notePath, content, guard) => {
      const comment = anchoring;
      if (
        comment === null ||
        comment.sent ||
        comment.path !== notePath ||
        guard.kind !== "expected"
      ) {
        return await bridge.request("write", { content, guard, path: notePath });
      }
      const result = await bridge.request("addComment", {
        base: guard.base,
        content,
        id: comment.id,
        path: notePath,
        text: comment.text,
      });
      comment.sent = result.kind === "written";
      return result;
    },
  };
  const io = createGuardedVaultIo(port);

  const list = async (): Promise<VaultEntry[]> => {
    const { paths } = await bridge.request("list", {});
    return paths.map(entryOf);
  };

  // the last listing the phone answered, kept through a failed read so the resolver's alias and id
  // tiers do not empty on a transient refusal; only the latest ask applies, however they land
  let knownTargets: readonly WikiTarget[] = [];
  let targetsSeq = 0;
  let targets: Promise<readonly WikiTarget[]> = Promise.resolve(knownTargets);
  const readTargets = async (seq: number): Promise<readonly WikiTarget[]> => {
    try {
      const { targets: read } = await bridge.request("wikiTargets", {});
      if (seq === targetsSeq) {
        knownTargets = read;
        linkResolver.setTargets(read);
      }
    } catch {
      // the next change asks again
    }
    return knownTargets;
  };
  const refreshTargets = (): void => {
    targetsSeq += 1;
    targets = readTargets(targetsSeq);
  };

  const formulas = createNoteFormulas({ listTargets: async () => await targets, readFile });

  let lastEditorState = editorStateKey({ dirty: false, saveError: null });

  const session = createVaultSession({
    // discarding is the confirm, so a dismissal re-creates and the edits survive it
    askVanished: async (vanished) =>
      (await confirm({
        body: "It was deleted while it had unsaved edits. Re-create it with them, or discard them.",
        cancelLabel: "Re-create",
        confirmLabel: "Discard edits",
        destructive: true,
        title: `${basenamePath(vanished)} was deleted`,
      }))
        ? "discard"
        : "recreate",
    boot: async () => {
      const [entries, content] = await Promise.all([list(), io.read(path).catch(() => null)]);
      return { entries, openNote: content === null ? null : { content, path } };
    },
    list,
    note: io,
    notify: (message) => {
      toast.error(message);
    },
    notifyMergeConflict: (conflicted) => {
      toast.warning(
        `${conflicted} also changed elsewhere. Where both changed the same lines, yours were kept.`,
      );
      bridge.emit({ path: conflicted, type: "mergeConflict" });
    },
    publishEditor: (state) => {
      store.publishEditor(state);
      const next = editorStateFrame(state);
      const key = editorStateKey(next);
      if (key !== lastEditorState) {
        lastEditorState = key;
        bridge.emit({ ...next, type: "editorState" });
      }
    },
    publishListing: linkResolver.setListing,
    publishOpenPath: (opened, change) => {
      store.publishOpenPath(opened, change);
      bridge.emit({ path: opened, type: "opened" });
    },
    rename: async (from, to) => await bridge.request("rename", { from, to }),
  });

  // The page never opens a second note itself: it writes this one, then asks the native stack.
  const navigate = (target: string): void => {
    if (target === store.state().openPath) {
      return;
    }
    void (async () => {
      if (await session.actions.flush()) {
        bridge.emit({ path: target, type: "navigate" });
      } else {
        toast.error("Couldn't save this note — resolve that before leaving it.");
      }
    })();
  };

  const actions: VaultActions = {
    ...session.actions,
    createFile: async (rawPath, content) => {
      const created = await session.actions.createFileAt(rawPath, content);
      if (created !== null) {
        navigate(created);
      }
    },
    openFile: navigate,
  };

  const readVaultAsset: EditorHostIo["readVaultAsset"] = async ({ path: asset }) => {
    try {
      const { base64, mediaType } = await bridge.request("readAsset", { path: asset });
      return { bytes: blobOf(base64, mediaType), ok: true };
    } catch (error) {
      return { error: messageOf(error), ok: false };
    }
  };

  const hostIo: EditorHostIo = {
    actions,
    // no server answers a frame on the phone, so an html block offers no Run
    htmlFrameUrl: null,
    linkResolver: linkResolver.store,
    onVaultChanged: (listener) => {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
    pickImage: async () => await bridge.request("pickImage", {}),
    readNoteFormulas: formulas.read,
    readVaultAsset,
    readVaultFile: async ({ path: notePath }) => await readFile(notePath),
    writeVaultAsset: async ({ baseName, file }) =>
      await bridge.request("writeAsset", {
        base64: await base64Of(file),
        baseName,
        mediaType: file.type,
      }),
  };

  // The toolbar puts the markers in at Save, so the flush's write carries them and the comment
  // together. A chord's create opens its field after its markers are in, where the autosave has
  // already written them, so its entry lands in a set of its own once the flush writes nothing.
  const createComment = async (id: string, text: string): Promise<boolean> => {
    const { editor, openPath } = store.state();
    if (openPath === null || editor.kind !== "open") {
      return false;
    }
    const refusal = newCommentRefusal(editor.content);
    if (refusal !== null) {
      toast.error(refusal);
      return false;
    }
    const pending: PendingComment = { id, path: openPath, sent: false, text };
    anchoring = pending;
    try {
      if (!(await session.actions.flush())) {
        return false;
      }
      if (pending.sent) {
        return true;
      }
      const flushed = store.state().editor;
      if (flushed.kind !== "open" || flushed.path !== openPath) {
        return false;
      }
      const result = await bridge.request("addComment", {
        base: flushed.content,
        content: flushed.content,
        id,
        path: openPath,
        text,
      });
      return result.kind === "written";
    } catch (error) {
      toast.error(`Couldn't add the comment — ${messageOf(error)}`);
      return false;
    } finally {
      if (anchoring === pending) {
        anchoring = null;
      }
    }
  };

  const flushFor = async (id: number): Promise<void> => {
    const ok = await session.actions.flush().catch(() => false);
    bridge.emit({ id, ok, type: "flushed" });
  };

  const onNative = (event: NativeEvent): void => {
    if (event.type === "vaultChanged") {
      formulas.forget(event.event);
      session.handleVaultChanged(event.event);
      // a note's aliases and id live in its bytes, so a content change can move a target too
      refreshTargets();
      for (const listener of changeListeners) {
        listener(event.event);
      }
    } else if (event.type === "flush") {
      void flushFor(event.id);
    }
  };

  let unsubscribe: (() => void) | null = null;

  return {
    io: hostIo,
    start: () => {
      unsubscribe ??= bridge.onNative(onNative);
      setAgentRequestActions({
        askAboutSelection: (selection) => {
          const { openPath } = store.state();
          if (openPath !== null) {
            bridge.emit({ path: openPath, selection, type: "askAgent" });
          }
        },
        showTag: (tag) => {
          bridge.emit({ tag, type: "showTag" });
        },
      });
      setCommentActions({
        create: createComment,
        open: (ids) => {
          if (ids.length > 0) {
            bridge.emit({ ids, type: "showComments" });
          }
        },
      });
      refreshTargets();
      void session.start();
    },
    stop: () => {
      unsubscribe?.();
      unsubscribe = null;
      setAgentRequestActions(null);
      setCommentActions(null);
      session.stop();
    },
  };
};
