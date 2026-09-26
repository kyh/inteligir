import type { CloudResult } from "@repo/api/cloud/client";
import type { CreateDispatchResponse } from "@repo/api/cloud/dispatch/dispatch-schema";
import { planPage } from "@repo/api/cloud/sync/plan-page";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SqlDriver } from "../../lib/sql-driver";
import { openTempDb, tempDbPath } from "../../notes/__tests__/phone-storage";
import { createFakeCloud, logRow } from "../../sync/__tests__/fakes";
import { createMemorySyncStore } from "../../sync/memory-sync-store";
import { createSyncRuntime } from "../../sync/sync-runtime";
import type { SyncStore } from "../../sync/sync-store";
import { applyPlan } from "../../sync/thread-log";
import { projectThread } from "../../sync/thread-projection";
import { dispatchCaption, threadDispatches, threadListEntries } from "../dispatch-projection";
import { createDispatchRuntime, DISPATCH_STATUS_POLL_MS } from "../dispatch-runtime";
import type { DispatchView } from "../dispatch-runtime";
import { createFakeInbox } from "./fake-inbox";
import type { FakeInbox } from "./fake-inbox";

const CRED = { credential: `igd_${"a".repeat(64)}`, deviceId: "dev_phone" };
const OTHER_CRED = { credential: `igd_${"b".repeat(64)}`, deviceId: "dev_phone_2" };
const MAC = "dev_mac";
const OWN = new Set([CRED.deviceId]);
const NOTE = "notes/plan.md";
const REVISION = "c".repeat(64);

afterEach(() => {
  vi.useRealTimers();
});

const rowsIn = async (db: SqlDriver): Promise<number> => {
  const [row] = await db.all("SELECT count(*) AS n FROM dispatch_outbox");
  return z.object({ n: z.number() }).parse(row).n;
};

// one phone: the sync runtime whose session every request rides, and the dispatch runtime over it.
// `restored` is a relaunch over what the database already holds.
const phoneOver = (
  inbox: FakeInbox,
  db: SqlDriver,
  options: { source?: "signed-in" | "restored"; firstId?: number } = {},
) => {
  const store = createMemorySyncStore();
  const cloud = createFakeCloud(inbox.client);
  const sync = createSyncRuntime({
    cloudUrl: "https://cloud.test",
    createClient: () => cloud.client,
    pollIntervalMs: null,
    store,
  });
  sync.setCredential(CRED);
  let minted = options.firstId ?? 0;
  const pulls = { count: 0 };
  const dispatch = createDispatchRuntime({
    db,
    mintId: () => {
      minted += 1;
      return minted.toString(16).padStart(32, "0");
    },
    pollIntervalMs: null,
    pull: () => {
      pulls.count += 1;
    },
    session: sync.session,
    threads: store,
  });
  dispatch.reset(options.source ?? "signed-in");
  return { dispatch, pulls, store, sync };
};

const only = (dispatches: readonly DispatchView[]): DispatchView => {
  const [first, ...rest] = dispatches;
  if (first === undefined || rest.length > 0) {
    throw new Error(`expected one request, the phone holds ${String(dispatches.length)}`);
  }
  return first;
};

const idOf = (outcome: { ok: true; id: string } | { ok: false; message: string }): string => {
  if (!outcome.ok) {
    throw new Error(outcome.message);
  }
  return outcome.id;
};

// the Mac took the phone's request into the thread and started a turn on it, and the phone pulled
const pullMacRequest = (
  store: SyncStore,
  args: { threadId: string; text: string; dispatchId: string },
): void => {
  const request: ThreadEvent = {
    dispatchId: args.dispatchId,
    scope: threadScope(),
    text: args.text,
    threadId: args.threadId,
    type: "client/turn/requested",
  };
  const started: ThreadEvent = {
    scope: turnScope("turn_1"),
    threadId: args.threadId,
    type: "turn/started",
  };
  applyPlan(
    store,
    planPage(
      [
        logRow({ deviceId: MAC, deviceSeq: 0, event: request, seq: 1 }),
        logRow({ deviceId: MAC, deviceSeq: 1, event: started, seq: 2 }),
      ],
      OWN,
    ).steps,
  );
};

describe("the phone's requests to a Mac", () => {
  it("keeps a request the cloud never answered and resends it under the SAME id after a relaunch", async () => {
    const file = tempDbPath();
    const inbox = createFakeInbox();
    inbox.network = "drops-answers";
    const first = phoneOver(inbox, openTempDb(file));

    const id = idOf(
      await first.dispatch.askAgent({ text: "summarize my week", threadId: "thr_a" }),
    );
    await first.dispatch.sendNow();
    expect(only(first.dispatch.get().dispatches).phase).toMatchObject({ kind: "unsent" });
    expect(dispatchCaption(only(first.dispatch.get().dispatches).phase, null)).toBe(
      "Not sent yet — retrying",
    );

    inbox.network = "up";
    const relaunched = phoneOver(inbox, openTempDb(file), { firstId: 100, source: "restored" });
    await relaunched.dispatch.sendNow();

    expect(new Set(inbox.creates.map((request) => request.id))).toStrictEqual(new Set([id]));
    expect(inbox.rows.size).toBe(1);
    expect(only(relaunched.dispatch.get().dispatches)).toMatchObject({
      id,
      phase: { kind: "waiting" },
      text: "summarize my week",
    });
  });

  it("attaches a new thread to the note it was asked from, and lists it before any Mac has it", async () => {
    const inbox = createFakeInbox();
    const { dispatch } = phoneOver(inbox, openTempDb());

    const id = idOf(
      await dispatch.askAgent({
        note: { path: NOTE, revision: REVISION },
        text: "Draft the plan\nwith three steps",
        threadId: "thr_new",
      }),
    );
    await dispatch.sendNow();

    expect(inbox.creates).toStrictEqual([
      {
        id,
        kind: "turn",
        originDocPath: NOTE,
        text: "Draft the plan\nwith three steps",
        threadId: "thr_new",
        viewContext: { resource: NOTE, revision: REVISION, surface: "doc" },
      },
    ]);
    expect(threadListEntries([], dispatch.get())).toStrictEqual([
      { caption: "Waiting for your Mac…", threadId: "thr_new", title: "Draft the plan" },
    ]);
  });

  it("hands a pending message to the log: gone once a pulled request carries its id, and never drawn twice", async () => {
    const inbox = createFakeInbox();
    const db = openTempDb();
    const { dispatch, pulls, store } = phoneOver(inbox, db);
    const id = idOf(await dispatch.askAgent({ text: "what changed?", threadId: "thr_a" }));
    await dispatch.sendNow();

    inbox.deliver(id);
    await dispatch.sendNow();
    expect(only(dispatch.get().dispatches).phase).toStrictEqual({ kind: "delivered" });
    expect(pulls.count).toBeGreaterThan(0);

    pullMacRequest(store, { dispatchId: id, text: "what changed?", threadId: "thr_a" });
    // drawn in the same render the pull landed in, before the runtime's delete commits
    const held = store.snapshotThread("thr_a");
    const thread = held === null ? null : projectThread(held);
    expect(thread?.items.filter((item) => item.kind === "user")).toHaveLength(1);
    expect(threadDispatches("thr_a", thread, dispatch.get()).pending).toStrictEqual([]);

    await vi.waitFor(async () => {
      expect(dispatch.get().dispatches).toStrictEqual([]);
      expect(await rowsIn(db)).toBe(0);
    });
  });

  it("says where each request stands, in the words the phone shows", async () => {
    const inbox = createFakeInbox();
    inbox.desktopsOnline = 0;
    const { dispatch } = phoneOver(inbox, openTempDb());
    const id = idOf(await dispatch.askAgent({ text: "tidy my inbox", threadId: "thr_a" }));
    await dispatch.sendNow();
    const caption = (): string => {
      const { desktopsOnline, pending } = threadDispatches("thr_a", null, dispatch.get());
      const [shown] = pending;
      return shown === undefined ? "" : dispatchCaption(shown.phase, desktopsOnline);
    };

    expect(caption()).toBe("Waiting for your Mac — open inteligir on it to run this");

    inbox.desktopsOnline = 1;
    await dispatch.sendNow();
    expect(caption()).toBe("Waiting for your Mac…");

    inbox.claim(id);
    await dispatch.sendNow();
    expect(caption()).toBe("Your Mac has it");

    inbox.deliver(id);
    await dispatch.sendNow();
    expect(caption()).toBe("Your Mac has it");

    expect(dispatchCaption({ error: "offline", kind: "unsent" }, 1)).toBe(
      "Not sent yet — retrying",
    );
    expect(dispatchCaption({ kind: "waiting" }, null)).toBe("Waiting for your Mac…");
    expect(dispatchCaption({ kind: "refused", message: "This thread is archived." }, 1)).toBe(
      "This thread is archived.",
    );
  });

  it("cancels a request no Mac holds, and one a Mac has keeps going as 'Your Mac has it'", async () => {
    const inbox = createFakeInbox();
    const db = openTempDb();
    const { dispatch } = phoneOver(inbox, db);
    const unclaimed = idOf(await dispatch.askAgent({ text: "first", threadId: "thr_a" }));
    const claimed = idOf(await dispatch.askAgent({ text: "second", threadId: "thr_a" }));
    await dispatch.sendNow();
    inbox.claim(claimed);

    expect(await dispatch.cancel(unclaimed)).toStrictEqual({ ok: true });
    expect(await dispatch.cancel(claimed)).toStrictEqual({ ok: true });

    expect(inbox.rows.has(unclaimed)).toBe(false);
    const left = only(dispatch.get().dispatches);
    expect(left).toMatchObject({ id: claimed, phase: { kind: "claimed" } });
    expect(dispatchCaption(left.phase, 1)).toBe("Your Mac has it");
    expect(await rowsIn(db)).toBe(1);
  });

  it("keeps a refused request's words, and the Mac's reason, until it is dismissed", async () => {
    const inbox = createFakeInbox();
    const db = openTempDb();
    const { dispatch } = phoneOver(inbox, db);
    const id = idOf(await dispatch.askAgent({ text: "rename every note", threadId: "thr_a" }));
    await dispatch.sendNow();

    inbox.refuse(id, "This thread is archived.");
    await dispatch.sendNow();

    expect(only(dispatch.get().dispatches)).toMatchObject({
      phase: { kind: "refused", message: "This thread is archived." },
      text: "rename every note",
    });
    expect(await rowsIn(db)).toBe(1);

    await dispatch.dismiss(id);
    expect(dispatch.get().dispatches).toStrictEqual([]);
    expect(await rowsIn(db)).toBe(0);
  });

  it("counts what a sign-out would lose: a request unsent or waiting, never one a Mac holds", async () => {
    const inbox = createFakeInbox();
    const { dispatch } = phoneOver(inbox, openTempDb());
    const waiting = idOf(await dispatch.askAgent({ text: "first", threadId: "thr_a" }));
    const claimed = idOf(await dispatch.askAgent({ text: "second", threadId: "thr_a" }));
    const refused = idOf(await dispatch.askAgent({ text: "third", threadId: "thr_a" }));
    expect(await dispatch.unclaimedCount()).toBe(3);

    await dispatch.sendNow();
    inbox.claim(claimed);
    inbox.refuse(refused, "This thread is archived.");
    await dispatch.sendNow();

    expect(dispatch.get().dispatches.map((view) => [view.id, view.phase.kind])).toStrictEqual([
      [waiting, "waiting"],
      [claimed, "claimed"],
      [refused, "refused"],
    ]);
    expect(await dispatch.unclaimedCount()).toBe(1);
  });

  it("empties the outbox when the phone signs out", async () => {
    const inbox = createFakeInbox();
    inbox.network = "down";
    const db = openTempDb();
    const { dispatch, sync } = phoneOver(inbox, db);
    await dispatch.askAgent({ text: "asked offline", threadId: "thr_a" });
    expect(await rowsIn(db)).toBe(1);

    sync.setCredential(null);
    dispatch.reset(null);

    expect(dispatch.get().dispatches).toStrictEqual([]);
    await vi.waitFor(async () => {
      expect(await rowsIn(db)).toBe(0);
    });
  });

  it("does not let a refusal heard under an earlier sign-in end the one that replaced it", async () => {
    const inbox = createFakeInbox();
    const releases: ((answer: CloudResult<CreateDispatchResponse>) => void)[] = [];
    // oxlint-disable-next-line promise/avoid-new -- a deferred: the test answers the create by hand, after the sign-in changed under it
    inbox.hold = new Promise((resolve) => {
      releases.push(resolve);
    });
    const { dispatch, sync } = phoneOver(inbox, openTempDb());
    await dispatch.askAgent({ text: "under the first sign-in", threadId: "thr_a" });
    await vi.waitFor(() => {
      expect(inbox.creates).toHaveLength(1);
    });

    sync.setCredential(OTHER_CRED);
    dispatch.reset("signed-in");
    releases.shift()?.({
      failure: { code: "unauthorized", deviceSeq: null, kind: "refused", message: "revoked" },
      ok: false,
    });
    await dispatch.sendNow();

    expect(sync.get()).toMatchObject({ deviceId: OTHER_CRED.deviceId, state: "signed-in" });
    expect(dispatch.get().dispatches).toStrictEqual([]);
  });

  it("answers a Mac's question about a phone-started turn through the same inbox", async () => {
    const inbox = createFakeInbox();
    const { dispatch } = phoneOver(inbox, openTempDb());
    const approvalId = "a".repeat(32);
    inbox.openApproval({
      createdAt: 1,
      id: approvalId,
      payload: {
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
        kind: "approval",
        reason: "to list the folder",
        subject: { command: "ls notes", cwd: null, itemId: "item_1", kind: "command" },
      },
      state: "open",
      threadId: "thr_a",
      turnId: "turn_1",
    });
    await dispatch.sendNow();

    const [asked] = threadDispatches("thr_a", null, dispatch.get()).approvals;
    expect(asked).toMatchObject({
      answer: null,
      code: true,
      decisions: ["allow_once", "allow_for_session", "deny"],
      reason: "to list the folder",
      summary: "ls notes",
    });

    const id = idOf(await dispatch.answer(approvalId, "allow_once"));
    await dispatch.sendNow();
    expect(inbox.rows.get(id)?.request).toStrictEqual({
      approvalId,
      decision: "allow_once",
      id,
      kind: "answer",
    });
    const [answering] = threadDispatches("thr_a", null, dispatch.get()).approvals;
    expect(answering?.answer?.phase).toStrictEqual({ kind: "waiting" });

    inbox.deliver(id);
    await dispatch.sendNow();
    expect(dispatch.get().dispatches).toStrictEqual([]);
    expect(threadDispatches("thr_a", null, dispatch.get()).approvals).toStrictEqual([]);
  });

  it("polls while a request waits and the app is in the foreground, and asks nothing otherwise", async () => {
    vi.useFakeTimers();
    const inbox = createFakeInbox();
    const store = createMemorySyncStore();
    const cloud = createFakeCloud(inbox.client);
    const sync = createSyncRuntime({
      cloudUrl: "https://cloud.test",
      createClient: () => cloud.client,
      pollIntervalMs: null,
      store,
    });
    sync.setCredential(CRED);
    const statusPolls = { count: 0 };
    const { dispatchStatus } = inbox.client;
    const dispatch = createDispatchRuntime({
      db: openTempDb(),
      mintId: () => "1".repeat(32),
      pull: () => {},
      session: {
        ...sync.session,
        current: () => {
          const current = sync.session.current();
          return current.kind === "live"
            ? {
                ...current,
                client: {
                  ...current.client,
                  dispatchStatus: async (ids) => {
                    statusPolls.count += 1;
                    if (dispatchStatus === undefined) {
                      throw new Error("the inbox answers status");
                    }
                    return await dispatchStatus(ids);
                  },
                },
              }
            : current;
        },
      },
      threads: store,
    });
    dispatch.reset("signed-in");
    const id = idOf(await dispatch.askAgent({ text: "waiting", threadId: "thr_a" }));
    await vi.waitFor(() => {
      expect(only(dispatch.get().dispatches).phase).toStrictEqual({ kind: "waiting" });
    });
    const before = statusPolls.count;

    await vi.advanceTimersByTimeAsync(DISPATCH_STATUS_POLL_MS);
    expect(statusPolls.count).toBe(before + 1);

    dispatch.suspend();
    await vi.advanceTimersByTimeAsync(DISPATCH_STATUS_POLL_MS * 3);
    expect(statusPolls.count).toBe(before + 1);

    dispatch.resume();
    await vi.waitFor(() => {
      expect(statusPolls.count).toBe(before + 2);
    });
    inbox.refuse(id, "No.");
    await vi.advanceTimersByTimeAsync(DISPATCH_STATUS_POLL_MS);
    const settledAt = statusPolls.count;
    await vi.advanceTimersByTimeAsync(DISPATCH_STATUS_POLL_MS * 3);
    expect(statusPolls.count).toBe(settledAt);
  });
});
