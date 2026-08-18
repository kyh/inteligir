// TWO INSTALLS, ONE ACCOUNT, ONE ORDER — issue #572's second acceptance, and
// the only test here that drives the WHOLE stack: the real thread service, the
// real ingest, the real routes, on two separate databases and vaults, against
// one `FakeCloud`.
//
// The honest bound, stated because it changes what this proves: `FakeCloud` is
// the contract over Maps, not the deployed Worker. What runs against the real
// Durable Object is `apps/web/src/worker/__tests__/thread-sync.test.ts`, which
// cannot reach this half — it runs on workerd, and this half is a Node process
// with better-sqlite3 in it. So the two suites meet at the contract, which is
// exactly what the contract is for.

import { listStoredThreadEvents } from "@repo/db/events";
import { describe, expect, it } from "vitest";
import { bootTestApp, type BootedTestApp } from "../../__tests__/boot-app";
import { FakeTurnDriver } from "../../__tests__/fake-turn-driver";
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
async function bootInstall(cloud: FakeCloud): Promise<BootedTestApp> {
  return await bootTestApp({
    cloudTransport: { fetch: cloud.fetch, pollIntervalMs: null },
    makeDriver: () => ({
      createTurnDriver: (sink) => new FakeTurnDriver(sink, { mode: "scripted" }),
    }),
  });
}

async function pair(install: BootedTestApp, cloud: FakeCloud, code: string): Promise<void> {
  cloud.mintCode(code);
  const response = ok(
    await install.client.cloud.pair.$post({ json: { code, deviceName: `device-${code}` } }),
  );
  expect((await response.json()).state).toBe("paired");
}

async function syncNow(install: BootedTestApp): Promise<void> {
  ok(await install.client.cloud.sync.$post());
}

/** Every event this database holds for a thread, as `(type, sequence)` — the
 *  shape a comparison across two devices can be made in. */
function eventOrder(install: BootedTestApp, threadId: string): string[] {
  return listStoredThreadEvents(install.db, { threadId }).map(
    (stored) => `${stored.sequence} ${stored.event.type}`,
  );
}

describe("two installs against one account", () => {
  it("converge: a thread used on A appears on B, with the events in one order", async () => {
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

    // ONE order, and it is A's — the merged log is what decides it.
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
