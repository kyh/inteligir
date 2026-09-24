import type { ForkOptions } from "electron";
import type {
  AttachFrame,
  ForkReply,
  ForkRequest,
} from "inteligir/server/child-host/fork-broker-wire";
import { forkRequestSchema } from "inteligir/server/child-host/fork-broker-wire";
import { describe, expect, it } from "vitest";
import { createForkBroker } from "../fork-broker";
import type { BrokeredChild } from "../fork-broker";

type Port = string;

class FakeChild implements BrokeredChild<Port> {
  pid: number | undefined = undefined;
  kills = 0;
  readonly posted: [AttachFrame, Port[]][] = [];
  #spawn: (() => void) | null = null;
  #exit: ((code: number) => void) | null = null;

  once(event: "spawn", listener: () => void): void;
  once(event: "exit", listener: (code: number) => void): void;
  once(event: "spawn" | "exit", listener: (code: number) => void): void {
    if (event === "spawn") {
      this.#spawn = () => {
        listener(0);
      };
    } else {
      this.#exit = listener;
    }
  }

  postMessage(message: AttachFrame, transfer: Port[]): void {
    this.posted.push([message, transfer]);
  }

  kill(): boolean {
    this.kills += 1;
    return true;
  }

  spawned(pid: number): void {
    this.pid = pid;
    this.#spawn?.();
  }

  exited(code: number): void {
    this.#exit?.(code);
  }
}

interface Harness {
  broker: ReturnType<typeof createForkBroker>;
  children: FakeChild[];
  forks: [string, string[], ForkOptions][];
  replies: [ForkReply, Port[]][];
  logs: string[];
}

const harness = (options: { forkThrows?: boolean; replyThrows?: boolean } = {}): Harness => {
  const children: FakeChild[] = [];
  const forks: [string, string[], ForkOptions][] = [];
  const replies: [ForkReply, Port[]][] = [];
  const logs: string[] = [];
  let channels = 0;
  const broker = createForkBroker<Port>({
    createChannel: () => {
      channels += 1;
      return { port1: `server-end-${String(channels)}`, port2: `child-end-${String(channels)}` };
    },
    fork: (modulePath, args, forkOptions) => {
      if (options.forkThrows === true) {
        throw new Error("no such module");
      }
      forks.push([modulePath, args, forkOptions]);
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    log: (message) => {
      logs.push(message);
    },
    reply: (message, transfer) => {
      if (options.replyThrows === true) {
        throw new Error("the server is gone");
      }
      replies.push([message, transfer]);
    },
  });
  return { broker, children, forks, logs, replies };
};

const REQUEST: ForkRequest = {
  args: ["/app/adapter.js"],
  cwd: "/vault",
  env: { PATH: "/bin" },
  id: "fork_1",
  kind: "fork",
  modulePath: "/app/dist/stdio-port-host.mjs",
  serviceName: "inteligir-agent-claude",
};

describe("main's fork broker", () => {
  it("forks what the server asked for, and hands each end of one channel out once it spawns", () => {
    const { broker, children, forks, replies } = harness();
    broker.fork(REQUEST);
    expect(forks).toEqual([
      [
        "/app/dist/stdio-port-host.mjs",
        ["/app/adapter.js"],
        {
          cwd: "/vault",
          env: { PATH: "/bin" },
          serviceName: "inteligir-agent-claude",
          stdio: "inherit",
        },
      ],
    ]);
    expect(replies).toEqual([]);
    children[0]?.spawned(321);
    expect(children[0]?.posted).toEqual([[{ kind: "attach" }, ["child-end-1"]]]);
    expect(replies).toEqual([[{ id: "fork_1", kind: "forked", pid: 321 }, ["server-end-1"]]]);
  });

  it("reports each exit to the server", () => {
    const { broker, children, replies } = harness();
    broker.fork(REQUEST);
    children[0]?.spawned(321);
    children[0]?.exited(9);
    expect(replies.at(-1)).toEqual([{ code: 9, id: "fork_1", kind: "exited" }, []]);
  });

  it("takes nothing but a whole fork request off the wire", () => {
    expect(forkRequestSchema.safeParse(REQUEST).success).toBe(true);
    expect(forkRequestSchema.safeParse({ ...REQUEST, modulePath: "" }).success).toBe(false);
    expect(forkRequestSchema.safeParse({ ...REQUEST, extra: true }).success).toBe(false);
    expect(forkRequestSchema.safeParse("fork").success).toBe(false);
  });

  it("answers a fork that throws as failed", () => {
    const { broker, replies } = harness({ forkThrows: true });
    broker.fork(REQUEST);
    expect(replies).toEqual([
      [{ id: "fork_1", kind: "fork-failed", message: "no such module" }, []],
    ]);
  });

  it("kills the children still running once the server is gone, and no others", () => {
    const { broker, children } = harness();
    broker.fork(REQUEST);
    broker.fork({ ...REQUEST, id: "fork_2" });
    children[0]?.spawned(1);
    children[1]?.spawned(2);
    children[0]?.exited(0);
    broker.dispose();
    expect(children.map((child) => child.kills)).toEqual([0, 1]);
  });

  it("logs a reply the server can no longer take, rather than throwing in main", () => {
    const { broker, children, logs } = harness({ replyThrows: true });
    broker.fork(REQUEST);
    expect(() => {
      children[0]?.spawned(321);
      children[0]?.exited(0);
    }).not.toThrow();
    expect(logs).toHaveLength(2);
  });
});
