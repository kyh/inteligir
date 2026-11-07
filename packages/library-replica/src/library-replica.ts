// The replica engine every device runs: the account's library as this device holds it, read
// offline and caught up whenever it can reach its cell. A pass sends the outbox oldest first,
// then pulls the change log and the bodies whose items moved; it runs when the replica starts or
// resumes, when a write is queued, when the socket says the library moved or opens, and on the
// minute's check-in, so nothing it holds rests on the socket. A failure waits a doubling while
// and goes again; a session's end stops the replica, which its host answers (a sign-out wipes it).
// The screens read the listing from memory and an item, its highlights, a search and the
// threads from SQL, each with this device's unsent writes laid over.

import { createORPCClient, safe } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { LibrarySocketFrame } from "@repo/contract/cloud/library/library-socket";
import type {
  threadEventRowSchema,
  threadRowSchema,
} from "@repo/contract/cloud/library/library-wire";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import type { AnnotationStore } from "@repo/notes/annotations/store-schema";
import { LibraryIndex } from "@repo/notes/library/library-index";
import type {
  ListingFolder,
  ListingPage,
  ListingQuery,
  ListingScopes,
} from "@repo/notes/library/library-index";
import { searchLibrary } from "@repo/notes/library/library-queries";
import type { LibrarySearchHit } from "@repo/notes/library/library-queries";
import { ensureLibrarySchema } from "@repo/notes/library/library-schema";
import { all, run, runPlanAsync } from "@repo/notes/library/library-sql";
import type { SqlPlan } from "@repo/notes/library/library-sql";
import { z } from "zod";

import type { CallFailure } from "./call-outcome";
import { itemIdsOf } from "./outbox-ops";
import { createOutbox } from "./outbox";
import type { OutboxRow } from "./outbox-rows";
import { createCommands } from "./replica-commands";
import type { ReplicaCommands } from "./replica-commands";
import {
  layFolders,
  readAllListingRows,
  readListingRows,
  readReplicaAnnotations,
  readReplicaItem,
  rowsNaming,
} from "./replica-listing";
import type { ReplicaItem, ReplicaListingRow } from "./replica-listing";
import type { ReplicaDeps } from "./replica-ports";
import { fetchBodies, pullChanges } from "./replica-pull";
import type { FetchOutcome } from "./replica-pull";
import {
  readFolders,
  readSyncState,
  readThreadEvents,
  readThreads,
  touchedNothing,
  wipeSynced,
} from "./replica-rows";
import type { Touched } from "./replica-rows";
import { createSocketHint } from "./replica-socket";
import type { SocketHint } from "./replica-socket";
import { serialLock } from "./serial-lock";

export type { ReplicaItem, ReplicaListingRow } from "./replica-listing";
export type { LinkInput, Made, PageInput } from "./replica-commands";
export { fileSha } from "./replica-commands";

type ThreadRow = z.infer<typeof threadRowSchema>;
type ThreadEventRow = z.infer<typeof threadEventRowSchema>;
type ThreadFrame = Extract<LibrarySocketFrame, { type: "thread" }>;
// a pass's end: caught up, more for the outbox at once, a failure, or a close
type PassOutcome =
  | Exclude<FetchOutcome, { kind: "failed" }>
  | { readonly kind: "more" }
  | { readonly kind: "failed"; readonly failure: ReplicaFailure };

// what stopped a pass: a call's failure, or a fault of this device's own
type ReplicaFailure = CallFailure | { readonly kind: "fault"; readonly message: string };

// the minute's check-in: a pull, and the socket dialled again if it dropped
const CHECK_IN_MS = 60_000;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 60_000;
// past this many ids, a page's landing reads the whole listing again rather than row by row
const REREAD_ALL_OVER = 200;

// a write the cell refused, waiting for the person to send it again or let it go
export interface ParkedWrite {
  readonly seq: number;
  readonly itemIds: readonly string[];
  readonly reason: string;
}

export interface ReplicaStatus {
  // a pass is under way: writes going, the log or the bodies coming
  readonly syncing: boolean;
  // what stopped the last pass, null once one ends clean; a session's end stops the replica
  // until it is started again
  readonly failure: ReplicaFailure | null;
  // writes not landed yet, the parked ones among them; a file kept for a write still to come
  // counts only once it is parked, since the write that names it is the change
  readonly unsent: number;
  readonly parked: readonly ParkedWrite[];
  // the bodies this pass fetched, of all it wants
  readonly bodies: { readonly fetched: number; readonly total: number };
  // where the pull stands in the change log, and the newest head heard
  readonly cursor: number;
  readonly head: number;
}

// what moved: the kinds of row and their ids (an item's, a folder's, a thread's, a file's sha),
// or the whole library at once, and the items a write of this device was merged into keeping its
// lines where another device changed the same ones, which a screen says
export interface ReplicaChange {
  readonly kinds: ReadonlySet<string>;
  readonly ids: ReadonlySet<string>;
  readonly reset: boolean;
  readonly overlapped: ReadonlySet<string>;
}

export interface LibraryReplica extends ReplicaCommands {
  // syncs, and keeps syncing: the socket's hint and the minute's check-in
  readonly start: () => void;
  // the app is in front again: the socket dials, a pass runs, and a stopped replica starts again
  readonly resume: () => void;
  // the app went behind: the socket closes and nothing runs until it resumes
  readonly suspend: () => void;
  // a pass now, or once the running one ends; resolves when the replica is caught up or stopped
  readonly sync: () => Promise<void>;
  // the item open on a screen, whose body comes first
  readonly focus: (itemId: string | null) => void;
  readonly close: () => Promise<void>;
  // a sign-out: every row this device holds goes, its unsent writes with them, and it closes
  readonly wipe: () => Promise<void>;

  readonly status: () => ReplicaStatus;
  readonly onStatus: (listener: () => void) => () => void;
  readonly onChange: (listener: (change: ReplicaChange) => void) => () => void;
  // the built-in agent's turn as the socket carries it, previews included
  readonly onThreadFrame: (listener: (frame: ThreadFrame) => void) => () => void;

  readonly listing: (query: ListingQuery) => ListingPage<ReplicaListingRow>;
  readonly scopes: () => ListingScopes;
  readonly folders: () => readonly ListingFolder[];
  readonly row: (itemId: string) => ReplicaListingRow | null;
  readonly item: (itemId: string) => Promise<ReplicaItem | null>;
  readonly annotations: (itemId: string) => Promise<AnnotationStore>;
  // the library's ranked search over what has landed, less what this device deleted
  readonly search: (query: string, limit: number) => Promise<LibrarySearchHit[]>;
  readonly threads: () => Promise<ThreadRow[]>;
  readonly threadEvents: (threadId: string) => Promise<ThreadEventRow[]>;

  // a parked write goes again, or is let go
  readonly retry: (seq: number) => Promise<void>;
  readonly discard: (seq: number) => Promise<void>;
}

export type ReplicaOpening =
  | { readonly kind: "ready"; readonly replica: LibraryReplica }
  // the device's SQLite is older than the schema needs
  | { readonly kind: "unsupported"; readonly sqliteVersion: string };

const nameSchema = z.object({ name: z.string() });

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

// a schema of another version, or one no build made: every table goes, the full-text index first,
// since its own tables go with it
const dropEverything = function* dropEverything(): SqlPlan<void> {
  const virtual = yield all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND instr(sql, 'CREATE VIRTUAL TABLE') = 1",
  );
  for (const raw of virtual) {
    yield run(`DROP TABLE IF EXISTS ${quoted(nameSchema.parse(raw).name)}`);
  }
  const tables = yield all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND instr(name, 'sqlite_') <> 1",
  );
  for (const raw of tables) {
    yield run(`DROP TABLE IF EXISTS ${quoted(nameSchema.parse(raw).name)}`);
  }
};

// a row the person would call a change of theirs: a file kept for a write still to come is part
// of the write that names it, which stages it too, so it counts alone only once it is refused and
// waits for the person
const isChange = (row: OutboxRow): boolean => row.op.kind !== "keep" || row.state === "parked";

const parkedOf = (rows: readonly OutboxRow[]): ParkedWrite[] =>
  rows.flatMap((row) =>
    row.state === "parked" && row.reason !== null
      ? [{ itemIds: itemIdsOf(row.op), reason: row.reason, seq: row.seq }]
      : [],
  );

export const openLibraryReplica = async (deps: ReplicaDeps): Promise<ReplicaOpening> => {
  const { blobs, clock, sql, transport } = deps;
  const ensure = async () =>
    await sql.exclusive(async (tx) => await runPlanAsync(tx, ensureLibrarySchema("replica")));
  let verdict = await ensure();
  if (verdict.kind === "mismatch") {
    // before the drop: once that commits, the next open finds an empty database and clears nothing
    await blobs.clear();
    await sql.exclusive(async (tx) => {
      await runPlanAsync(tx, dropEverything());
    });
    verdict = await ensure();
  }
  if (verdict.kind === "unsupported") {
    return { kind: "unsupported", sqliteVersion: verdict.sqliteVersion };
  }
  if (verdict.kind === "mismatch") {
    throw new Error(`the replica's schema did not open after starting over (${verdict.found})`);
  }

  const client: V1Client = createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => await transport.fetch(new Request(url, init)),
      origin: transport.origin,
      url: V1_RPC_PATH,
    }),
  );

  let closed = false;
  const live = (): boolean => !closed;

  let status: ReplicaStatus = {
    bodies: { fetched: 0, total: 0 },
    cursor: 0,
    failure: null,
    head: 0,
    parked: [],
    syncing: false,
    unsent: 0,
  };
  const statusListeners = new Set<() => void>();
  const setStatus = (next: Partial<ReplicaStatus>): void => {
    status = { ...status, ...next };
    for (const listener of statusListeners) {
      listener();
    }
  };

  const changeListeners = new Set<(change: ReplicaChange) => void>();
  const threadListeners = new Set<(frame: ThreadFrame) => void>();

  let index = new LibraryIndex<ReplicaListingRow>();
  let rowsById = new Map<string, ReplicaListingRow>();
  let folders: ListingFolder[] = [];
  // one reading of the listing at a time, so an older one never lands over a newer
  const reading = serialLock();

  const emit = (change: ReplicaChange): void => {
    for (const listener of changeListeners) {
      listener(change);
    }
  };

  const readAll = async (pending: readonly OutboxRow[]): Promise<void> => {
    const rows = await runPlanAsync(sql, readAllListingRows(pending));
    const next = new LibraryIndex<ReplicaListingRow>();
    for (const row of rows) {
      next.upsert(row);
    }
    folders = layFolders(await runPlanAsync(sql, readFolders()), pending);
    next.setFolders(folders);
    index = next;
    rowsById = new Map(rows.map((row) => [row.id, row]));
  };

  const readSome = async (ids: readonly string[], pending: readonly OutboxRow[]): Promise<void> => {
    const rows = await runPlanAsync(sql, readListingRows(ids, pending));
    for (const [id, row] of rows) {
      if (row === null) {
        index.remove(id);
        rowsById.delete(id);
      } else {
        index.upsert(row);
        rowsById.set(id, row);
      }
    }
  };

  const outboxStatus = (pending: readonly OutboxRow[]): void => {
    setStatus({ parked: parkedOf(pending), unsent: pending.filter(isChange).length });
  };

  const refresh = async (
    touched: Touched,
    reset: boolean,
    pending: readonly OutboxRow[],
  ): Promise<void> => {
    await reading(async () => {
      const ids = [...touched.ids];
      if (reset || ids.length > REREAD_ALL_OVER) {
        await readAll(pending);
      } else {
        if (touched.kinds.has("item") || touched.kinds.has("annotation")) {
          await readSome(ids, pending);
        }
        if (touched.kinds.has("folder")) {
          folders = layFolders(await runPlanAsync(sql, readFolders()), pending);
          index.setFolders(folders);
        }
      }
    });
    outboxStatus(pending);
    emit({
      ids: touched.ids,
      kinds: touched.kinds,
      overlapped: touched.overlapped,
      reset: reset || touched.ids.size > REREAD_ALL_OVER,
    });
  };

  const outbox = createOutbox({
    blobs,
    changed: async (touched, pending) => {
      await refresh(touched, false, pending);
    },
    client,
    clock,
    live,
    merge: deps.merge,
    newId: deps.newId,
    sql,
    transport,
  });
  await outbox.load();
  await reading(async () => {
    await readAll(outbox.rows());
  });
  const held = await runPlanAsync(sql, readSyncState());
  setStatus({ cursor: held.cursor, head: held.head });
  outboxStatus(outbox.rows());

  // ---- the passes ----

  let focused: string | null = null;
  let active = false;
  // a session's end: nothing runs until the replica is started again
  let stopped = false;
  let running: Promise<void> | null = null;
  let again = false;
  let failures = 0;
  let cancelRetry: (() => void) | null = null;
  let cancelCheckIn: (() => void) | null = null;
  // the account's socket, when the host dials one; made once the passes it hurries exist
  let socket: SocketHint | null = null;

  const landed = async (touched: Touched, reset: boolean): Promise<void> => {
    await refresh(touched, reset, outbox.rows());
  };

  // one pass: the outbox, the log, the bodies, stopping at the first that fails
  const pass = async (): Promise<PassOutcome> => {
    const drained = await outbox.drain();
    if (drained.kind === "closed") {
      return { kind: "closed" };
    }
    if (drained.kind === "stopped") {
      return { failure: drained.failure, kind: "failed" };
    }
    const pulled = await pullChanges({ client, landed, live, sql });
    if (pulled.kind !== "done") {
      return pulled;
    }
    const state = await runPlanAsync(sql, readSyncState());
    setStatus({ cursor: state.cursor, head: Math.max(status.head, state.head) });
    const bodies = await fetchBodies({
      client,
      focused: () => focused,
      landed,
      live,
      progress: (progress) => {
        setStatus({ bodies: progress });
      },
      sql,
    });
    if (bodies.kind !== "done") {
      return bodies;
    }
    return { kind: drained.kind === "more" ? "more" : "done" };
  };

  const sync = async (): Promise<void> => {
    if (closed || stopped) {
      return;
    }
    if (running !== null) {
      again = true;
      await running;
      return;
    }
    const passes = (async () => {
      setStatus({ syncing: true });
      let outcome: PassOutcome = { kind: "done" };
      try {
        do {
          again = false;
          outcome = await pass();
        } while ((outcome.kind === "more" || (outcome.kind === "done" && again)) && live());
      } catch (error) {
        // a fault of this device's (its database, a row it cannot read): said, and tried again
        // on the same doubling wait as a cloud that did not answer
        outcome = {
          failure: {
            kind: "fault",
            message: error instanceof Error ? error.message : String(error),
          },
          kind: "failed",
        };
      } finally {
        running = null;
        setStatus({ syncing: false });
      }
      if (outcome.kind !== "failed") {
        failures = 0;
        cancelRetry?.();
        cancelRetry = null;
        if (outcome.kind !== "closed") {
          setStatus({ failure: null });
        }
        return;
      }
      setStatus({ failure: outcome.failure });
      if (outcome.failure.kind === "session") {
        // the host answers it (a sign-out wipes the replica); nothing runs until it starts again
        stopped = true;
        socket?.close();
        return;
      }
      failures += 1;
      cancelRetry?.();
      cancelRetry = clock.after(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1)), () => {
        cancelRetry = null;
        if (active) {
          void sync();
        }
      });
    })();
    running = passes;
    await passes;
  };

  const kick = (): void => {
    if (active) {
      void sync();
    }
  };

  const onFrame = (frame: LibrarySocketFrame): void => {
    if (frame.type === "library") {
      if (frame.head > status.cursor) {
        setStatus({ head: Math.max(status.head, frame.head) });
        kick();
      }
      return;
    }
    for (const listener of threadListeners) {
      listener(frame);
    }
    if (!frame.preview) {
      kick();
    }
  };

  socket =
    deps.dial === null
      ? null
      : createSocketHint({
          clock,
          dial: deps.dial,
          onFrame,
          onOpen: kick,
          origin: transport.origin,
          ticket: async () => {
            const [error, answer] = await safe(client.account.socketTicket());
            return error === null ? answer.ticket : null;
          },
        });

  const checkIn = (): void => {
    cancelCheckIn?.();
    cancelCheckIn = clock.after(CHECK_IN_MS, () => {
      cancelCheckIn = null;
      if (!active) {
        return;
      }
      if (!stopped) {
        socket?.connect();
      }
      kick();
      checkIn();
    });
  };

  const halt = (): void => {
    active = false;
    socket?.close();
    cancelCheckIn?.();
    cancelCheckIn = null;
    cancelRetry?.();
    cancelRetry = null;
  };

  const goOn = (): void => {
    if (closed) {
      return;
    }
    active = true;
    stopped = false;
    socket?.connect();
    checkIn();
    void sync();
  };

  const close = async (): Promise<void> => {
    halt();
    closed = true;
    await running;
  };

  const commands = createCommands({
    clock,
    newId: deps.newId,
    outbox,
    queued: kick,
    sql,
  });

  const replica: LibraryReplica = {
    ...commands,

    annotations: async (itemId) =>
      await runPlanAsync(
        sql,
        readReplicaAnnotations(
          itemId,
          rowsNaming(outbox.rows(), itemId),
          Math.floor(clock.now() / 1000),
        ),
      ),

    close,

    discard: async (seq) => {
      await outbox.discard(seq);
    },

    focus: (itemId) => {
      focused = itemId;
      if (itemId === null) {
        return;
      }
      void (async () => {
        try {
          const item = await runPlanAsync(sql, readReplicaItem(itemId, []));
          if (item !== null && !item.bodyHeld) {
            kick();
          }
        } catch {
          // a read the replica cannot make now; the next pass fetches the body all the same
        }
      })();
    },

    folders: () => folders,

    item: async (itemId) =>
      await runPlanAsync(sql, readReplicaItem(itemId, rowsNaming(outbox.rows(), itemId))),

    listing: (query) => index.items(query),

    onChange: (listener) => {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },

    onStatus: (listener) => {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },

    onThreadFrame: (listener) => {
      threadListeners.add(listener);
      return () => {
        threadListeners.delete(listener);
      };
    },

    resume: goOn,

    retry: async (seq) => {
      await outbox.retry(seq);
      kick();
    },

    row: (itemId) => rowsById.get(itemId) ?? null,

    scopes: () => index.scopes(),

    search: async (query, limit) => {
      const hits = await runPlanAsync(sql, searchLibrary(query, limit));
      return hits.filter((hit) => rowsById.get(hit.itemId)?.deletedAt === null);
    },

    start: goOn,

    status: () => status,

    suspend: halt,

    sync,

    threadEvents: async (threadId) => await runPlanAsync(sql, readThreadEvents(threadId)),

    threads: async () => await runPlanAsync(sql, readThreads()),

    wipe: async () => {
      await close();
      await outbox.wipe();
      await sql.exclusive(async (tx) => {
        await runPlanAsync(tx, wipeSynced(null));
      });
      await reading(async () => {
        await readAll(outbox.rows());
      });
      outboxStatus(outbox.rows());
      setStatus({ cursor: 0, head: 0 });
      const nothing = touchedNothing();
      emit({ ids: nothing.ids, kinds: nothing.kinds, overlapped: nothing.overlapped, reset: true });
    },
  };
  return { kind: "ready", replica };
};
