// Drives the subprocess proxy's lifecycle against an in-memory child channel:
// the protocol, replay-on-respawn and self-healing are testable without ever
// forking a process (the real fork path is exercised by running the app).

import { describe, expect, it } from "vitest";
import type { ChildToParentMessage, ParentToChildMessage } from "../watcher/messages";
import type { ParcelWatcherEventBatch } from "../watcher/parcel-backend";
import { createParcelWatcherProxy, type ChildChannel } from "../watcher/parcel-watcher-proxy";

interface FakeChild {
  channel: ChildChannel;
  sent: ParentToChildMessage[];
  killed: boolean;
  emit(message: ChildToParentMessage): void;
  exit(): void;
}

function createFakeChildFactory() {
  const children: FakeChild[] = [];
  function spawnChannel(): ChildChannel {
    const sent: ParentToChildMessage[] = [];
    const messageListeners: Array<(message: ChildToParentMessage) => void> = [];
    const exitListeners: Array<() => void> = [];
    const child: FakeChild = {
      sent,
      killed: false,
      channel: {
        send: (message) => sent.push(message),
        onMessage: (listener) => messageListeners.push(listener),
        onExit: (listener) => exitListeners.push(listener),
        kill: () => {
          child.killed = true;
        },
      },
      emit: (message) => {
        for (const listener of messageListeners) {
          listener(message);
        }
      },
      exit: () => {
        for (const listener of exitListeners) {
          listener();
        }
      },
    };
    children.push(child);
    return child.channel;
  }
  return { children, spawnChannel };
}

function subscribeMessages(child: FakeChild) {
  return child.sent.filter(
    (message): message is Extract<ParentToChildMessage, { kind: "subscribe" }> =>
      message.kind === "subscribe",
  );
}

describe("the parcel watcher proxy", () => {
  it("subscribes through the child and delivers its event batches", async () => {
    const { children, spawnChannel } = createFakeChildFactory();
    const proxy = createParcelWatcherProxy({ spawnChannel });
    const batches: ParcelWatcherEventBatch[] = [];

    await proxy.subscribe("/vault", (_error, events) => batches.push(events), {
      ignore: [".git"],
    });
    expect(children).toHaveLength(1);
    const child = children[0];
    if (!child) {
      throw new Error("expected a spawned child");
    }

    child.emit({ kind: "ready" });
    const subscribes = subscribeMessages(child);
    expect(subscribes).toHaveLength(1);
    expect(subscribes[0]).toMatchObject({
      dir: "/vault",
      rescan: false,
      opts: { ignore: [".git"] },
    });

    const id = subscribes[0]?.id ?? "";
    child.emit({ kind: "events", id, events: [{ path: "/vault/a.md", type: "update" }] });
    expect(batches).toEqual([[{ path: "/vault/a.md", type: "update" }]]);
    proxy.dispose();
  });

  it("respawns a dead child and replays the subscription with a rescan", async () => {
    const { children, spawnChannel } = createFakeChildFactory();
    const proxy = createParcelWatcherProxy({ spawnChannel });
    await proxy.subscribe("/vault", () => {});
    const first = children[0];
    if (!first) {
      throw new Error("expected a spawned child");
    }
    first.emit({ kind: "ready" });
    first.emit({ kind: "pong" });

    first.exit();
    expect(children).toHaveLength(2);
    const second = children[1];
    if (!second) {
      throw new Error("expected a respawned child");
    }
    second.emit({ kind: "ready" });
    const replayed = subscribeMessages(second);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({ dir: "/vault", rescan: true });
    proxy.dispose();
  });

  it("recycles the whole child on a backend watch-error", async () => {
    const { children, spawnChannel } = createFakeChildFactory();
    const proxy = createParcelWatcherProxy({ spawnChannel });
    await proxy.subscribe("/vault", () => {});
    const first = children[0];
    if (!first) {
      throw new Error("expected a spawned child");
    }
    first.emit({ kind: "ready" });
    first.emit({ kind: "pong" });
    const firstId = subscribeMessages(first)[0]?.id ?? "";

    first.emit({ kind: "watch-error", id: firstId, message: "inotify poll interrupted" });
    expect(first.killed).toBe(true);
    expect(children).toHaveLength(2);
    proxy.dispose();
  });

  it("stops respawning once disposed", async () => {
    const { children, spawnChannel } = createFakeChildFactory();
    const proxy = createParcelWatcherProxy({ spawnChannel });
    await proxy.subscribe("/vault", () => {});
    const first = children[0];
    if (!first) {
      throw new Error("expected a spawned child");
    }
    proxy.dispose();
    expect(first.killed).toBe(true);
    first.exit();
    expect(children).toHaveLength(1);
  });
});
