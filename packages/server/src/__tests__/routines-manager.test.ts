import { afterEach, describe, expect, it, vi } from "vitest";

import { RoutinesManager } from "../routines/routines-manager";
import { DelegationManager, type DelegationAgent } from "../delegation/delegation-manager";
import { BackgroundTurnLock } from "../delegation/background-turn-lock";
import { RestoreManager } from "../restore/restore-manager";
import { SnapshotStore } from "../restore/snapshot-store";
import type { FsAdapter } from "@repo/storage/json-store";
import type { RoutineSchedule } from "@repo/bridge/routines";

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

/** A controllable stand-in for the shared background Agent (delegation's
 * fakeAgent, verbatim): drive idle resolution + emit assistant text by hand. */
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

function enoent(path: string): Error {
  const err: Error & { code?: string } = new Error(`ENOENT: no such file: ${path}`);
  err.code = "ENOENT";
  return err;
}

const DAILY_9: RoutineSchedule = { cadence: "daily", timeOfDay: "09:00" };
// A stable local-time anchor: Tue 2026-07-21.
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 6, day, hours, minutes);

/** Test rig: an in-memory vault + a RoutinesManager over injected clock,
 * restore, and vault closures — the routines twin of delegation's rigs. */
function makeRig(opts?: {
  vault?: Record<string, string>;
  now?: Date;
  isProviderConnected?: () => boolean;
  turnLock?: BackgroundTurnLock;
}) {
  const vault = new Map(Object.entries(opts?.vault ?? {}));
  const writes: Array<{ path: string; content: string }> = [];
  const clockState = { now: opts?.now ?? at(21, 12) };
  const snapshots = memorySnapshots();
  const readVault = (rel: string): string => {
    const content = vault.get(rel);
    if (content === undefined) throw enoent(rel);
    return content;
  };
  const writeVault = (rel: string, content: string): void => {
    writes.push({ path: rel, content });
    vault.set(rel, content);
  };
  const trashed: string[] = [];
  const restore = new RestoreManager({
    snapshots,
    readVault,
    writeVault,
    trashVault: async (rel) => {
      trashed.push(rel);
      return vault.delete(rel);
    },
  });
  const events: Array<{ runningId: string | null }> = [];
  const mgr = new RoutinesManager({
    fs: memoryFs(),
    path: "/routines.json",
    readVault,
    writeVault,
    restore,
    isProviderConnected: opts?.isProviderConnected ?? (() => true),
    clock: () => clockState.now,
    dailyPath: (now) =>
      `journal/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.md`,
    onChanged: (result) => events.push({ runningId: result.runningId }),
    ...(opts?.turnLock ? { turnLock: opts.turnLock } : {}),
  });
  return { mgr, vault, writes, trashed, clockState, snapshots, events };
}

/** Create one enabled daily routine targeting `notes/log.md`. */
function addRoutine(
  mgr: RoutinesManager,
  over?: Partial<{
    name: string;
    prompt: string;
    schedule: RoutineSchedule;
    target: { kind: "daily" } | { kind: "note"; path: string };
    enabled: boolean;
  }>,
) {
  const result = mgr.upsert({
    name: over?.name ?? "Morning briefing",
    prompt: over?.prompt ?? "Summarize open tasks.",
    schedule: over?.schedule ?? DAILY_9,
    target: over?.target ?? { kind: "note", path: "notes/log.md" },
    enabled: over?.enabled ?? true,
  });
  if (!result.ok) throw new Error(`upsert failed: ${result.error}`);
  return result.routine;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RoutinesManager.upsert", () => {
  it("creates with host-owned bookkeeping and edits without disturbing it", () => {
    const { mgr, clockState } = makeRig({ vault: { "notes/log.md": "# Log\n" } });
    const created = addRoutine(mgr);
    expect(created.createdAt).toBe(clockState.now.getTime());
    expect(created.lastRunAt).toBeNull();
    expect(created.lastRun).toBeNull();

    const edited = mgr.upsert({
      id: created.id,
      name: "Renamed",
      prompt: created.prompt,
      schedule: DAILY_9,
      target: { kind: "daily" },
      enabled: false,
    });
    expect(edited.ok).toBe(true);
    const [r] = mgr.list().routines;
    expect(r?.name).toBe("Renamed");
    expect(r?.createdAt).toBe(created.createdAt); // preserved
    expect(r?.enabled).toBe(false);
  });

  it("rejects an unknown id", () => {
    const { mgr } = makeRig();
    const result = mgr.upsert({
      id: "nope",
      name: "x",
      prompt: "y",
      schedule: DAILY_9,
      target: { kind: "daily" },
      enabled: true,
    });
    expect(result).toEqual({ ok: false, error: "Unknown routine." });
  });

  it("refuses a private target note at save time (and unreadable frontmatter, fail-closed)", () => {
    const { mgr } = makeRig({
      vault: {
        "secret.md": "---\nprivate: true\n---\n# S\n",
        "broken.md": "---\n[not: valid: yaml\n---\n# B\n",
      },
    });
    for (const path of ["secret.md", "broken.md"]) {
      const result = mgr.upsert({
        name: "x",
        prompt: "y",
        schedule: DAILY_9,
        target: { kind: "note", path },
        enabled: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("private");
    }
    expect(mgr.list().routines).toHaveLength(0);
  });

  it("allows a target note that doesn't exist yet (the run creates it)", () => {
    const { mgr } = makeRig();
    expect(addRoutine(mgr, { target: { kind: "note", path: "new/summary.md" } }).id).toBeTruthy();
  });
});

describe("RoutinesManager.runNow", () => {
  it("refuses when the provider isn't connected — feedback, not a silent queue", () => {
    const { mgr } = makeRig({ isProviderConnected: () => false });
    const routine = addRoutine(mgr);
    expect(mgr.runNow(routine.id)).toEqual({
      ok: false,
      error: "Connect an AI provider in Settings → AI to run routines.",
    });
  });

  it("runs: stamps lastRunAt at dispatch, snapshots BEFORE the agent, appends host-side, records done", async () => {
    const doc = "# Log\n";
    const rig = makeRig({ vault: { "notes/log.md": doc } });
    const routine = addRoutine(rig.mgr);
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);

    const order: string[] = [];
    const realCapture = rig.snapshots.capture.bind(rig.snapshots);
    vi.spyOn(rig.snapshots, "capture").mockImplementation((...args) => {
      order.push("capture");
      realCapture(...args);
    });
    const realSend = fake.agent.sendMessage;
    fake.agent.sendMessage = async (message) => {
      order.push("dispatch");
      await realSend(message);
    };

    expect(rig.mgr.runNow(routine.id)).toEqual({ ok: true });
    await flush();
    expect(rig.mgr.list().runningId).toBe(routine.id);
    expect(rig.mgr.list().routines[0]?.lastRunAt).toBe(rig.clockState.now.getTime());
    expect(order).toEqual(["capture", "dispatch"]);
    // The prompt names the routine, the target, and forbids file edits.
    expect(fake.prompts[0]).toContain("Morning briefing");
    expect(fake.prompts[0]).toContain("./vault/notes/log.md");
    expect(fake.prompts[0]).toContain("Do NOT create or edit any files");

    fake.emitAssistant("- All clear today.");
    fake.finish();
    await flush();

    const [r] = rig.mgr.list().routines;
    expect(rig.mgr.list().runningId).toBeNull();
    expect(r?.lastRun?.status).toBe("done");
    expect(r?.lastRun?.hasSnapshot).toBe(true);
    if (r?.lastRun?.status === "done") expect(r.lastRun.summary).toBe("- All clear today.");
    // Host-side append: original bytes intact, one blank line, headed block.
    expect(rig.vault.get("notes/log.md")).toBe(
      "# Log\n\n## Morning briefing — 2026-07-21\n\n- All clear today.\n",
    );
    // The snapshot holds the pre-run bytes.
    const runId = r?.lastRun?.runId ?? "";
    expect(rig.snapshots.read(runId)).toMatchObject({ ok: true, content: doc });
  });

  it("creates an absent target (daily note) and restore deletes it (create-kind snapshot)", async () => {
    const rig = makeRig();
    const routine = addRoutine(rig.mgr, { target: { kind: "daily" } });
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await flush();
    fake.emitAssistant("Briefing.");
    fake.finish();
    await flush();

    const daily = "journal/2026-07-21.md";
    expect(rig.vault.get(daily)).toBe("## Morning briefing — 2026-07-21\n\nBriefing.\n");

    expect(await rig.mgr.restoreLastRun(routine.id)).toEqual({ ok: true });
    expect(rig.trashed).toEqual([daily]); // undo of a created note = trash it
    expect(rig.vault.has(daily)).toBe(false);
    expect(rig.mgr.list().routines[0]?.lastRun?.restoredAt).not.toBeNull();
  });

  it("refuses a private target at run time without dispatching the agent", async () => {
    const rig = makeRig({ vault: { "notes/log.md": "---\nprivate: true\n---\n# Log\n" } });
    // Bypass the upsert-time check by making the note private AFTER creation.
    rig.vault.set("notes/log.md", "# Log\n");
    const routine = addRoutine(rig.mgr);
    rig.vault.set("notes/log.md", "---\nprivate: true\n---\n# Log\n");
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await flush();

    const [r] = rig.mgr.list().routines;
    expect(r?.lastRun?.status).toBe("failed");
    if (r?.lastRun?.status === "failed") expect(r.lastRun.error).toContain("private");
    expect(fake.prompts).toHaveLength(0); // never reached the agent
    expect(rig.vault.get("notes/log.md")).toContain("private: true"); // untouched
  });

  it("aborts the run (agent never dispatched) when the snapshot can't be captured", async () => {
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" } });
    const routine = addRoutine(rig.mgr);
    vi.spyOn(rig.snapshots, "capture").mockImplementation(() => {
      throw new Error("disk full");
    });
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await flush();

    const [r] = rig.mgr.list().routines;
    expect(r?.lastRun?.status).toBe("failed");
    if (r?.lastRun?.status === "failed") expect(r.lastRun.error).toContain("snapshot");
    expect(fake.prompts).toHaveLength(0);
  });

  it("a timed-out run records failure but keeps the snapshot restorable", async () => {
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" } });
    const routine = addRoutine(rig.mgr);
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await flush();
    fake.timeOut();
    await flush();

    const [r] = rig.mgr.list().routines;
    expect(r?.lastRun?.status).toBe("failed");
    if (r?.lastRun?.status === "failed") expect(r.lastRun.error).toBe("Timed out");
    expect(r?.lastRun?.hasSnapshot).toBe(true);
  });

  it("an empty reply is a failure — nothing is appended", async () => {
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" } });
    const routine = addRoutine(rig.mgr);
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await flush();
    fake.emitAssistant("   ");
    fake.finish();
    await flush();

    expect(rig.mgr.list().routines[0]?.lastRun?.status).toBe("failed");
    expect(rig.vault.get("notes/log.md")).toBe("# Log\n");
  });

  it("serializes its own queue — the second run waits for the first", async () => {
    const rig = makeRig({ vault: { "a.md": "# A\n", "b.md": "# B\n" } });
    const first = addRoutine(rig.mgr, { name: "First", target: { kind: "note", path: "a.md" } });
    const second = addRoutine(rig.mgr, { name: "Second", target: { kind: "note", path: "b.md" } });
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);

    rig.mgr.runNow(first.id);
    rig.mgr.runNow(second.id);
    await flush();
    expect(rig.mgr.list().runningId).toBe(first.id);
    expect(fake.prompts).toHaveLength(1);

    fake.emitAssistant("done a");
    fake.finish();
    await flush();
    expect(rig.mgr.list().runningId).toBe(second.id);
    expect(fake.prompts).toHaveLength(2);
  });
});

describe("shared background-session serialization (the safety core)", () => {
  it("a routine never dispatches while a delegation holds the shared lock — and runs after it releases", async () => {
    vi.useFakeTimers();
    const lock = new BackgroundTurnLock();
    const fake = fakeAgent();

    // Delegation manager on the SHARED lock, mid-run.
    const dlg = new DelegationManager({
      fs: memoryFs(),
      path: "/delegations.json",
      readVault: () => "- [ ] task one\n",
      restore: new RestoreManager({ snapshots: memorySnapshots() }),
      isProviderConnected: () => true,
      turnLock: lock,
    });
    dlg.setRunner(() => fake.agent);
    dlg.createDelegation({ sourceFile: "n.md", ordinal: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(lock.holder()).toBe("delegation");

    // Routines manager on the SAME lock: Run now must not reach the agent.
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" }, turnLock: lock });
    const routine = addRoutine(rig.mgr);
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(rig.mgr.list().runningId).toBeNull();
    expect(fake.prompts).toHaveLength(1); // still only the delegation's prompt

    // Delegation finishes → lock free → the routine's retry dispatches it.
    fake.emitAssistant("Done.");
    fake.finish();
    await vi.advanceTimersByTimeAsync(1100); // > BUSY_RETRY_MS
    expect(rig.mgr.list().runningId).toBe(routine.id);
    expect(lock.holder()).toBe("routine");
    expect(fake.prompts).toHaveLength(2);

    fake.emitAssistant("Result.");
    fake.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(lock.holder()).toBeNull();
  });

  it("a delegation queued behind a running routine waits for the lock too", async () => {
    vi.useFakeTimers();
    const lock = new BackgroundTurnLock();
    const fake = fakeAgent();
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" }, turnLock: lock });
    const routine = addRoutine(rig.mgr);
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(lock.holder()).toBe("routine");

    const dlg = new DelegationManager({
      fs: memoryFs(),
      path: "/delegations.json",
      readVault: () => "- [ ] task one\n",
      restore: new RestoreManager({ snapshots: memorySnapshots() }),
      isProviderConnected: () => true,
      turnLock: lock,
    });
    dlg.setRunner(() => fake.agent);
    dlg.createDelegation({ sourceFile: "n.md", ordinal: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(dlg.getDelegations()[0]?.status).toBe("queued"); // not running
    expect(fake.prompts).toHaveLength(1);

    fake.emitAssistant("Routine result.");
    fake.finish();
    await vi.advanceTimersByTimeAsync(1100);
    expect(dlg.getDelegations()[0]?.status).toBe("running");
    expect(fake.prompts).toHaveLength(2);
  });
});

describe("RoutinesManager scheduler", () => {
  it("tick queues a due routine ONCE (lastRunAt at dispatch consumes the slot)", async () => {
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" }, now: at(20, 12) });
    const routine = addRoutine(rig.mgr); // created the 20th at noon
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent); // immediate tick: not due (no slot since creation)
    await flush();
    expect(fake.prompts).toHaveLength(0);

    // The 21st, 09:05 — the slot passed. One tick dispatches...
    rig.clockState.now = at(21, 9, 5);
    rig.mgr.tick();
    await flush();
    expect(rig.mgr.list().runningId).toBe(routine.id);
    expect(fake.prompts).toHaveLength(1);
    fake.emitAssistant("Done.");
    fake.finish();
    await flush();

    // ...and later ticks in the same slot do nothing.
    rig.clockState.now = at(21, 18);
    rig.mgr.tick();
    await flush();
    expect(fake.prompts).toHaveLength(1);

    // The next day's slot fires again.
    rig.clockState.now = at(22, 9, 1);
    rig.mgr.tick();
    await flush();
    expect(fake.prompts).toHaveLength(2);
  });

  it("missed slots while closed → ONE catch-up run on the launch tick", async () => {
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" }, now: at(17, 12) });
    const routine = addRoutine(rig.mgr);
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    await flush();
    // Ran on the 18th's slot.
    rig.clockState.now = at(18, 9, 1);
    rig.mgr.tick();
    await flush();
    fake.emitAssistant("ok");
    fake.finish();
    await flush();
    expect(fake.prompts).toHaveLength(1);

    // "App closed" over the 19th/20th/21st slots; relaunch tick on the 21st.
    rig.clockState.now = at(21, 15);
    rig.mgr.tick(); // = the setRunner launch tick
    await flush();
    expect(fake.prompts).toHaveLength(2); // once, not three times
    fake.emitAssistant("ok");
    fake.finish();
    await flush();
    rig.mgr.tick();
    await flush();
    expect(fake.prompts).toHaveLength(2);
    expect(rig.mgr.list().routines[0]?.id).toBe(routine.id);
  });

  it("disabled routines never fire on the scheduler; Run now still works (test-your-config)", async () => {
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" }, now: at(20, 12) });
    const routine = addRoutine(rig.mgr, { enabled: false });
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.clockState.now = at(21, 10);
    rig.mgr.tick();
    await flush();
    expect(fake.prompts).toHaveLength(0);

    expect(rig.mgr.runNow(routine.id)).toEqual({ ok: true });
    await flush();
    expect(fake.prompts).toHaveLength(1);
  });

  it("no provider → the tick consumes nothing; the slot fires once when it returns", async () => {
    let connected = false;
    const rig = makeRig({
      vault: { "notes/log.md": "# Log\n" },
      now: at(20, 12),
      isProviderConnected: () => connected,
    });
    addRoutine(rig.mgr);
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.clockState.now = at(21, 10);
    rig.mgr.tick();
    await flush();
    expect(fake.prompts).toHaveLength(0);
    expect(rig.mgr.list().routines[0]?.lastRunAt).toBeNull(); // slot NOT consumed

    connected = true;
    rig.mgr.tick();
    await flush();
    expect(fake.prompts).toHaveLength(1);
  });
});

describe("RoutinesManager bookkeeping", () => {
  it("restoreLastRun refuses while the routine is running, restores bytes after", async () => {
    const doc = "# Log\n";
    const rig = makeRig({ vault: { "notes/log.md": doc } });
    const routine = addRoutine(rig.mgr);
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await flush();
    expect((await rig.mgr.restoreLastRun(routine.id)).ok).toBe(false); // running

    fake.emitAssistant("Result.");
    fake.finish();
    await flush();
    expect(rig.vault.get("notes/log.md")).toContain("Result.");
    expect(await rig.mgr.restoreLastRun(routine.id)).toEqual({ ok: true });
    expect(rig.vault.get("notes/log.md")).toBe(doc); // byte-identical pre-run copy
  });

  it("renameTarget repoints note targets and last-run restore paths (file + folder)", async () => {
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" } });
    const routine = addRoutine(rig.mgr);
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await flush();
    fake.emitAssistant("Result.");
    fake.finish();
    await flush();

    rig.mgr.renameTarget("notes/log.md", "notes/journal.md");
    let [r] = rig.mgr.list().routines;
    expect(r?.target).toEqual({ kind: "note", path: "notes/journal.md" });
    expect(r?.lastRun?.path).toBe("notes/journal.md");

    rig.mgr.renameTarget("notes", "archive"); // folder move
    [r] = rig.mgr.list().routines;
    expect(r?.target).toEqual({ kind: "note", path: "archive/journal.md" });
    expect(r?.lastRun?.path).toBe("archive/journal.md");
  });

  it("applyPrunedSnapshots clears hasSnapshot so no stale restore is offered", async () => {
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" } });
    const routine = addRoutine(rig.mgr);
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await flush();
    fake.emitAssistant("Result.");
    fake.finish();
    await flush();
    const runId = rig.mgr.list().routines[0]?.lastRun?.runId ?? "";
    expect(rig.mgr.list().routines[0]?.lastRun?.hasSnapshot).toBe(true);

    rig.mgr.applyPrunedSnapshots([runId]);
    expect(rig.mgr.list().routines[0]?.lastRun?.hasSnapshot).toBe(false);
    expect((await rig.mgr.restoreLastRun(routine.id)).ok).toBe(false);
  });

  it("delete drops the routine and its queued runs; an in-flight run settles into thin air", async () => {
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" } });
    const routine = addRoutine(rig.mgr);
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await flush();
    expect(rig.mgr.list().runningId).toBe(routine.id);

    expect(rig.mgr.delete(routine.id)).toEqual({ ok: true });
    expect(rig.mgr.list().routines).toHaveLength(0);
    fake.emitAssistant("late");
    fake.finish();
    await flush(); // no throw, no resurrection
    expect(rig.mgr.list().routines).toHaveLength(0);
    expect(rig.mgr.list().runningId).toBeNull();
  });

  it("stop() releases the shared lock and an abandoned run can't write a late outcome", async () => {
    const lock = new BackgroundTurnLock();
    const rig = makeRig({ vault: { "notes/log.md": "# Log\n" }, turnLock: lock });
    const routine = addRoutine(rig.mgr);
    const fake = fakeAgent();
    rig.mgr.setRunner(() => fake.agent);
    rig.mgr.runNow(routine.id);
    await flush();
    expect(lock.holder()).toBe("routine");

    rig.mgr.stop();
    expect(lock.holder()).toBeNull(); // a fresh delegation runner isn't blocked
    expect(rig.mgr.list().runningId).toBeNull();

    fake.emitAssistant("late result");
    fake.finish();
    await flush();
    expect(rig.mgr.list().routines[0]?.lastRun).toBeNull(); // no late outcome
  });
});
