// ---------------------------------------------------------------------------
// Delegation, routines, and the lane they share.
//
// Almost nothing here is a double. The queue, the durable lock, the snapshot
// store, the tool executor, the vault write-back and the report path are the
// production ones; only the process that would have produced the container's
// reports is scripted (../agent/fake-sandbox). So a run driven here exercises
// the same code a real container drives, minus the HTTP hop and pi.
//
// The cases are chosen for the invariants that carry product meaning rather
// than for coverage: one unattended turn at a time ACROSS both surfaces, a
// restore point before every unattended write, an anchor that refuses to drift,
// and a schedule that fires from a Durable Object alarm rather than a timer.
// ---------------------------------------------------------------------------

import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SANDBOX_PROVIDER_ID } from "../agent/provider-catalog";
import { executeAgentTool } from "../agent/agent-tools";
import { userHostName } from "../host/host-address";
import type { UserHost } from "../host/user-host";
import { authenticated, invoke, signUp } from "./host-helpers";

/** A fresh host object per case — the vault manifest, the queues and the
 * scripted containers all live in one object's storage. */
function withHost<T>(
  name: string,
  run: (host: UserHost, state: DurableObjectState) => Promise<T> | T,
): Promise<T> {
  return runInDurableObject(env.UserHost.getByName(userHostName(name)), (host, state) =>
    run(host, state),
  );
}

/** Select the credential-free provider — no account, no OAuth app, no real
 * container. Every background run refuses outright without one. */
function connect(host: UserHost): void {
  host.agent.credentials.setSelection({ provider: SANDBOX_PROVIDER_ID, modelId: "sandbox-1" });
}

/** Let every deferred continuation run. A scripted turn is dispatched through
 * `ctx.waitUntil` exactly as a real one is, so it continues after the call that
 * started it has already resolved. */
async function settle(): Promise<void> {
  for (let pass = 0; pass < 80; pass += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let pass = 0; pass < 80; pass += 1) await Promise.resolve();
}

/** Drive every queued background turn to completion. Each settled run pumps the
 * next, so the queue drains on its own — this only has to keep yielding. */
async function drain(): Promise<void> {
  for (let pass = 0; pass < 6; pass += 1) await settle();
}

const THREE_TASKS = "- [ ] first\n- [ ] second\n- [ ] third\n";

afterEach(() => {
  vi.useRealTimers();
});

describe("the background lane", () => {
  it("runs one delegation at a time and queues the rest", async () => {
    const staged = await withHost("bg-serialized", async (host) => {
      connect(host);
      await host.vault.writeText("tasks.md", THREE_TASKS);
      // Hold the lane first, so all three creates land in the queue and the
      // pump that follows is observed from a known state rather than raced.
      const blocker = host.agent.runs.claim("delegation", "held-by-the-test", Date.now());
      if (blocker === null) throw new Error("the lane was not free");
      const created = await Promise.all([
        host.agent.delegations.create({ sourceFile: "tasks.md", ordinal: 0 }),
        host.agent.delegations.create({ sourceFile: "tasks.md", ordinal: 1 }),
        host.agent.delegations.create({ sourceFile: "tasks.md", ordinal: 2 }),
      ]);
      expect(created.map((result) => result.ok)).toEqual([true, true, true]);
      const queued = host.agent.delegations.list().delegations.map((row) => row.status);

      host.agent.runs.release(blocker.turnId);
      await host.agent.delegations.pump();
      return {
        queued,
        pumped: host.agent.delegations.list().delegations.map((row) => row.status),
        holder: host.agent.runs.holder()?.owner ?? null,
      };
    });
    expect(staged.queued).toEqual(["queued", "queued", "queued"]);
    // ONE pump starts ONE run. The other two stay queued behind the lane
    // rather than racing it.
    expect(staged.pumped).toEqual(["running", "queued", "queued"]);
    expect(staged.holder).toBe("delegation");

    const drained = await withHost("bg-serialized", async (host) => {
      await drain();
      return host.agent.delegations.list().delegations;
    });
    // Each settled run pumped the next, so the queue drained on its own — and
    // every run edited the checkbox it was created for.
    expect(drained.map((row) => row.status)).toEqual(["done", "done", "done"]);
    expect(drained.map((row) => row.anchor.text)).toEqual(["first", "second", "third"]);
    expect(drained[0]?.resultSummary).toContain("[scripted]");
  });

  it("holds a routine behind a running delegation, then lets it through", async () => {
    const held = await withHost("bg-shared-lock", async (host) => {
      connect(host);
      const routine = host.agent.routines.upsert({
        name: "Daily digest",
        prompt: "Summarize",
        schedule: { cadence: "daily", timeOfDay: "09:00" },
        target: { kind: "note", path: "digest.md" },
        enabled: true,
      });
      if (!routine.ok) throw new Error(routine.error);
      // A delegation holds the lane. "Run now" must QUEUE rather than start a
      // second unattended turn beside it — the shared lock is the only thing
      // that stops two surfaces dispatching onto one container.
      const blocker = host.agent.runs.claim("delegation", "a-running-delegation", Date.now());
      if (blocker === null) throw new Error("the lane was not free");
      const queued = await host.agent.routines.runNow(routine.routine.id);
      return {
        queued,
        holder: host.agent.runs.holder()?.owner ?? null,
        runningRoutine: host.agent.routines.list().runningId,
        // Never booted: the routine did not reach a container at all.
        container: (await host.agent.scripted("background")?.state())?.phase ?? null,
        blockerTurn: blocker.turnId,
      };
    });
    expect(held.queued).toEqual({ ok: true });
    expect(held.holder).toBe("delegation");
    expect(held.runningRoutine).toBeNull();
    expect(held.container).toBe("cold");

    const after = await withHost("bg-shared-lock", async (host) => {
      host.agent.runs.release(held.blockerTurn);
      await host.agent.routines.pump();
      await drain();
      return {
        routine: host.agent.routines.list().routines[0]?.lastRun?.status,
        digest: await host.vault.readText("digest.md"),
        holder: host.agent.runs.holder(),
      };
    });
    expect(after.routine).toBe("done");
    // The write path is HOST-owned: the host appended the agent's reply under a
    // heading it composed.
    expect(after.digest).toContain("## Daily digest — ");
    expect(after.digest).toContain("[scripted]");
    expect(after.holder).toBeNull();
  });

  it("refuses to run at all when no restore point can be saved", async () => {
    const name = "bg-capture-fails";
    const key = await withHost(name, async (host) => {
      connect(host);
      await host.vault.writeText("digest.md", "# Digest\n");
      const file = host.vault.lookup("digest.md");
      if (file === null) throw new Error("the target was not written");
      return file.key;
    });
    // The manifest still names the file, but its bytes are gone — so the copy
    // aside cannot be made, and fail-closed means the agent never sees the run.
    await env.VAULT_FILES.delete(`${userHostName(name)}/${key}`);

    const outcome = await withHost(name, async (host) => {
      const routine = host.agent.routines.upsert({
        name: "Digest",
        prompt: "Summarize",
        schedule: { cadence: "daily", timeOfDay: "09:00" },
        target: { kind: "note", path: "digest.md" },
        enabled: true,
      });
      if (!routine.ok) throw new Error(routine.error);
      await host.agent.routines.runNow(routine.routine.id);
      await drain();
      return {
        lastRun: host.agent.routines.list().routines[0]?.lastRun,
        holder: host.agent.runs.holder(),
        container: await host.agent.scripted("background")?.state(),
      };
    });
    expect(outcome.lastRun?.status).toBe("failed");
    expect(outcome.lastRun?.status === "failed" ? outcome.lastRun.error : "").toContain(
      "restore point",
    );
    // The strongest half of fail-closed: the unattended container was never
    // even booted, so nothing could have been written.
    expect(outcome.container?.phase).toBe("cold");
    expect(outcome.holder).toBeNull();
  });

  it("reclaims a lease whose run never reported back", async () => {
    const outcome = await withHost("bg-lease", async (host) => {
      connect(host);
      await host.vault.writeText("tasks.md", "- [ ] one\n");
      await host.agent.delegations.create({ sourceFile: "tasks.md", ordinal: 0 });
      const run = host.agent.runs.holder();
      if (run === null) throw new Error("the delegation did not take the lane");
      // A container that dies mid-turn never reports, so the lease is the only
      // thing that can free the lane.
      await host.agent.sweepBackground(run.expiresAt + 1);
      return {
        holder: host.agent.runs.holder(),
        status: host.agent.delegations.list().delegations[0],
      };
    });
    expect(outcome.holder).toBeNull();
    expect(outcome.status?.status).toBe("failed");
    expect(outcome.status?.status === "failed" ? outcome.status.error : "").toBe("Timed out");
  });
});

describe("delegation anchors", () => {
  it("refuses a checkbox that moved while it sat queued", async () => {
    const outcome = await withHost("bg-anchor", async (host) => {
      connect(host);
      await host.vault.writeText("tasks.md", THREE_TASKS);
      const blocker = host.agent.runs.claim("delegation", "held-by-the-test", Date.now());
      if (blocker === null) throw new Error("the lane was not free");
      await host.agent.delegations.create({ sourceFile: "tasks.md", ordinal: 2 });
      // A checkbox inserted ABOVE shifts every ordinal below it, so the queued
      // record now names a DIFFERENT task. The ordinal still resolves — that is
      // the point — so only the anchor text can catch it.
      await host.vault.writeText("tasks.md", `- [ ] inserted\n${THREE_TASKS}`);
      host.agent.runs.release(blocker.turnId);
      await host.agent.delegations.pump();
      await drain();
      return {
        record: host.agent.delegations.list().delegations[0],
        // Never dispatched: the wrong task was never handed to an agent.
        container: (await host.agent.scripted("background")?.state())?.phase ?? null,
      };
    });
    expect(outcome.record?.status).toBe("failed");
    expect(outcome.record?.status === "failed" ? outcome.record.error : "").toContain(
      "re-delegate",
    );
    expect(outcome.container).toBe("cold");
  });
});

describe("records this build cannot read", () => {
  // A record that will not PARSE and one that parses into the wrong shape are
  // the same fact: a row this build cannot read. The projection names itself as
  // failed rather than vanishing from the list — and neither case may reach the
  // caller as a throw out of a plain `list()`.
  it("projects an unparseable delegation row instead of throwing", async () => {
    const listed = await withHost("bg-corrupt-delegation", async (host, state) => {
      connect(host);
      await host.vault.writeText("tasks.md", THREE_TASKS);
      await host.agent.delegations.create({ sourceFile: "tasks.md", ordinal: 0 });
      await drain();
      state.storage.sql.exec("UPDATE agent_delegations SET record = ?", "{ not json at all");
      return host.agent.delegations.list();
    });
    expect(listed.delegations).toHaveLength(1);
    expect(listed.delegations[0]?.status).toBe("failed");
  });

  it("projects an unparseable routine row instead of throwing", async () => {
    const listed = await withHost("bg-corrupt-routine", (host, state) => {
      const created = host.agent.routines.upsert({
        name: "Morning",
        prompt: "Say hello",
        schedule: { cadence: "daily", timeOfDay: "09:00" },
        target: { kind: "daily" },
        enabled: false,
      });
      expect(created.ok).toBe(true);
      state.storage.sql.exec("UPDATE agent_routines SET record = ?", "}{");
      return host.agent.routines.list();
    });
    expect(listed.routines).toHaveLength(1);
    expect(listed.routines[0]?.name).toBe("Unreadable routine");
  });
});

describe("the delegate tier", () => {
  it("caps how many background tasks one agent turn may queue", async () => {
    const results = await withHost("bg-cap", async (host) => {
      connect(host);
      await host.vault.writeText("tasks.md", `${THREE_TASKS}- [ ] fourth\n`);
      const context = {
        vault: host.vault,
        knowledge: host.knowledge,
        snapshots: host.agent.snapshots,
        delegations: host.agent.delegations,
        scope: { origin: "chat", ref: host.agent.chat.activeSessionId() },
        turnId: "one-turn",
        attended: true,
        confirm: () => Promise.resolve(true),
      } as const;
      const attempts: { isError: boolean; text: string }[] = [];
      for (const ordinal of [0, 1, 2, 3]) {
        attempts.push(
          await executeAgentTool(context, "delegate_task", { path: "tasks.md", ordinal }),
        );
      }
      return { attempts, queued: host.agent.delegations.list().delegations.length };
    });
    expect(results.attempts.slice(0, 3).map((result) => result.isError)).toEqual([
      false,
      false,
      false,
    ]);
    expect(results.attempts[3]?.isError).toBe(true);
    expect(results.attempts[3]?.text).toContain("already handed 3");
    // The refused one never became a record.
    expect(results.queued).toBe(3);
  });
});

describe("routines on the alarm", () => {
  it("fires from a Durable Object alarm, and a retry does not fire it twice", async () => {
    const account = await signUp("routine-alarm@example.com");
    const stub = env.UserHost.getByName(userHostName(account.userId));
    await runInDurableObject(stub, (host) => {
      connect(host);
    });

    // Created over the REAL socket, so the object arms its own alarm from the
    // schedule exactly as it does in production.
    const { ws, frames } = await authenticated(account);
    const created = await invoke(ws, frames, 1, "upsertRoutine", {
      name: "Morning digest",
      prompt: "Summarize yesterday",
      schedule: { cadence: "daily", timeOfDay: "09:00" },
      target: { kind: "note", path: "digest.md" },
      enabled: true,
    });
    expect(created.ok).toBe(true);
    ws.close(1000, "done");

    // Past the next 09:00 slot. The routine's floor is its creation instant, so
    // nothing was due until one passed.
    vi.setSystemTime(new Date(Date.now() + 25 * 60 * 60 * 1000));

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    // Cloudflare delivers an alarm at least once. The retry must find the slot
    // already consumed — `lastRunAt` is stamped at dispatch for exactly this.
    await runDurableObjectAlarm(stub);
    await runInDurableObject(stub, () => drain());

    const after = await runInDurableObject(stub, async (host) => ({
      digest: await host.vault.readText("digest.md"),
      routine: host.agent.routines.list().routines[0],
      holder: host.agent.runs.holder(),
    }));
    expect(after.routine?.lastRun?.status).toBe("done");
    expect(after.holder).toBeNull();
    // Fired ONCE: two headings would mean the retry ran it again.
    expect(after.digest.match(/## Morning digest/g)).toHaveLength(1);
  });

  it("bails without writing when the routine is disabled mid-run", async () => {
    const after = await withHost("bg-epoch", async (host) => {
      connect(host);
      await host.vault.writeText("digest.md", "# Digest\n");
      const created = host.agent.routines.upsert({
        name: "Digest",
        prompt: "Summarize",
        schedule: { cadence: "daily", timeOfDay: "09:00" },
        target: { kind: "note", path: "digest.md" },
        enabled: true,
      });
      if (!created.ok) throw new Error(created.error);
      await host.agent.routines.runNow(created.routine.id);
      // Disabled while the turn is in flight. The epoch guard is what stops an
      // unattended reply landing in a note under a config the user has since
      // changed.
      host.agent.routines.upsert({
        id: created.routine.id,
        name: "Digest",
        prompt: "Summarize",
        schedule: { cadence: "daily", timeOfDay: "09:00" },
        target: { kind: "note", path: "digest.md" },
        enabled: false,
      });
      await drain();
      return {
        digest: await host.vault.readText("digest.md"),
        routine: host.agent.routines.list().routines[0],
        holder: host.agent.runs.holder(),
      };
    });
    expect(after.digest).toBe("# Digest\n");
    expect(after.routine?.lastRun).toBeNull();
    // The lane is still handed back — bailing is not leaking.
    expect(after.holder).toBeNull();
  });
});

describe("AI-edit restore points", () => {
  it("undoes a created note to a tombstone, not to nothing", async () => {
    const outcome = await withHost("bg-undo-create", async (host) => {
      const scope = { origin: "chat", ref: "thread-1" } as const;
      // Captured BEFORE the write, on a path that does not exist yet.
      const id = await host.agent.snapshots.capture(scope, "invented.md");
      if (id === null) throw new Error("the capture failed");
      await host.vault.writeText("invented.md", "# Invented by the agent\n");
      const restored = await host.agent.snapshots.restore([id], "chat");
      return {
        restored,
        file: host.vault.lookup("invented.md"),
        trash: host.vault.listTrash().map((entry) => entry.path),
      };
    });
    expect(outcome.restored).toEqual({ ok: true });
    // A tombstone, not a permanent delete: the vault's trash is what "gone"
    // means here, so the undo is itself undoable for the retention window.
    expect(outcome.file?.state).toBe("trashed");
    expect(outcome.trash).toEqual(["invented.md"]);
  });

  it("keeps the newest 50 per origin, so a long chat cannot evict a run's", async () => {
    const held = await withHost("bg-retention", async (host) => {
      await host.vault.writeText("note.md", "body\n");
      // A background run's undo point, taken first — the one a chatty
      // conversation must not be able to push out.
      const runPoint = await host.agent.snapshots.capture(
        { origin: "delegation", ref: "task-1" },
        "note.md",
      );
      const chat: string[] = [];
      for (let index = 0; index < 55; index += 1) {
        const id = await host.agent.snapshots.capture(
          { origin: "chat", ref: "thread-1" },
          "note.md",
        );
        if (id === null) throw new Error("a chat capture failed");
        chat.push(id);
      }
      return {
        run: runPoint === null ? false : host.agent.snapshots.holds(runPoint),
        oldestChat: host.agent.snapshots.holds(chat[0] ?? ""),
        withinCap: host.agent.snapshots.holds(chat[5] ?? ""),
        newestChat: host.agent.snapshots.holds(chat[54] ?? ""),
      };
    });
    expect(held.run).toBe(true);
    expect(held.oldestChat).toBe(false);
    expect(held.withinCap).toBe(true);
    expect(held.newestChat).toBe(true);
  });

  it("refuses to undo a background task's edit through the chat toast", async () => {
    const outcome = await withHost("bg-origin-guard", async (host) => {
      await host.vault.writeText("note.md", "body\n");
      const id = await host.agent.snapshots.capture(
        { origin: "delegation", ref: "task-1" },
        "note.md",
      );
      if (id === null) throw new Error("the capture failed");
      return host.agent.snapshots.restore([id], "chat");
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.reason).toContain("not edited by this surface");
  });
});
