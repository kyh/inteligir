// The single-document editor column. The buffer IS the file: content loads
// once per note into the CodeMirror buffer, which the NoteController then
// owns — a debounced PUT on the quiet period, flush on blur/close/hide, and
// the external-change path (ws doc/vault events → refetch → adopt or merge).
// Deliberately NOT query-cache-driven after mount: two writers over one
// buffer is the bug, so the cache is only the initial load and the refetch
// transport.

import { MarkdownEditor } from "@repo/editor/react/markdown-editor";
import type { MarkdownEditor as MarkdownEditorHandle } from "@repo/editor/create-markdown-editor";
import { toast } from "@repo/ui/components/sonner";
import { Spinner } from "@repo/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ApiError, queryKeys, unwrap } from "../api";
import { useWorkspace } from "../workspace-context";
import { NoteController } from "./note-controller";
import { NoteTitle } from "./note-title";

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
      onRename={onRename}
      onVanished={onVanished}
    />
  );
}

function OpenNote({
  path,
  initialContent,
  onRename,
  onVanished,
}: NoteViewProps & { initialContent: string }) {
  const { api, queryClient, docEvents } = useWorkspace();
  const controllerRef = useRef<NoteController | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  // While our own rename is in flight the old path 404s by design; the
  // external check must not read that as an external delete. The flag stays
  // set on success — the path change remounts this component anyway.
  const renamePendingRef = useRef(false);

  // Everything the controller needs at teardown time, without re-running the
  // mount effect: the latest client and path live in a ref.
  const saveRef = useRef({ api, path });
  saveRef.current = { api, path };

  const handleEditor = (editor: MarkdownEditorHandle | null): void => {
    if (editor === null) {
      const controller = controllerRef.current;
      if (controller !== null) {
        // Flush FIRST: its synchronous prefix reads the buffer while the
        // editor is still alive; dispose only stops the timer.
        void controller.flush();
        controller.dispose();
        controllerRef.current = null;
      }
      editorRef.current = null;
      return;
    }
    editorRef.current = editor;
    controllerRef.current = new NoteController({
      buffer: editor,
      initialContent,
      save: async (content) => {
        const { api: client, path: currentPath } = saveRef.current;
        await unwrap(await client.vault.file.$put({ json: { path: currentPath, content } }));
      },
      onConflict: () => {
        toast.warning("This note changed on disk while you edited it — kept your version.");
      },
      onSaveError: () => {
        toast.error("Could not save the note. Your changes are still in the editor.");
      },
    });
  };

  // External changes: any doc event naming this path — or an unnamed vault
  // change (the watcher does not attribute paths) — re-reads the file and
  // hands the disk content to the controller, which no-ops on its own echo.
  useEffect(() => {
    return docEvents.subscribe((docId) => {
      if (docId !== null && docId !== path) {
        return;
      }
      void (async () => {
        try {
          const data = await queryClient.fetchQuery({
            queryKey: queryKeys.vaultFile(path),
            queryFn: async () => unwrap(await api.vault.file.$get({ query: { path } })),
          });
          controllerRef.current?.externalContent(data.content);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404 && !renamePendingRef.current) {
            onVanished();
          }
        }
      })();
    });
  }, [api, docEvents, queryClient, path, onVanished]);

  // Flush when the tab hides or the page unloads — the debounce must never
  // outlive the page.
  useEffect(() => {
    const flush = (): void => {
      void controllerRef.current?.flush();
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <div
      className="h-full overflow-y-auto"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          void controllerRef.current?.flush();
        }
      }}
    >
      <div className="mx-auto w-full max-w-[var(--editor-width,44rem)] px-7 pt-12">
        <NoteTitle
          path={path}
          onRename={(toPath) => {
            void (async () => {
              renamePendingRef.current = true;
              try {
                await controllerRef.current?.flush();
                await unwrap(await api.vault.rename.$post({ json: { from: path, to: toPath } }));
                onRename(toPath);
              } catch (error) {
                renamePendingRef.current = false;
                if (error instanceof ApiError && error.status === 409) {
                  toast.error("A note with that name already exists.");
                } else {
                  toast.error("Could not rename the note.");
                }
              }
            })();
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
