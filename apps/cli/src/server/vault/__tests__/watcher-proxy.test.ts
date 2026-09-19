import { describe, expect, it } from "vitest";
import type { ChildToParentMessage, ParentToChildMessage } from "../watcher/messages";
import type { ParcelWatcherEventBatch } from "../watcher/parcel-backend";
import { createParcelWatcherProxy } from "../watcher/parcel-watcher-proxy";
import type { ChildChannel } from "../watcher/parcel-watcher-proxy";

interface FakeChild {
  channel: ChildChannel;
  sent: ParentToChildMessage[];
  killed: boolean;
  emit: (message: ChildToParentMessage) => void;
  exit: () => void;
}

const createFakeChildFactory = () => {
  const children: FakeChild[] = [];
  const spawnChannel = (): ChildChannel => {
    const sent: ParentToChildMessage[] = [];
    const messageListeners: ((message: ChildToParentMessage) => void)[] = [];
    const exitListeners: (() => void)[] = [];
    const child: FakeChild = {
      channel: {
        kill: () => {
          child.killed = true;
        },
        onExit: (listener) => {
          exitListeners.push(listener);
        },
        onMessage: (listener) => {
          messageListeners.push(listener);
        },
        send: (message) => {
          sent.push(message);
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
      killed: false,
      sent,
    };
    children.push(child);
    return child.channel;
  };
  return { children, spawnChannel };
};

const subscribeMessages = (child: FakeChild) =>
  child.sent.filter(
    (message): message is Extract<ParentToChildMessage, { kind: "subscribe" }> =>
      message.kind === "subscribe",
  );

describe("the parcel watcher proxy", () => {
  it("subscribes through the child and delivers its event batches", async () => {
    const { children, spawnChannel } = createFakeChildFactory();
    const proxy = createParcelWatcherProxy({ spawnChannel });
    const batches: ParcelWatcherEventBatch[] = [];

    await proxy.subscribe(
      "/vault",
      (_error, events) => {
        batches.push(events);
      },
      { ignore: [".git"] },
    );
    expect(children).toHaveLength(1);
    const [child] = children;
    if (!child) {
      throw new Error("expected a spawned child");
    }

    child.emit({ kind: "ready" });
    const subscribes = subscribeMessages(child);
    expect(subscribes).toHaveLength(1);
    expect(subscribes[0]).toMatchObject({
      dir: "/vault",
      opts: { ignore: [".git"] },
      rescan: false,
    });

    const id = subscribes[0]?.id ?? "";
    child.emit({ events: [{ path: "/vault/a.md", type: "update" }], id, kind: "events" });
    expect(batches).toEqual([[{ path: "/vault/a.md", type: "update" }]]);
    proxy.dispose();
  });

  it("respawns a dead child and replays the subscription with a rescan", async () => {
    const { children, spawnChannel } = createFakeChildFactory();
    const proxy = createParcelWatcherProxy({ spawnChannel });
    await proxy.subscribe("/vault", () => {});
    const [first] = children;
    if (!first) {
      throw new Error("expected a spawned child");
    }
    first.emit({ kind: "ready" });
    first.emit({ kind: "pong" });

    first.exit();
    expect(children).toHaveLength(2);
    const [, second] = children;
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
    const [first] = children;
    if (!first) {
      throw new Error("expected a spawned child");
    }
    first.emit({ kind: "ready" });
    first.emit({ kind: "pong" });
    const firstId = subscribeMessages(first)[0]?.id ?? "";

    first.emit({ id: firstId, kind: "watch-error", message: "inotify poll interrupted" });
    expect(first.killed).toBe(true);
    expect(children).toHaveLength(2);
    proxy.dispose();
  });

  it("stops respawning once disposed", async () => {
    const { children, spawnChannel } = createFakeChildFactory();
    const proxy = createParcelWatcherProxy({ spawnChannel });
    await proxy.subscribe("/vault", () => {});
    const [first] = children;
    if (!first) {
      throw new Error("expected a spawned child");
    }
    proxy.dispose();
    expect(first.killed).toBe(true);
    first.exit();
    expect(children).toHaveLength(1);
  });
});
