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
    const result = mgr.createDelegation({ sourceFile: "n.md", index: 5 }); // out of range
    expect(result.ok).toBe(false);
    expect(mgr.getDelegations()).toHaveLength(0);
  });

  it("queues a valid checkbox with its resolved anchor", () => {
    const mgr = makeManager();
    const result = mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    expect(result.ok).toBe(true);
    const [d] = mgr.getDelegations();
    expect(d?.status).toBe("queued");
    expect(d?.anchor).toEqual({ index: 0, text: "task one", heading: "Today" });
    expect(d?.lineText).toBe("- [ ] task one");
  });

  it("never silently drops queued work at the cap (only terminal records evict)", () => {
    const mgr = makeManager(); // no runner → everything stays queued
    for (let i = 0; i < 205; i++) mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    const all = mgr.getDelegations();
    // With no terminal (done/failed) records to evict, the queue is kept intact
    // past MAX_DELEGATIONS rather than blind-slicing off the oldest queued ones.
    expect(all.length).toBe(205);
    expect(all.every((d) => d.status === "queued")).toBe(true);
  });
});

describe("DelegationManager.markUnavailable", () => {
  it("fails queued delegations and rejects new ones with the reason", () => {
    const mgr = makeManager();
    mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    expect(mgr.getDelegations()[0]?.status).toBe("queued");

    mgr.markUnavailable("agent down");
    const d = mgr.getDelegations()[0];
    expect(d?.status).toBe("failed");
    expect(d?.error).toBe("agent down");

    expect(mgr.createDelegation({ sourceFile: "n.md", index: 1 })).toEqual({
      ok: false,
      error: "agent down",
    });
  });

  it("clears unavailability once a runner is wired", () => {
    const mgr = makeManager();
    mgr.markUnavailable("agent down");
    expect(mgr.createDelegation({ sourceFile: "n.md", index: 0 }).ok).toBe(false);

    mgr.setRunner(() => fakeAgent().agent);
    expect(mgr.createDelegation({ sourceFile: "n.md", index: 1 }).ok).toBe(true);
  });
});

describe("DelegationManager run lifecycle", () => {
  it("runs queued → running → done, sending the task to the agent", async () => {
    const mgr = makeManager();
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);

    mgr.createDelegation({ sourceFile: "n.md", index: 0 });
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

  it("re-runs against current bytes when the task is unchanged but the doc shifted around it", async () => {
    let live = "## Today\n\n- [ ] task one\n- [ ] task two\n";
    const mgr = new DelegationManager({ fs: memoryFs(), path: "/d.json", readVault: () => live });
    mgr.createDelegation({ sourceFile: "n.md", index: 0 }); // anchor = "task one"

    // A non-checkbox paragraph is inserted above: the ordinal is unchanged and
    // the task text still matches, so the run proceeds against fresh bytes.
    live = "## Today\n\nSome new note above.\n\n- [ ] task one\n- [ ] task two\n";
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);
    await flush();

    expect(mgr.getDelegations()[0]?.status).toBe("running");
    expect(fake.prompts[0]).toContain("task one");
  });

  it("fails safe (never dispatches) when the ordinal would retarget to a different task", async () => {
    let live = "## Today\n\n- [ ] task one\n- [ ] task two\n";
    const mgr = new DelegationManager({ fs: memoryFs(), path: "/d.json", readVault: () => live });
    mgr.createDelegation({ sourceFile: "n.md", index: 1 }); // anchor = "task two"
    expect(mgr.getDelegations()[0]?.anchor.text).toBe("task two");

    // A NEW checkbox is inserted above while queued: index 1 now points at
    // "task one". Re-targeting would make the agent do the wrong task, so fail.
    live = "## Today\n\n- [ ] inserted\n- [ ] task one\n- [ ] task two\n";
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);
    await flush();

    const d = mgr.getDelegations()[0];
    expect(d?.status).toBe("failed");
    expect(d?.error).toContain("changed");
    expect(fake.prompts.length).toBe(0);
  });

  it("fails (and never dispatches) a delegation whose checkbox vanished while queued", async () => {
    let live = "## Today\n\n- [ ] task one\n";
    const mgr = new DelegationManager({ fs: memoryFs(), path: "/d.json", readVault: () => live });
    mgr.createDelegation({ sourceFile: "n.md", index: 0 });

    live = "## Today\n\n(all tasks removed)\n";
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);
    await flush();

    const d = mgr.getDelegations()[0];
    expect(d?.status).toBe("failed");
    expect(d?.error).toContain("no longer");
    expect(fake.prompts.length).toBe(0);
  });

  it("marks a timed-out run as failed", async () => {
    const mgr = makeManager();
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);

    mgr.createDelegation({ sourceFile: "n.md", index: 0 });
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

    mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    mgr.createDelegation({ sourceFile: "n.md", index: 1 });
    await flush();

    // Only the first is running; the second stays queued.
    expect(mgr.getDelegations().map((d) => d.status)).toEqual(["running", "queued"]);

    fake.finish();
    await flush();

    // First done, second now picked up.
    expect(mgr.getDelegations().map((d) => d.status)).toEqual(["done", "running"]);
  });

  it("fails an in-flight run on stop and doesn't wedge the queue", async () => {
    const mgr = makeManager();
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);

    mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    await flush();
    expect(mgr.getDelegations()[0]?.status).toBe("running");

    mgr.stop(); // agent torn down mid-run (Cmd+K / logout)
    const d = mgr.getDelegations()[0];
    expect(d?.status).toBe("failed");
    expect(d?.error).toContain("Interrupted");

    // The lock is released: a fresh runner drains new work.
    mgr.setRunner(() => fakeAgent().agent);
    mgr.createDelegation({ sourceFile: "n.md", index: 1 });
    await flush();
    expect(mgr.getDelegations()[1]?.status).toBe("running");
  });

  it("keeps an interrupted run failed even if it finishes after stop()", async () => {
    const mgr = makeManager();
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);

    mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    await flush();
    expect(mgr.getDelegations()[0]?.status).toBe("running");

    mgr.stop();
    expect(mgr.getDelegations()[0]?.status).toBe("failed");

    // The in-flight run finishes late — it must NOT resurrect the record to "done".
    fake.emitAssistant("Booked it.");
    fake.finish();
    await flush();
    const d = mgr.getDelegations()[0];
    expect(d?.status).toBe("failed");
    expect(d?.error).toContain("Interrupted");
  });

  it("a run abandoned by stop() doesn't disturb the lock a fresh runner holds", async () => {
    const mgr = makeManager();
    const a1 = fakeAgent();
    mgr.setRunner(() => a1.agent);

    mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    mgr.createDelegation({ sourceFile: "n.md", index: 1 });
    await flush();
    expect(mgr.getDelegations().map((d) => d.status)).toEqual(["running", "queued"]);

    mgr.stop(); // a1 torn down mid-run; #0 fails, lock released, epoch bumped
    const a2 = fakeAgent();
    mgr.setRunner(() => a2.agent);
    await flush();
    // The fresh agent drains the queue: #1 now runs (exactly one dispatch).
    expect(mgr.getDelegations().map((d) => d.status)).toEqual(["failed", "running"]);
    expect(a2.prompts.length).toBe(1);

    // The abandoned a1 run finishes late — it must NOT start a second run or
    // clobber the lock a2 holds.
    a1.finish();
    await flush();
    expect(mgr.getDelegations().map((d) => d.status)).toEqual(["failed", "running"]);
    expect(a2.prompts.length).toBe(1);
  });

  it("repoints delegations across a file and a folder rename", async () => {
    const mgr = makeManager();
    mgr.setRunner(() => fakeAgent().agent);
    mgr.createDelegation({ sourceFile: "notes/a.md", index: 0 });
    await flush();
    mgr.createDelegation({ sourceFile: "notes/b.md", index: 0 });

    mgr.renameSource("notes/a.md", "notes/renamed.md"); // exact file
    expect(mgr.getDelegations()[0]?.sourceFile).toBe("notes/renamed.md");
    expect(mgr.getDelegations()[1]?.sourceFile).toBe("notes/b.md"); // untouched

    mgr.renameSource("notes", "archive"); // folder move — prefix match
    expect(mgr.getDelegations().map((d) => d.sourceFile)).toEqual([
      "archive/renamed.md",
      "archive/b.md",
    ]);
  });

  it("cancels a queued delegation but not a running one", async () => {
    const mgr = makeManager();
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);

    const first = mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    const second = mgr.createDelegation({ sourceFile: "n.md", index: 1 });
    await flush();
    const firstId = first.ok ? first.delegation.id : "";
    const secondId = second.ok ? second.delegation.id : "";

    // First is running → cancel is a no-op; second is queued → cancelled.
    expect(mgr.cancelDelegation(firstId).ok).toBe(false);
    expect(mgr.cancelDelegation(secondId).ok).toBe(true);
    expect(mgr.getDelegations().map((d) => d.anchor.text)).toEqual(["task one"]);
  });
});
