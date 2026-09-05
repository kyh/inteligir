import { partialMatchKey, QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

// null: an unnamed vault change — the watcher could not attribute a path.
type DocListener = (docId: string | null) => void;

interface DocEvents {
  subscribe: (listener: DocListener) => () => void;
}

// An undefined `id` is a synthetic sweep: any thread may have changed.
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

function isUnlinkedMentionsQuery(queryKey: readonly unknown[]): boolean {
  return partialMatchKey(queryKey, orpc.knowledge.unlinkedMentions.key());
}

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
        void queryClient.invalidateQueries({ queryKey: orpc.vault.deleted.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.comments.key() });
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
      // The note's bytes are not query state, so content-changed goes to the
      // open note's reader alone; a query alongside bought a second read of the
      // same bytes. Knowledge is swept whole: this doc's links are some other
      // note's backlinks, and which note is not knowable here. The one exception
      // is the vault-wide prose scan behind unlinked mentions, which would re-read
      // every doc body per autosave; it waits for files-changed or a refold.
      if (message.changes.includes("content-changed")) {
        notifyDoc(message.id);
        void queryClient.invalidateQueries({
          queryKey: orpc.knowledge.key(),
          predicate: (query) => !isUnlinkedMentionsQuery(query.queryKey),
        });
      }
      break;
    case "thread":
      void queryClient.invalidateQueries({ queryKey: orpc.threads.key() });
      notifyThread(message);
      break;
  }
}

// The ws bus sweeps every cached family, so react-query's defaults are pure
// cost: refetch-on-focus re-ran a full vault walk and a `git status` on every
// alt-tab back. A query the bus does not cover opts out per call.
export function createWorkspaceQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false },
    },
  });
}

// The whole vocabulary, not a list: a list claims which kinds a gap can hide.
const THREAD_RECONNECT_SWEEP: ThreadChangedMessage = {
  type: "changed",
  entity: "thread",
  changes: THREAD_CHANGE_KINDS,
};

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
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

  // Constructed inside the effect: dispose() is permanent, so a client held in
  // state would be killed for good by a double-invoked dev effect's cleanup.
  useEffect(() => {
    const invalidation = new InvalidationClient({
      createSocket: () => browserInvalidationSocket(workspaceSocketUrl(socketOrigin())),
      onChanged: (message) =>
        applyChangedMessage(runtime.queryClient, runtime.notifyDoc, runtime.notifyThread, message),
      // System status is swept too: a dropped socket most likely means the
      // server restarted.
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
      <RadiusProvider radius="rounded">
        <SizeProvider size="compact">
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

// The editor keys off `data-theme` on :root, the chrome off ThemeProvider's
// `.dark` class; stamping the resolved theme (never "system") keeps them agreeing.
function EditorThemeCarrier() {
  const { resolved } = useTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  return null;
}
