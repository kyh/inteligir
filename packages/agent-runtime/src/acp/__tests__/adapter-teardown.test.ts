import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createAcpAgentRuntime } from "../acp-runtime";
import type { AgentRuntime } from "../../types";

const FAKE_AGENT = fileURLToPath(new URL("../../test-support/fake-acp-agent.mjs", import.meta.url));

// never answers ACP, outlives its stdin's end and runs a child of its own in its group, saying so
// on stderr once that child is up; `onTerm` is what it does with a SIGTERM.
const withChild = (onTerm: string): string => `
process.on("SIGTERM", () => { ${onTerm} });
require("node:child_process")
  .spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
  .once("spawn", () => { process.stderr.write("ready\\n"); });
setInterval(() => {}, 1000);
`;

// an adapter wedged with its own child still running.
const WEDGED_AGENT = withChild("");

// codex-acp's way with a SIGTERM: it exits, leaving its app-server behind.
const ORPHANING_AGENT = withChild("process.exit(0);");

const groupAlive = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

const groups: number[] = [];

afterEach(() => {
  for (const pgid of groups.splice(0)) {
    if (groupAlive(pgid)) {
      process.kill(-pgid, "SIGKILL");
    }
  }
});

const THREAD_ID = "thr_1";

interface Spawned {
  runtime: AgentRuntime;
  adapters: ChildProcessWithoutNullStreams[];
  stderr: string[];
}

const runtimeOver = (argv: readonly string[]): Spawned => {
  const spawned: Spawned = {
    adapters: [],
    runtime: createAcpAgentRuntime({
      onEvent: () => {
        /* empty */
      },
      onStderr: (line) => {
        spawned.stderr.push(line);
      },
      spawnAdapter: (_harness, env) => {
        const adapter = spawn(process.execPath, argv, {
          detached: true,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        if (adapter.pid !== undefined) {
          groups.push(adapter.pid);
        }
        spawned.adapters.push(adapter);
        return adapter;
      },
      workspacePath: process.cwd(),
    }),
    stderr: [],
  };
  onTestFinished(async () => {
    await spawned.runtime.shutdown();
  });
  return spawned;
};

// the one adapter's process group, once its own child is up.
const readyGroup = async ({ adapters, stderr }: Spawned): Promise<number> => {
  await vi.waitFor(() => {
    expect(stderr).toContain("ready");
  });
  const [adapter] = adapters;
  if (adapter?.pid === undefined) {
    throw new Error("the runtime started no adapter");
  }
  return adapter.pid;
};

describe("ending an adapter", { timeout: 20_000 }, () => {
  it("lets one that stops at its stdin's end exit on its own", async () => {
    const spawned = runtimeOver([FAKE_AGENT]);
    await spawned.runtime.startThread({ providerId: "codex", threadId: THREAD_ID });

    await spawned.runtime.closeThread(THREAD_ID);

    expect(spawned.adapters.map((adapter) => [adapter.exitCode, adapter.signalCode])).toEqual([
      [0, null],
    ]);
  });

  it("gives a wedged one its grace, then kills its whole group", async () => {
    const spawned = runtimeOver(["-e", WEDGED_AGENT]);
    const refused = expect(
      spawned.runtime.startThread({ providerId: "codex", threadId: THREAD_ID }),
    ).rejects.toThrow(/adapter exited \(signal SIGKILL\)/u);
    const pgid = await readyGroup(spawned);

    const closing = spawned.runtime.closeThread(THREAD_ID);
    await delay(500);
    expect(groupAlive(pgid)).toBe(true);

    await closing;
    await vi.waitFor(() => {
      expect(groupAlive(pgid)).toBe(false);
    });
    await refused;
  });

  it("kills the child one left behind when it exited", async () => {
    const spawned = runtimeOver(["-e", ORPHANING_AGENT]);
    const refused = expect(
      spawned.runtime.startThread({ providerId: "codex", threadId: THREAD_ID }),
    ).rejects.toThrow(/adapter exited \(code 0\)/u);
    const pgid = await readyGroup(spawned);

    await spawned.runtime.closeThread(THREAD_ID);

    await vi.waitFor(() => {
      expect(groupAlive(pgid)).toBe(false);
    });
    await refused;
  });
});
