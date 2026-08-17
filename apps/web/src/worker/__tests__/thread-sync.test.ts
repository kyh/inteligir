import {
  ackCapturesResponseSchema,
  captureResponseSchema,
  claimCapturesResponseSchema,
} from "@repo/cloud-contract/captures";
import { cloudErrorSchema } from "@repo/cloud-contract/errors";
import {
  pullResponseSchema,
  pushResponseSchema,
  type PushRequest,
} from "@repo/cloud-contract/sync";
import { syncPingSchema, type SyncPing } from "@repo/cloud-contract/ws";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  deviceHeaders,
  ORIGIN,
  pairDevice,
  sessionHeaders,
  signUpUser,
  userIdOf,
} from "./cloud-helpers";

// The ThreadSyncDO through the real Worker path: verified device credential →
// the user's own object — push conflict handling, paging, the capture inbox's
// two-phase handoff, ws ping targeting, and the account-deletion purge.

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

function meta(
  threadId: string,
  lane: "any" | "desktop",
  updatedAt: number,
  title?: string,
): NonNullable<PushRequest["threads"]>[number] {
  return { threadId, lane, updatedAt, ...(title === undefined ? {} : { title }) };
}

function capture(credential: string, text: string, idempotencyKey: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/v1/capture`, {
    method: "POST",
    headers: { ...deviceHeaders(credential), "content-type": "application/json" },
    body: JSON.stringify({ text, idempotencyKey }),
  });
}

async function claim(credential: string) {
  const response = await SELF.fetch(`${ORIGIN}/v1/sync/captures/claim`, {
    method: "POST",
    headers: { ...deviceHeaders(credential), "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(response.status).toBe(200);
  return claimCapturesResponseSchema.parse(await response.json());
}

async function ack(credential: string, claimToken: string, ids: string[]) {
  const response = await SELF.fetch(`${ORIGIN}/v1/sync/captures/ack`, {
    method: "POST",
    headers: { ...deviceHeaders(credential), "content-type": "application/json" },
    body: JSON.stringify({ claimToken, ids }),
  });
  expect(response.status).toBe(200);
  return ackCapturesResponseSchema.parse(await response.json());
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

    // The retry after a lost response: same (deviceSeq)s, same bodies.
    const replay = pushResponseSchema.parse(await (await push(credential, batch)).json());
    expect(replay).toEqual({ accepted: 0, duplicates: 2, lastSeq: 2 });

    const page = await pull(credential, 0);
    expect(page.events.map((row) => row.deviceSeq)).toEqual([1, 2]);
    expect(page.events[0]?.event).toEqual({ type: "test", payload: "a" });
    expect(page.hasMore).toBe(false);
  });

  it("accepts a retry that appends to a partially-stored batch", async () => {
    const { bearer } = await signUpUser("sync-partial@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");

    await push(credential, { events: [event("th_1", 1, "a")] });
    // The device never saw the response, so it resends 1 with 2 appended.
    const retry = pushResponseSchema.parse(
      await (
        await push(credential, { events: [event("th_1", 1, "a"), event("th_1", 2, "b")] })
      ).json(),
    );
    expect(retry).toEqual({ accepted: 1, duplicates: 1, lastSeq: 2 });
  });

  it("refuses a stored position replayed with a DIFFERENT body, naming it", async () => {
    const { bearer } = await signUpUser("sync-conflict@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");
    await push(credential, { events: [event("th_1", 1, "a"), event("th_1", 2, "b")] });

    const response = await push(credential, { events: [event("th_1", 2, "DIFFERENT")] });
    expect(response.status).toBe(409);
    const envelope = cloudErrorSchema.parse(await response.json());
    expect(envelope.error.code).toBe("sync-conflict");
    expect(envelope.error.deviceSeq).toBe(2);

    // Refused, not half-applied: the stored body is untouched.
    const page = await pull(credential, 0);
    expect(page.events[1]?.event).toEqual({ type: "test", payload: "b" });
  });

  it("refuses a NEW position at or below the high-water mark", async () => {
    const { bearer } = await signUpUser("sync-reverse@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");
    await push(credential, { events: [event("th_1", 5, "five")] });

    // Position 3 was never stored, and accepting it would hand an older event
    // a newer global seq.
    const response = await push(credential, { events: [event("th_1", 3, "three")] });
    expect(response.status).toBe(409);
    const envelope = cloudErrorSchema.parse(await response.json());
    expect(envelope.error.code).toBe("sync-out-of-order");
    expect(envelope.error.deviceSeq).toBe(3);
    expect((await pull(credential, 0)).events).toHaveLength(1);
  });

  it("refuses a batch that is not sorted, before storing any of it", async () => {
    const { bearer } = await signUpUser("sync-unsorted@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");

    const response = await push(credential, {
      events: [event("th_1", 1, "a"), event("th_1", 3, "c"), event("th_1", 2, "b")],
    });
    expect(response.status).toBe(409);
    expect(cloudErrorSchema.parse(await response.json()).error.code).toBe("sync-out-of-order");
    // Not a prefix, not a partial — nothing landed.
    expect((await pull(credential, 0)).events).toEqual([]);
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

  it("keeps the NEWEST thread metadata when a delayed retry arrives", async () => {
    const { bearer } = await signUpUser("sync-meta@example.test");
    const phone = await pairDevice(bearer, "Phone");
    const desktop = await pairDevice(bearer, "Desktop");
    const desktopWs = await openSocket(desktop.credential, "desktop");

    // The user files it as a desktop dispatch, then changes their mind.
    await push(phone.credential, { events: [], threads: [meta("th_1", "desktop", 1000, "First")] });
    await push(phone.credential, { events: [], threads: [meta("th_1", "any", 2000, "Second")] });
    await settled();
    const afterMoveOff = desktopWs.frames.length;

    // The stale retry of the FIRST change lands late. It must not resurrect
    // the desktop lane — if it did, the dispatch would fire again here.
    await push(phone.credential, { events: [], threads: [meta("th_1", "desktop", 1000, "First")] });
    await settled();
    expect(desktopWs.frames).toHaveLength(afterMoveOff);

    desktopWs.socket.close();
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
      threads: [meta("th_dispatch", "desktop", 1000, "Do the thing")],
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
      threads: [meta("th_chat", "any", 1000)],
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

  it("dispatches a metadata-ONLY push, which carries no events to sync", async () => {
    const { bearer } = await signUpUser("sync-meta-only@example.test");
    const desktop = await pairDevice(bearer, "Desktop");
    const phone = await pairDevice(bearer, "Phone");
    const desktopWs = await openSocket(desktop.credential, "desktop");

    // Filing the thread IS the dispatch; its first event may not exist yet.
    const response = pushResponseSchema.parse(
      await (
        await push(phone.credential, {
          events: [],
          threads: [meta("th_later", "desktop", 1000, "Queued")],
        })
      ).json(),
    );
    expect(response).toEqual({ accepted: 0, duplicates: 0, lastSeq: 0 });
    await settled();

    // No sync ping — nothing was appended to pull — but the poke lands.
    expect(desktopWs.frames).toEqual([{ type: "dispatch", threadId: "th_later" }]);
    desktopWs.socket.close();
  });

  it("keeps its socket identity in the attachment, not in instance memory", async () => {
    const { bearer } = await signUpUser("sync-hibernate@example.test");
    const desktop = await pairDevice(bearer, "Desktop");
    const phone = await pairDevice(bearer, "Phone");
    const desktopWs = await openSocket(desktop.credential, "desktop");
    const userId = await userIdOf(bearer);
    const stub = env.THREAD_SYNC.getByName(`user:${userId}`);

    // Hibernation's actual mechanic: the runtime keeps the socket and the
    // attachment, and hands a RECONSTRUCTED instance whatever it can read back
    // off them. Reading the tag through the state proves the identity survives
    // an instance that no longer remembers accepting the socket — the whole
    // reason no field may cache it.
    const tags = await runInDurableObject(stub, (_instance, state) =>
      state.getWebSockets().map((ws) => ws.deserializeAttachment()),
    );
    expect(tags).toEqual([{ deviceId: desktop.deviceId, platform: "desktop" }]);

    // And the lane routing still reads it on a LATER invocation.
    await push(phone.credential, {
      events: [event("th_x", 1, "after")],
      threads: [meta("th_x", "desktop", 1000)],
    });
    await settled();
    expect(desktopWs.frames).toEqual([
      { type: "sync", seq: 1 },
      { type: "dispatch", threadId: "th_x" },
    ]);
    desktopWs.socket.close();
  });

  it("severs a revoked device's live socket", async () => {
    const { bearer } = await signUpUser("sync-sever@example.test");
    const doomed = await pairDevice(bearer, "Doomed Laptop");
    const socket = await openSocket(doomed.credential, "desktop");
    const closed = new Promise<number>((resolve) => {
      socket.socket.addEventListener("close", (close) => resolve(close.code));
    });

    await SELF.fetch(`${ORIGIN}/v1/device/revoke`, {
      method: "POST",
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: doomed.deviceId }),
    });

    expect(await closed).toBe(1008);
  });

  it("refuses the socket without a device credential", async () => {
    const response = await SELF.fetch(`${ORIGIN}/v1/sync/ws`, {
      headers: { upgrade: "websocket" },
    });
    expect(response.status).toBe(401);
  });
});

describe("capture inbox", () => {
  it("hands a capture to exactly one claimer, and deletes it once", async () => {
    const { bearer } = await signUpUser("capture-once@example.test");
    const phone = await pairDevice(bearer, "Phone");
    const laptop = await pairDevice(bearer, "Laptop");

    const posted = captureResponseSchema.parse(
      await (await capture(phone.credential, "buy oat milk", "key-oat-milk-1")).json(),
    );
    expect(posted.duplicate).toBe(false);

    const laptopClaim = await claim(laptop.credential);
    expect(laptopClaim.captures).toEqual([
      { id: posted.id, text: "buy oat milk", createdAt: posted.createdAt },
    ]);

    // The other device claiming at the same time gets NOTHING — that is the
    // whole point of the claim: two devices cannot both apply it.
    const phoneClaim = await claim(phone.credential);
    expect(phoneClaim.captures).toEqual([]);

    // The owner's ack deletes; the loser's ack does not, and says so per id.
    expect(await ack(laptop.credential, laptopClaim.claimToken, [posted.id])).toEqual({
      results: [{ id: posted.id, outcome: "deleted" }],
    });
    expect(await ack(phone.credential, phoneClaim.claimToken, [posted.id])).toEqual({
      results: [{ id: posted.id, outcome: "unknown" }],
    });

    expect((await claim(laptop.credential)).captures).toEqual([]);
  });

  it("tells a lapsed claimer its rows were reclaimed rather than deleting them", async () => {
    const { bearer } = await signUpUser("capture-lapsed@example.test");
    const phone = await pairDevice(bearer, "Phone");
    const laptop = await pairDevice(bearer, "Laptop");
    const posted = captureResponseSchema.parse(
      await (await capture(phone.credential, "remember", "key-remember-1")).json(),
    );

    const stale = await claim(laptop.credential);
    expect(stale.captures).toHaveLength(1);

    // The claim lapses (a crashed device) and another one takes the row.
    const userId = await userIdOf(bearer);
    const stub = env.THREAD_SYNC.getByName(`user:${userId}`);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE captures SET claimed_at = 0");
    });
    const fresh = await claim(phone.credential);
    expect(fresh.captures.map((row) => row.id)).toEqual([posted.id]);

    // The lapsed claimer must NOT delete what it no longer owns.
    expect(await ack(laptop.credential, stale.claimToken, [posted.id])).toEqual({
      results: [{ id: posted.id, outcome: "reclaimed" }],
    });
    expect(await ack(phone.credential, fresh.claimToken, [posted.id])).toEqual({
      results: [{ id: posted.id, outcome: "deleted" }],
    });
  });

  it("dedupes a retried capture on its idempotency key", async () => {
    const { bearer } = await signUpUser("capture-idem@example.test");
    const phone = await pairDevice(bearer, "Phone");

    const first = captureResponseSchema.parse(
      await (await capture(phone.credential, "one thought", "key-shared")).json(),
    );
    const retry = captureResponseSchema.parse(
      await (await capture(phone.credential, "one thought", "key-shared")).json(),
    );
    expect(retry.id).toBe(first.id);
    expect(retry.duplicate).toBe(true);

    expect((await claim(phone.credential)).captures).toHaveLength(1);
  });

  it("pings every socket when a capture lands", async () => {
    const { bearer } = await signUpUser("capture-ping@example.test");
    const phone = await pairDevice(bearer, "Phone");
    const laptop = await pairDevice(bearer, "Laptop");
    const laptopWs = await openSocket(laptop.credential, "desktop");

    await capture(phone.credential, "remember the thing", "key-ping-1");
    await settled();

    expect(laptopWs.frames).toEqual([{ type: "capture" }]);
    laptopWs.socket.close();
  });

  it("refuses an empty capture", async () => {
    const { bearer } = await signUpUser("capture-empty@example.test");
    const phone = await pairDevice(bearer, "Phone");
    const response = await capture(phone.credential, "   ", "key-empty-1");
    expect(response.status).toBe(400);
  });
});

describe("account deletion", () => {
  it("purges the thread-sync object and every device row", async () => {
    const { bearer, password } = await signUpUser("delete-me@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");
    await push(credential, { events: [event("th_1", 1, "to be purged")] });
    await capture(credential, "to be purged too", "key-purge-1");
    expect((await pull(credential, 0)).lastSeq).toBe(1);

    const userId = await userIdOf(bearer);
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

    // ...and the object's own storage is empty. Read straight off the SQL,
    // because every route now refuses a tombstoned object — so a route that
    // answered "nothing here" would be proving the tombstone, not the wipe.
    const stub = env.THREAD_SYNC.getByName(`user:${userId}`);
    const rows = await runInDurableObject(stub, (_instance, state) => ({
      events: state.storage.sql.exec("SELECT COUNT(*) AS n FROM sync_events").one().n,
      captures: state.storage.sql.exec("SELECT COUNT(*) AS n FROM captures").one().n,
      threads: state.storage.sql.exec("SELECT COUNT(*) AS n FROM thread_meta").one().n,
    }));
    expect(rows).toEqual({ events: 0, captures: 0, threads: 0 });
  });

  it("refuses a request that verified just before the account died", async () => {
    const { bearer, password } = await signUpUser("delete-race@example.test");
    const { deviceId, credential } = await pairDevice(bearer, "Laptop");
    const userId = await userIdOf(bearer);
    await push(credential, { events: [event("th_1", 1, "before")] });

    await SELF.fetch(`${ORIGIN}/api/auth/delete-user`, {
      method: "POST",
      headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    // The in-flight request: its credential check already PASSED (the D1 rows
    // are gone now, so replay it at the object exactly as the Worker would
    // have forwarded it). Without the tombstone this rebuilds the log the
    // purge just deleted.
    const stub = env.THREAD_SYNC.getByName(`user:${userId}`);
    const inFlight = await stub.fetch("https://thread-sync/push", {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": deviceId },
      body: JSON.stringify({ events: [event("th_1", 2, "after the purge")] }),
    });
    expect(inFlight.status).toBe(410);
    expect(cloudErrorSchema.parse(await inFlight.json()).error.code).toBe("account-deleted");

    const remaining = await runInDurableObject(
      stub,
      (_instance, state) => state.storage.sql.exec("SELECT COUNT(*) AS n FROM sync_events").one().n,
    );
    expect(remaining).toBe(0);
  });
});
