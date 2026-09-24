import { partialMatchKey, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { THREAD_CHANGE_KINDS } from "@repo/domain/change-kinds";
import type { ThreadChangeKind, VaultChangeKind } from "@repo/domain/change-kinds";
import type { VaultChangedEvent } from "@repo/editor/host-io";
import { COMMENTS_STORE_DIR } from "@repo/notes/comments/sidecar-schema";
import { ThemeProvider } from "@repo/ui/lib/theme";
import { RadiusProvider } from "@repo/ui/lib/radius-context";
import { SizeProvider } from "@repo/ui/lib/size-context";
import type { ChangedMessage, ThreadChangedMessage } from "@repo/api/local/notifications";
import type { VaultEntry, VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import { createContext, useContext, useEffect, useState } from "react";
import { workspaceSocketUrl } from "@repo/api/local/routes";
import { AppearanceProvider } from "./appearance";
import { orpc } from "./api";
import { socketOrigin } from "./socket-origin";
import { browserInvalidationSocket, InvalidationClient } from "./invalidation-client";
import { PREFS, usePref } from "./prefs";

type VaultChangeListener = (event: VaultChangedEvent) => void;

interface VaultChanges {
  subscribe: (listener: VaultChangeListener) => () => void;
}

// An undefined `id` is a synthetic sweep: any thread may have changed.
type ThreadListener = (message: ThreadChangedMessage) => void;

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

const isUnlinkedMentionsQuery = (queryKey: readonly unknown[]): boolean =>
  partialMatchKey(queryKey, orpc.knowledge.unlinkedMentions.key());

const isCommentsStorePath = (path: string): boolean => path.startsWith(`${COMMENTS_STORE_DIR}/`);

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

// content-changed moves no row, so the listing is patched rather than re-walked; without it the
// recents, sorted by modifiedMs, never move for a note being edited. Each doc carries the time its
// frame arrived, which from a loopback server is the write's own to within a frame.
const touchModified = (
  tree: VaultTreeResponse | undefined,
  modifiedAt: ReadonlyMap<string, number>,
): VaultTreeResponse | undefined => {
  const stamped = (entry: VaultEntry): VaultEntry => {
    if (entry.kind !== "file") {
      return entry;
    }
    const modifiedMs = modifiedAt.get(entry.path);
    return modifiedMs === undefined ? entry : { ...entry, modifiedMs };
  };
  if (tree === undefined || tree.entries.every((entry) => stamped(entry) === entry)) {
    return tree;
  }
  return { ...tree, entries: tree.entries.map(stamped) };
};

// What the frames since the last flush owe the screen, folded rather than replayed: a K-note
// rename or a streamed turn is K frames that each asked for the same refetch.
export class ChangeBatch {
  private readonly vaultKinds = new Set<VaultChangeKind>();
  // null once a files-changed frame named no paths: every note re-checks.
  private movedPaths: Set<string> | null = new Set();
  // stamped on arrival, not at the flush: a hidden window defers the flush, never the write.
  private readonly contentChanged = new Map<string, number>();
  private readonly threads = new Map<string | undefined, Set<ThreadChangeKind>>();

  add(message: ChangedMessage): void {
    switch (message.entity) {
      case "vault": {
        for (const kind of message.changes) {
          this.vaultKinds.add(kind);
        }
        if (message.changes.includes("files-changed")) {
          if (message.paths === undefined) {
            this.movedPaths = null;
          } else {
            for (const path of message.paths) {
              this.movedPaths?.add(path);
            }
          }
        }
        break;
      }
      case "doc": {
        if (message.changes.includes("content-changed")) {
          this.contentChanged.set(message.id, Date.now());
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

  // One files event however many paths moved, so the note session re-lists once per flush; a doc
  // whose content changed in the same flush rides it, so the open note reloads once.
  private vaultChangedEvents(): VaultChangedEvent[] {
    if (!this.vaultKinds.has("files-changed")) {
      return [...this.contentChanged.keys()].map((path): VaultChangedEvent => ({
        kind: "content",
        path,
      }));
    }
    const paths =
      this.movedPaths === null
        ? null
        : [...new Set([...this.movedPaths, ...this.contentChanged.keys()])];
    return [{ kind: "files", paths }];
  }

  apply(
    queryClient: QueryClient,
    emitVaultChange: VaultChangeListener,
    notifyThread: ThreadListener,
  ): void {
    if (this.vaultKinds.has("files-changed")) {
      void queryClient.invalidateQueries({ queryKey: orpc.vault.tree.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.vault.deleted.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.comments.key() });
    } else if (this.contentChanged.size > 0) {
      // The note's bytes are not query state, so content-changed goes to the
      // open note's reader alone; a query alongside bought a second read of the
      // same bytes. Knowledge is swept whole: this doc's links are some other
      // note's backlinks, and which note is not knowable here. The one exception
      // is the vault-wide prose scan behind unlinked mentions, which would re-read
      // every doc body per autosave; it waits for files-changed or a refold.
      void queryClient.invalidateQueries({
        predicate: (query) => !isUnlinkedMentionsQuery(query.queryKey),
        queryKey: orpc.knowledge.key(),
      });
      // a comment added to a note that already has a store rewrites the store and names no row.
      if ([...this.contentChanged.keys()].some(isCommentsStorePath)) {
        void queryClient.invalidateQueries({ queryKey: orpc.comments.key() });
      }
    }
    if (this.vaultKinds.has("sync-status-changed")) {
      void queryClient.invalidateQueries({ queryKey: orpc.vault.status.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.cloud.status.key() });
    }
    if (this.contentChanged.size > 0) {
      queryClient.setQueryData(orpc.vault.tree.queryKey(), (tree) =>
        touchModified(tree, this.contentChanged),
      );
    }
    for (const event of this.vaultChangedEvents()) {
      emitVaultChange(event);
    }

    // a thread finds its note by the note's id, so a moved note re-points every thread with no
    // thread frame of its own.
    const filesMoved = this.vaultKinds.has("files-changed");
    if (filesMoved || [...this.threads.values()].some((kinds) => movesAny(MOVES_THE_LIST, kinds))) {
      void queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() });
    }
    if (filesMoved) {
      void queryClient.invalidateQueries({ queryKey: orpc.threads.get.key() });
    }
    for (const [threadId, kinds] of this.threads) {
      if (!filesMoved && movesAny(MOVES_THE_DETAIL, kinds)) {
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
const BUS_SWEPT_FAMILIES: readonly QueryKey[] = [
  orpc.vault.key(),
  orpc.knowledge.key(),
  orpc.comments.key(),
  orpc.threads.key(),
  orpc.cloud.status.key(),
];

const EVERY_FILE: VaultChangedEvent = { kind: "files", paths: null };

// The whole vocabulary, not a list: a list claims which kinds a gap can hide.
const THREAD_RECONNECT_SWEEP: ThreadChangedMessage = {
  changes: THREAD_CHANGE_KINDS,
  entity: "thread",
  type: "changed",
};

// System status is swept too: a dropped socket most likely means the server restarted.
export const sweepAfterReconnect = (
  queryClient: QueryClient,
  emitVaultChange: VaultChangeListener,
  notifyThread: ThreadListener,
): void => {
  for (const queryKey of [...BUS_SWEPT_FAMILIES, orpc.system.status.key()]) {
    void queryClient.invalidateQueries({ queryKey });
  }
  emitVaultChange(EVERY_FILE);
  notifyThread(THREAD_RECONNECT_SWEEP);
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
      createSocket: () => browserInvalidationSocket(workspaceSocketUrl(socketOrigin())),
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
