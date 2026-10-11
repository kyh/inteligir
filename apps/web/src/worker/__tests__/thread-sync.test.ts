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
  buildHeaders,
  deviceHeaders,
  emitted,
  loginDevice,
  openSocket,
  ORIGIN,
  postAccountDelete,
  postSignOut,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "./cloud-helpers";

const push = async (credential: string, body: PushRequest): Promise<Response> =>
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

const capture = async (
  credential: string,
  text: string,
  idempotencyKey: string,
): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}/v1/capture`, {
    body: JSON.stringify({ idempotencyKey, text }),
    headers: { ...deviceHeaders(credential), "content-type": "application/json" },
    method: "POST",
  });

describe("thread sync log", () => {
  it("pushes, pulls, and ignores a replayed outbox batch", async () => {
    const { cookie } = await signUpUser("sync-idem@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");

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

  it("stores each body as one text that parses back, and serves that text verbatim", async () => {
    const { cookie } = await signUpUser("sync-verbatim@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");
    const bodies: PushRequest["events"][number]["event"][] = [
      { nested: [1, "x", null, { deep: [true, false] }], type: "test" },
      'a bare string: "quoted", \\ a backslash, a \u2028 separator and a </script>',
      "あ😀 and a lone \uD800 half",
      0.1,
      1e21,
      null,
      false,
      [],
      {},
    ];
    await push(credential, {
      events: bodies.map((body, index) => ({
        createdAt: index,
        deviceSeq: index + 1,
        event: body,
        threadId: "th_1",
      })),
    });

    const stub = threadSyncStub(env, await userIdOf(cookie));
    const stored = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ event: string }>("SELECT event FROM sync_events ORDER BY seq")
        .toArray()
        .map((row) => row.event),
    );
    expect(stored).toEqual(bodies.map((body) => JSON.stringify(body)));
    for (const [index, text] of stored.entries()) {
      expect(JSON.parse(text)).toEqual(bodies[index]);
    }

    const response = await SELF.fetch(`${ORIGIN}/v1/sync/pull?afterSeq=0`, {
      headers: deviceHeaders(credential),
    });
    expect(response.headers.get("content-type")).toBe("application/json");
    const text = await response.text();
    for (const body of stored) {
      expect(text).toContain(`"event":${body}`);
    }
    expect(emitted(pullResponseSchema, text).events.map((row) => row.event)).toEqual(bodies);
  });

  it("accepts a retry that appends to a partially-stored batch", async () => {
    const { cookie } = await signUpUser("sync-partial@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");

    await push(credential, { events: [event("th_1", 1, "a")] });
    const retried = await push(credential, {
      events: [event("th_1", 1, "a"), event("th_1", 2, "b")],
    });
    const retry = emitted(pushResponseSchema, await retried.text());
    expect(retry).toEqual({ accepted: 1, duplicates: 1, lastSeq: 2 });
  });

  it("refuses a stored position replayed with a DIFFERENT body, naming it", async () => {
    const { cookie } = await signUpUser("sync-conflict@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");
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
    const { cookie } = await signUpUser("sync-reverse@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");
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
    const { cookie } = await signUpUser("sync-unsorted@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");

    const response = await push(credential, {
      events: [event("th_1", 1, "a"), event("th_1", 3, "c"), event("th_1", 2, "b")],
    });
    expect(response.status).toBe(409);
    expect(emitted(cloudErrorSchema, await response.text()).error.code).toBe("sync-out-of-order");
    const page = await pull(credential, 0);
    expect(page.events).toEqual([]);
  });

  it("refuses a batch carrying a key beside its events, storing none of it", async () => {
    const { cookie } = await signUpUser("sync-undeclared@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");

    const withThreads = {
      events: [event("th_1", 1, "a")],
      threads: [{ threadId: "th_1", title: "Fix the build" }],
    };
    const response = await push(credential, withThreads);
    expect(response.status).toBe(400);
    expect(emitted(cloudErrorSchema, await response.text()).error.code).toBe("bad-request");
    const page = await pull(credential, 0);
    expect(page.events).toEqual([]);
  });

  it("merges devices into one log and pages by the global seq", async () => {
    const { cookie } = await signUpUser("sync-merge@example.test");
    const laptop = await loginDevice(cookie, "Laptop");
    const phone = await loginDevice(cookie, "Phone");

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
    const aliceDevice = await loginDevice(alice.cookie, "Alice's Laptop");
    const bobDevice = await loginDevice(bob.cookie, "Bob's Laptop");

    await push(aliceDevice.credential, { events: [event("th_a", 1, "secret")] });

    const bobsView = await pull(bobDevice.credential, 0);
    expect(bobsView.events).toEqual([]);
    expect(bobsView.lastSeq).toBe(0);
  });

  it("pings every other device on push, and never the pusher", async () => {
    const { cookie } = await signUpUser("sync-ping@example.test");
    const desktop = await loginDevice(cookie, "Desktop");
    const phone = await loginDevice(cookie, "Phone");
    const tablet = await loginDevice(cookie, "Tablet");

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

  it("keeps its socket identity in the hibernation tags, not in instance memory", async () => {
    const { cookie } = await signUpUser("sync-hibernate@example.test");
    const desktop = await loginDevice(cookie, "Desktop");
    const phone = await loginDevice(cookie, "Phone");
    const desktopWs = await openSocket(desktop.credential, "desktop");
    const stub = threadSyncStub(env, await userIdOf(cookie));

    const tags = await runInDurableObject(stub, (_instance, state) =>
      state.getWebSockets().map((ws) => state.getTags(ws)),
    );
    expect(tags).toEqual([[`device:${desktop.deviceId}`, "platform:desktop"]]);

    await push(phone.credential, { events: [event("th_x", 1, "after")] });
    await awaitFrames(desktopWs, [{ seq: 1, type: "sync" }]);
    desktopWs.socket.close();
  });

  it("severs a revoked device's live socket", async () => {
    const { cookie } = await signUpUser("sync-sever@example.test");
    const doomed = await loginDevice(cookie, "Doomed Laptop");
    const socket = await openSocket(doomed.credential, "desktop");
    // oxlint-disable-next-line promise/avoid-new -- the close code arrives as a socket event, which only a promise can hand to an await
    const closed = new Promise<number>((resolve) => {
      socket.socket.addEventListener("close", (close) => {
        resolve(close.code);
      });
    });

    await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
      body: JSON.stringify({ deviceId: doomed.deviceId }),
      headers: { ...sessionHeaders(cookie), "content-type": "application/json" },
      method: "POST",
    });

    expect(await closed).toBe(SYNC_WS_REVOKED_CLOSE_CODE);
  });

  it("severs a signed-out device's live socket", async () => {
    const { cookie } = await signUpUser("sync-sever-signout@example.test");
    const leaving = await loginDevice(cookie, "Leaving Laptop");
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
      headers: { ...buildHeaders(), upgrade: "websocket" },
    });
    expect(response.status).toBe(401);
  });
});

describe("capture inbox", () => {
  it("pings every socket when a capture lands", async () => {
    const { cookie } = await signUpUser("capture-ping@example.test");
    const phone = await loginDevice(cookie, "Phone");
    const laptop = await loginDevice(cookie, "Laptop");
    const laptopWs = await openSocket(laptop.credential, "desktop");

    await capture(phone.credential, "remember the thing", "key-ping-1");

    await awaitFrames(laptopWs, [{ type: "capture" }]);
    laptopWs.socket.close();
  });

  it("refuses an empty capture", async () => {
    const { cookie } = await signUpUser("capture-empty@example.test");
    const phone = await loginDevice(cookie, "Phone");
    const response = await capture(phone.credential, "   ", "key-empty-1");
    expect(response.status).toBe(400);
  });
});

describe("account deletion", () => {
  it("purges the thread-sync object and every device row", async () => {
    const { cookie, password } = await signUpUser("delete-me@example.test");
    const { credential } = await loginDevice(cookie, "Laptop");
    await push(credential, { events: [event("th_1", 1, "to be purged")] });
    await capture(credential, "to be purged too", "key-purge-1");
    const page = await pull(credential, 0);
    expect(page.lastSeq).toBe(1);

    const userId = await userIdOf(cookie);
    const deletion = await postAccountDelete(deviceHeaders(credential), password);
    expect(deletion.status).toBe(200);

    const after = await SELF.fetch(`${ORIGIN}/v1/sync/pull?afterSeq=0`, {
      headers: deviceHeaders(credential),
    });
    expect(after.status).toBe(401);

    // read off the SQL: every route refuses a tombstoned object, so a route answer would prove the tombstone, not the wipe
    const stub = threadSyncStub(env, userId);
    const rows = await runInDurableObject(stub, (_instance, state) => ({
      captures: state.storage.sql.exec("SELECT COUNT(*) AS n FROM captures").one().n,
      dispatches: state.storage.sql.exec("SELECT COUNT(*) AS n FROM dispatches").one().n,
      events: state.storage.sql.exec("SELECT COUNT(*) AS n FROM sync_events").one().n,
    }));
    expect(rows).toEqual({ captures: 0, dispatches: 0, events: 0 });
  });

  it("refuses a request that verified just before the account died", async () => {
    const { cookie, password } = await signUpUser("delete-race@example.test");
    const { deviceId, credential } = await loginDevice(cookie, "Laptop");
    const userId = await userIdOf(cookie);
    await push(credential, { events: [event("th_1", 1, "before")] });

    const deletion = await postAccountDelete(deviceHeaders(credential), password);
    expect(deletion.status).toBe(200);

    // replays calls whose credential check passed before the purge, as the Worker would have made them
    const stub = threadSyncStub(env, userId);
    const late = [
      await stub.push(deviceId, [
        { createdAt: 2, deviceSeq: 2, event: '"after the purge"', threadId: "th_1" },
      ]),
      await stub.pull({ afterSeq: 0, limit: 10 }),
      await stub.capture({ idempotencyKey: "key-after-purge", text: "after the purge" }),
      await stub.claimCaptures({ limit: 10 }),
      await stub.ackCaptures({ claimToken: "late-claim", ids: ["late-capture"] }),
    ];
    expect(late.map((result) => (result.ok ? "answered" : result.code))).toEqual([
      "account-deleted",
      "account-deleted",
      "account-deleted",
      "account-deleted",
      "account-deleted",
    ]);

    const socket = await stub.fetch("https://thread-sync/ws", {
      headers: { [SOCKET_IDENTITY_HEADERS.deviceId]: deviceId, upgrade: "websocket" },
    });
    expect(socket.status).toBe(410);
    expect(emitted(cloudErrorSchema, await socket.text()).error.code).toBe("account-deleted");

    const remaining = await runInDurableObject(stub, (_instance, state) => ({
      captures: state.storage.sql.exec("SELECT COUNT(*) AS n FROM captures").one().n,
      events: state.storage.sql.exec("SELECT COUNT(*) AS n FROM sync_events").one().n,
    }));
    expect(remaining).toEqual({ captures: 0, events: 0 });
  });
});
