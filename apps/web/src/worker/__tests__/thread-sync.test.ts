import { cloudErrorSchema } from "@repo/contract/cloud/errors";
import { pullResponseSchema, pushResponseSchema } from "@repo/contract/cloud/sync/sync-schema";
import type { PushRequest } from "@repo/contract/cloud/sync/sync-schema";
import { SYNC_WS_REVOKED_CLOSE_CODE } from "@repo/contract/cloud/sync/sync-ws";
import { runInDurableObject, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { threadSyncStub } from "../sync/routes";
import { SOCKET_IDENTITY_HEADERS } from "../sync/thread-sync-do";
import {
  awaitFrames,
  deviceHeaders,
  emitted,
  openSocket,
  ORIGIN,
  loginDevice,
  postSignOut,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "./cloud-helpers";

// what 0.4.0 sends beside its events: each titled thread's lane and title
interface StaleThreadMeta {
  lane: "any" | "desktop";
  threadId: string;
  title?: string;
  updatedAt: number;
}

const push = async (
  credential: string,
  body: PushRequest & { threads?: readonly StaleThreadMeta[] },
): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}/v1/sync/push`, {
    body: JSON.stringify(body),
    headers: { ...deviceHeaders(credential), "content-type": "application/json" },
    method: "POST",
  });

const pull = async (credential: string, afterSeq: number, limit?: number) => {
  const query =
    limit === undefined ? `afterSeq=${afterSeq}` : `afterSeq=${afterSeq}&limit=${limit}`;
  const response = await SELF.fetch(`${ORIGIN}/v1/sync/pull?${query}`, {
    headers: deviceHeaders(credential),
  });
  expect(response.status).toBe(200);
  return emitted(pullResponseSchema, await response.text());
};

const event = (
  threadId: string,
  deviceSeq: number,
  payload: string,
): PushRequest["events"][number] => ({
  createdAt: deviceSeq,
  deviceSeq,
  event: { payload, type: "test" },
  threadId,
});

describe("thread sync log", () => {
  it("pushes, pulls, and ignores a replayed outbox batch", async () => {
    const { bearer } = await signUpUser("sync-idem@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");

    const batch: PushRequest = { events: [event("th_1", 1, "a"), event("th_1", 2, "b")] };
    const pushed = await push(credential, batch);
    const first = emitted(pushResponseSchema, await pushed.text());
    expect(first).toEqual({ accepted: 2, duplicates: 0, lastSeq: 2 });

    const replayed = await push(credential, batch);
    const replay = emitted(pushResponseSchema, await replayed.text());
    expect(replay).toEqual({ accepted: 0, duplicates: 2, lastSeq: 2 });

    const page = await pull(credential, 0);
    expect(page.events.map((row) => row.deviceSeq)).toEqual([1, 2]);
    expect(page.events[0]?.event).toEqual({ payload: "a", type: "test" });
    expect(page.hasMore).toBe(false);
  });

  it("accepts a retry that appends to a partially-stored batch", async () => {
    const { bearer } = await signUpUser("sync-partial@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");

    await push(credential, { events: [event("th_1", 1, "a")] });
    const retried = await push(credential, {
      events: [event("th_1", 1, "a"), event("th_1", 2, "b")],
    });
    const retry = emitted(pushResponseSchema, await retried.text());
    expect(retry).toEqual({ accepted: 1, duplicates: 1, lastSeq: 2 });
  });

  it("refuses a stored position replayed with a DIFFERENT body, naming it", async () => {
    const { bearer } = await signUpUser("sync-conflict@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    await push(credential, { events: [event("th_1", 1, "a"), event("th_1", 2, "b")] });

    const response = await push(credential, { events: [event("th_1", 2, "DIFFERENT")] });
    expect(response.status).toBe(409);
    const envelope = emitted(cloudErrorSchema, await response.text());
    expect(envelope.error.code).toBe("sync-conflict");
    expect(envelope.error.deviceSeq).toBe(2);

    const page = await pull(credential, 0);
    expect(page.events[1]?.event).toEqual({ payload: "b", type: "test" });
  });

  it("refuses a NEW position at or below the high-water mark", async () => {
    const { bearer } = await signUpUser("sync-reverse@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    await push(credential, { events: [event("th_1", 5, "five")] });

    const response = await push(credential, { events: [event("th_1", 3, "three")] });
    expect(response.status).toBe(409);
    const envelope = emitted(cloudErrorSchema, await response.text());
    expect(envelope.error.code).toBe("sync-out-of-order");
    expect(envelope.error.deviceSeq).toBe(3);
    const page = await pull(credential, 0);
    expect(page.events).toHaveLength(1);
  });

  it("refuses a batch that is not sorted, before storing any of it", async () => {
    const { bearer } = await signUpUser("sync-unsorted@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");

    const response = await push(credential, {
      events: [event("th_1", 1, "a"), event("th_1", 3, "c"), event("th_1", 2, "b")],
    });
    expect(response.status).toBe(409);
    expect(emitted(cloudErrorSchema, await response.text()).error.code).toBe("sync-out-of-order");
    const page = await pull(credential, 0);
    expect(page.events).toEqual([]);
  });

  it("merges devices into one log and pages by the global seq", async () => {
    const { bearer } = await signUpUser("sync-merge@example.test");
    const laptop = await loginDevice(bearer, "Laptop");
    const phone = await loginDevice(bearer, "Phone");

    await push(laptop.credential, { events: [event("th_1", 1, "l1"), event("th_1", 2, "l2")] });
    await push(phone.credential, { events: [event("th_2", 1, "p1")] });

    const first = await pull(laptop.credential, 0, 2);
    expect(first.events).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.lastSeq).toBe(3);

    const lastSeen = first.events[1]?.seq ?? 0;
    const second = await pull(laptop.credential, lastSeen, 2);
    expect(second.events).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.events[0]?.deviceId).toBe(phone.deviceId);
    expect(second.events[0]?.threadId).toBe("th_2");
  });

  it("keeps accounts apart: another user's log is empty", async () => {
    const alice = await signUpUser("sync-alice@example.test");
    const bob = await signUpUser("sync-bob@example.test");
    const aliceDevice = await loginDevice(alice.bearer, "Alice's Laptop");
    const bobDevice = await loginDevice(bob.bearer, "Bob's Laptop");

    await push(aliceDevice.credential, { events: [event("th_a", 1, "secret")] });

    const bobsView = await pull(bobDevice.credential, 0);
    expect(bobsView.events).toEqual([]);
    expect(bobsView.lastSeq).toBe(0);
  });

  it("pings every other device on push, and never the pusher", async () => {
    const { bearer } = await signUpUser("sync-ping@example.test");
    const desktop = await loginDevice(bearer, "Desktop");
    const phone = await loginDevice(bearer, "Phone");
    const tablet = await loginDevice(bearer, "Tablet");

    const desktopWs = await openSocket(desktop.credential, "desktop");
    const tabletWs = await openSocket(tablet.credential, "other");
    const phoneWs = await openSocket(phone.credential, "other");

    await push(phone.credential, { events: [event("th_chat", 1, "hello")] });

    await awaitFrames(desktopWs, [{ seq: 1, type: "sync" }]);
    await awaitFrames(tabletWs, [{ seq: 1, type: "sync" }]);
    expect(phoneWs.frames).toEqual([]);

    desktopWs.socket.close();
    tabletWs.socket.close();
    phoneWs.socket.close();
  });

  it("accepts a stale install's desktop lane and dispatches nothing for it", async () => {
    const { bearer } = await signUpUser("sync-stale-lane@example.test");
    const desktop = await loginDevice(bearer, "Desktop");
    const stale = await loginDevice(bearer, "Old Laptop");
    const desktopWs = await openSocket(desktop.credential, "desktop");

    const pushed = await push(stale.credential, {
      events: [event("th_lane", 1, "run this")],
      threads: [{ lane: "desktop", threadId: "th_lane", title: "Do the thing", updatedAt: 1000 }],
    });
    expect(emitted(pushResponseSchema, await pushed.text())).toEqual({
      accepted: 1,
      duplicates: 0,
      lastSeq: 1,
    });
    const metaOnly = await push(stale.credential, {
      events: [],
      threads: [{ lane: "desktop", threadId: "th_later", updatedAt: 2000 }],
    });
    expect(emitted(pushResponseSchema, await metaOnly.text())).toEqual({
      accepted: 0,
      duplicates: 0,
      lastSeq: 1,
    });
    await push(stale.credential, { events: [event("th_lane", 2, "and this")] });

    // frames arrive in order, so a dispatch for either push would sit before the second sync
    await awaitFrames(desktopWs, [
      { seq: 1, type: "sync" },
      { seq: 2, type: "sync" },
    ]);
    desktopWs.socket.close();
  });

  it("keeps its socket identity in the hibernation tags, not in instance memory", async () => {
    const { bearer } = await signUpUser("sync-hibernate@example.test");
    const desktop = await loginDevice(bearer, "Desktop");
    const phone = await loginDevice(bearer, "Phone");
    const desktopWs = await openSocket(desktop.credential, "desktop");
    const stub = threadSyncStub(env, await userIdOf(bearer));

    const tags = await runInDurableObject(stub, (_instance, state) =>
      state.getWebSockets().map((ws) => state.getTags(ws)),
    );
    expect(tags).toEqual([[`device:${desktop.deviceId}`, "platform:desktop"]]);

    await push(phone.credential, { events: [event("th_x", 1, "after")] });
    await awaitFrames(desktopWs, [{ seq: 1, type: "sync" }]);
    desktopWs.socket.close();
  });

  it("severs a revoked device's live socket", async () => {
    const { bearer } = await signUpUser("sync-sever@example.test");
    const doomed = await loginDevice(bearer, "Doomed Laptop");
    const socket = await openSocket(doomed.credential, "desktop");
    // oxlint-disable-next-line promise/avoid-new -- the close code arrives as a socket event, which only a promise can hand to an await
    const closed = new Promise<number>((resolve) => {
      socket.socket.addEventListener("close", (close) => {
        resolve(close.code);
      });
    });

    await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
      body: JSON.stringify({ deviceId: doomed.deviceId }),
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      method: "POST",
    });

    expect(await closed).toBe(SYNC_WS_REVOKED_CLOSE_CODE);
  });

  it("severs a signed-out device's live socket", async () => {
    const { bearer } = await signUpUser("sync-sever-signout@example.test");
    const leaving = await loginDevice(bearer, "Leaving Laptop");
    const socket = await openSocket(leaving.credential, "desktop");
    // oxlint-disable-next-line promise/avoid-new -- the close code arrives as a socket event, which only a promise can hand to an await
    const closed = new Promise<number>((resolve) => {
      socket.socket.addEventListener("close", (close) => {
        resolve(close.code);
      });
    });

    await postSignOut(deviceHeaders(leaving.credential));

    expect(await closed).toBe(SYNC_WS_REVOKED_CLOSE_CODE);
  });

  it("refuses the socket without a device credential", async () => {
    const response = await SELF.fetch(`${ORIGIN}/v1/sync/ws`, {
      headers: { upgrade: "websocket" },
    });
    expect(response.status).toBe(401);
  });
});

describe("account deletion", () => {
  it("purges the thread-sync object and every device row", async () => {
    const { bearer, password } = await signUpUser("delete-me@example.test");
    const { credential } = await loginDevice(bearer, "Laptop");
    await push(credential, { events: [event("th_1", 1, "to be purged")] });
    const page = await pull(credential, 0);
    expect(page.lastSeq).toBe(1);

    const userId = await userIdOf(bearer);
    const deletion = await SELF.fetch(`${ORIGIN}/api/auth/delete-user`, {
      body: JSON.stringify({ password }),
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      method: "POST",
    });
    expect(deletion.status).toBe(200);

    const after = await SELF.fetch(`${ORIGIN}/v1/sync/pull?afterSeq=0`, {
      headers: deviceHeaders(credential),
    });
    expect(after.status).toBe(401);

    // read off the SQL: every route refuses a tombstoned object, so a route answer would prove the tombstone, not the wipe
    const stub = threadSyncStub(env, userId);
    const rows = await runInDurableObject(stub, (_instance, state) => ({
      dispatches: state.storage.sql.exec("SELECT COUNT(*) AS n FROM dispatches").one().n,
      events: state.storage.sql.exec("SELECT COUNT(*) AS n FROM sync_events").one().n,
    }));
    expect(rows).toEqual({ dispatches: 0, events: 0 });
  });

  it("refuses a request that verified just before the account died", async () => {
    const { bearer, password } = await signUpUser("delete-race@example.test");
    const { deviceId, credential } = await loginDevice(bearer, "Laptop");
    const userId = await userIdOf(bearer);
    await push(credential, { events: [event("th_1", 1, "before")] });

    await SELF.fetch(`${ORIGIN}/api/auth/delete-user`, {
      body: JSON.stringify({ password }),
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      method: "POST",
    });

    // replays calls whose credential check passed before the purge, as the Worker would have made them
    const stub = threadSyncStub(env, userId);
    const late = [
      await stub.push(deviceId, [
        { createdAt: 2, deviceSeq: 2, event: '"after the purge"', threadId: "th_1" },
      ]),
      await stub.pull({ afterSeq: 0, limit: 10 }),
    ];
    expect(late.map((result) => (result.ok ? "answered" : result.code))).toEqual([
      "account-deleted",
      "account-deleted",
    ]);

    const socket = await stub.fetch("https://thread-sync/ws", {
      headers: { [SOCKET_IDENTITY_HEADERS.deviceId]: deviceId, upgrade: "websocket" },
    });
    expect(socket.status).toBe(410);
    expect(emitted(cloudErrorSchema, await socket.text()).error.code).toBe("account-deleted");

    const remaining = await runInDurableObject(stub, (_instance, state) => ({
      events: state.storage.sql.exec("SELECT COUNT(*) AS n FROM sync_events").one().n,
    }));
    expect(remaining).toEqual({ events: 0 });
  });
});
