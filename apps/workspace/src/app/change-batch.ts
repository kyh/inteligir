import { partialMatchKey } from "@tanstack/react-query";
import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import { THREAD_CHANGE_KINDS } from "@repo/domain/change-kinds";
import type { ThreadChangeKind, VaultChangeKind } from "@repo/domain/change-kinds";
import type { VaultChangedEvent } from "@repo/editor/host-io";
import { isAnnotationsStorePath } from "@repo/notes/annotations/store-schema";
import type { ChangedMessage, ThreadChangedMessage } from "@repo/contract/local/notifications";
import { orpc } from "./api";

export type VaultChangeListener = (event: VaultChangedEvent) => void;

// An undefined `id` is a synthetic sweep: any thread may have changed.
export type ThreadListener = (message: ThreadChangedMessage) => void;

// Total over the kinds, like thread-hooks' MOVES_THE_TIMELINE. A streamed turn is hundreds of
// events-appended frames that move no list row and no detail field: the timeline's delta fetch is
// their only reader, and a refetch of every thread per frame is what these tables refuse.
const MOVES_THE_LIST = {
  "archived-changed": true,
  "changes-committed": false,
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
  "changes-committed": false,
  "events-appended": false,
  "interactions-changed": true,
  "origin-changed": true,
  "queue-changed": true,
  "status-changed": true,
  "thread-created": true,
  "title-changed": true,
} satisfies Record<ThreadChangeKind, boolean>;

// what each turn changed is read from the vault's log. A local commit, a turn's or an undo's, names
// its thread; a pull moves the log too, a turn another Mac committed included, and says only
// files-changed, which apply() weighs beside this table.
const MOVES_THE_CHANGES = {
  "archived-changed": false,
  "changes-committed": true,
  "events-appended": false,
  "interactions-changed": false,
  "origin-changed": false,
  "queue-changed": false,
  "status-changed": false,
  "thread-created": false,
  "title-changed": false,
} satisfies Record<ThreadChangeKind, boolean>;

const movesAny = (
  table: Record<ThreadChangeKind, boolean>,
  kinds: ReadonlySet<ThreadChangeKind>,
): boolean => [...kinds].some((kind) => table[kind]);

// every doc and asset the library holds (about 7.5 MB at 50k items), so it moves only on
// targets-changed, which the server says when a settle added, removed or renamed a path or changed
// a doc's aliases, id, pin or title, every field of its row (the pinned set is read from it); any
// other body edit, most of every fill's and every keystroke's, says only content-changed.
const isWikiTargets = (query: Query): boolean =>
  partialMatchKey(query.queryKey, orpc.knowledge.wikiTargets.key());

// the knowledge family less the targets: a link into a note lives in another note's bytes, so the
// rest is swept whole
export const sweepKnowledge = (queryClient: QueryClient): void => {
  void queryClient.invalidateQueries({
    predicate: (query) => !isWikiTargets(query),
    queryKey: orpc.knowledge.key(),
  });
};

const TARGETS_REFETCH_MS = 5000;

// per query client, across flushes: an import or a fill storm renames paths for minutes, and
// each frame's batch would otherwise refetch the targets again
interface TargetsRefetch {
  lastAt: number;
  pending: ReturnType<typeof setTimeout> | null;
}

const targetsRefetches = new WeakMap<QueryClient, TargetsRefetch>();

// at most once per TARGETS_REFETCH_MS: the first after a quiet spell at once, and every frame
// inside the window folded into one trailing refetch at its end
const refetchTargets = (queryClient: QueryClient): void => {
  const state = targetsRefetches.get(queryClient) ?? {
    lastAt: Number.NEGATIVE_INFINITY,
    pending: null,
  };
  targetsRefetches.set(queryClient, state);
  if (state.pending !== null) {
    return;
  }
  const run = (): void => {
    state.pending = null;
    state.lastAt = Date.now();
    void queryClient.invalidateQueries({ queryKey: orpc.knowledge.wikiTargets.key() });
  };
  const wait = state.lastAt + TARGETS_REFETCH_MS - Date.now();
  if (wait <= 0) {
    run();
    return;
  }
  state.pending = setTimeout(run, wait);
};

// What the frames since the last flush owe the screen, folded rather than replayed: a K-note
// rename or a streamed turn is K frames that each asked for the same refetch.
export class ChangeBatch {
  private readonly vaultKinds = new Set<VaultChangeKind>();
  // null once a files-changed frame named no paths: every note re-checks.
  private movedPaths: Set<string> | null = new Set();
  // the docs whose bytes moved in place since the last flush
  private readonly contentChanged = new Set<string>();
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
          this.contentChanged.add(message.id);
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
      return [...this.contentChanged].map((path): VaultChangedEvent => ({
        kind: "content",
        path,
      }));
    }
    const paths =
      this.movedPaths === null ? null : [...new Set([...this.movedPaths, ...this.contentChanged])];
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
      sweepKnowledge(queryClient);
      void queryClient.invalidateQueries({ queryKey: orpc.annotations.key() });
    } else if (this.contentChanged.size > 0) {
      // The note's bytes are not query state, so content-changed goes to the
      // open note's reader alone; a query alongside bought a second read of the
      // same bytes. Knowledge is swept whole but for the targets: this doc's
      // links are some other note's backlinks, and which note is not knowable here.
      sweepKnowledge(queryClient);
      // a highlight added to an item that already has a store rewrites the store and names no row.
      if ([...this.contentChanged].some(isAnnotationsStorePath)) {
        void queryClient.invalidateQueries({ queryKey: orpc.annotations.key() });
      }
    }
    if (this.vaultKinds.has("sync-status-changed")) {
      void queryClient.invalidateQueries({ queryKey: orpc.vault.status.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.cloud.status.key() });
    }
    if (this.vaultKinds.has("import-changed")) {
      void queryClient.invalidateQueries({ queryKey: orpc.imports.status.key() });
    }
    if (this.vaultKinds.has("targets-changed")) {
      refetchTargets(queryClient);
    }
    for (const event of this.vaultChangedEvents()) {
      emitVaultChange(event);
    }

    // a thread finds its note by the note's id, so a moved note re-points every thread with no
    // thread frame of its own; and a pull's commits reach the log with no thread frame either.
    const filesMoved = this.vaultKinds.has("files-changed");
    if (filesMoved || [...this.threads.values()].some((kinds) => movesAny(MOVES_THE_LIST, kinds))) {
      void queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() });
    }
    if (filesMoved) {
      void queryClient.invalidateQueries({ queryKey: orpc.threads.get.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.threads.turnChanges.key() });
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
      if (!filesMoved && movesAny(MOVES_THE_CHANGES, kinds)) {
        void queryClient.invalidateQueries({
          queryKey:
            threadId === undefined
              ? orpc.threads.turnChanges.key()
              : orpc.threads.turnChanges.key({ input: { threadId } }),
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
  orpc.annotations.key(),
  orpc.imports.key(),
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
