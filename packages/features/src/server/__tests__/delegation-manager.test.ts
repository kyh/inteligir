import { afterEach, describe, expect, it, vi } from "vitest";

import { DelegationManager, type DelegationAgent } from "../delegation/delegation-manager";
import { SNAPSHOT_RETENTION, SnapshotStore } from "../snapshots/snapshot-store";
import type { FsAdapter } from "../lib/json-store";
import { isRecord } from "@repo/features/ipc";

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

/** A snapshot store over an in-memory map — no ~/.inteligir writes in tests. */
function memorySnapshots(): SnapshotStore {
  const files = new Map<string, string>();
  return new SnapshotStore({
    fs: memoryFs(),
    files: {
      read: (p) => files.get(p) ?? null,
      write: (p, content) => {
        files.set(p, content);
      },
      remove: (p) => {
        files.delete(p);
      },
      list: (dir) =>
        [...files.keys()]
          .filter((p) => p.startsWith(`${dir}/`))
          .map((p) => p.slice(dir.length + 1)),
    },
    dir: "/snaps",
    indexPath: "/snapshots.json",
  });
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
  return new DelegationManager({
    fs: memoryFs(),
    path: "/delegations.json",
    readVault: () => doc,
    snapshots: memorySnapshots(),
  });
}

/** Manager over a mutable `live` document, recording vault writes — the rig
 * for snapshot/restore tests. */
function makeRestoreRig(initial = DOC) {
  const state: { live: string | null } = { live: initial };
  const writes: Array<{ path: string; content: string }> = [];
  const snapshots = memorySnapshots();
  const mgr = new DelegationManager({
    fs: memoryFs(),
    path: "/delegations.json",
    readVault: () => {
      if (state.live === null) throw new Error("ENOENT: no such file");
      return state.live;
    },
    writeVault: (path, content) => {
      writes.push({ path, content });
      state.live = content;
    },
    snapshots,
  });
  return { mgr, state, writes, snapshots };
}

afterEach(() => vi.restoreAllMocks());

describe("DelegationManager.createDelegation", () => {
  it("rejects a checkbox that isn't in the file", () => {
    const mgr = makeManager();
    const result = mgr.createDelegation({ sourceFile: "n.md", index: 5 }); // out of range
    expect(result.ok).toBe(false);
    expect(mgr.getDelegations()).toHaveLength(0);
  });

  it("refuses a private note — its content must not reach the AI provider", () => {
    const mgr = makeManager(`---\nprivate: true\n---\n${DOC}`);
    const result = mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    expect(result).toEqual({
      ok: false,
      error: "This note is private — delegating would send its content to the AI provider.",
    });
    expect(mgr.getDelegations()).toHaveLength(0);
  });

  it("refuses unreadable frontmatter too (fail-closed)", () => {
    const mgr = makeManager(`---\n[not: valid: yaml\n---\n${DOC}`);
    const result = mgr.createDelegation({ sourceFile: "n.md", index: 0 });
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
    const mgr = new DelegationManager({
      fs: memoryFs(),
      path: "/d.json",
      readVault: () => live,
      snapshots: memorySnapshots(),
    });
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
    const mgr = new DelegationManager({
      fs: memoryFs(),
      path: "/d.json",
      readVault: () => live,
      snapshots: memorySnapshots(),
    });
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
    const mgr = new DelegationManager({
      fs: memoryFs(),
      path: "/d.json",
      readVault: () => live,
      snapshots: memorySnapshots(),
    });
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

  it("stops a running delegation and cancels a queued one", async () => {
    const mgr = makeManager();
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);

    const first = mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    const second = mgr.createDelegation({ sourceFile: "n.md", index: 1 });
    await flush();
    const firstId = first.ok ? first.delegation.id : "";
    const secondId = second.ok ? second.delegation.id : "";

    // First is running → stop interrupts it (stays in the list); second is
    // queued → removed from the queue.
    expect(mgr.cancelDelegation(firstId).ok).toBe(true);
    expect(mgr.cancelDelegation(secondId).ok).toBe(true);
    expect(mgr.getDelegations().map((d) => d.anchor.text)).toEqual(["task one"]);
  });

  it("snapshots the file BEFORE dispatching the agent (never an unsnapshotted run)", async () => {
    const { mgr, snapshots } = makeRestoreRig();
    const order: string[] = [];
    const realCapture = snapshots.capture.bind(snapshots);
    vi.spyOn(snapshots, "capture").mockImplementation((...args) => {
      order.push("capture");
      realCapture(...args);
    });
    const fake = fakeAgent();
    const realSend = fake.agent.sendMessage;
    fake.agent.sendMessage = async (message) => {
      order.push("dispatch");
      await realSend(message);
    };
    mgr.setRunner(() => fake.agent);

    const created = mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    await flush();

    expect(order).toEqual(["capture", "dispatch"]);
    const id = created.ok ? created.delegation.id : "";
    expect(mgr.getDelegations()[0]?.hasSnapshot).toBe(true);
    const snap = snapshots.read(id);
    expect(snap).toMatchObject({ ok: true, content: DOC });
  });

  it("aborts the run (agent never dispatched) when the snapshot can't be captured", async () => {
    const { mgr, snapshots } = makeRestoreRig();
    vi.spyOn(snapshots, "capture").mockImplementation(() => {
      throw new Error("disk full");
    });
    const fake = fakeAgent();
    mgr.setRunner(() => fake.agent);

    mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    await flush();

    const d = mgr.getDelegations()[0];
    expect(d?.status).toBe("failed");
    expect(d?.error).toContain("snapshot");
    expect(d?.hasSnapshot).toBe(false);
    expect(fake.prompts.length).toBe(0);
  });
});

describe("DelegationManager.restoreSnapshot", () => {
  /** Run one delegation to completion and return its id. */
  async function runOne(rig: ReturnType<typeof makeRestoreRig>, index = 0): Promise<string> {
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    const created = rig.mgr.createDelegation({ sourceFile: "n.md", index });
    await flush();
    fake.finish();
    await flush();
    return created.ok ? created.delegation.id : "";
  }

  it("restores the pre-run bytes through the vault write and records restoredAt", async () => {
    const rig = makeRestoreRig();
    const id = await runOne(rig);

    // The agent edited the file after the snapshot was taken.
    rig.state.live = "## Today\n\n- [x] task one\n  - ✅ did it\n- [ ] task two\n";

    expect(rig.mgr.restoreSnapshot(id)).toEqual({ ok: true });
    expect(rig.writes).toEqual([{ path: "n.md", content: DOC }]);
    expect(rig.state.live).toBe(DOC); // byte-identical to the pre-run copy
    expect(rig.mgr.getDelegations()[0]?.restoredAt).not.toBeNull();
  });

  it("is a no-op success (no write) when the file already matches the snapshot", async () => {
    const rig = makeRestoreRig();
    const id = await runOne(rig);

    expect(rig.mgr.restoreSnapshot(id)).toEqual({ ok: true });
    expect(rig.writes).toEqual([]); // no write → no watcher churn
    expect(rig.mgr.getDelegations()[0]?.restoredAt).not.toBeNull();
  });

  it("recreates the file when it was deleted after the run", async () => {
    const rig = makeRestoreRig();
    const id = await runOne(rig);

    rig.state.live = null; // file deleted — readVault now throws

    expect(rig.mgr.restoreSnapshot(id)).toEqual({ ok: true });
    expect(rig.writes).toEqual([{ path: "n.md", content: DOC }]);
  });

  it("rejects a restore while the delegation is still queued or running", async () => {
    const rig = makeRestoreRig();
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    const created = rig.mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    const id = created.ok ? created.delegation.id : "";
    await flush();
    expect(rig.mgr.getDelegations()[0]?.status).toBe("running");

    const result = rig.mgr.restoreSnapshot(id);
    expect(result.ok).toBe(false);
    expect(rig.writes).toEqual([]);
  });

  it("rejects an unknown delegation and a delegation that never snapshotted", () => {
    const rig = makeRestoreRig();
    expect(rig.mgr.restoreSnapshot("nope").ok).toBe(false);

    // Queued (no runner) → never ran, no snapshot, and also not terminal.
    const created = rig.mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    const id = created.ok ? created.delegation.id : "";
    expect(rig.mgr.restoreSnapshot(id).ok).toBe(false);
    expect(rig.writes).toEqual([]);
  });

  it("keeps per-delegation pre-states on the same file — the second snapshot never clobbers the first", async () => {
    // Two delegations against one file run back-to-back. Each snapshot is keyed
    // by delegation id and captures the bytes immediately before THAT run, so:
    // restore(first) = the original document (undoes both edits), and
    // restore(second) = the state after the first agent edit.
    const rig = makeRestoreRig();
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    const first = rig.mgr.createDelegation({ sourceFile: "n.md", index: 0 });
    const second = rig.mgr.createDelegation({ sourceFile: "n.md", index: 1 });
    const firstId = first.ok ? first.delegation.id : "";
    const secondId = second.ok ? second.delegation.id : "";
    await flush();

    // First runs against the original doc, then "edits" it (checks task one).
    const afterFirst = "## Today\n\n- [x] task one\n  - ✅ done\n- [ ] task two\n";
    rig.state.live = afterFirst;
    fake.finish();
    await flush(); // second resolves + snapshots against afterFirst
    const afterSecond = "## Today\n\n- [x] task one\n  - ✅ done\n- [x] task two\n  - ✅ done\n";
    rig.state.live = afterSecond;
    fake.finish();
    await flush();
    expect(rig.mgr.getDelegations().map((d) => d.status)).toEqual(["done", "done"]);

    expect(rig.mgr.restoreSnapshot(secondId)).toEqual({ ok: true });
    expect(rig.state.live).toBe(afterFirst); // undo just the second edit

    expect(rig.mgr.restoreSnapshot(firstId)).toEqual({ ok: true });
    expect(rig.state.live).toBe(DOC); // back to the original document
  });

  it("round-trips nasty bytes exactly — CRLF, lone CR, trailing whitespace, unicode, no final newline", async () => {
    const nasty =
      "## Tödāy 👩‍🚀\r\n\r\n- [ ] tâsk one\r\n\r\ntrailing spaces  \r\nzero​width, combining é, 日本語\rlone-CR line\nmixed LF, no final newline";
    const rig = makeRestoreRig(nasty);
    const id = await runOne(rig);

    // The "agent" checks the box and appends a result on its own line endings.
    rig.state.live = `${nasty.replace("- [ ]", "- [x]")}\n  - ✅ done\n`;

    expect(rig.mgr.restoreSnapshot(id)).toEqual({ ok: true });
    expect(rig.state.live).toBe(nasty); // byte-identical, not merely equivalent
  });

  it("fails gracefully (no write) when the snapshot was pruned by retention", async () => {
    const rig = makeRestoreRig();
    const id = await runOne(rig);

    // Push the real snapshot past the retention horizon with strictly newer
    // captures, then run the host-start sweep.
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => ++now);
    for (let i = 0; i < SNAPSHOT_RETENTION; i++) {
      rig.snapshots.capture(
        { id: `filler-${i}`, origin: "delegation", path: "x.md", kind: "edit" },
        `filler ${i}`,
      );
    }
    rig.mgr.pruneSnapshots();

    const result = rig.mgr.restoreSnapshot(id);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("No saved copy");
    expect(rig.writes).toEqual([]);
    expect(rig.mgr.getDelegations()[0]?.restoredAt).toBeNull();
    // Prune flips hasSnapshot at the data level, so no surface — present or
    // future — can offer a restore whose bytes are gone.
    expect(rig.mgr.getDelegations()[0]?.hasSnapshot).toBe(false);
  });
});

describe("delegations store v2 → v3 migration", () => {
  // A record exactly as a v2 build persisted it — no hasSnapshot/restoredAt.
  const V2_RECORD = {
    id: "3f6b2c1a-0000-4000-8000-000000000001",
    sourceFile: "notes/today.md",
    anchor: { index: 1, text: "task two", heading: "Today" },
    lineText: "- [ ] task two",
    status: "done",
    createdAt: 1700000000000,
    startedAt: 1700000001000,
    finishedAt: 1700000002000,
    resultSummary: "did it",
    error: null,
  };

  it("loads a real v2 blob, adds snapshot fields with safe defaults, and never quarantines", () => {
    const files = new Map<string, string>([
      ["/delegations.json", JSON.stringify({ version: 2, delegations: [V2_RECORD] }, null, 2)],
    ]);
    const fs: FsAdapter = {
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
    const mgr = new DelegationManager({
      fs,
      path: "/delegations.json",
      readVault: () => DOC,
      snapshots: memorySnapshots(),
    });

    // The record survives intact and gains the v3 fields with their only sane
    // defaults: a pre-snapshot record has no snapshot and was never restored.
    expect(mgr.getDelegations()).toEqual([{ ...V2_RECORD, hasSnapshot: false, restoredAt: null }]);
    // Migration path, not the corrupt-recovery path — nothing was set aside…
    expect([...files.keys()].filter((k) => k !== "/delegations.json")).toEqual([]);
    // …and the upgraded shape was re-persisted as v3 so the chain doesn't re-run.
    const persisted: unknown = JSON.parse(files.get("/delegations.json") ?? "null");
    expect(isRecord(persisted) ? persisted["version"] : null).toBe(3);
  });
});
