// the stubs this Mac fills, and when: what it saved and what its import wrote, every one at once,
// since a stub another device made is that device's to fill. Two fills run at once, one per host,
// a save ahead of an import, so a save made during an import of thousands is filled at the next
// free slot. A transient failure tries again after 1, 10 and 60 minutes; the fourth is said in the
// file. A fill still running after five minutes is stopped and tried again on that same schedule.

import type { ItemFill } from "@repo/contract/local/items/items-schema";
import { urlHost } from "@repo/notes/items/item-url";

import type { CaptureClock } from "./capture-ports";
import type { FillOutcome, FillTarget } from "./fill-item";
import type { FillOrigin, PendingFill, PendingFillsStore } from "./pending-fills-store";

const MINUTE = 60_000;
const RETRY_AFTER_MS = [MINUTE, 10 * MINUTE, 60 * MINUTE];
const FILLS_AT_ONCE = 2;
// one fill's whole time: past it the fill is aborted and the row tried again later, so a dial that
// never ends cannot hold a slot for the life of the process
const ROW_DEADLINE_MS = 5 * MINUTE;

// what one fill of a row ended as, handed to the saves waiting on it
interface FillDone {
  path: string;
  fill: ItemFill;
  wrote: string[];
}

export interface FillQueueDeps {
  store: PendingFillsStore;
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
    origin: FillOrigin;
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

// the two lanes a pass starts from, in turn: what the person is waiting on (a save) ahead of what
// runs in the background (an import)
type Lane = "interactive" | "background";
const laneOf = (origin: FillOrigin): Lane => (origin === "own" ? "interactive" : "background");

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
  let disposed = false;
  let cancelWake: (() => void) | null = null;

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
        if (running.has(row.itemId) || hosts.has(hostOf(row))) {
          continue;
        }
        hosts.add(hostOf(row));
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
    try {
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

  // a row's fill, holding its host
  const start = (row: PendingFill, then: () => void): void => {
    const controller = new AbortController();
    const host = hostOf(row);
    busyHosts.add(host);
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
      pump();
    },

    async dispose() {
      disposed = true;
      cancelWake?.();
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
