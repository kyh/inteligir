// The single-document editor column. The buffer IS the file: content loads
// once per note into the CodeMirror buffer, which the NoteController then
// owns — a debounced compare-and-swap PUT on the quiet period (the write
// carries the sha-256 of its base; a 409 comes back with the disk's truth for
// a merge-and-retry), flush on blur/close/hide, and the external-change path
// (ws doc/vault events → refetch → adopt or merge). Deliberately NOT
// query-cache-driven after mount: two writers over one buffer is the bug, so
// the cache is only the initial load and the refetch transport — every
// refetch result flows through the controller's adopt/merge, never straight
// into the buffer.

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
  setThreadChips,
  threadChipsExtension,
  type ThreadChipInfo,
  type ThreadChipState,
} from "@repo/editor/thread-chip";
import { threadMarkerInsertion } from "@repo/notes/markdown/thread-marker";
import { toast } from "@repo/ui/components/sonner";
import { Spinner } from "@repo/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { contentHashHex } from "@repo/server-contract/vault";
import { ApiError, queryKeys, unwrap } from "../api";
import {
  chipStatusFor,
  taskPrompt,
  type DelegationDraft,
  type DelegationIntent,
} from "../chat/chat-model";
import { useDocThreads } from "../chat/thread-hooks";
import { NoteController, type SaveResult } from "./note-controller";
import { NoteTitle } from "./note-title";
import { sendKeepaliveWrite } from "./keepalive-write";
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
}

export function NoteView({ path, delegation, onRename, onVanished, onSearchTag }: NoteViewProps) {
  const { api } = useWorkspace();
  const fileQuery = useQuery({
    queryKey: queryKeys.vaultFile(path),
    queryFn: async () => unwrap(await api.vault.file.$get({ query: { path } })),
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 2,
  });

  const vanished = fileQuery.error instanceof ApiError && fileQuery.error.status === 404;
  useEffect(() => {
    if (vanished) {
      onVanished();
    }
  }, [vanished, onVanished]);

  if (fileQuery.data === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {fileQuery.isError ? (
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
      initialContent={fileQuery.data.content}
      diskContent={fileQuery.data.content}
      onRename={onRename}
      onVanished={onVanished}
      onSearchTag={onSearchTag}
    />
  );
}

function OpenNote({
  path,
  delegation,
  initialContent,
  diskContent,
  onRename,
  onVanished,
  onSearchTag,
}: NoteViewProps & {
  /** The content the controller mounts with — fixed for this instance. */
  initialContent: string;
  /** The query's LATEST disk view; every change flows through the
   * controller's adopt/merge, so a remount served from a stale cache
   * reconciles the moment the refetch lands. */
  diskContent: string;
}) {
  const { api, docEvents } = useWorkspace();
  const queryClient = useQueryClient();
  const controllerRef = useRef<NoteController | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  // While our own rename is in flight the old path 404s by design; the
  // external check must not read that as an external delete. The flag stays
  // set on success — the path change remounts this component anyway.
  const renamePendingRef = useRef(false);

  // The chip data: every thread bound to this doc, mapped to the widget's
  // vocabulary. Invalidated whole by the ws thread sweep.
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
            chips: docThreads.flatMap<ThreadChipInfo>((activity) =>
              activity.thread.originAnchor === null
                ? []
                : [
                    {
                      anchor: activity.thread.originAnchor,
                      status: chipStatusFor(activity),
                      title: activity.thread.title,
                    },
                  ],
            ),
          },
    [docThreads],
  );
  const chipStateRef = useRef(chipState);

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
  const draftFor = (intent: DelegationIntent, selection: DelegationSelection): DelegationDraft => {
    editorRef.current?.view.dispatch({ effects: setPendingAnchor.of(selection.to) });
    const clearPending = (): void => {
      editorRef.current?.view.dispatch({ effects: setPendingAnchor.of(null) });
    };
    return {
      intent,
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
    delegationAffordanceExtension({
      onDelegateSelection: (intent, selection) => {
        delegationRef.current.onDraft(draftForRef.current(intent, selection));
      },
      onDelegateTask: (task) => {
        delegationRef.current.onRunTask(draftForRef.current("do", task), taskPrompt(task.text));
      },
    }),
  ]);

  // Status changes reach the widgets as an effect — never through the doc.
  useEffect(() => {
    editorRef.current?.view.dispatch({ effects: setThreadChips.of(chipState) });
  }, [chipState]);

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
    // Chip data may have landed before the editor did.
    editor.view.dispatch({ effects: setThreadChips.of(chipStateRef.current) });
    controllerRef.current = new NoteController({
      buffer: editor,
      initialContent,
      save,
      onConflict: () => {
        toast.warning("This note changed on disk while you edited it — kept your version.");
      },
      onSaveError: () => {
        toast.error("Could not save the note. Your changes are still in the editor.");
      },
    });
  };

  // The refetch seam (finding: a stale cached mount must never silently
  // become the base): whatever the query learns flows through adopt/merge.
  useEffect(() => {
    controllerRef.current?.externalContent(diskContent);
  }, [diskContent]);

  // External changes: a doc event naming this path (or a folder above it) —
  // or an unnamed vault change, which asserts nothing — re-reads the file and
  // hands the disk content to the controller, which no-ops on its own echo.
  // A DIRECT read, not fetchQuery: an in-flight rename 404s the old path by
  // design, and writing that error into the shared query cache would trip
  // NoteView's own vanished path, which this handler's guard cannot reach.
  // The cache is refreshed on success only.
  //
  // Reads COALESCE: a burst of events (a save's own echo plus the vault
  // announcement, an agent turn writing repeatedly) holds ONE request in
  // flight, and events arriving during it collapse into a single trailing
  // re-read — so the last read always reflects the final disk state.
  useEffect(() => {
    let inFlight: Promise<void> | null = null;
    let repeat = false;

    const readNow = async (): Promise<void> => {
      try {
        const data = await unwrap(await api.vault.file.$get({ query: { path } }));
        queryClient.setQueryData(queryKeys.vaultFile(path), data);
        controllerRef.current?.externalContent(data.content);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && !renamePendingRef.current) {
          onVanished();
        }
      }
    };

    const scheduleRead = (): void => {
      if (inFlight !== null) {
        repeat = true;
        return;
      }
      const run = (): Promise<void> =>
        readNow().finally(() => {
          inFlight = null;
          if (repeat) {
            repeat = false;
            scheduleRead();
          }
        });
      inFlight = run();
    };

    return docEvents.subscribe((docId) => {
      // A named folder covers the notes beneath it — a directory rename or
      // delete names the folder, never each file inside it.
      if (docId !== null && docId !== path && !path.startsWith(`${docId}/`)) {
        return;
      }
      scheduleRead();
    });
  }, [api, docEvents, queryClient, path, onVanished]);

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
      <div className="mx-auto w-full max-w-[var(--editor-width,44rem)] px-7 pt-12">
        <NoteTitle
          path={path}
          onRename={async (toPath) => {
            renamePendingRef.current = true;
            try {
              // The gate: an unsaved buffer must be durable under the OLD
              // path before the file moves; a failed save aborts the rename.
              await controllerRef.current?.flush();
            } catch {
              renamePendingRef.current = false;
              toast.error("The note could not be saved, so it was not renamed.");
              throw new Error("rename aborted: save failed");
            }
            try {
              await unwrap(await api.vault.rename.$post({ json: { from: path, to: toPath } }));
              onRename(toPath);
            } catch (error) {
              renamePendingRef.current = false;
              if (error instanceof ApiError && error.status === 409) {
                toast.error("A note with that name already exists.");
              } else {
                toast.error("Could not rename the note.");
              }
              throw error;
            }
          }}
          onSubmit={() => editorRef.current?.focus()}
        />
      </div>
      <MarkdownEditor
        className="note-editor-host"
        initialDoc={initialContent}
        extensions={delegationExtensions}
        onDocChanged={() => controllerRef.current?.docChanged()}
        onOpenTag={onSearchTag}
        onEditor={handleEditor}
      />
    </div>
  );
}
