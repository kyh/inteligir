import { listStoredThreadEvents } from "@repo/db/events";
import { NotificationBuffer } from "@repo/domain/notifier";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { describe, expect, it } from "vitest";
import { bootThreadHarness } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";
import { ThreadService } from "../../threads/service";
import { unavailableTurnDriver } from "../../threads/turn-driver";
import { FAKE_ACCOUNT, FakeCloud } from "./fake-cloud";

// pollIntervalMs: null — the test triggers every pass itself.
const bootInstall = async (
  cloud: FakeCloud,
  mode: "scripted" | "manual" = "scripted",
): Promise<BootedTestApp> =>
  await bootThreadHarness(
    { mode },
    { cloudTransport: { fetch: cloud.fetch, pollIntervalMs: null } },
  );

const login = async (install: BootedTestApp, deviceName: string): Promise<void> => {
  const status = await install.client.cloud.login({ ...FAKE_ACCOUNT, deviceName });
  expect(status.state).toBe("signed-in");
};

const syncNow = async (install: BootedTestApp): Promise<void> => {
  await install.client.cloud.syncNow();
};

const saidText = (event: ThreadEvent): string => {
  if (event.type === "client/turn/requested") {
    return event.text;
  }
  if (event.type === "item/completed" && event.item.type === "agentMessage") {
    return event.item.text;
  }
  return "";
};

const eventOrder = (install: BootedTestApp, threadId: string): string[] =>
  listStoredThreadEvents(install.db, { threadId }).map(({ event }) =>
    `${event.type} ${saidText(event)}`.trim(),
  );

const eventSet = (install: BootedTestApp, threadId: string): string[] =>
  eventOrder(install, threadId).toSorted();

const writerBlock = (order: readonly string[], text: string): string[] => {
  const start = order.indexOf(`client/turn/requested ${text}`);
  if (start === -1) {
    throw new Error(`no turn for "${text}"`);
  }
  return order.slice(start, start + 7);
};

describe("two installs against one account", () => {
  it("converge: a thread used on A appears on B, in A's order", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await login(a, "A");
    await login(b, "B");

    const { thread } = await a.client.threads.create({ title: "Shared" });

    const sent = await a.client.threads.send({
      text: "hello from A",
      threadId: thread.id,
    });
    expect(sent.kind).toBe("started");

    await syncNow(a);
    await syncNow(b);

    const detail = await b.client.threads.get({ threadId: thread.id });
    expect(detail.thread.id).toBe(thread.id);

    const order = eventOrder(a, thread.id);
    expect(order.length).toBeGreaterThan(3);
    expect(eventOrder(b, thread.id)).toEqual(order);

    const body = await b.client.threads.timeline({ threadId: thread.id });
    if (body.kind !== "full") {
      throw new Error("expected a full timeline");
    }
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
    await login(a, "A");
    await login(b, "B");

    const { thread } = await a.client.threads.create({ title: "Idempotent" });
    await a.client.threads.send({
      text: "once",
      threadId: thread.id,
    });
    await syncNow(a);

    await syncNow(b);
    const afterFirst = eventOrder(b, thread.id);
    await syncNow(b);
    await syncNow(b);
    expect(eventOrder(b, thread.id)).toEqual(afterFirst);
  });

  it("holds the same set, and keeps each writer's own turn in order", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await login(a, "A");
    await login(b, "B");

    const { thread } = await a.client.threads.create({ title: "Concurrent" });
    await a.client.threads.send({
      text: "seed",
      threadId: thread.id,
    });
    await syncNow(a);
    await syncNow(b);

    await a.client.threads.send({
      text: "from A",
      threadId: thread.id,
    });
    await b.client.threads.send({
      text: "from B",
      threadId: thread.id,
    });
    await syncNow(a);
    await syncNow(b);
    await syncNow(a);

    const onA = eventOrder(a, thread.id);
    const onB = eventOrder(b, thread.id);

    expect(eventSet(b, thread.id)).toEqual(eventSet(a, thread.id));
    expect(onB).not.toEqual(onA);
    for (const text of ["seed", "from A", "from B"]) {
      expect(writerBlock(onB, text)).toEqual(writerBlock(onA, text));
    }
  });

  it("adds nothing when a device that signed in again replays the account's whole log", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await login(a, "A");
    await login(b, "B");

    const { thread } = await a.client.threads.create({ title: "Signed in again" });
    await a.client.threads.send({
      text: "before signing out",
      threadId: thread.id,
    });
    await syncNow(a);
    await syncNow(b);
    const before = eventOrder(b, thread.id);
    expect(before.length).toBeGreaterThan(3);

    await b.client.cloud.logout();
    await login(b, "B again");
    await syncNow(b);
    await syncNow(b);

    expect(eventOrder(b, thread.id)).toEqual(before);
    const detail = await b.client.threads.get({ threadId: thread.id });
    expect(detail.thread.status).toBe("idle");
  });

  it("leaves a turn running on another device alone across a reboot", async () => {
    const cloud = new FakeCloud();
    // manual: emits turn/started and nothing after, so the turn stays open.
    const a = await bootInstall(cloud, "manual");
    const b = await bootInstall(cloud);
    await login(a, "A");
    await login(b, "B");

    const { thread } = await a.client.threads.create({ title: "Long task" });
    await a.client.threads.send({
      text: "run it",
      threadId: thread.id,
    });
    await syncNow(a);
    await syncNow(b);

    const pulled = await b.client.threads.get({ threadId: thread.id });
    expect(pulled.thread.status).toBe("active");

    const rebooted = new ThreadService({
      createTurnDriver: () => unavailableTurnDriver,
      db: b.db,
      notifier: new NotificationBuffer(),
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
    await login(a, "A");
    await login(b, "B");

    const { thread } = await a.client.threads.create({ title: "Two-way" });
    await a.client.threads.send({
      text: "from A",
      threadId: thread.id,
    });
    await syncNow(a);
    await syncNow(b);

    await b.client.threads.send({
      text: "from B",
      threadId: thread.id,
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
