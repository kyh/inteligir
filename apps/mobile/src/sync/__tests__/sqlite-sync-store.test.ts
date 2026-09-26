import type { CloudResult } from "@repo/api/cloud/client";
import { planPage } from "@repo/api/cloud/sync/plan-page";
import type { PullResponse } from "@repo/api/cloud/sync/sync-schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { SqlDriver } from "../../lib/sql-driver";
import { openSyncStore, openTempDb, tempDbPath } from "../../notes/__tests__/phone-storage";
import { createSyncRuntime } from "../sync-runtime";
import type { SyncStore } from "../sync-store";
import { agentDelta, agentMessage, createFakeCloud, logRow, ok, userRequest } from "./fakes";

const CRED = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_self" };
const OTHER = "dev_other";
const OWN = new Set([CRED.deviceId]);

// a request, its streamed answer and the answer itself: two held events, four rows of cursor
const conversation = () => [
  logRow({ deviceId: OTHER, deviceSeq: 0, event: userRequest("thr_x", "hi"), seq: 1 }),
  logRow({ deviceId: OTHER, deviceSeq: 1, event: agentDelta("thr_x", "t1", "m1", "hel"), seq: 2 }),
  logRow({
    deviceId: OTHER,
    deviceSeq: 2,
    event: agentMessage("thr_x", "t1", "m1", "hello"),
    seq: 3,
  }),
  logRow({ deviceId: OTHER, deviceSeq: 3, event: agentDelta("thr_x", "t2", "m2", "…"), seq: 4 }),
];

const page = (): CloudResult<PullResponse> =>
  ok({ events: conversation(), hasMore: false, lastSeq: 4 });

// one launch's sync runtime over a store, and the cursor each of its pulls asked after
const launch = (store: SyncStore, pages: CloudResult<PullResponse>[] = []) => {
  const pulledAfter: number[] = [];
  const cloud = createFakeCloud({
    pull: async (query) => {
      pulledAfter.push(query.afterSeq);
      return pages.shift() ?? ok({ events: [], hasMore: false, lastSeq: query.afterSeq });
    },
  });
  const runtime = createSyncRuntime({
    cloudUrl: "https://cloud.test",
    createClient: () => cloud.client,
    pollIntervalMs: null,
    store,
  });
  runtime.setCredential(CRED);
  return { pulledAfter, runtime };
};

const heldEvents = async (db: SqlDriver): Promise<number> => {
  const [row] = await db.all("SELECT count(*) AS n FROM thread_events");
  return z.object({ n: z.number() }).parse(row).n;
};

// the SQL port with the cursor's write refused, as a full disk would refuse it partway through a page
const refusingCursor = (db: SqlDriver): SqlDriver => ({
  ...db,
  exclusive: async (work) => {
    await db.exclusive(async (tx) => {
      await work({
        ...tx,
        run: async (sql, params) => {
          if (sql.includes("thread_sync")) {
            throw new Error("disk full");
          }
          await tx.run(sql, params);
        },
      });
    });
  },
});

describe("the synced threads on disk", () => {
  it("serves a relaunch what the last one held, and pulls on from its cursor, not 0", async () => {
    const file = tempDbPath();
    const first = openSyncStore(openTempDb(file));
    await first.reset("signed-in");
    const firstLaunch = launch(first, [page()]);
    await firstLaunch.runtime.syncNow();
    expect(firstLaunch.pulledAfter).toEqual([0]);

    const relaunched = openSyncStore(openTempDb(file));
    await relaunched.reset("restored");

    expect(relaunched.readCursor()).toBe(4);
    expect(relaunched.snapshotThreads()).toStrictEqual(first.snapshotThreads());
    expect(relaunched.snapshotThread("thr_x")).toMatchObject({ lastSeq: 4 });
    const secondLaunch = launch(relaunched);
    await secondLaunch.runtime.syncNow();
    expect(secondLaunch.pulledAfter).toEqual([4]);
  });

  it("leaves the cursor and the rows where they were when a page's transaction fails", async () => {
    const file = tempDbPath();
    const db = openTempDb(file);
    const store = openSyncStore(refusingCursor(db));
    await store.reset("signed-in");

    await expect(store.applyPlan(planPage(conversation(), OWN).steps)).rejects.toThrow("disk full");

    expect(store.readCursor()).toBe(0);
    expect(store.snapshotThreads()).toStrictEqual([]);
    expect(await heldEvents(db)).toBe(0);
    const relaunched = openSyncStore(openTempDb(file));
    await relaunched.reset("restored");
    expect(relaunched.readCursor()).toBe(0);
  });

  it("pulls the log again from its first row when another grammar parsed what it holds", async () => {
    const file = tempDbPath();
    const first = openSyncStore(openTempDb(file));
    await first.reset("signed-in");
    await launch(first, [page()]).runtime.syncNow();
    const db = openTempDb(file);
    await db.run("UPDATE thread_sync SET grammar = ?", ["an older build's grammar"]);

    const relaunched = openSyncStore(db);
    await relaunched.reset("restored");

    expect(relaunched.readCursor()).toBe(0);
    expect(relaunched.snapshotThreads()).toStrictEqual([]);
    expect(await heldEvents(db)).toBe(0);
    const again = launch(relaunched, [page()]);
    await again.runtime.syncNow();
    expect(again.pulledAfter).toEqual([0]);
    expect(relaunched.snapshotThread("thr_x")?.events).toHaveLength(2);
    expect(relaunched.readCursor()).toBe(4);
  });

  it("starts over from the log's first row when a held event cannot be read", async () => {
    const file = tempDbPath();
    const first = openSyncStore(openTempDb(file));
    await first.reset("signed-in");
    await launch(first, [page()]).runtime.syncNow();
    const db = openTempDb(file);
    await db.run("UPDATE thread_events SET event = ? WHERE seq = 1", ['{"type":"nope"}']);

    const relaunched = openSyncStore(db);
    await relaunched.reset("restored");

    expect(relaunched.readCursor()).toBe(0);
    expect(relaunched.snapshotThreads()).toStrictEqual([]);
    expect(await heldEvents(db)).toBe(0);
  });

  it("never lands a page that started before a sign-out", async () => {
    const db = openTempDb();
    const store = openSyncStore(db);
    await store.reset("signed-in");

    const applying = store.applyPlan(planPage(conversation(), OWN).steps);
    const signingOut = store.reset(null);
    await Promise.all([applying, signingOut]);

    expect(store.readCursor()).toBe(0);
    expect(store.snapshotThreads()).toStrictEqual([]);
    expect(await heldEvents(db)).toBe(0);
  });
});
