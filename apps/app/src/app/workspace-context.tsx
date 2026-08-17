// The workspace runtime: ONE typed client, ONE QueryClient, ONE invalidation
// socket — constructed together, threaded through context. Changed messages
// land here and become query invalidations (list/status/system) plus a doc
// event the open note listens to; the note's buffer is deliberately NOT
// query-cached (the buffer IS the file — see note-view).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme, type Theme } from "@repo/ui/lib/theme";
import type { ChangedMessage, ThreadChangedMessage } from "@repo/server-contract/notifications";
import { createContext, useContext, useEffect, useState } from "react";
import { createWorkspaceApiClient, queryKeys } from "./api";
import {
  browserInvalidationSocket,
  InvalidationClient,
  workspaceSocketUrl,
} from "./invalidation-client";
import { readTheme, writeTheme } from "./prefs";

/** null = an unnamed vault change (the filesystem watcher does not attribute
 *  paths); the open note re-checks its own file either way. */
type DocListener = (docId: string | null) => void;

interface DocEvents {
  subscribe: (listener: DocListener) => () => void;
}

/** `id` is undefined for a synthetic sweep (reconnect gap): listeners filter
 *  by id, so undefined reads as "any thread may have changed". */
type ThreadListener = (message: ThreadChangedMessage) => void;

interface ThreadEvents {
  subscribe: (listener: ThreadListener) => () => void;
}

export interface WorkspaceRuntime {
  api: ReturnType<typeof createWorkspaceApiClient>;
  docEvents: DocEvents;
  threadEvents: ThreadEvents;
}

const WorkspaceContext = createContext<WorkspaceRuntime | null>(null);

export function useWorkspace(): WorkspaceRuntime {
  const runtime = useContext(WorkspaceContext);
  if (runtime === null) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return runtime;
}

function applyChangedMessage(
  queryClient: QueryClient,
  notifyDoc: (docId: string | null) => void,
  notifyThread: ThreadListener,
  message: ChangedMessage,
): void {
  switch (message.entity) {
    case "system":
      void queryClient.invalidateQueries({ queryKey: queryKeys.systemStatus });
      break;
    case "vault":
      if (message.changes.includes("files-changed")) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.vaultTree });
        // A NAMED change reaches only the notes it names; an unnamed one
        // asserts nothing, so every open note re-checks its own file.
        if (message.paths === undefined) {
          notifyDoc(null);
        } else {
          for (const path of message.paths) {
            notifyDoc(path);
          }
        }
      }
      if (message.changes.includes("sync-status-changed")) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.vaultStatus });
      }
      break;
    case "doc":
      void queryClient.invalidateQueries({ queryKey: queryKeys.vaultFile(message.id) });
      notifyDoc(message.id);
      break;
    case "thread":
      // One sweep for the whole family (list, detail, by-doc); the timeline
      // is not query-cached — its hook listens on threadEvents instead.
      void queryClient.invalidateQueries({ queryKey: queryKeys.threadsRoot });
      notifyThread(message);
      break;
  }
}

/** What a reconnect implies for threads: anything may have changed. */
const THREAD_RECONNECT_SWEEP: ThreadChangedMessage = {
  type: "changed",
  entity: "thread",
  changes: ["events-appended", "status-changed", "interactions-changed", "queue-changed"],
};

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  // The runtime — client, query cache, doc-event hub, the context value —
  // is built ONCE here; nothing about it depends on a render.
  const [runtime] = useState(() => {
    const queryClient = new QueryClient();
    const docListeners = new Set<DocListener>();
    const notifyDoc = (docId: string | null): void => {
      for (const listener of docListeners) {
        listener(docId);
      }
    };
    const docEvents: DocEvents = {
      subscribe(listener) {
        docListeners.add(listener);
        return () => {
          docListeners.delete(listener);
        };
      },
    };
    const threadListeners = new Set<ThreadListener>();
    const notifyThread: ThreadListener = (message) => {
      for (const listener of threadListeners) {
        listener(message);
      }
    };
    const threadEvents: ThreadEvents = {
      subscribe(listener) {
        threadListeners.add(listener);
        return () => {
          threadListeners.delete(listener);
        };
      },
    };
    const contextValue: WorkspaceRuntime = {
      api: createWorkspaceApiClient(),
      docEvents,
      threadEvents,
    };
    return { queryClient, notifyDoc, notifyThread, contextValue };
  });

  // The client is constructed INSIDE the effect, symmetric with its
  // teardown: dispose() is permanent, so a client held in state would be
  // killed for good by the first cleanup a double-invoked dev effect runs.
  useEffect(() => {
    const invalidation = new InvalidationClient({
      createSocket: () => browserInvalidationSocket(workspaceSocketUrl(window.location.origin)),
      onChanged: (message) =>
        applyChangedMessage(runtime.queryClient, runtime.notifyDoc, runtime.notifyThread, message),
      // Mutations during a connection gap produced no frames; on reconnect,
      // invalidate everything the subscriptions cover — the vault, system and
      // thread key families — and make the open note and any live timeline
      // re-check their state.
      onReconnected: () => {
        void runtime.queryClient.invalidateQueries({ queryKey: ["vault"] });
        void runtime.queryClient.invalidateQueries({ queryKey: ["system"] });
        void runtime.queryClient.invalidateQueries({ queryKey: queryKeys.threadsRoot });
        runtime.notifyDoc(null);
        runtime.notifyThread(THREAD_RECONNECT_SWEEP);
      },
    });
    invalidation.start();
    invalidation.subscribe({ kind: "system" });
    invalidation.subscribe({ kind: "vault" });
    invalidation.subscribe({ kind: "thread-list" });
    return () => {
      invalidation.dispose();
    };
  }, [runtime]);

  const [theme, setThemeState] = useState<Theme>(readTheme);
  const setTheme = (next: Theme): void => {
    writeTheme(next);
    setThemeState(next);
  };

  return (
    <ThemeProvider theme={theme} setTheme={setTheme}>
      <EditorThemeCarrier />
      <QueryClientProvider client={runtime.queryClient}>
        <WorkspaceContext value={runtime.contextValue}>{children}</WorkspaceContext>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

/** The editor's palette keys off `data-theme` on :root; the app chrome keys
 *  off the `.dark` class the shared ThemeProvider owns. Stamping the RESOLVED
 *  theme (never "system") keeps the two carriers agreeing in all three states
 *  without relying on the editor's own media-query fallback. */
function EditorThemeCarrier() {
  const { resolved } = useTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  return null;
}
