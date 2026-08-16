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
import { toast } from "@repo/ui/components/sonner";
import { Spinner } from "@repo/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { contentHashHex } from "@repo/server-contract/vault";
import { ApiError, queryKeys, unwrap } from "../api";
import { NoteController, type SaveResult } from "./note-controller";
import { NoteTitle } from "./note-title";
import { sendKeepaliveWrite } from "./keepalive-write";
import { useWorkspace } from "../workspace-context";

export interface NoteViewProps {
  path: string;
  onRename: (toPath: string) => void;
  /** The note disappeared from disk under us (external delete). */
  onVanished: () => void;
}

export function NoteView({ path, onRename, onVanished }: NoteViewProps) {
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
      initialContent={fileQuery.data.content}
      diskContent={fileQuery.data.content}
      onRename={onRename}
      onVanished={onVanished}
    />
  );
}

function OpenNote({
  path,
  initialContent,
  diskContent,
  onRename,
  onVanished,
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

  // External changes: any doc event naming this path — or an unnamed vault
  // change (the watcher does not attribute paths) — re-reads the file and
  // hands the disk content to the controller, which no-ops on its own echo.
  // A DIRECT read, not fetchQuery: an in-flight rename 404s the old path by
  // design, and writing that error into the shared query cache would trip
  // NoteView's own vanished path, which this handler's guard cannot reach.
  // The cache is refreshed on success only.
  useEffect(() => {
    return docEvents.subscribe((docId) => {
      if (docId !== null && docId !== path) {
        return;
      }
      void (async () => {
        try {
          const data = await unwrap(await api.vault.file.$get({ query: { path } }));
          queryClient.setQueryData(queryKeys.vaultFile(path), data);
          controllerRef.current?.externalContent(data.content);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404 && !renamePendingRef.current) {
            onVanished();
          }
        }
      })();
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
        onDocChanged={() => controllerRef.current?.docChanged()}
        onEditor={handleEditor}
      />
    </div>
  );
}
