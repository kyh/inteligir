// The workspace runtime: ONE typed client, ONE QueryClient, ONE invalidation
// socket — constructed together, threaded through context. Changed messages
// land here and become query invalidations (list/status/system) plus a doc
// event the open note listens to; the note's buffer is deliberately NOT
// query-cached (the buffer IS the file — see note-view).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { THREAD_CHANGE_KINDS } from "@repo/domain/change-kinds";
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

export interface DocEvents {
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

/** What one changed message means for this client: which query families go
 *  stale, and who is told directly. Exported for `__tests__/changed-message`,
 *  which pins that a doc change reaches the open note's reader and nothing
 *  else — a cache invalidation riding alongside is a second read of bytes one
 *  reader already fetched. */
export function applyChangedMessage(
  queryClient: QueryClient,
  notifyDoc: (docId: string | null) => void,
  notifyThread: ThreadListener,
  message: ChangedMessage,
): void {
  switch (message.entity) {
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
      // The two doc kinds reach DIFFERENT readers, which is the reason they
      // are two kinds. The note's bytes are not query state (the buffer IS the
      // file), so `content-changed` goes to the open note's own reader and
      // invalidates nothing — a `vaultFile` query alongside it bought a second
      // read of the same bytes. A suggestion IS query state, and the file did
      // not move, so `proposals-changed` sweeps that family and must not make
      // the note re-read itself to learn about a row.
      if (message.changes.includes("content-changed")) {
        notifyDoc(message.id);
      }
      if (message.changes.includes("proposals-changed")) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.proposalsRoot });
      }
      break;
    case "thread":
      // One sweep for the whole family (list, detail, by-doc); the timeline
      // is not query-cached — its hook listens on threadEvents instead.
      void queryClient.invalidateQueries({ queryKey: queryKeys.threadsRoot });
      if (message.changes.includes("proposals-changed")) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.proposalsRoot });
      }
      notifyThread(message);
      break;
  }
}

/**
 * The invalidation model of this app is the ws bus, whole and entire: every
 * cached family above is swept by a changed message and again on reconnect. So
 * react-query's own defaults are not a second opinion, they are pure cost —
 * `staleTime: 0` plus refetch-on-focus/mount/reconnect re-ran every live query
 * on every alt-tab back, including a full vault walk and a `git status`, to
 * arrive at the answer the socket had already delivered.
 *
 * A query the bus does NOT cover opts out per call (`useSystemStatus`), which
 * is the honest shape: a fresh-forever default is only safe where something
 * else says when it went stale.
 */
export function createWorkspaceQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false },
    },
  });
}

/**
 * What a reconnect implies for threads: anything may have changed — spelled as
 * the whole vocabulary rather than a list of it, because a list is a CLAIM
 * about which kinds a gap can hide and this one was already wrong (it named
 * four of seven, silently asserting that no thread was created, archived or
 * re-anchored while the socket was down).
 */
const THREAD_RECONNECT_SWEEP: ThreadChangedMessage = {
  type: "changed",
  entity: "thread",
  changes: THREAD_CHANGE_KINDS,
};

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  // The runtime — client, query cache, doc-event hub, the context value —
  // is built ONCE here; nothing about it depends on a render.
  const [runtime] = useState(() => {
    const queryClient = createWorkspaceQueryClient();
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
      // invalidate everything the subscriptions cover — the vault and thread
      // key families — and make the open note and any live timeline re-check
      // their state. System status is swept alongside them for a different
      // reason: a socket that dropped most likely means the server restarted,
      // which changes every field on it.
      onReconnected: () => {
        void runtime.queryClient.invalidateQueries({ queryKey: ["vault"] });
        void runtime.queryClient.invalidateQueries({ queryKey: queryKeys.systemStatus });
        void runtime.queryClient.invalidateQueries({ queryKey: queryKeys.threadsRoot });
        void runtime.queryClient.invalidateQueries({ queryKey: queryKeys.proposalsRoot });
        runtime.notifyDoc(null);
        runtime.notifyThread(THREAD_RECONNECT_SWEEP);
      },
    });
    invalidation.start();
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
