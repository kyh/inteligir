// the stubs this Mac fills, and when. Its own saves and imports are filled at once; in a library
// that syncs with the account's hosted vault, a phone's stub (one whose adding commit the Worker
// made) after a delay of up to a minute, shuffled by this data dir's seed so two Macs pick
// different moments, and another device's after it has waited fifteen minutes; a library that
// syncs anywhere else fills only what this Mac saved. Two fills run at once, one per host, and one
// phone or foreign fill at a time, which syncs before it fetches (and drops a stub another device
// filled meanwhile) and commits and syncs after it writes. A save and a phone's share go ahead of
// an import and another device's stubs, so a save made during an import is filled at once. A
// transient failure tries again after 1, 10 and 60 minutes; the fourth is said in the file. A fill
// still running after five minutes is stopped and tried again on that same schedule.

import { createHash } from "node:crypto";

import type { ItemFill } from "@repo/contract/local/items/items-schema";
import { isItemStub, itemFactsOf } from "@repo/notes/items/item-frontmatter";
import { urlHost } from "@repo/notes/items/item-url";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";

import type { KnowledgeRuntime } from "../../knowledge/knowledge-runtime";
import type { ItemCore } from "../item-core";
import type { CaptureClock } from "./capture-ports";
import type { FillOutcome, FillTarget } from "./fill-item";
import type { FillOrigin, PendingFill, PendingFillsStore } from "./pending-fills-store";

const MINUTE = 60_000;
const RETRY_AFTER_MS = [MINUTE, 10 * MINUTE, 60 * MINUTE];
const FOREIGN_WAIT_MS = 15 * MINUTE;
const PHONE_SHUFFLE_MS = MINUTE;
const SYNC_COALESCE_MS = MINUTE;
const FILLS_AT_ONCE = 2;
// one fill's whole time: past it the fill is aborted and the row tried again later, so a dial that
// never ends cannot hold a slot for the life of the process
const ROW_DEADLINE_MS = 5 * MINUTE;
// a cheap pass over the index's stubs for ones this Mac has no row for, and a full one that also
// drops the rows whose stub stopped being one
const SWEEP_POLL_MS = 10_000;
const FULL_SWEEP_MS = 5 * MINUTE;

// what one fill of a row ended as, handed to the saves waiting on it
interface FillDone {
  path: string;
  fill: ItemFill;
  wrote: string[];
}

export interface FillQueueDeps {
  store: PendingFillsStore;
  core: Pick<ItemCore, "read" | "creatorOf" | "syncsWithAccount" | "syncNow" | "commitPaths">;
  knowledge: Pick<KnowledgeRuntime, "itemStubs" | "pathForNoteId">;
  clock: CaptureClock;
  // the fill itself, with the target the queue built from the row
  fillRow: (
    target: Omit<FillTarget, "signal" | "onMoved" | "text">,
    signal: AbortSignal,
    onMoved: (path: string) => void,
  ) => Promise<FillOutcome>;
  // the page a browser handed over for a row, consumed by its fill
  takeSupplied: (itemId: string) => { html: string; at: number } | null;
  // a copy of the page asked for while the row's fill was already under way without one: a
  // keep-copy refresh of the item that fill wrote, run before the row's waiters are answered
  copyAfter: (
    row: { itemId: string; path: string; url: string },
    signal: AbortSignal,
  ) => Promise<FillOutcome>;
  debug: (line: string) => void;
}

export interface FillQueue {
  // a row of this Mac's own, a save's or the import's, due at once; a row for an id already held
  // only gains `keepCopy`, made after its fill when that fill is already under way without it
  add: (row: {
    itemId: string;
    path: string;
    url: string;
    keepCopy: boolean;
    coverHint: string | null;
    origin: Extract<FillOrigin, "own" | "import">;
  }) => void;
  has: (itemId: string) => boolean;
  // resolves with the row's first fill that ended (written, dropped, or put off by a transient
  // failure), or null after `ms`
  waitFor: (itemId: string, ms: number) => Promise<FillDone | null>;
  boot: () => void;
  dispose: () => Promise<void>;
}

// a row's host, read once per url: the queue asks it on every pass over its head
const HOSTS = new Map<string, string>();
const HOSTS_REMEMBERED = 50_000;
const hostOf = (row: PendingFill): string => {
  const known = HOSTS.get(row.url);
  if (known !== undefined) {
    return known;
  }
  const host = urlHost(row.url) ?? row.url;
  if (HOSTS.size >= HOSTS_REMEMBERED) {
    HOSTS.clear();
  }
  HOSTS.set(row.url, host);
  return host;
};

// a phone's or another device's row, which syncs around its fill and holds the one elsewhere slot
const isElsewhere = (origin: FillOrigin): boolean => origin === "phone" || origin === "foreign";

// the two lanes a pass starts from, in turn: what the person is waiting on (a save, a phone's
// share) ahead of what runs in the background (an import, another device's stub)
type Lane = "interactive" | "background";
const laneOf = (origin: FillOrigin): Lane =>
  origin === "own" || origin === "phone" ? "interactive" : "background";

// a row placed before another in its lane: the sooner due, then the earlier seen, then by id
const comesBefore = (a: PendingFill, b: PendingFill): boolean => {
  if (a.notBefore === b.notBefore) {
    return a.firstSeenAt === b.firstSeenAt ? a.itemId < b.itemId : a.firstSeenAt < b.firstSeenAt;
  }
  return a.notBefore < b.notBefore;
};

interface Waiter {
  resolve: (done: FillDone | null) => void;
}

export const createFillQueue = (deps: FillQueueDeps): FillQueue => {
  const { store, clock } = deps;
  const rows = new Map<string, PendingFill>();
  // each lane's row ids by host, each host's by when each comes due, then when it was first seen:
  // only a host's first row may start, so a pass reads one row per host, never a walk of one
  // site's import thousands deep
  const lanes: Record<Lane, Map<string, string[]>> = {
    background: new Map(),
    interactive: new Map(),
  };
  const queueOf = (row: PendingFill): string[] | undefined =>
    lanes[laneOf(row.origin)].get(hostOf(row));
  // every row id in the same order across lanes and hosts: when the next one comes due is a
  // binary search, never a walk of the store
  const byTime: string[] = [];
  const running = new Map<
    string,
    { controller: AbortController; done: Promise<void>; keepCopy: boolean }
  >();
  // the running rows a copy of the page was asked for after their fill started without one
  const copyLater = new Set<string>();
  const waiters = new Map<string, Waiter[]>();
  const busyHosts = new Set<string>();
  let elsewhereBusy = false;
  let disposed = false;
  let cancelWake: (() => void) | null = null;
  let cancelPoll: (() => void) | null = null;
  let lastFullSweep = 0;
  let lastSyncAt: number | null = null;
  let syncing: Promise<void> | null = null;
  let seed: string | null = null;

  const shuffle = (path: string): number => {
    seed ??= store.shuffleSeed();
    const digest = createHash("sha256").update(`${seed}\n${path}`).digest();
    return digest.readUInt32BE(0) % (PHONE_SHUFFLE_MS + 1);
  };

  // one pass at most per minute across every fill that asks
  const syncAround = async (): Promise<void> => {
    if (syncing !== null) {
      await syncing;
      return;
    }
    if (lastSyncAt !== null && clock.now() - lastSyncAt < SYNC_COALESCE_MS) {
      return;
    }
    lastSyncAt = clock.now();
    syncing = deps.core.syncNow();
    try {
      await syncing;
    } finally {
      syncing = null;
    }
  };

  const answer = (itemId: string, done: FillDone | null): void => {
    const waiting = waiters.get(itemId) ?? [];
    waiters.delete(itemId);
    for (const waiter of waiting) {
      waiter.resolve(done);
    }
  };

  // the first position in an ordered list of ids whose row does not come before `row`
  const positionOf = (order: readonly string[], row: PendingFill): number => {
    let low = 0;
    let high = order.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const at = rows.get(order[middle] ?? "");
      if (at !== undefined && comesBefore(at, row)) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  };

  const unorder = (row: PendingFill): void => {
    const timed = byTime.indexOf(row.itemId);
    if (timed !== -1) {
      byTime.splice(timed, 1);
    }
    const order = queueOf(row);
    const at = order?.indexOf(row.itemId) ?? -1;
    if (order === undefined || at === -1) {
      return;
    }
    order.splice(at, 1);
    if (order.length === 0) {
      lanes[laneOf(row.origin)].delete(hostOf(row));
    }
  };

  // a row held, placed in its lane by when it comes due; a change that keeps its moment keeps its
  // place
  const put = (row: PendingFill): void => {
    const held = rows.get(row.itemId);
    if (held !== undefined && held.notBefore === row.notBefore && held.origin === row.origin) {
      rows.set(row.itemId, row);
      return;
    }
    if (held !== undefined) {
      unorder(held);
    }
    rows.set(row.itemId, row);
    const lane = lanes[laneOf(row.origin)];
    const order = lane.get(hostOf(row)) ?? [];
    lane.set(hostOf(row), order);
    order.splice(positionOf(order, row), 0, row.itemId);
    byTime.splice(positionOf(byTime, row), 0, row.itemId);
  };

  // each host's first row in a lane
  const headsOf = (lane: Lane): PendingFill[] =>
    [...lanes[lane].values()].flatMap((order) => {
      const head = rows.get(order[0] ?? "");
      return head === undefined ? [] : [head];
    });

  const forget = (itemId: string): void => {
    const held = rows.get(itemId);
    if (held !== undefined) {
      unorder(held);
    }
    rows.delete(itemId);
    copyLater.delete(itemId);
    // a page a browser handed over for the row is never read once the row is gone
    deps.takeSupplied(itemId);
    store.remove(itemId);
  };

  // the earliest due rows that may start now, by the concurrency rules: the interactive lane's
  // first, and in each lane the soonest due first among the hosts not busy, so one site's import
  // thousands deep never holds a free slot from every other site
  const startable = (now: number): PendingFill[] => {
    const picked: PendingFill[] = [];
    const hosts = new Set(busyHosts);
    let elsewhere = elsewhereBusy;
    for (const lane of ["interactive", "background"] as const) {
      if (running.size + picked.length >= FILLS_AT_ONCE) {
        break;
      }
      const due = headsOf(lane)
        .filter((row) => row.notBefore <= now && !hosts.has(hostOf(row)))
        .toSorted((a, b) => (comesBefore(a, b) ? -1 : 1));
      for (const row of due) {
        if (running.size + picked.length >= FILLS_AT_ONCE) {
          break;
        }
        const fromElsewhere = isElsewhere(row.origin);
        if (running.has(row.itemId) || hosts.has(hostOf(row)) || (fromElsewhere && elsewhere)) {
          continue;
        }
        hosts.add(hostOf(row));
        elsewhere ||= fromElsewhere;
        picked.push(row);
      }
    }
    return picked;
  };

  const settle = (row: PendingFill, outcome: FillOutcome): void => {
    switch (outcome.kind) {
      case "written": {
        forget(row.itemId);
        answer(row.itemId, { fill: outcome.fill, path: outcome.path, wrote: outcome.wrote });
        break;
      }
      case "dropped": {
        forget(row.itemId);
        answer(
          row.itemId,
          outcome.path === null
            ? null
            : { fill: { state: "pending" }, path: outcome.path, wrote: outcome.wrote },
        );
        break;
      }
      // never a row's own fill, whose stub was never read; settled as a drop that says why
      case "unread": {
        forget(row.itemId);
        answer(row.itemId, {
          fill: { message: outcome.message, state: "failed" },
          path: outcome.path,
          wrote: [],
        });
        break;
      }
      case "retry": {
        const attempts = row.attempts + 1;
        const notBefore =
          clock.now() + (RETRY_AFTER_MS[attempts - 1] ?? RETRY_AFTER_MS.at(-1) ?? MINUTE);
        put({ ...row, attempts, notBefore });
        store.reschedule(row.itemId, attempts, notBefore);
        answer(row.itemId, {
          fill: { state: "pending" },
          path: outcome.path,
          wrote: outcome.wrote,
        });
        break;
      }
      case "aborted": {
        break;
      }
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  };

  // the fill's outcome with the copy asked for while it ran, made from what it wrote
  const withCopyAfter = async (
    row: PendingFill,
    outcome: FillOutcome,
    signal: AbortSignal,
  ): Promise<FillOutcome> => {
    const asked = copyLater.delete(row.itemId);
    if (!asked || outcome.kind !== "written") {
      return outcome;
    }
    const copied = await deps.copyAfter(
      { itemId: row.itemId, path: outcome.path, url: row.url },
      signal,
    );
    if (copied.kind !== "written") {
      return outcome;
    }
    return { ...copied, wrote: [...outcome.wrote, ...copied.wrote] };
  };

  const runRow = async (
    row: PendingFill,
    controller: AbortController,
    overran: () => boolean,
  ): Promise<void> => {
    const elsewhere = isElsewhere(row.origin);
    try {
      if (elsewhere) {
        await syncAround();
        const read = await deps.core.read(row.path);
        // another device filled it first; a copy the person asked this Mac for is still made, from
        // the page their browser handed over, as a refresh would make it
        if (read !== null && !isItemStub(itemFactsOf(read.content))) {
          const current = rows.get(row.itemId) ?? row;
          const asked = copyLater.delete(row.itemId) || current.keepCopy;
          const copied = asked
            ? await deps.copyAfter(
                { itemId: row.itemId, path: current.path, url: row.url },
                controller.signal,
              )
            : null;
          settle(
            current,
            copied?.kind === "written"
              ? copied
              : { kind: "dropped", path: current.path, wrote: [] },
          );
          return;
        }
        // a library that stopped syncing with the account fills only what this Mac saved
        if (read === null || !(await deps.core.syncsWithAccount())) {
          settle(row, { kind: "dropped", path: read === null ? null : row.path, wrote: [] });
          return;
        }
      }
      const filled = await deps.fillRow(
        {
          coverHint: row.coverHint,
          itemId: row.itemId,
          keepCopy: row.keepCopy,
          // a transient failure retries up to three times; the fourth is said in the file
          mayRetry: row.attempts < RETRY_AFTER_MS.length,
          origin: row.origin,
          path: row.path,
          supplied: deps.takeSupplied(row.itemId),
          url: row.url,
        },
        controller.signal,
        (path) => {
          const current = rows.get(row.itemId);
          if (current !== undefined) {
            put({ ...current, path });
            store.setPath(row.itemId, path);
          }
        },
      );
      const copied = await withCopyAfter(row, filled, controller.signal);
      const current = rows.get(row.itemId) ?? row;
      // a fill the deadline stopped is put off like a transient failure
      const outcome: FillOutcome =
        copied.kind === "aborted" && overran()
          ? { kind: "retry", path: current.path, wrote: [] }
          : copied;
      settle(current, outcome);
      if (elsewhere && outcome.kind === "written") {
        await deps.core.commitPaths(outcome.wrote);
        lastSyncAt = null;
        await syncAround();
      }
    } catch (error) {
      deps.debug(
        `fill of ${row.path} failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
      settle(rows.get(row.itemId) ?? row, { kind: "retry", path: row.path, wrote: [] });
    }
  };

  // the soonest moment a row comes due after `now`, null when none waits: the first row past the
  // due prefix
  const nextDue = (now: number): number | null => {
    let low = 0;
    let high = byTime.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const at = rows.get(byTime[middle] ?? "");
      if (at !== undefined && at.notBefore <= now) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return rows.get(byTime[low] ?? "")?.notBefore ?? null;
  };

  // a row's fill, holding its host and (for a phone's or another Mac's) the one elsewhere slot
  const start = (row: PendingFill, then: () => void): void => {
    const controller = new AbortController();
    const host = hostOf(row);
    const elsewhere = isElsewhere(row.origin);
    busyHosts.add(host);
    elsewhereBusy ||= elsewhere;
    let overran = false;
    const cancelDeadline = clock.setTimer(ROW_DEADLINE_MS, () => {
      overran = true;
      controller.abort();
    });
    const done = (async () => {
      try {
        await runRow(row, controller, () => overran);
      } finally {
        cancelDeadline();
        running.delete(row.itemId);
        busyHosts.delete(host);
        if (elsewhere) {
          elsewhereBusy = false;
        }
        then();
      }
    })();
    running.set(row.itemId, { controller, done, keepCopy: row.keepCopy });
  };

  const pump = (): void => {
    if (disposed) {
      return;
    }
    const now = clock.now();
    for (const row of startable(now)) {
      start(row, pump);
    }
    const next = nextDue(now);
    if (next !== null) {
      cancelWake?.();
      cancelWake = clock.setTimer(next - now, () => {
        cancelWake = null;
        pump();
      });
    }
  };

  // a stub with no row gains one: a phone's within a minute, anyone else's after fifteen. Only a
  // library that syncs with the account adopts any (the sweep asks), so a folder's own link notes
  // shaped like stubs are never filled unasked
  const adopt = async (path: string, now: number): Promise<void> => {
    const read = await deps.core.read(path);
    if (read === null) {
      return;
    }
    const facts = itemFactsOf(read.content);
    const itemId = frontmatterId(read.content);
    if (!isItemStub(facts) || facts.url === null || itemId === null) {
      return;
    }
    const held = rows.get(itemId);
    if (held !== undefined) {
      if (held.path !== path && !running.has(itemId)) {
        put({ ...held, path });
        store.setPath(itemId, path);
      }
      return;
    }
    const phone = (await deps.core.creatorOf(path)) === "phone";
    const row: PendingFill = {
      attempts: 0,
      coverHint: null,
      firstSeenAt: now,
      itemId,
      keepCopy: false,
      notBefore: now + (phone ? shuffle(path) : FOREIGN_WAIT_MS),
      origin: phone ? "phone" : "foreign",
      path,
      url: facts.url,
    };
    put(row);
    store.insert(row);
  };

  // a row whose stub stopped being one (filled elsewhere, removed, edited into a note) goes
  const prune = async (stubs: ReadonlySet<string>): Promise<void> => {
    for (const row of rows.values()) {
      if (running.has(row.itemId) || stubs.has(row.path)) {
        continue;
      }
      const read = await deps.core.read(row.path);
      if (read !== null) {
        if (!isItemStub(itemFactsOf(read.content))) {
          forget(row.itemId);
        }
        continue;
      }
      const moved = await deps.knowledge.pathForNoteId(row.itemId, row.path);
      if (moved === null) {
        forget(row.itemId);
      } else {
        put({ ...row, path: moved });
        store.setPath(row.itemId, moved);
      }
    }
  };

  const sweep = async (): Promise<void> => {
    const now = clock.now();
    const stubs = await deps.knowledge.itemStubs();
    const known = new Set([...rows.values()].map((row) => row.path));
    const unknown = stubs.filter((path) => !known.has(path));
    if (unknown.length > 0 && (await deps.core.syncsWithAccount())) {
      for (const path of unknown) {
        await adopt(path, now);
      }
    }
    if (now - lastFullSweep >= FULL_SWEEP_MS) {
      lastFullSweep = now;
      await prune(new Set(stubs));
    }
    pump();
  };

  const poll = (): void => {
    cancelPoll = clock.setTimer(SWEEP_POLL_MS, () => {
      void (async () => {
        try {
          await sweep();
        } catch (error) {
          deps.debug(`sweep failed: ${error instanceof Error ? error.message : "unknown"}`);
        }
        if (!disposed) {
          poll();
        }
      })();
    });
  };

  return {
    add(row) {
      const held = rows.get(row.itemId);
      if (held !== undefined) {
        if (row.keepCopy && !held.keepCopy) {
          put({ ...held, keepCopy: true });
          store.setKeepCopy(row.itemId);
        }
        if (row.keepCopy && running.get(row.itemId)?.keepCopy === false) {
          copyLater.add(row.itemId);
        }
        // a copy the person asked for of another device's stub is read now rather than after that
        // device's wait, still syncing first, so a stub filled elsewhere is not filled twice
        const now = clock.now();
        const current = rows.get(row.itemId) ?? held;
        if (
          row.keepCopy &&
          isElsewhere(current.origin) &&
          !running.has(row.itemId) &&
          current.notBefore > now
        ) {
          put({ ...current, notBefore: now });
          store.reschedule(row.itemId, current.attempts, now);
          pump();
        }
        return;
      }
      const now = clock.now();
      const pending: PendingFill = {
        attempts: 0,
        coverHint: row.coverHint,
        firstSeenAt: now,
        itemId: row.itemId,
        keepCopy: row.keepCopy,
        notBefore: now,
        origin: row.origin,
        path: row.path,
        url: row.url,
      };
      put(pending);
      store.insert(pending);
      pump();
    },

    boot() {
      for (const row of store.all()) {
        put(row);
      }
      lastFullSweep = clock.now();
      pump();
      poll();
    },

    async dispose() {
      disposed = true;
      cancelWake?.();
      cancelPoll?.();
      for (const { controller } of running.values()) {
        controller.abort();
      }
      await Promise.all([...running.values()].map(async ({ done }) => await done));
      for (const itemId of waiters.keys()) {
        answer(itemId, null);
      }
    },

    has: (itemId) => rows.has(itemId),

    async waitFor(itemId, ms) {
      if (!rows.has(itemId)) {
        return await Promise.resolve(null);
      }
      const answered = Promise.withResolvers<FillDone | null>();
      const list = waiters.get(itemId) ?? [];
      list.push({ resolve: answered.resolve });
      waiters.set(itemId, list);
      const cancel = clock.setTimer(ms, () => {
        answered.resolve(null);
      });
      const done = await answered.promise;
      cancel();
      return done;
    },
  };
};
