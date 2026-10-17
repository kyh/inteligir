// the stubs this Mac fills, and when. Its own saves and imports are filled at once; a phone's stub
// (one whose adding commit the Worker made) after a delay of up to a minute, shuffled by this data
// dir's seed so two Macs pick different moments; anyone else's after it has waited fifteen minutes.
// Two fills run at once, one per host, and one phone or foreign fill at a time, which syncs before
// it fetches (and drops a stub another device filled meanwhile) and commits and syncs after it
// writes. A transient failure tries again after 1, 10 and 60 minutes; the fourth is said in the file.

import { createHash } from "node:crypto";

import type { ItemFill } from "@repo/contract/local/items/items-schema";
import { isItemStub, itemFactsOf } from "@repo/notes/items/item-frontmatter";
import { urlHost } from "@repo/notes/items/item-url";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";

import type { KnowledgeRuntime } from "../../knowledge/knowledge-runtime";
import type { ItemCore } from "../item-core";
import type { CaptureClock } from "./capture-ports";
import type { FillOutcome, FillTarget } from "./fill-item";
import type { PendingFill, PendingFillsStore } from "./pending-fills-store";

const MINUTE = 60_000;
const RETRY_AFTER_MS = [MINUTE, 10 * MINUTE, 60 * MINUTE];
const FOREIGN_WAIT_MS = 15 * MINUTE;
const PHONE_SHUFFLE_MS = MINUTE;
const SYNC_COALESCE_MS = MINUTE;
const FILLS_AT_ONCE = 2;
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
  core: Pick<ItemCore, "read" | "creatorOf" | "syncNow" | "commitPaths">;
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
  debug: (line: string) => void;
}

export interface FillQueue {
  // an own row, due at once; a row for an id already held only gains `keepCopy`
  add: (row: {
    itemId: string;
    path: string;
    url: string;
    keepCopy: boolean;
    coverHint: string | null;
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

// how far past the first due row a pass looks for one it may start: one site's import thousands
// deep waits behind its own head rather than costing every pass a walk of the whole store
const SCAN_MAX = 256;

// a row placed before another: the sooner due, then the earlier seen, then by id
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
  // the rows' ids by when each comes due, then when it was first seen: the next fill is a prefix
  // read, never a sort of the whole store (an import holds thousands)
  const order: string[] = [];
  const running = new Map<string, { controller: AbortController; done: Promise<void> }>();
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

  // the first position whose row does not come before `row`
  const positionOf = (row: PendingFill): number => {
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

  const unorder = (itemId: string): void => {
    const at = order.indexOf(itemId);
    if (at !== -1) {
      order.splice(at, 1);
    }
  };

  // a row held, placed by when it comes due; a change that keeps its moment keeps its place
  const put = (row: PendingFill): void => {
    const held = rows.get(row.itemId);
    if (held !== undefined && held.notBefore === row.notBefore) {
      rows.set(row.itemId, row);
      return;
    }
    if (held !== undefined) {
      unorder(row.itemId);
    }
    rows.set(row.itemId, row);
    order.splice(positionOf(row), 0, row.itemId);
  };

  const forget = (itemId: string): void => {
    rows.delete(itemId);
    unorder(itemId);
    store.remove(itemId);
  };

  // the earliest due rows that may start now, by the concurrency rules
  const startable = (now: number): PendingFill[] => {
    const picked: PendingFill[] = [];
    const hosts = new Set(busyHosts);
    let elsewhere = elsewhereBusy;
    for (const [index, itemId] of order.entries()) {
      const row = rows.get(itemId);
      if (
        row === undefined ||
        row.notBefore > now ||
        index >= SCAN_MAX ||
        running.size + picked.length >= FILLS_AT_ONCE
      ) {
        break;
      }
      const isElsewhere = row.origin !== "own";
      if (running.has(itemId) || hosts.has(hostOf(row)) || (isElsewhere && elsewhere)) {
        continue;
      }
      hosts.add(hostOf(row));
      elsewhere ||= isElsewhere;
      picked.push(row);
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

  const runRow = async (row: PendingFill, controller: AbortController): Promise<void> => {
    const elsewhere = row.origin !== "own";
    try {
      if (elsewhere) {
        await syncAround();
        const read = await deps.core.read(row.path);
        if (read === null || !isItemStub(itemFactsOf(read.content))) {
          settle(row, { kind: "dropped", path: read === null ? null : row.path, wrote: [] });
          return;
        }
      }
      const outcome = await deps.fillRow(
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
      settle(rows.get(row.itemId) ?? row, outcome);
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
    let high = order.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const at = rows.get(order[middle] ?? "");
      if (at !== undefined && at.notBefore <= now) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return rows.get(order[low] ?? "")?.notBefore ?? null;
  };

  // a row's fill, holding its host and (for a phone's or another Mac's) the one elsewhere slot
  const start = (row: PendingFill, then: () => void): void => {
    const controller = new AbortController();
    const host = hostOf(row);
    const elsewhere = row.origin !== "own";
    busyHosts.add(host);
    elsewhereBusy ||= elsewhere;
    const done = (async () => {
      try {
        await runRow(row, controller);
      } finally {
        running.delete(row.itemId);
        busyHosts.delete(host);
        if (elsewhere) {
          elsewhereBusy = false;
        }
        then();
      }
    })();
    running.set(row.itemId, { controller, done });
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

  // a stub with no row gains one: a phone's within a minute, anyone else's after fifteen
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
    for (const path of stubs) {
      if (!known.has(path)) {
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
        origin: "own",
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
