import { afterEach, describe, expect, it, vi } from "vitest";

import { DelegationManager, type DelegationAgent } from "@/main/delegation/delegation-manager";
import type { FsAdapter } from "@/main/lib/json-store";

function memoryFs(): FsAdapter {
  const files = new Map<string, string>();
  return {
    read: (p) => files.get(p) ?? null,
    write: (p, content) => {
      files.set(p, content);
    },
    rename: (from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`rename: missing ${from}`);
      files.delete(from);
      files.set(to, content);
    },
  };
}

// A controllable stand-in for the background Agent: drive idle resolution and
// emit assistant text by hand.
function fakeAgent() {
  let subscriber: ((event: unknown) => void) | null = null;
  let resolveIdle: ((finished: boolean) => void) | null = null;
  let status = "idle";
  const prompts: string[] = [];

  const agent: DelegationAgent = {
    subscribe: (listener) => {
      subscriber = listener;
      return () => {
        subscriber = null;
      };
    },
    getState: () => ({ status }),
    sendMessage: async (message) => {
      prompts.push(message);
      status = "busy";
    },
    waitForIdle: () =>
      new Promise<boolean>((resolve) => {
        resolveIdle = resolve;
      }),
    interrupt: async () => {
      status = "idle";
      return true;
    },
  };

  return {
    agent,
    prompts,
    emitAssistant: (text: string) =>
      subscriber?.({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text }] },
      }),
    finish: () => {
      status = "idle";
      resolveIdle?.(true);
    },
    timeOut: () => {
      resolveIdle?.(false);
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const DOC = "## Today\n\n- [ ] task one\n- [ ] task two\n";

function makeManager(doc = DOC) {
  return new DelegationManager({ fs: memoryFs(), path: "/delegations.json", readVault: () => doc });
}

afterEach(() => vi.restoreAllMocks());

describe("DelegationManager.createDelegation", () => {
  it("rejects a checkbox that isn't in the file", () => {
    const mgr = makeManager();
    const result = mgr.createDelegation({ sourceFile: "n.md", text: "ghost task" });
    expect(result.ok).toBe(false);
    expect(mgr.getDelegations()).toHaveLength(0);
  });

  it("queues a valid checkbox with its resolved anchor", () => {
    const mgr = makeManager();
    const result = mgr.createDelegation({ sourceFile: "n.md", text: "task one" });
    expect(result.ok).toBe(true);
    const [d] = mgr.getDelegations();
    expect(d?.status).toBe("queued");
    expect(d?.anchor).toEqual({ text: "task one", heading: "Today" });
    expect(d?.lineText).toBe("- [ ] task one");
  });
});

describe("DelegationManager run lifecycle", () => {
  it("runs queued → running → done, sending the task to the agent", async () => {
    const mgr = makeManager();
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);

    mgr.createDelegation({ sourceFile: "n.md", text: "task one" });
    await flush();

    expect(mgr.getDelegations()[0]?.status).toBe("running");
    expect(fake.prompts[0]).toContain("task one");
    expect(fake.prompts[0]).toContain("./vault/n.md");

    fake.emitAssistant("Booked it.");
    fake.finish();
    await flush();

    const d = mgr.getDelegations()[0];
    expect(d?.status).toBe("done");
    expect(d?.resultSummary).toBe("Booked it.");
  });

  it("marks a timed-out run as failed", async () => {
    const mgr = makeManager();
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);

    mgr.createDelegation({ sourceFile: "n.md", text: "task one" });
    await flush();
    fake.timeOut();
    await flush();

    const d = mgr.getDelegations()[0];
    expect(d?.status).toBe("failed");
    expect(d?.error).toBe("Timed out");
  });

  it("serializes the queue — the second waits for the first to finish", async () => {
    const mgr = makeManager();
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);

    mgr.createDelegation({ sourceFile: "n.md", text: "task one" });
    mgr.createDelegation({ sourceFile: "n.md", text: "task two" });
    await flush();

    // Only the first is running; the second stays queued.
    expect(mgr.getDelegations().map((d) => d.status)).toEqual(["running", "queued"]);

    fake.finish();
    await flush();

    // First done, second now picked up.
    expect(mgr.getDelegations().map((d) => d.status)).toEqual(["done", "running"]);
  });

  it("cancels a queued delegation but not a running one", async () => {
    const mgr = makeManager();
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);

    const first = mgr.createDelegation({ sourceFile: "n.md", text: "task one" });
    const second = mgr.createDelegation({ sourceFile: "n.md", text: "task two" });
    await flush();
    const firstId = first.ok ? first.delegation.id : "";
    const secondId = second.ok ? second.delegation.id : "";

    // First is running → cancel is a no-op; second is queued → cancelled.
    expect(mgr.cancelDelegation(firstId).ok).toBe(false);
    expect(mgr.cancelDelegation(secondId).ok).toBe(true);
    expect(mgr.getDelegations().map((d) => d.anchor.text)).toEqual(["task one"]);
  });
});
