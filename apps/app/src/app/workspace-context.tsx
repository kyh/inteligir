// The workspace runtime: ONE typed client, ONE QueryClient, ONE invalidation
// socket — constructed together, threaded through context. Changed messages
// land here and become query invalidations (list/status/system) plus a doc
// event the open note listens to; the note's buffer is deliberately NOT
// query-cached (the buffer IS the file — see note-view).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme, type Theme } from "@repo/ui/lib/theme";
import type { ChangedMessage } from "@repo/server-contract/notifications";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
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

export interface WorkspaceRuntime {
  api: ReturnType<typeof createWorkspaceApiClient>;
  queryClient: QueryClient;
  docEvents: DocEvents;
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
  message: ChangedMessage,
): void {
  switch (message.entity) {
    case "system":
      void queryClient.invalidateQueries({ queryKey: queryKeys.systemStatus });
      break;
    case "vault":
      if (message.changes.includes("files-changed")) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.vaultTree });
        notifyDoc(null);
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
      // No thread surface in this shell yet.
      break;
  }
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
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
    return {
      api: createWorkspaceApiClient(),
      queryClient,
      docEvents,
      notifyDoc,
    };
  });

  // The client is constructed INSIDE the effect, symmetric with its
  // teardown: dispose() is permanent, so a client held in state would be
  // killed for good by the first cleanup a double-invoked dev effect runs.
  useEffect(() => {
    const invalidation = new InvalidationClient({
      createSocket: () => browserInvalidationSocket(workspaceSocketUrl(window.location.origin)),
      onChanged: (message) => applyChangedMessage(runtime.queryClient, runtime.notifyDoc, message),
    });
    invalidation.start();
    invalidation.subscribe({ kind: "system" });
    invalidation.subscribe({ kind: "vault" });
    return () => {
      invalidation.dispose();
    };
  }, [runtime]);

  const [theme, setThemeState] = useState<Theme>(readTheme);
  const setTheme = (next: Theme): void => {
    writeTheme(next);
    setThemeState(next);
  };

  const contextValue = useMemo<WorkspaceRuntime>(
    () => ({ api: runtime.api, queryClient: runtime.queryClient, docEvents: runtime.docEvents }),
    [runtime],
  );

  return (
    <ThemeProvider theme={theme} setTheme={setTheme}>
      <EditorThemeCarrier />
      <QueryClientProvider client={runtime.queryClient}>
        <WorkspaceContext value={contextValue}>{children}</WorkspaceContext>
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
