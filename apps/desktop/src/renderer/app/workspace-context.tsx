// The workspace runtime: ONE typed client, ONE QueryClient, ONE invalidation
// socket — constructed together, threaded through context. Changed messages
// land here and become query invalidations (list/status/system) plus a doc
// event the open note listens to; the note's buffer is deliberately NOT
// query-cached (the buffer IS the file — see note-view).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { THREAD_CHANGE_KINDS } from "@repo/domain/change-kinds";
import { ThemeProvider, useTheme, type Theme } from "@repo/ui/lib/theme";
import { RadiusProvider } from "@repo/ui/lib/radius-context";
import { SizeProvider } from "@repo/ui/lib/size-context";
import type { ChangedMessage, ThreadChangedMessage } from "@repo/api/local/notifications";
import { createContext, useContext, useEffect, useState } from "react";
import { workspaceSocketUrl } from "@repo/api/local/routes";
import { AppearanceProvider } from "./appearance";
import { client, orpc } from "./api";
import { socketOrigin } from "./socket-origin";
import { browserInvalidationSocket, InvalidationClient } from "./invalidation-client";
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
  api: typeof client;
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
        void queryClient.invalidateQueries({ queryKey: orpc.vault.tree.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.vault.trashList.key() });
        // A `read` query is never the OPEN note's source (the buffer is that);
        // it is how a surface diffing against disk — the history tab — holds
        // the bytes it compared, and a stale one shows a diff of a file that
        // has moved.
        void queryClient.invalidateQueries({ queryKey: orpc.vault.read.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.comments.key() });
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
        void queryClient.invalidateQueries({ queryKey: orpc.vault.status.key() });
      }
      break;
    case "doc":
      // The two doc kinds reach DIFFERENT readers, which is the reason they
      // are two kinds. The note's bytes are not query state (the buffer IS the
      // file), so `content-changed` goes to the open note's own reader and
      // invalidates no read of those bytes — a `vaultFile` query alongside it
      // bought a second read of the same ones.
      //
      // Knowledge is the other kind of derived state a doc's OWN bytes move:
      // the links this doc holds are someone else's backlinks, and which
      // someone is not knowable from here — so the family is swept whole,
      // never per path. Related notes are that same argument over a wider
      // input (links, tags AND text), which is why one prefix sweep covers
      // both; neither needs a `knowledge` change kind of its own, because
      // every knowledge query settles the index before answering.
      if (message.changes.includes("content-changed")) {
        notifyDoc(message.id);
        void queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
      }
      break;
    case "thread":
      // One sweep for the whole family (list, detail); the timeline is not
      // query-cached — its hook listens on threadEvents instead.
      void queryClient.invalidateQueries({ queryKey: orpc.threads.key() });
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
      api: client,
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
      createSocket: () => browserInvalidationSocket(workspaceSocketUrl(socketOrigin())),
      onChanged: (message) =>
        applyChangedMessage(runtime.queryClient, runtime.notifyDoc, runtime.notifyThread, message),
      // Mutations during a connection gap produced no frames; on reconnect,
      // invalidate everything the subscriptions cover — the vault and thread
      // key families — and make the open note and any live timeline re-check
      // their state. System status is swept alongside them for a different
      // reason: a socket that dropped most likely means the server restarted,
      // which changes every field on it.
      onReconnected: () => {
        void runtime.queryClient.invalidateQueries({ queryKey: orpc.vault.key() });
        void runtime.queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
        void runtime.queryClient.invalidateQueries({ queryKey: orpc.system.status.key() });
        void runtime.queryClient.invalidateQueries({ queryKey: orpc.threads.key() });
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
      <RadiusProvider defaultRadius="rounded">
        <SizeProvider defaultSize="compact">
          <AppearanceProvider>
            <QueryClientProvider client={runtime.queryClient}>
              <WorkspaceContext value={runtime.contextValue}>{children}</WorkspaceContext>
            </QueryClientProvider>
          </AppearanceProvider>
        </SizeProvider>
      </RadiusProvider>
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
