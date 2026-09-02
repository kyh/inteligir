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

import { createRouterClient } from "@orpc/server";
import { listStoredThreadEvents } from "@repo/db/events";
import { NotificationBuffer } from "@repo/domain/notifier";
import { describe, expect, it } from "vitest";
import { bootThreadHarness, type BootedTestApp } from "../../__tests__/boot-app";
import { localRouter } from "../../root-router";
import { ThreadService } from "../../threads/service";
import { unavailableTurnDriver } from "../../threads/turn-driver";
import { FakeCloud } from "./fake-cloud";
import { approveMint, callbackFor, LOOPBACK_HOST, stateOf } from "./pair-fixtures";

/** An install with its own data dir, vault and database, wired to `cloud`.
 *  `pollIntervalMs: null` leaves the sync procedure the only trigger, so the
 *  test says when a pass happens instead of racing one. */
async function bootInstall(
  cloud: FakeCloud,
  mode: "scripted" | "manual" = "scripted",
): Promise<BootedTestApp> {
  return await bootThreadHarness(
    { mode },
    { cloudTransport: { fetch: cloud.fetch, pollIntervalMs: null } },
  );
}

/**
 * Pair an install the way a user does (issue #573), through the composed app
 * rather than the runtime: `cloud.pairBegin` over the typed client, then the
 * callback a browser would follow — a plain `GET` on the loopback route, with
 * the state read off the approve URL exactly as the approve page reads it.
 *
 * `openBrowser: false`, because a suite that popped a window on whoever ran it
 * would be the last thing anyone wants from `pnpm test`.
 */
async function pair(install: BootedTestApp, cloud: FakeCloud, code: string): Promise<void> {
  // The harness's client carries no Host — nothing reached it over HTTP — and
  // a pairing that names no callback address is refused, so this one call gets
  // a client standing where a loopback caller would.
  const fromLoopback = createRouterClient(localRouter, {
    context: { ...install.composed.context, requestHost: LOOPBACK_HOST },
  });
  const begun = await fromLoopback.cloud.pairBegin({
    deviceName: `device-${code}`,
    openBrowser: false,
  });
  approveMint(cloud, begun.url, code);
  const callback = callbackFor(begun.url, code, stateOf(begun.url));
  expect(new URL(callback).origin).toBe(`http://${LOOPBACK_HOST}`);

  // What the browser does next, and the only thing that completes a pairing.
  const landed = await install.composed.app.request(callback);
  expect(landed.status).toBe(200);
  expect(await landed.text()).toContain("Paired");
  expect((await install.client.cloud.status()).state).toBe("paired");
}

async function syncNow(install: BootedTestApp): Promise<void> {
  await install.client.cloud.syncNow();
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

    const { thread } = await a.client.threads.create({ title: "Shared" });

    const sent = await a.client.threads.send({
      threadId: thread.id,
      text: "hello from A",
    });
    expect(sent.kind).toBe("started");

    await syncNow(a);
    await syncNow(b);

    // The thread exists on B with the id the ACCOUNT gave it, not one B minted.
    const detail = await b.client.threads.get({ threadId: thread.id });
    expect(detail.thread.id).toBe(thread.id);

    // One writer, so one order — see the concurrent case below for what is
    // NOT claimed.
    const order = eventOrder(a, thread.id);
    expect(order.length).toBeGreaterThan(3);
    expect(eventOrder(b, thread.id)).toEqual(order);

    // B's timeline renders the same conversation A's does.
    const body = await b.client.threads.timeline({ threadId: thread.id });
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

    const { thread } = await a.client.threads.create({ title: "Idempotent" });
    await a.client.threads.send({
      threadId: thread.id,
      text: "once",
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

    const { thread } = await a.client.threads.create({ title: "Concurrent" });
    await a.client.threads.send({
      threadId: thread.id,
      text: "seed",
    });
    await syncNow(a);
    await syncNow(b);

    // Both write before either syncs — genuinely concurrent.
    await a.client.threads.send({
      threadId: thread.id,
      text: "from A",
    });
    await b.client.threads.send({
      threadId: thread.id,
      text: "from B",
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

    const { thread } = await a.client.threads.create({ title: "Re-paired" });
    await a.client.threads.send({
      threadId: thread.id,
      text: "before the re-pair",
    });
    await syncNow(a);
    await syncNow(b);
    const before = eventOrder(b, thread.id);
    expect(before.length).toBeGreaterThan(3);

    // Unpair forgets the cursor along with everything else the old credential
    // meant, so the next pairing pulls the log from its FIRST row — and every
    // one of those rows is already here.
    await b.client.cloud.unpair();
    await pair(b, cloud, "CCCC-CCCC");
    await syncNow(b);
    await syncNow(b);

    expect(eventOrder(b, thread.id)).toEqual(before);
    // Still idle: a replayed `turn/started` projected again would have left the
    // thread running for a turn that finished long ago.
    const detail = await b.client.threads.get({ threadId: thread.id });
    expect(detail.thread.status).toBe("idle");
  });

  it("leaves a turn running on another device alone across a reboot", async () => {
    const cloud = new FakeCloud();
    // A holds its turn OPEN: `manual` emits turn/started and nothing after, so
    // what B pulls is a turn whose provider is alive on another machine.
    const a = await bootInstall(cloud, "manual");
    const b = await bootInstall(cloud);
    await pair(a, cloud, "AAAA-AAAA");
    await pair(b, cloud, "BBBB-BBBB");

    const { thread } = await a.client.threads.create({ title: "Long task" });
    await a.client.threads.send({
      threadId: thread.id,
      text: "run it",
    });
    await syncNow(a);
    await syncNow(b);

    const pulled = await b.client.threads.get({ threadId: thread.id });
    expect(pulled.thread.status).toBe("active");

    // A REBOOT of B: a second ThreadService over the same database runs the
    // wedged-thread sweep at boot(). It must not declare a provider it does
    // not own to be dead — that failure would be fabricated here and then
    // pushed back to the machine still doing the work.
    const rebooted = new ThreadService({
      db: b.db,
      notifier: new NotificationBuffer(),
      createTurnDriver: () => unavailableTurnDriver,
    });
    rebooted.boot();
    expect(rebooted.list().some((row) => row.id === thread.id)).toBe(true);
    expect(eventOrder(b, thread.id).some((row) => row.startsWith("provider/error"))).toBe(false);
    const afterReboot = await b.client.threads.get({ threadId: thread.id });
    expect(afterReboot.thread.status).toBe("active");
  });

  it("carries B's reply back to A, so the log is genuinely two-way", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await pair(a, cloud, "AAAA-AAAA");
    await pair(b, cloud, "BBBB-BBBB");

    const { thread } = await a.client.threads.create({ title: "Two-way" });
    await a.client.threads.send({
      threadId: thread.id,
      text: "from A",
    });
    await syncNow(a);
    await syncNow(b);

    await b.client.threads.send({
      threadId: thread.id,
      text: "from B",
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
