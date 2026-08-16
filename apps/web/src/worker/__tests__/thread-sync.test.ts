import {
  ackCapturesResponseSchema,
  captureResponseSchema,
  listCapturesResponseSchema,
} from "@repo/cloud-contract/captures";
import {
  pullResponseSchema,
  pushResponseSchema,
  type PushRequest,
} from "@repo/cloud-contract/sync";
import { syncPingSchema, type SyncPing } from "@repo/cloud-contract/ws";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deviceHeaders, ORIGIN, pairDevice, sessionHeaders, signUpUser } from "./cloud-helpers";

// The ThreadSyncDO through the real Worker path: verified device credential →
// the user's own object — push/pull idempotency, paging, the capture inbox's
// exactly-once ack, ws ping targeting, and the account-deletion purge.

async function push(credential: string, body: PushRequest): Promise<Response> {
  return await SELF.fetch(`${ORIGIN}/v1/sync/push`, {
    method: "POST",
    headers: { ...deviceHeaders(credential), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function pull(credential: string, afterSeq: number, limit?: number) {
  const query =
    limit === undefined ? `afterSeq=${afterSeq}` : `afterSeq=${afterSeq}&limit=${limit}`;
  const response = await SELF.fetch(`${ORIGIN}/v1/sync/pull?${query}`, {
    headers: deviceHeaders(credential),
  });
  expect(response.status).toBe(200);
  return pullResponseSchema.parse(await response.json());
}

function event(
  threadId: string,
  deviceSeq: number,
  payload: string,
): PushRequest["events"][number] {
  return { threadId, deviceSeq, event: { type: "test", payload }, createdAt: deviceSeq };
}

/** Open the invalidation socket and collect its frames. */
async function openSocket(
  credential: string,
  platform: string,
): Promise<{ frames: SyncPing[]; socket: WebSocket }> {
  const response = await SELF.fetch(`${ORIGIN}/v1/sync/ws?platform=${platform}`, {
    headers: { ...deviceHeaders(credential), upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error("no websocket on the 101");
  socket.accept();
  const frames: SyncPing[] = [];
  socket.addEventListener("message", (message) => {
    if (typeof message.data === "string") {
      frames.push(syncPingSchema.parse(JSON.parse(message.data)));
    }
  });
  return { frames, socket };
}

/** The pings are sent inside the push's own invocation; one macrotask later
 * they have crossed the in-process pair. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

describe("thread sync log", () => {
  it("pushes, pulls, and ignores a replayed outbox batch", async () => {
    const { bearer } = await signUpUser("sync-idem@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");

    const batch: PushRequest = { events: [event("th_1", 1, "a"), event("th_1", 2, "b")] };
    const first = pushResponseSchema.parse(await (await push(credential, batch)).json());
    expect(first).toEqual({ accepted: 2, duplicates: 0, lastSeq: 2 });

    // The retry after a lost response: same (deviceSeq)s, no new rows.
    const replay = pushResponseSchema.parse(await (await push(credential, batch)).json());
    expect(replay).toEqual({ accepted: 0, duplicates: 2, lastSeq: 2 });

    const page = await pull(credential, 0);
    expect(page.events.map((row) => row.deviceSeq)).toEqual([1, 2]);
    expect(page.events[0]?.event).toEqual({ type: "test", payload: "a" });
    expect(page.hasMore).toBe(false);
  });

  it("merges devices into one log and pages by the global seq", async () => {
    const { bearer } = await signUpUser("sync-merge@example.test");
    const laptop = await pairDevice(bearer, "Laptop");
    const phone = await pairDevice(bearer, "Phone");

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
    // The row names its writer, so a client can skip its own.
    expect(second.events[0]?.deviceId).toBe(phone.deviceId);
    expect(second.events[0]?.threadId).toBe("th_2");
  });

  it("keeps accounts apart: another user's log is empty", async () => {
    const alice = await signUpUser("sync-alice@example.test");
    const bob = await signUpUser("sync-bob@example.test");
    const aliceDevice = await pairDevice(alice.bearer, "Alice's Laptop");
    const bobDevice = await pairDevice(bob.bearer, "Bob's Laptop");

    await push(aliceDevice.credential, { events: [event("th_a", 1, "secret")] });

    const bobsView = await pull(bobDevice.credential, 0);
    expect(bobsView.events).toEqual([]);
    expect(bobsView.lastSeq).toBe(0);
  });

  it("pings other devices on push, desktop sockets on desktop-lane threads", async () => {
    const { bearer } = await signUpUser("sync-ping@example.test");
    const desktop = await pairDevice(bearer, "Desktop");
    const phone = await pairDevice(bearer, "Phone");
    const tablet = await pairDevice(bearer, "Tablet");

    const desktopWs = await openSocket(desktop.credential, "desktop");
    const tabletWs = await openSocket(tablet.credential, "other");
    const phoneWs = await openSocket(phone.credential, "other");

    // The phone dispatches a desktop-lane thread: meta + first event, one push.
    await push(phone.credential, {
      events: [event("th_dispatch", 1, "run this")],
      threads: [{ threadId: "th_dispatch", lane: "desktop", title: "Do the thing" }],
    });
    await settled();

    // The desktop socket hears both the sync ping and the dispatch poke.
    expect(desktopWs.frames).toEqual([
      { type: "sync", seq: 1 },
      { type: "dispatch", threadId: "th_dispatch" },
    ]);
    // A non-desktop socket hears only the sync ping.
    expect(tabletWs.frames).toEqual([{ type: "sync", seq: 1 }]);
    // The pusher's own socket hears nothing — it holds what it pushed.
    expect(phoneWs.frames).toEqual([]);

    // An any-lane push pings sync only, on every non-pusher socket.
    await push(phone.credential, {
      events: [event("th_chat", 2, "hello")],
      threads: [{ threadId: "th_chat", lane: "any" }],
    });
    await settled();
    expect(desktopWs.frames).toHaveLength(3);
    expect(desktopWs.frames[2]).toEqual({ type: "sync", seq: 2 });
    expect(tabletWs.frames).toHaveLength(2);
    expect(phoneWs.frames).toEqual([]);

    desktopWs.socket.close();
    tabletWs.socket.close();
    phoneWs.socket.close();
  });

  it("refuses the socket without a device credential", async () => {
    const response = await SELF.fetch(`${ORIGIN}/v1/sync/ws`, {
      headers: { upgrade: "websocket" },
    });
    expect(response.status).toBe(401);
  });
});

describe("capture inbox", () => {
  it("hands a capture to exactly one acker", async () => {
    const { bearer } = await signUpUser("capture-once@example.test");
    const phone = await pairDevice(bearer, "Phone");
    const laptop = await pairDevice(bearer, "Laptop");

    const posted = captureResponseSchema.parse(
      await (
        await SELF.fetch(`${ORIGIN}/v1/capture`, {
          method: "POST",
          headers: { ...deviceHeaders(phone.credential), "content-type": "application/json" },
          body: JSON.stringify({ text: "buy oat milk" }),
        })
      ).json(),
    );

    const listed = listCapturesResponseSchema.parse(
      await (
        await SELF.fetch(`${ORIGIN}/v1/sync/captures`, {
          headers: deviceHeaders(laptop.credential),
        })
      ).json(),
    );
    expect(listed.captures).toEqual([
      { id: posted.id, text: "buy oat milk", createdAt: posted.createdAt },
    ]);

    const ack = (credential: string) =>
      SELF.fetch(`${ORIGIN}/v1/sync/captures/ack`, {
        method: "POST",
        headers: { ...deviceHeaders(credential), "content-type": "application/json" },
        body: JSON.stringify({ ids: [posted.id] }),
      });

    // The first ack deletes; the second — another device racing — deletes zero,
    // which is its signal not to apply.
    const winner = ackCapturesResponseSchema.parse(await (await ack(laptop.credential)).json());
    expect(winner.deleted).toBe(1);
    const loser = ackCapturesResponseSchema.parse(await (await ack(phone.credential)).json());
    expect(loser.deleted).toBe(0);

    const after = listCapturesResponseSchema.parse(
      await (
        await SELF.fetch(`${ORIGIN}/v1/sync/captures`, {
          headers: deviceHeaders(laptop.credential),
        })
      ).json(),
    );
    expect(after.captures).toEqual([]);
  });

  it("pings every socket when a capture lands", async () => {
    const { bearer } = await signUpUser("capture-ping@example.test");
    const phone = await pairDevice(bearer, "Phone");
    const laptop = await pairDevice(bearer, "Laptop");
    const laptopWs = await openSocket(laptop.credential, "desktop");

    await SELF.fetch(`${ORIGIN}/v1/capture`, {
      method: "POST",
      headers: { ...deviceHeaders(phone.credential), "content-type": "application/json" },
      body: JSON.stringify({ text: "remember the thing" }),
    });
    await settled();

    expect(laptopWs.frames).toEqual([{ type: "capture" }]);
    laptopWs.socket.close();
  });

  it("refuses an empty capture", async () => {
    const { bearer } = await signUpUser("capture-empty@example.test");
    const phone = await pairDevice(bearer, "Phone");
    const response = await SELF.fetch(`${ORIGIN}/v1/capture`, {
      method: "POST",
      headers: { ...deviceHeaders(phone.credential), "content-type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    });
    expect(response.status).toBe(400);
  });
});

describe("account deletion", () => {
  it("purges the thread-sync object and every device row", async () => {
    const { bearer, password } = await signUpUser("delete-me@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");
    await push(credential, { events: [event("th_1", 1, "to be purged")] });
    await SELF.fetch(`${ORIGIN}/v1/capture`, {
      method: "POST",
      headers: { ...deviceHeaders(credential), "content-type": "application/json" },
      body: JSON.stringify({ text: "to be purged too" }),
    });
    expect((await pull(credential, 0)).lastSeq).toBe(1);

    const session = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
      headers: sessionHeaders(bearer),
    });
    const sessionBody: unknown = await session.json();
    const userId =
      typeof sessionBody === "object" &&
      sessionBody !== null &&
      "user" in sessionBody &&
      typeof sessionBody.user === "object" &&
      sessionBody.user !== null &&
      "id" in sessionBody.user &&
      typeof sessionBody.user.id === "string"
        ? sessionBody.user.id
        : null;
    expect(userId).not.toBeNull();

    const deletion = await SELF.fetch(`${ORIGIN}/api/auth/delete-user`, {
      method: "POST",
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    expect(deletion.status).toBe(200);

    // The credential died with the device rows...
    const after = await SELF.fetch(`${ORIGIN}/v1/sync/pull?afterSeq=0`, {
      headers: deviceHeaders(credential),
    });
    expect(after.status).toBe(401);

    // ...and the object's own storage is empty, asked through the binding the
    // tests hold (in production the Worker is the object's only caller).
    const stub = env.THREAD_SYNC.getByName(`user:${userId ?? ""}`);
    const emptied = pullResponseSchema.parse(
      await (await stub.fetch("https://thread-sync/pull?afterSeq=0")).json(),
    );
    expect(emptied).toEqual({ events: [], lastSeq: 0, hasMore: false });
    const captures = listCapturesResponseSchema.parse(
      await (await stub.fetch("https://thread-sync/captures")).json(),
    );
    expect(captures.captures).toEqual([]);
  });
});
