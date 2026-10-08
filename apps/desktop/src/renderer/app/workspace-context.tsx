import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { THREAD_CHANGE_KINDS } from "@repo/domain/change-kinds";
import type { ThreadChangeKind } from "@repo/domain/change-kinds";
import { ThemeProvider } from "@repo/ui/lib/theme";
import { RadiusProvider } from "@repo/ui/lib/radius-context";
import { SizeProvider } from "@repo/ui/lib/size-context";
import type { ChangedMessage, ThreadChangedMessage } from "@repo/contract/local/notifications";
import { createContext, useContext, useEffect, useState } from "react";
import { workspaceSocketUrl } from "@repo/contract/local/routes";
import { orpc } from "./api";
import { browserInvalidationSocket, InvalidationClient } from "./invalidation-client";
import { PREFS, usePref } from "./prefs";

// An undefined `id` is a synthetic sweep: any thread may have changed.
type ThreadListener = (message: ThreadChangedMessage) => void;

interface ThreadEvents {
  subscribe: (listener: ThreadListener) => () => void;
}

export interface WorkspaceRuntime {
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

// Total over the kinds, like thread-hooks' MOVES_THE_TIMELINE. A streamed turn is hundreds of
// events-appended frames that move no list row and no detail field: the timeline's delta fetch is
// their only reader, and a refetch of every thread per frame is what these tables refuse.
const MOVES_THE_LIST = {
  "archived-changed": true,
  "events-appended": false,
  "interactions-changed": false,
  "origin-changed": true,
  "queue-changed": false,
  "status-changed": true,
  "thread-created": true,
  "title-changed": true,
} satisfies Record<ThreadChangeKind, boolean>;

const MOVES_THE_DETAIL = {
  "archived-changed": true,
  "events-appended": false,
  "interactions-changed": true,
  "origin-changed": true,
  "queue-changed": true,
  "status-changed": true,
  "thread-created": true,
  "title-changed": true,
} satisfies Record<ThreadChangeKind, boolean>;

const movesAny = (
  table: Record<ThreadChangeKind, boolean>,
  kinds: ReadonlySet<ThreadChangeKind>,
): boolean => [...kinds].some((kind) => table[kind]);

// What the frames since the last flush owe the screen, folded rather than replayed: a streamed
// turn is K frames that each asked for the same refetch.
export class ChangeBatch {
  // the sync's own status moved: the rail's row and Settings read it
  private syncStatusChanged = false;
  private readonly threads = new Map<string | undefined, Set<ThreadChangeKind>>();

  add(message: ChangedMessage): void {
    switch (message.entity) {
      case "vault": {
        if (message.changes.includes("sync-status-changed")) {
          this.syncStatusChanged = true;
        }
        break;
      }
      case "thread": {
        const kinds = this.threads.get(message.id) ?? new Set<ThreadChangeKind>();
        for (const kind of message.changes) {
          kinds.add(kind);
        }
        this.threads.set(message.id, kinds);
        break;
      }
      default: {
        const exhaustive: never = message;
        return exhaustive;
      }
    }
  }

  apply(queryClient: QueryClient, notifyThread: ThreadListener): void {
    if (this.syncStatusChanged) {
      void queryClient.invalidateQueries({ queryKey: orpc.cloud.status.key() });
    }
    if ([...this.threads.values()].some((kinds) => movesAny(MOVES_THE_LIST, kinds))) {
      void queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() });
    }
    for (const [threadId, kinds] of this.threads) {
      if (movesAny(MOVES_THE_DETAIL, kinds)) {
        void queryClient.invalidateQueries({
          queryKey:
            threadId === undefined
              ? orpc.threads.get.key()
              : orpc.threads.get.key({ input: { threadId } }),
        });
      }
      const changes = [...kinds];
      const merged: ThreadChangedMessage =
        threadId === undefined
          ? { changes, entity: "thread", type: "changed" }
          : { changes, entity: "thread", id: threadId, type: "changed" };
      notifyThread(merged);
    }
  }
}

// Every family the bus keeps fresh, so the reconnect sweep cannot miss one the frames reach: a gap
// in the socket produced no frames.
const BUS_SWEPT_FAMILIES: readonly QueryKey[] = [orpc.threads.key(), orpc.cloud.status.key()];

// The whole vocabulary, not a list: a list claims which kinds a gap can hide.
const THREAD_RECONNECT_SWEEP: ThreadChangedMessage = {
  changes: THREAD_CHANGE_KINDS,
  entity: "thread",
  type: "changed",
};

// System status is swept too: a dropped socket most likely means the server restarted.
export const sweepAfterReconnect = (
  queryClient: QueryClient,
  notifyThread: ThreadListener,
): void => {
  for (const queryKey of [...BUS_SWEPT_FAMILIES, orpc.system.status.key()]) {
    void queryClient.invalidateQueries({ queryKey });
  }
  notifyThread(THREAD_RECONNECT_SWEEP);
};

// The ws bus sweeps every cached family, so react-query's defaults are pure
// cost: refetch-on-focus would re-read every thread on every alt-tab back. A
// query the bus does not cover opts out per call.
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
    const contextValue: WorkspaceRuntime = { threadEvents };
    return { contextValue, notifyThread, queryClient };
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
      due?.apply(runtime.queryClient, runtime.notifyThread);
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
        sweepAfterReconnect(runtime.queryClient, runtime.notifyThread);
      },
    });
    invalidation.start();
    invalidation.subscribe({ kind: "vault" });
    invalidation.subscribe({ kind: "thread-list" });
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
          <QueryClientProvider client={runtime.queryClient}>
            <WorkspaceContext value={runtime.contextValue}>{children}</WorkspaceContext>
          </QueryClientProvider>
        </SizeProvider>
      </RadiusProvider>
    </ThemeProvider>
  );
};
