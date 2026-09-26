import { listStoredThreadEvents } from "@repo/db/events";
import { NotificationBuffer } from "@repo/domain/notifier";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { getThread, setThreadProviderSession } from "@repo/db/threads";
import { turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it, onTestFinished } from "vitest";
import { bootThreadHarness } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";
import { ThreadService } from "../../threads/service";
import { unavailableTurnDriver } from "../../threads/turn-driver";
import { createCloudRuntime } from "../sync-runtime";
import type { CloudRuntime } from "../sync-runtime";
import { FAKE_ACCOUNT, FakeCloud } from "./fake-cloud";
import { pathOnlyOrigins } from "../../__tests__/path-only-origins";

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

// the cloud half of a restart on the same data dir under `build`: the running runtime stops, and
// a new one boots over the same db and credential with its own ingest.
const rebootCloud = async (
  install: BootedTestApp,
  running: CloudRuntime,
  cloud: FakeCloud,
  build: string,
): Promise<CloudRuntime> => {
  await running.dispose();
  const runtime = createCloudRuntime({
    build,
    cloudUrl: install.config.cloudUrl,
    dataDir: install.dataDir,
    db: install.db,
    onDebug: () => {},
    transport: { fetch: cloud.fetch, pollIntervalMs: null },
    vault: install.vault.service,
  });
  runtime.attach(
    new ThreadService({
      createTurnDriver: () => unavailableTurnDriver,
      db: install.db,
      notifier: new NotificationBuffer(),
      origins: pathOnlyOrigins,
      sync: runtime,
    }),
  );
  onTestFinished(async () => {
    await runtime.dispose();
  });
  return runtime;
};

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

  it("adds nothing when the writer itself signs in again and pulls back its own rows", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    await login(a, "A");

    const { thread } = await a.client.threads.create({ title: "Written here" });
    await a.client.threads.send({
      text: "before signing out",
      threadId: thread.id,
    });
    await syncNow(a);
    const before = eventOrder(a, thread.id);
    expect(before.length).toBeGreaterThan(3);

    await a.client.cloud.logout();
    await login(a, "A again");
    await syncNow(a);
    await syncNow(a);

    expect(eventOrder(a, thread.id)).toEqual(before);
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
      origins: pathOnlyOrigins,
    });
    rebooted.boot();
    const listed = await rebooted.list({});
    expect(listed.threads.some((row) => row.id === thread.id)).toBe(true);
    expect(eventOrder(b, thread.id).some((row) => row.startsWith("provider/error"))).toBe(false);
    const afterReboot = await b.client.threads.get({ threadId: thread.id });
    expect(afterReboot.thread.status).toBe("active");
  });

  it("carries a 200KB command output to the other install clipped, and settled there", async () => {
    const cloud = new FakeCloud();
    // manual: the turn stays open for the test to stream into.
    const a = await bootInstall(cloud, "manual");
    const b = await bootInstall(cloud);
    await login(a, "A");
    await login(b, "B");

    const { thread } = await a.client.threads.create({ title: "Big build" });
    await a.client.threads.send({ text: "build it", threadId: thread.id });
    const started = listStoredThreadEvents(a.db, { threadId: thread.id }).find(
      ({ event }) => event.type === "turn/started",
    );
    if (started?.event.scope.kind !== "turn") {
      throw new Error("expected the turn to have started");
    }
    const { turnId } = started.event.scope;
    const scope = turnScope(turnId);
    const output = "compiling…\n".repeat(20_000);
    a.composed.context.threads.ingestProviderEvents(thread.id, [
      {
        item: {
          approvalStatus: null,
          command: "make",
          cwd: "/vault",
          id: "item_build",
          status: "pending",
          type: "commandExecution",
        },
        scope,
        threadId: thread.id,
        type: "item/started",
      },
      {
        item: {
          aggregatedOutput: output,
          approvalStatus: null,
          command: "make",
          cwd: "/vault",
          exitCode: 0,
          id: "item_build",
          status: "completed",
          type: "commandExecution",
        },
        scope,
        threadId: thread.id,
        type: "item/completed",
      },
      { scope, status: "completed", threadId: thread.id, type: "turn/completed" },
    ]);
    await syncNow(a);
    await syncNow(b);

    const commandRow = async (install: BootedTestApp) => {
      const body = await install.client.threads.timeline({ threadId: thread.id });
      if (body.kind !== "full") {
        throw new Error("expected a full timeline");
      }
      const row = body.timeline.rows
        .flatMap((top) => (top.kind === "turn" ? top.children : [top]))
        .find((child) => child.id === `item:${turnId}:item_build`);
      if (row?.kind !== "work" || row.workKind !== "command") {
        throw new Error("expected the command row");
      }
      return row;
    };
    const onA = await commandRow(a);
    const onB = await commandRow(b);
    expect(onB.status).toBe("completed");
    expect(onA.outputLineCount).toBe(20_000);
    expect(onB.outputLineCount).toBeLessThan(onA.outputLineCount);
    expect(onB.outputHead).toEqual(onA.outputHead);
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

  it("carries a thread's title, note, harness and archive to the other install", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await login(a, "A");
    await login(b, "B");

    await a.client.vault.write({
      content: "# Week\n",
      guard: { kind: "overwrite" },
      path: "Week.md",
    });
    const { thread } = await a.client.threads.create({
      originDocPath: "Week.md",
      title: "Plan the week",
    });
    // the bind a real runtime makes before its first prompt; the scripted driver makes none.
    setThreadProviderSession(a.db, {
      providerId: "codex",
      providerThreadId: "session_on_a",
      threadId: thread.id,
    });
    await a.client.threads.send({ text: "draft a plan", threadId: thread.id });
    await syncNow(a);
    await syncNow(b);

    const pulled = await b.client.threads.get({ threadId: thread.id });
    expect(pulled.thread).toMatchObject({
      archivedAt: null,
      originDocPath: "Week.md",
      providerId: "codex",
      title: "Plan the week",
    });
    expect(getThread(b.db, thread.id)?.providerThreadId).toBeNull();

    await a.client.vault.rename({ from: "Week.md", to: "Plans/Week.md" });
    await a.client.threads.archive({ threadId: thread.id });
    await syncNow(a);
    await syncNow(b);
    // the move reaches B through git, never the log: B's vault takes A's bytes, the note's id with
    // them, and B's thread follows that id.
    const { content } = await a.client.vault.read({ path: "Plans/Week.md" });
    await b.client.vault.write({ content, guard: { kind: "overwrite" }, path: "Plans/Week.md" });

    const moved = await b.client.threads.get({ threadId: thread.id });
    expect(moved.thread.originDocPath).toBe("Plans/Week.md");
    expect(moved.thread.archivedAt).not.toBeNull();
    expect(eventOrder(b, thread.id)).toEqual(eventOrder(a, thread.id));
  });

  it("stops its own running turn when the other install archives the thread", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    // manual: B's turn stays open until something stops it.
    const b = await bootThreadHarness(
      { mode: "manual" },
      { cloudTransport: { fetch: cloud.fetch, pollIntervalMs: null } },
    );
    await login(a, "A");
    await login(b, "B");

    const { thread } = await a.client.threads.create({ title: "Shared" });
    await a.client.threads.send({ text: "from A", threadId: thread.id });
    await syncNow(a);
    await syncNow(b);
    const sent = await b.client.threads.send({ text: "from B", threadId: thread.id });
    expect(sent.kind).toBe("started");

    await a.client.threads.archive({ threadId: thread.id });
    await syncNow(a);
    await syncNow(b);

    expect(b.driver.interruptedThreads).toEqual([thread.id]);
    const detail = await b.client.threads.get({ threadId: thread.id });
    expect(detail.thread.status).toBe("idle");
    expect(detail.thread.archivedAt).not.toBeNull();
  });

  it("keeps a thread that never made a request on its own install, archived or moved", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await login(a, "A");
    await login(b, "B");

    await a.client.vault.write({
      content: "# Draft\n",
      guard: { kind: "overwrite" },
      path: "Draft.md",
    });
    const { thread } = await a.client.threads.create({ originDocPath: "Draft.md" });
    await a.client.vault.rename({ from: "Draft.md", to: "Kept/Draft.md" });
    await a.client.threads.archive({ threadId: thread.id });
    await syncNow(a);
    await syncNow(b);

    expect(cloud.logSize()).toBe(0);
    const onB = await b.client.threads.list({ includeArchived: true });
    expect(onB.threads).toEqual([]);
    const local = await a.client.threads.get({ threadId: thread.id });
    expect(local.thread.originDocPath).toBe("Kept/Draft.md");
    expect(local.thread.archivedAt).not.toBeNull();
  });

  it("pulls a row an older build skipped once a build that reads it boots, and lands it once", async () => {
    const cloud = new FakeCloud();
    const a = await bootInstall(cloud);
    const b = await bootInstall(cloud);
    await login(a, "A");
    await login(b, "B");

    const { thread } = await a.client.threads.create({ title: "Newer grammar" });
    await a.client.threads.send({ text: "hello", threadId: thread.id });
    await syncNow(a);
    const written = eventSet(a, thread.id);

    // B's build predates the type, so the planner moves B's cursor past the row.
    cloud.unreadableTypes.add("item/completed");
    await syncNow(b);
    const held = eventSet(b, thread.id);
    expect(written.filter((event) => !held.includes(event))).toEqual([
      "item/completed Echo: hello",
    ]);

    // the grammar that reads it ships; the build B already ran does not look back.
    cloud.unreadableTypes.clear();
    const sameBuild = await rebootCloud(b, b.composed.context.cloud, cloud, "0.1.0-test");
    await sameBuild.syncNow();
    expect(eventSet(b, thread.id)).toEqual(held);

    const nextBuild = await rebootCloud(b, sameBuild, cloud, "0.2.0-test");
    await nextBuild.syncNow();
    expect(eventSet(b, thread.id)).toEqual(written);
    await nextBuild.syncNow();
    expect(eventSet(b, thread.id)).toEqual(written);
  });
});
