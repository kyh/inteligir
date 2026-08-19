// TWO INSTALLS, ONE ACCOUNT — issue #572's second acceptance, and the only
// test here that drives the WHOLE stack: the real thread service, the real
// ingest, the real routes, on two separate databases and vaults, against one
// `FakeCloud`.
//
// "Converge" is narrowed here rather than assumed — the concurrent-writer
// case below states exactly which order is shared and which is not.
//
// The honest bound, stated because it changes what this proves: `FakeCloud` is
// the contract over Maps, not the deployed Worker. What runs against the real
// Durable Object is `apps/web/src/worker/__tests__/thread-sync.test.ts`, which
// cannot reach this half — it runs on workerd, and this half is a Node process
// with better-sqlite3 in it. So the two suites meet at the contract, which is
// exactly what the contract is for.

import { listStoredThreadEvents } from "@repo/db/events";
import { NotificationBuffer } from "@repo/domain/notifier";
import { describe, expect, it } from "vitest";
import { bootTestApp, type BootedTestApp } from "../../__tests__/boot-app";
import { FakeTurnDriver } from "../../__tests__/fake-turn-driver";
import { ThreadService } from "../../threads/service";
import { unavailableTurnDriver } from "../../threads/turn-driver";
import { FakeCloud } from "./fake-cloud";

interface ResponseLike {
  ok: boolean;
  status: number;
}

function isOk<TResponse extends ResponseLike>(
  response: TResponse,
): response is Extract<TResponse, { ok: true }> {
  return response.ok;
}

/** The typed client's union split at the status, so a `.json()` below is the
 *  200 body — the same gate `requireOk` is for the CLI. */
function ok<TResponse extends ResponseLike>(response: TResponse): Extract<TResponse, { ok: true }> {
  if (!isOk(response)) {
    throw new Error(`expected a 2xx, got ${response.status}`);
  }
  return response;
}

/** An install with its own data dir, vault and database, wired to `cloud`.
 *  `pollIntervalMs: null` leaves `POST /cloud/sync` the only trigger, so the
 *  test says when a pass happens instead of racing one. */
async function bootInstall(
  cloud: FakeCloud,
  mode: "scripted" | "manual" = "scripted",
): Promise<BootedTestApp> {
  return await bootTestApp({
    cloudTransport: { fetch: cloud.fetch, pollIntervalMs: null },
    makeDriver: () => ({ createTurnDriver: (sink) => new FakeTurnDriver(sink, { mode }) }),
  });
}

/**
 * Pair an install the way a user does (issue #573), through the composed app
 * rather than the runtime: `POST /cloud/pair/begin` over the typed client, then
 * the callback a browser would follow — a plain `GET` on the loopback route,
 * with the state read off the approve URL exactly as the approve page reads it.
 *
 * `openBrowser: false`, because a suite that popped a window on whoever ran it
 * would be the last thing anyone wants from `pnpm test`.
 */
/** The loopback address these installs pretend to be reached on. The begin
 *  route reads the port back out of the request's own Host header, because
 *  `listen` may have probed past the configured one. */
const LOOPBACK_HOST = "127.0.0.1:4664";

async function pair(install: BootedTestApp, cloud: FakeCloud, code: string): Promise<void> {
  const begun = ok(
    await install.client.cloud.pair.begin.$post(
      { json: { deviceName: `device-${code}`, openBrowser: false } },
      { headers: { host: LOOPBACK_HOST } },
    ),
  );
  const approve = new URL((await begun.json()).url);
  const state = approve.searchParams.get("state") ?? "";
  // The approve page's mint, bound to the PKCE challenge begin put on the URL —
  // registered here because the app kept the verifier and only the hash travels.
  cloud.mintCode(code, approve.searchParams.get("challenge") ?? "");
  const callback = new URL(approve.searchParams.get("redirect") ?? "");
  expect(callback.origin).toBe(`http://${LOOPBACK_HOST}`);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);

  // What the browser does next, and the only thing that completes a pairing.
  const landed = await install.composed.app.request(callback.toString());
  expect(landed.status).toBe(200);
  expect(await landed.text()).toContain("Paired");
  expect((await ok(await install.client.cloud.status.$get()).json()).state).toBe("paired");
}

async function syncNow(install: BootedTestApp): Promise<void> {
  ok(await install.client.cloud.sync.$post());
}

/** Every event this database holds for a thread, in its local order and
 *  keyed by what the row SAYS — a key of type alone cannot tell two turns
 *  apart, and telling them apart is the whole question here. */
function eventOrder(install: BootedTestApp, threadId: string): string[] {
  return listStoredThreadEvents(install.db, { threadId }).map((stored) => {
    const event = stored.event;
    const said =
      event.type === "client/turn/requested"
        ? event.text
        : event.type === "item/completed" && event.item.type === "agentMessage"
          ? event.item.text
          : "";
    return `${event.type} ${said}`.trim();
  });
}

/** The same rows as an unordered multiset — what BOTH devices are guaranteed
 *  to hold. */
function eventSet(install: BootedTestApp, threadId: string): string[] {
  return eventOrder(install, threadId).toSorted();
}

/** The subsequence of `order` a single writer contributed, identified by the
 *  message text its turn carried. */
function writerBlock(order: readonly string[], text: string): string[] {
  const start = order.indexOf(`client/turn/requested ${text}`);
  if (start === -1) {
    throw new Error(`no turn for "${text}"`);
  }
  return order.slice(start, start + 7);
}

describe("two installs against one account", () => {
  it("converge: a thread used on A appears on B, in A's order", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await pair(a, cloud, "AAAA-AAAA");
    await pair(b, cloud, "BBBB-BBBB");

    const created = ok(await a.client.threads.create.$post({ json: { title: "Shared" } }));
    const { thread } = await created.json();

    const sent = ok(
      await a.client.threads.send.$post({
        json: { threadId: thread.id, text: "hello from A", mode: "steer-if-active" },
      }),
    );
    expect((await sent.json()).kind).toBe("started");

    await syncNow(a);
    await syncNow(b);

    // The thread exists on B with the id the ACCOUNT gave it, not one B minted.
    const detail = ok(await b.client.threads.get.$get({ query: { threadId: thread.id } }));
    expect((await detail.json()).thread.id).toBe(thread.id);

    // One writer, so one order — see the concurrent case below for what is
    // NOT claimed.
    const order = eventOrder(a, thread.id);
    expect(order.length).toBeGreaterThan(3);
    expect(eventOrder(b, thread.id)).toEqual(order);

    // B's timeline renders the same conversation A's does.
    const timeline = ok(await b.client.threads.timeline.$get({ query: { threadId: thread.id } }));
    const body = await timeline.json();
    if (body.kind !== "full") throw new Error("expected a full timeline");
    expect(
      body.timeline.rows.some(
        (row) => row.kind === "conversation" && row.role === "user" && row.text === "hello from A",
      ),
    ).toBe(true);
  });

  it("applies each event exactly once, however many passes run", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await pair(a, cloud, "AAAA-AAAA");
    await pair(b, cloud, "BBBB-BBBB");

    const created = ok(await a.client.threads.create.$post({ json: { title: "Idempotent" } }));
    const { thread } = await created.json();
    await a.client.threads.send.$post({
      json: { threadId: thread.id, text: "once", mode: "steer-if-active" },
    });
    await syncNow(a);

    await syncNow(b);
    const afterFirst = eventOrder(b, thread.id);
    // The cursor rides the apply's own transaction, so a second pass over the
    // same log adds nothing — the property a separate cursor write would only
    // hold between crashes.
    await syncNow(b);
    await syncNow(b);
    expect(eventOrder(b, thread.id)).toEqual(afterFirst);
  });

  /**
   * WHAT CONVERGENCE MEANS HERE, and what it does not.
   *
   * `events.sequence` is allocated per THREAD by whichever device appends —
   * which for a synced row is the device that PULLED it — so it is an ARRIVAL
   * order, not a shared one. Two devices that both write before either syncs
   * end up with the same rows in different positions, and no care in the
   * client changes that: the local log is append-only under a UNIQUE(thread,
   * sequence), so no renumbering is available to it.
   *
   * The account log DOES carry a total order — its global `seq` — so the
   * honest options were to project that instead, or to say plainly what holds.
   * Projecting it means the timeline stops reading `sequence`, which is a
   * rewrite of a surface this work has no business touching. So the claim is
   * narrowed to the two properties that ARE true, and both are pinned below.
   */
  it("holds the same set, and keeps each writer's own turn in order", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await pair(a, cloud, "AAAA-AAAA");
    await pair(b, cloud, "BBBB-BBBB");

    const created = ok(await a.client.threads.create.$post({ json: { title: "Concurrent" } }));
    const { thread } = await created.json();
    await a.client.threads.send.$post({
      json: { threadId: thread.id, text: "seed", mode: "steer-if-active" },
    });
    await syncNow(a);
    await syncNow(b);

    // Both write before either syncs — genuinely concurrent.
    await a.client.threads.send.$post({
      json: { threadId: thread.id, text: "from A", mode: "steer-if-active" },
    });
    await b.client.threads.send.$post({
      json: { threadId: thread.id, text: "from B", mode: "steer-if-active" },
    });
    await syncNow(a);
    await syncNow(b);
    await syncNow(a);

    const onA = eventOrder(a, thread.id);
    const onB = eventOrder(b, thread.id);

    expect(eventSet(b, thread.id)).toEqual(eventSet(a, thread.id));
    // The interleave differs, and asserting THAT is the point: each device
    // appended its own turn first and pulled the other's after.
    expect(onB).not.toEqual(onA);
    for (const text of ["seed", "from A", "from B"]) {
      expect(writerBlock(onB, text)).toEqual(writerBlock(onA, text));
    }
  });

  it("adds nothing when a re-paired device replays the account's whole log", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await pair(a, cloud, "AAAA-AAAA");
    await pair(b, cloud, "BBBB-BBBB");

    const created = ok(await a.client.threads.create.$post({ json: { title: "Re-paired" } }));
    const { thread } = await created.json();
    await a.client.threads.send.$post({
      json: { threadId: thread.id, text: "before the re-pair", mode: "steer-if-active" },
    });
    await syncNow(a);
    await syncNow(b);
    const before = eventOrder(b, thread.id);
    expect(before.length).toBeGreaterThan(3);

    // Unpair forgets the cursor along with everything else the old credential
    // meant, so the next pairing pulls the log from its FIRST row — and every
    // one of those rows is already here.
    ok(await b.client.cloud.unpair.$post());
    await pair(b, cloud, "CCCC-CCCC");
    await syncNow(b);
    await syncNow(b);

    expect(eventOrder(b, thread.id)).toEqual(before);
    // Still idle: a replayed `turn/started` projected again would have left the
    // thread running for a turn that finished long ago.
    const detail = ok(await b.client.threads.get.$get({ query: { threadId: thread.id } }));
    expect((await detail.json()).thread.status).toBe("idle");
  });

  it("leaves a turn running on another device alone across a reboot", async () => {
    const cloud = new FakeCloud();
    // A holds its turn OPEN: `manual` emits turn/started and nothing after, so
    // what B pulls is a turn whose provider is alive on another machine.
    const a = await bootInstall(cloud, "manual");
    const b = await bootInstall(cloud);
    await pair(a, cloud, "AAAA-AAAA");
    await pair(b, cloud, "BBBB-BBBB");

    const created = ok(await a.client.threads.create.$post({ json: { title: "Long task" } }));
    const { thread } = await created.json();
    await a.client.threads.send.$post({
      json: { threadId: thread.id, text: "run it", mode: "steer-if-active" },
    });
    await syncNow(a);
    await syncNow(b);

    const pulled = ok(await b.client.threads.get.$get({ query: { threadId: thread.id } }));
    expect((await pulled.json()).thread.status).toBe("active");

    // A REBOOT of B: a second ThreadService over the same database runs
    // `recoverWedgedThreads` at construction. It must not declare a provider it
    // does not own to be dead — that failure would be fabricated here and then
    // pushed back to the machine still doing the work.
    const rebooted = new ThreadService({
      db: b.db,
      notifier: new NotificationBuffer(),
      createTurnDriver: () => unavailableTurnDriver,
    });
    expect(rebooted.list().some((row) => row.id === thread.id)).toBe(true);
    expect(eventOrder(b, thread.id).some((row) => row.startsWith("provider/error"))).toBe(false);
    const afterReboot = ok(await b.client.threads.get.$get({ query: { threadId: thread.id } }));
    expect((await afterReboot.json()).thread.status).toBe("active");
  });

  it("carries B's reply back to A, so the log is genuinely two-way", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await pair(a, cloud, "AAAA-AAAA");
    await pair(b, cloud, "BBBB-BBBB");

    const created = ok(await a.client.threads.create.$post({ json: { title: "Two-way" } }));
    const { thread } = await created.json();
    await a.client.threads.send.$post({
      json: { threadId: thread.id, text: "from A", mode: "steer-if-active" },
    });
    await syncNow(a);
    await syncNow(b);

    await b.client.threads.send.$post({
      json: { threadId: thread.id, text: "from B", mode: "steer-if-active" },
    });
    await syncNow(b);
    await syncNow(a);

    const texts = listStoredThreadEvents(a.db, { threadId: thread.id })
      .map((stored) => stored.event)
      .filter((event) => event.type === "client/turn/requested")
      .map((event) => event.text);
    expect(texts).toContain("from A");
    expect(texts).toContain("from B");
  });
});
