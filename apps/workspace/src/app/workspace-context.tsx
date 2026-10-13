import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@repo/ui/lib/theme";
import { RadiusProvider } from "@repo/ui/lib/radius-context";
import { SizeProvider } from "@repo/ui/lib/size-context";
import { createContext, useContext, useEffect, useState } from "react";
import { workspaceSocketUrl } from "@repo/contract/local/routes";
import { AppearanceProvider } from "./appearance";
import { ChangeBatch, sweepAfterReconnect } from "./change-batch";
import type { ThreadListener, VaultChangeListener } from "./change-batch";
import { browserInvalidationSocket, InvalidationClient } from "./invalidation-client";
import { PREFS, usePref } from "./prefs";

interface VaultChanges {
  subscribe: (listener: VaultChangeListener) => () => void;
}

interface ThreadEvents {
  subscribe: (listener: ThreadListener) => () => void;
}

export interface WorkspaceRuntime {
  vaultChanges: VaultChanges;
  threadEvents: ThreadEvents;
}

const WorkspaceContext = createContext<WorkspaceRuntime | null>(null);

export const useWorkspace = (): WorkspaceRuntime => {
  const runtime = useContext(WorkspaceContext);
  if (runtime === null) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return runtime;
};

// The ws bus sweeps every cached family, so react-query's defaults are pure
// cost: refetch-on-focus re-ran a full vault walk and a `git status` on every
// alt-tab back. A query the bus does not cover opts out per call.
export const createWorkspaceQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { refetchOnReconnect: false, refetchOnWindowFocus: false, staleTime: Infinity },
    },
  });

export const WorkspaceProvider = ({ children }: { children: React.ReactNode }) => {
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [runtime] = useState(() => {
    const queryClient = createWorkspaceQueryClient();
    const vaultChangeListeners = new Set<VaultChangeListener>();
    const emitVaultChange: VaultChangeListener = (event) => {
      for (const listener of vaultChangeListeners) {
        listener(event);
      }
    };
    const vaultChanges: VaultChanges = {
      subscribe(listener) {
        vaultChangeListeners.add(listener);
        return () => {
          vaultChangeListeners.delete(listener);
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
    const contextValue: WorkspaceRuntime = { threadEvents, vaultChanges };
    return { contextValue, emitVaultChange, notifyThread, queryClient };
  });

  // Constructed inside the effect: dispose() is permanent, so a client held in
  // state would be killed for good by a double-invoked dev effect's cleanup.
  useEffect(() => {
    // One flush per animation frame. A hidden window runs no frames, so a long turn streamed
    // while minimized folds into one flush on return rather than a refetch per frame.
    let batch: ChangeBatch | null = null;
    let frame: number | null = null;
    const flush = (): void => {
      frame = null;
      const due = batch;
      batch = null;
      due?.apply(runtime.queryClient, runtime.emitVaultChange, runtime.notifyThread);
    };
    const invalidation = new InvalidationClient({
      // the page is the server's own, under the shell as in a tab, so the socket dials its origin
      createSocket: () => browserInvalidationSocket(workspaceSocketUrl(window.location.origin)),
      onChanged: (message) => {
        if (batch === null) {
          batch = new ChangeBatch();
          frame = requestAnimationFrame(flush);
        }
        batch.add(message);
      },
      onReconnected: () => {
        sweepAfterReconnect(runtime.queryClient, runtime.emitVaultChange, runtime.notifyThread);
      },
      targets: [{ kind: "vault" }, { kind: "thread-list" }],
    });
    invalidation.start();
    return () => {
      invalidation.dispose();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [runtime]);

  const [theme, chooseTheme] = usePref(PREFS.theme);

  return (
    <ThemeProvider theme={theme} setTheme={chooseTheme}>
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
};
