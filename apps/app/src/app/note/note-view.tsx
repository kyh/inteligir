// The single-document editor column. The buffer IS the file: content loads
// once per note into the CodeMirror buffer, which the NoteController then
// owns — a debounced compare-and-swap PUT on the quiet period (the write
// carries the sha-256 of its base; a 409 comes back with the disk's truth for
// a merge-and-retry), flush on blur/close/hide, and the external-change path
// (ws doc/vault events → re-read → adopt or merge).
//
// The note's bytes are NOT query state: `useNoteDisk` (note-disk.ts) is the
// one reader, and every value it produces flows through the controller's
// adopt/merge, never straight into the buffer. Two writers over one buffer is
// the bug this shape exists to make unrepresentable.

import type { AgentWriteMode } from "@repo/domain/agent-write-mode";
import { MarkdownEditor } from "@repo/editor/react/markdown-editor";
import type { MarkdownEditor as MarkdownEditorHandle } from "@repo/editor/create-markdown-editor";
import {
  delegationAffordanceExtension,
  type DelegationSelection,
} from "@repo/editor/delegation-affordance";
import {
  pendingAnchorExtension,
  pendingAnchorPosition,
  setPendingAnchor,
} from "@repo/editor/pending-anchor";
import {
  proposalMarksExtension,
  setProposalHunks,
  type ProposalHunkView,
  type ProposalMarksState,
} from "@repo/editor/proposal-marks";
import {
  setThreadChips,
  threadChipsExtension,
  type ThreadChipInfo,
  type ThreadChipState,
} from "@repo/editor/thread-chip";
import { threadMarkerInsertion } from "@repo/notes/markdown/thread-marker";
import { toast } from "@repo/ui/components/sonner";
import { Spinner } from "@repo/ui/components/spinner";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { contentHashHex } from "@repo/server-contract/vault";
import { ApiError } from "../api";
import { renameVaultEntry } from "../vault-hooks";
import {
  isSettledActivity,
  taskPrompt,
  threadActivity,
  THREAD_ACTIVITY_LABELS,
  THREAD_ACTIVITY_TONES,
  type DelegationDraft,
  type DelegationIntent,
  type ViewContextSource,
} from "../chat/chat-model";
import { useDocThreads } from "../chat/thread-hooks";
import { ProposalBar } from "../proposals/proposal-bar";
import { useDocProposals, useProposalActions } from "../proposals/proposal-hooks";
import { readDelegationWriteMode } from "../prefs";
import { BacklinksSection } from "./backlinks-panel";
import { RelatedSection } from "./related-panel";
import { NoteController, type SaveResult } from "./note-controller";
import { useNoteDisk } from "./note-disk";
import { readNoteViewContext } from "./note-view-context";
import { NoteTitle } from "./note-title";
import { sendKeepaliveWrite } from "./keepalive-write";
import { vaultAssetUrl } from "./vault-asset";
import { useWorkspace } from "../workspace-context";

/** How the note surface hands delegation intents up to the workspace. */
export interface NoteDelegation {
  /** Selection affordance: arm the composer with a draft. */
  onDraft: (draft: DelegationDraft) => void;
  /** Checkbox fast path: one click, the task text already IS the prompt. */
  onRunTask: (draft: DelegationDraft, prompt: string) => void;
  /** A chip was clicked: open its thread in the chat panel. */
  onOpenThread: (threadId: string) => void;
}

export interface NoteViewProps {
  path: string;
  delegation: NoteDelegation;
  onRename: (toPath: string) => void;
  /** The note disappeared from disk under us (external delete). */
  onVanished: () => void;
  /** A `#tag` chip was clicked: narrow the palette's search to that tag. */
  onSearchTag: (tag: string) => void;
  /** Open another note — a backlink row under the document. */
  onOpenNote: (path: string) => void;
  /** Fill the workspace's one view-context slot while this note is open, and
   *  clear it when it is not. */
  onViewContextSource: (source: ViewContextSource | null) => void;
}

export function NoteView({
  path,
  delegation,
  onRename,
  onVanished,
  onSearchTag,
  onOpenNote,
  onViewContextSource,
}: NoteViewProps) {
  const { api, docEvents } = useWorkspace();
  const disk = useNoteDisk({ api, docEvents, path, onVanished });

  if (disk.content === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {disk.failed ? (
          <p className="text-sm">Could not open {path}.</p>
        ) : (
          <Spinner className="size-4" />
        )}
      </div>
    );
  }

  return (
    <OpenNote
      key={path}
      path={path}
      delegation={delegation}
      diskContent={disk.content}
      onRename={onRename}
      setRenamePending={disk.setRenamePending}
      onSearchTag={onSearchTag}
      onOpenNote={onOpenNote}
      onViewContextSource={onViewContextSource}
    />
  );
}

interface OpenNoteProps {
  path: string;
  delegation: NoteDelegation;
  /** A `#tag` chip was clicked: narrow the palette's search to that tag. */
  onSearchTag: (tag: string) => void;
  /** The reader's LATEST disk view. The editor mounts from it once; every
   * later value flows through the controller's adopt/merge. */
  diskContent: string;
  onRename: (toPath: string) => void;
  setRenamePending: (pending: boolean) => void;
  onOpenNote: (path: string) => void;
  onViewContextSource: (source: ViewContextSource | null) => void;
}

function OpenNote({
  path,
  delegation,
  diskContent,
  onRename,
  setRenamePending,
  onSearchTag,
  onOpenNote,
  onViewContextSource,
}: OpenNoteProps) {
  const { api } = useWorkspace();
  const controllerRef = useRef<NoteController | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);

  // The chip data: every thread bound to this doc, rendered from the ONE
  // activity derivation the palette and the dock read too — the editor is
  // handed a word, a tone and a dismiss verdict, never a status to interpret.
  // Invalidated whole by the ws thread sweep.
  const docThreadsQuery = useDocThreads(path);
  const docThreads = docThreadsQuery.data?.threads;
  // `loading` until the query genuinely ANSWERS — never an empty list, which
  // would make every valid anchor look unclaimed and therefore dismissable.
  const chipState = useMemo<ThreadChipState>(
    () =>
      docThreads === undefined
        ? { kind: "loading" }
        : {
            kind: "ready",
            chips: docThreads.flatMap<ThreadChipInfo>((docThread) => {
              if (docThread.thread.originAnchor === null) {
                return [];
              }
              const activity = threadActivity(docThread.thread, docThread);
              return [
                {
                  anchor: docThread.thread.originAnchor,
                  tone: THREAD_ACTIVITY_TONES[activity],
                  activity: THREAD_ACTIVITY_LABELS[activity],
                  title: docThread.thread.title,
                  dismissable: isSettledActivity(activity),
                },
              ];
            }),
          },
    [docThreads],
  );
  const chipStateRef = useRef(chipState);

  // The suggestions against this note. `diskContent` is the note's bytes as
  // last READ, which is exactly what the hunks' base line numbers describe —
  // so a proposal can be placed only while the buffer still equals it. Any
  // unsaved keystroke makes the placement a guess, and the editor says so by
  // withholding the marks rather than highlighting lines the hunk never named.
  const proposalsQuery = useDocProposals(path);
  const proposals = useMemo(() => proposalsQuery.data ?? [], [proposalsQuery.data]);
  const proposalActions = useProposalActions((message) => {
    toast.error(message);
  });
  const [bufferMatchesDisk, setBufferMatchesDisk] = useState(true);
  const marksState = useMemo<ProposalMarksState>(() => {
    if (proposalsQuery.data === undefined) {
      return { kind: "idle" };
    }
    const placeable = proposals.filter(
      (proposal) => proposal.status === "pending" && proposal.baseContent === diskContent,
    );
    if (!bufferMatchesDisk || placeable.length === 0) {
      const pendingCount = proposals.filter((proposal) => proposal.status === "pending").length;
      return pendingCount === 0 ? { kind: "idle" } : { kind: "unplaceable", count: pendingCount };
    }
    return {
      kind: "ready",
      hunks: placeable.flatMap<ProposalHunkView>((proposal) =>
        proposal.hunks.map((hunk) => ({
          proposalId: proposal.id,
          revision: proposal.revision,
          index: hunk.index,
          baseStart: hunk.baseStart,
          baseEnd: hunk.baseEnd,
          proposedLineCount: hunk.proposedLines.length,
        })),
      ),
    };
  }, [proposalsQuery.data, proposals, diskContent, bufferMatchesDisk]);
  const marksStateRef = useRef(marksState);
  const proposalActionsRef = useRef(proposalActions);

  // The editor extensions are fixed at mount, so every callback reads the
  // CURRENT handlers through this ref; assigned in a layout effect so an
  // event firing between commit and passive effects sees fresh values.
  const delegationRef = useRef({
    threadIdFor: (_anchor: string): string | null => null,
    onDraft: (_draft: DelegationDraft): void => {},
    onRunTask: (_draft: DelegationDraft, _prompt: string): void => {},
    onOpenThread: (_threadId: string): void => {},
  });
  useLayoutEffect(() => {
    chipStateRef.current = chipState;
    marksStateRef.current = marksState;
    proposalActionsRef.current = proposalActions;
    delegationRef.current = {
      threadIdFor: (anchor) =>
        (docThreads ?? []).find((activity) => activity.thread.originAnchor === anchor)?.thread.id ??
        null,
      onDraft: delegation.onDraft,
      onRunTask: delegation.onRunTask,
      onOpenThread: delegation.onOpenThread,
    };
  });

  /**
   * The draft the composer finishes. The anchor position is handed to the
   * EDITOR to track (`setPendingAnchor`) rather than captured as a number: the
   * user types a prompt and an agent write may merge in before submit, and a
   * raw offset would name a different block by then.
   */
  const draftFor = (
    intent: DelegationIntent,
    writeMode: AgentWriteMode,
    selection: DelegationSelection,
  ): DelegationDraft => {
    editorRef.current?.view.dispatch({ effects: setPendingAnchor.of(selection.to) });
    const clearPending = (): void => {
      editorRef.current?.view.dispatch({ effects: setPendingAnchor.of(null) });
    };
    return {
      intent,
      writeMode,
      docPath: path,
      selectionText: selection.text,
      cancel: clearPending,
      anchor: async (anchorToken) => {
        const editor = editorRef.current;
        const controller = controllerRef.current;
        if (editor === null || controller === null) {
          return { ok: false, reason: "no-editor" };
        }
        const at = pendingAnchorPosition(editor.view.state);
        if (at === null) {
          clearPending();
          return { ok: false, reason: "block-gone" };
        }
        const insertion = threadMarkerInsertion(editor.getDoc(), at, anchorToken);
        editor.view.dispatch({
          changes: { from: insertion.at, insert: insertion.text },
          effects: setPendingAnchor.of(null),
          userEvent: "input.delegate-anchor",
        });
        try {
          // Durable BEFORE any thread exists: flush rejects when the write did
          // not land, and the caller creates nothing on a rejection.
          await controller.flush();
        } catch {
          return { ok: false, reason: "save-failed" };
        }
        return { ok: true };
      },
    };
  };
  const draftForRef = useRef(draftFor);
  useLayoutEffect(() => {
    draftForRef.current = draftFor;
  });

  const [delegationExtensions] = useState(() => [
    pendingAnchorExtension,
    threadChipsExtension({
      onOpen: (anchor) => {
        const threadId = delegationRef.current.threadIdFor(anchor);
        if (threadId !== null) {
          delegationRef.current.onOpenThread(threadId);
        }
      },
    }),
    proposalMarksExtension({
      onAccept: (hunk) => {
        void proposalActionsRef.current.accept({
          proposalId: hunk.proposalId,
          expectedRevision: hunk.revision,
          hunkIndex: hunk.index,
        });
      },
      onReject: (hunk) => {
        void proposalActionsRef.current.reject({
          proposalId: hunk.proposalId,
          expectedRevision: hunk.revision,
          hunkIndex: hunk.index,
        });
      },
    }),
    delegationAffordanceExtension({
      defaultWriteMode: readDelegationWriteMode,
      onDelegateSelection: (intent, writeMode, selection) => {
        delegationRef.current.onDraft(draftForRef.current(intent, writeMode, selection));
      },
      onDelegateTask: (writeMode, task) => {
        delegationRef.current.onRunTask(
          draftForRef.current("do", writeMode, task),
          taskPrompt(task.text),
        );
      },
    }),
  ]);

  // What this note contributes to the next message the composer sends. Reads
  // refs only, so it is stable for the life of this mount (the key is `path`)
  // and a selection change re-renders nothing.
  const readViewContext = useCallback<ViewContextSource>(async () => {
    const editor = editorRef.current;
    if (editor === null) {
      return null;
    }
    const controller = controllerRef.current;
    return readNoteViewContext(path, {
      flush: async () => {
        await controller?.flush();
      },
      read: () => {
        const main = editor.view.state.selection.main;
        return { content: editor.getDoc(), from: main.from, to: main.to };
      },
    });
  }, [path]);

  useEffect(() => {
    onViewContextSource(readViewContext);
    return () => {
      onViewContextSource(null);
    };
  }, [onViewContextSource, readViewContext]);

  // Status changes reach the widgets as an effect — never through the doc.
  useEffect(() => {
    editorRef.current?.view.dispatch({ effects: setThreadChips.of(chipState) });
  }, [chipState]);

  useEffect(() => {
    editorRef.current?.view.dispatch({ effects: setProposalHunks.of(marksState) });
  }, [marksState]);

  // The guarded save: hash the base, PUT with the guard, map a 409 CAS body
  // to the controller's SaveResult. Every other refusal throws.
  const save = async (content: string, base: string): Promise<SaveResult> => {
    const expectedHash = await contentHashHex(base);
    const response = await api.vault.file.$put({ json: { path, content, expectedHash } });
    if (response.ok) {
      return { ok: true };
    }
    if (response.status === 409) {
      const body = await response.json();
      if (body.error === "cas_mismatch") {
        return {
          ok: false,
          kind: "cas",
          current: body.current === undefined ? null : { content: body.current.content },
        };
      }
      throw new ApiError(409, body.error, body.message);
    }
    const body = await response.json();
    throw new ApiError(response.status, body.error, body.message);
  };

  const handleEditor = (editor: MarkdownEditorHandle | null): void => {
    if (editor === null) {
      const controller = controllerRef.current;
      if (controller !== null) {
        controllerRef.current = null;
        // Await durability, THEN stop the timers: dispose during the resumed
        // flush must not drop the latest buffer. The CM state object survives
        // destroy(), so the flush can still read the final content.
        void (async () => {
          try {
            await controller.flush();
          } catch {
            // onSaveError already surfaced it; unmount has no caller to gate.
          } finally {
            controller.dispose();
          }
        })();
      }
      editorRef.current = null;
      return;
    }
    editorRef.current = editor;
    // Chip and suggestion data may have landed before the editor did.
    editor.view.dispatch({
      effects: [
        setThreadChips.of(chipStateRef.current),
        setProposalHunks.of(marksStateRef.current),
      ],
    });
    controllerRef.current = new NoteController({
      buffer: editor,
      initialContent: diskContent,
      save,
      onConflict: () => {
        toast.warning("This note changed on disk while you edited it — kept your version.");
      },
      onSaveError: () => {
        toast.error("Could not save the note. Your changes are still in the editor.");
      },
    });
  };

  // The ONE seam disk content reaches the buffer through (finding: a stale
  // mount must never silently become the base). Every read the note's reader
  // performs — the initial one and every doc-event re-read — lands here, and
  // the controller no-ops on its own echo.
  useEffect(() => {
    controllerRef.current?.externalContent(diskContent);
    // An adopted read makes the buffer the disk again (or a merge makes it
    // dirty); either way the marks' placement question is re-answered here
    // rather than waiting for the next keystroke.
    setBufferMatchesDisk(controllerRef.current?.isDirty() !== true);
  }, [diskContent]);

  // The tab hiding still has a live page — an ordinary flush. The page GOING
  // AWAY does not: pagehide fires a keepalive PUT of the raw buffer
  // (unguarded on purpose — nobody is left to merge a refusal).
  useEffect(() => {
    const onPageHide = (): void => {
      const controller = controllerRef.current;
      const editor = editorRef.current;
      if (controller?.isDirty() === true && editor !== null) {
        sendKeepaliveWrite(window.location.origin, path, editor.getDoc());
      }
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        void controllerRef.current?.flush().catch(() => {});
      }
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [path]);

  return (
    <div
      className="h-full overflow-y-auto"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          void controllerRef.current?.flush().catch(() => {});
        }
      }}
    >
      <div className="mx-auto w-full max-w-[var(--editor-width)] px-7 pt-12">
        <ProposalBar
          proposals={proposals}
          actions={proposalActions}
          unplaceable={marksState.kind === "unplaceable"}
          onOpenThread={delegation.onOpenThread}
        />
        <NoteTitle
          path={path}
          onRename={async (toPath) => {
            // The old path 404s until the reader follows the new one; the
            // flag stays set on success, because the path change resets the
            // reader anyway.
            setRenamePending(true);
            try {
              // The gate: an unsaved buffer must be durable under the OLD
              // path before the file moves; a failed save aborts the rename.
              await controllerRef.current?.flush();
            } catch {
              setRenamePending(false);
              toast.error("The note could not be saved, so it was not renamed.");
              throw new Error("rename aborted: save failed");
            }
            const outcome = await renameVaultEntry(api, path, toPath);
            if (!outcome.ok) {
              setRenamePending(false);
              toast.error(outcome.message);
              // The title re-arms its commit guard on a rejection, so the
              // same name can be retried once the refusal is dealt with.
              throw new Error(outcome.message);
            }
            onRename(toPath);
          }}
          onSubmit={() => editorRef.current?.focus()}
        />
      </div>
      <MarkdownEditor
        className="note-editor-host"
        initialDoc={diskContent}
        extensions={delegationExtensions}
        onDocChanged={() => {
          controllerRef.current?.docChanged();
          // The marks' coordinates are the DISK's; the moment they part
          // company they stop drawing, and a save brings them back.
          setBufferMatchesDisk(controllerRef.current?.isDirty() !== true);
        }}
        onOpenTag={onSearchTag}
        resolveAsset={vaultAssetUrl}
        onEditor={handleEditor}
      />
      <div className="mx-auto w-full max-w-[var(--editor-width)] px-7 pb-16">
        <BacklinksSection path={path} onOpen={onOpenNote} />
        <RelatedSection path={path} onOpen={onOpenNote} />
      </div>
    </div>
  );
}
