import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { beginAgentTurnWrites } from "../agents/agent-commits";
import { createGitEngine } from "./git-engine";
import {
  commitCount,
  expectCleanRepo,
  failFlush,
  FAST_COMMIT,
  git,
  initVault,
  lastMessage,
  makeBareRemote,
  makeEngine,
  refusingHook,
  scratchDir,
  TEST_DEVICE,
  trackedFiles,
} from "./test-support/git-fixtures";
import type { AutoCommitTiming } from "./test-support/git-fixtures";
import { createNotifierRecorder } from "./test-support/notifier-recorder";

const awaitCommitCount = async (root: string, count: number): Promise<void> => {
  await vi.waitFor(
    async () => {
      expect(await commitCount(root)).toBe(count);
    },
    { timeout: 5000 },
  );
};

// only a negative ("no commit follows") waits this out; a coming commit is awaited by count.
const debounceSettled = async (timing: AutoCommitTiming): Promise<void> => {
  await delay(timing.maxWaitMs + timing.quietMs);
};

describe("what a scheduled commit costs", () => {
  it("stages the union of the paths it was told about, and nothing else", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    // both schedules land in one quiet window: an await between them lets a slow runner's 50ms
    // window close on the first alone.
    await writeFile(path.join(root, "told-a.md"), "a\n", "utf-8");
    await writeFile(path.join(root, "told-b.md"), "b\n", "utf-8");
    await writeFile(path.join(root, "untold.md"), "c\n", "utf-8");
    engine.scheduleCommit(["told-a.md"]);
    engine.scheduleCommit(["told-b.md"]);

    await awaitCommitCount(root, before + 1);
    const { stdout } = await git.run(root, ["show", "--name-only", "--format=", "HEAD"]);
    expect(stdout.trim().split("\n").toSorted()).toEqual(["told-a.md", "told-b.md"]);
    expect(await engine.commitNow()).toEqual({ files: 1 });
  });

  it("stages `[a].md` alone — a note's name is a path, never a glob for `a.md`", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    await writeFile(path.join(root, "a.md"), "plain\n", "utf-8");
    await writeFile(path.join(root, "[a].md"), "bracketed\n", "utf-8");
    await engine.commitNow();
    const before = await commitCount(root);

    await writeFile(path.join(root, "[a].md"), "bracketed edit\n", "utf-8");
    engine.scheduleCommit(["[a].md"]);
    await writeFile(path.join(root, "a.md"), "user edit\n", "utf-8");

    await awaitCommitCount(root, before + 1);
    const { stdout } = await git.run(root, ["show", "--name-status", "--format=", "HEAD"]);
    expect(stdout.trim()).toBe("M\t[a].md");
    expect(await lastMessage(root)).toBe("vault: update [a].md");
    expect(await engine.commitNow()).toEqual({ files: 1 });
    expect(await lastMessage(root)).toBe("vault: update a.md");
  });

  it("falls back to the whole tree when one scheduler named no paths", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    await writeFile(path.join(root, "told.md"), "a\n", "utf-8");
    await writeFile(path.join(root, "untold.md"), "b\n", "utf-8");
    engine.scheduleCommit(["told.md"]);
    engine.scheduleCommit();

    await awaitCommitCount(root, before + 1);
    expect(await engine.commitNow()).toBeNull();
    await expectCleanRepo(root);
  });

  it("announces no status change: a commit is not a transition", async () => {
    const { root, engine, statusChanges } = await makeEngine({
      remoteUrl: null,
      timing: FAST_COMMIT,
    });
    const before = await commitCount(root);
    await writeFile(path.join(root, "saved.md"), "a\n", "utf-8");
    engine.scheduleCommit(["saved.md"]);
    await awaitCommitCount(root, before + 1);

    expect(statusChanges()).toBe(0);
    await engine.commitNow();
    expect(statusChanges()).toBe(0);
  });
});

// each case spawns a chain of git processes, which a loaded machine stretches past vitest's 5s default.
describe("auto-commit", { timeout: 30_000 }, () => {
  it("lands a burst of writes as ONE commit with the file count", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    for (const name of ["a.md", "b.md", "c.md"]) {
      await writeFile(path.join(root, name), `# ${name}\n`, "utf-8");
      engine.scheduleCommit([name]);
    }

    await awaitCommitCount(root, before + 1);
    expect(await lastMessage(root)).toBe("vault: update 3 files");
    await debounceSettled(FAST_COMMIT);
    expect(await commitCount(root)).toBe(before + 1);
    await expectCleanRepo(root);
  });

  it("names the file when the commit is one file — the log has to be answerable", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    await writeFile(path.join(root, "a note.md"), "# One\n", "utf-8");
    engine.scheduleCommit(["a note.md"]);

    await awaitCommitCount(root, before + 1);
    expect(await lastMessage(root)).toBe("vault: update a note.md");
  });

  it("names the file on the unscoped sweep too, so the two paths agree", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    await writeFile(path.join(root, "swept.md"), "# Swept\n", "utf-8");
    expect(await engine.commitNow()).toEqual({ files: 1 });
    expect(await lastMessage(root)).toBe("vault: update swept.md");
  });

  it("commits past the vault's own hooks — a refused auto-commit leaves the tree dirty for good", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const hooks = scratchDir("inteligir-git-hooks-");
    await refusingHook(hooks, "pre-commit");
    await refusingHook(hooks, "commit-msg");
    await git.run(root, ["config", "core.hooksPath", hooks]);

    await writeFile(path.join(root, "swept.md"), "a\n", "utf-8");
    expect(await engine.commitNow()).toEqual({ files: 1 });
    await writeFile(path.join(root, "scoped.md"), "b\n", "utf-8");
    expect(
      await engine.commitPaths(["scoped.md"], { email: "a@inteligir", name: "agent" }, "agent"),
    ).toEqual({ files: 1 });
    const before = await commitCount(root);
    await writeFile(path.join(root, "flushed.md"), "c\n", "utf-8");
    engine.scheduleCommit(["flushed.md"]);
    await awaitCommitCount(root, before + 1);
    await expectCleanRepo(root);
  });

  it("sees a new note in a vault whose config hides untracked files from status", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    await git.run(root, ["config", "status.showUntrackedFiles", "no"]);
    await writeFile(path.join(root, "fresh.md"), "new\n", "utf-8");
    expect(await engine.commitNow()).toEqual({ files: 1 });
    expect(await trackedFiles(root)).toEqual(["fresh.md"]);
  });

  it("reports a failed flush in the status until a flush lands", async () => {
    const { root, engine, statusChanges } = await makeEngine({
      remoteUrl: null,
      timing: FAST_COMMIT,
    });
    // git's own lock, held as a GUI client or a crashed git would leave it.
    const lock = path.join(root, ".git", "index.lock");
    await writeFile(lock, "", "utf-8");
    await writeFile(path.join(root, "stuck.md"), "a\n", "utf-8");
    engine.scheduleCommit(["stuck.md"]);
    await vi.waitFor(
      () => {
        expect(statusChanges()).toBe(1);
      },
      { timeout: 5000 },
    );
    const failed = await engine.status();
    expect(failed.lastError).toMatch(/index\.lock/u);

    await rm(lock);
    engine.scheduleCommit(["stuck.md"]);
    await vi.waitFor(
      () => {
        expect(statusChanges()).toBe(2);
      },
      { timeout: 5000 },
    );
    const landed = await engine.status();
    expect(landed.lastError).toBeNull();
    await expectCleanRepo(root);
  });

  it("clears a failed flush's report once a sync pass commits what it stranded", async () => {
    const made = await makeEngine({ remoteUrl: await makeBareRemote(), timing: FAST_COMMIT });
    await failFlush(made);

    const synced = await made.engine.syncNow();
    expect(synced.lastError).toBeNull();
    await expectCleanRepo(made.root);
  });

  it("clears a failed flush's report once a checkpoint commits what it stranded", async () => {
    const made = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    await failFlush(made);
    const changesBefore = made.statusChanges();

    expect(await made.engine.commitNow()).toEqual({ files: 1 });
    const status = await made.engine.status();
    expect(status.lastError).toBeNull();
    expect(made.statusChanges()).toBe(changesBefore + 1);
    await expectCleanRepo(made.root);
  });

  it("a scoped commitNow commits only its paths, under a turn's hold too", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    const hold = engine.holdCommits();
    onTestFinished(hold.release);
    await writeFile(path.join(root, "restored.md"), "checkpoint me\n", "utf-8");
    await writeFile(path.join(root, "mid-turn.md"), "the turn's own write\n", "utf-8");

    expect(await engine.commitNow(["restored.md"])).toEqual({ files: 1 });
    const head = await git.run(root, ["log", "-1", "--format=%an <%ae>|%s"]);
    expect(head.stdout.trim()).toBe("inteligir <vault@inteligir.local>|vault: update restored.md");
    const { stdout } = await git.run(root, ["status", "--porcelain"]);
    expect(stdout).toBe("?? mid-turn.md\n");
  });

  it("commitNow is a no-op on a clean tree and commits as the engine, from this device", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    expect(await engine.commitNow()).toBeNull();

    await writeFile(path.join(root, "note.md"), "a user edit\n", "utf-8");
    expect(await engine.commitNow()).toEqual({ files: 1 });
    const { stdout } = await git.run(root, ["log", "-1", "--format=%an <%ae>|%cn"]);
    expect(stdout.trim()).toBe(`inteligir <vault@inteligir.local>|${TEST_DEVICE}`);
  });

  it("interleaved turns attribute separately: each commits ITS write set only", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    const holdA = engine.holdCommits();
    const holdB = engine.holdCommits();
    await writeFile(path.join(root, "a.md"), "turn A\n", "utf-8");
    await writeFile(path.join(root, "b.md"), "turn B\n", "utf-8");
    await writeFile(path.join(root, "user.md"), "user edit\n", "utf-8");
    engine.scheduleCommit();

    const committedA = await engine.commitPaths(
      ["a.md"],
      { email: "a@inteligir", name: "agent-a" },
      "agent: vault update\n\nThread: thr_a",
    );
    expect(committedA).toEqual({ files: 1 });
    holdA.release();
    let shown = await git.run(root, ["show", "--name-only", "--format=%an", "HEAD"]);
    expect(shown.stdout).toContain("agent-a");
    expect(shown.stdout).toContain("a.md");
    expect(shown.stdout).not.toContain("b.md");
    expect(shown.stdout).not.toContain("user.md");

    const committedB = await engine.commitPaths(
      ["b.md"],
      { email: "b@inteligir", name: "agent-b" },
      "agent: vault update\n\nThread: thr_b",
    );
    expect(committedB).toEqual({ files: 1 });
    holdB.release();
    shown = await git.run(root, ["show", "--name-only", "--format=%an", "HEAD"]);
    expect(shown.stdout).toContain("agent-b");
    expect(shown.stdout).toContain("b.md");
    expect(shown.stdout).not.toContain("user.md");

    await awaitCommitCount(root, before + 3);
    shown = await git.run(root, ["show", "--name-only", "--format=%an", "HEAD"]);
    expect(shown.stdout).toContain("inteligir");
    expect(shown.stdout).toContain("user.md");
    await expectCleanRepo(root);

    expect(
      await engine.commitPaths(["a.md"], { email: "a@inteligir", name: "agent-a" }, "noop"),
    ).toBeNull();
  });

  it("a commit hold defers the debounce flush; release re-arms it", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    const hold = engine.holdCommits();
    await writeFile(path.join(root, "mid-turn.md"), "agent writing\n", "utf-8");
    engine.scheduleCommit();
    await debounceSettled(FAST_COMMIT);
    expect(await commitCount(root)).toBe(before);

    const committed = await engine.commitPaths(
      ["mid-turn.md"],
      { email: "agent@inteligir.local", name: "inteligir-agent" },
      "agent: vault update\n\nThread: thr_test",
    );
    expect(committed).toEqual({ files: 1 });
    hold.release();

    await debounceSettled(FAST_COMMIT);
    expect(await commitCount(root)).toBe(before + 1);
    expect(await lastMessage(root)).toBe("agent: vault update");
    const identity = await git.run(root, ["log", "-1", "--format=%an <%ae>|%cn"]);
    expect(identity.stdout.trim()).toBe(`inteligir-agent <agent@inteligir.local>|${TEST_DEVICE}`);
    const { stdout } = await git.run(root, ["log", "-1", "--format=%(trailers:key=Thread)"]);
    expect(stdout.trim()).toBe("Thread: thr_test");
    await expectCleanRepo(root);
  });

  it("a turn starts by committing what the user had not, so its commit's parent holds the user's bytes", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    await writeFile(path.join(root, "note.md"), "the first draft\n", "utf-8");
    await engine.commitNow();
    await writeFile(path.join(root, "note.md"), "typed just before the agent was asked\n", "utf-8");
    engine.scheduleCommit(["note.md"]);

    const turn = beginAgentTurnWrites({
      git: engine,
      notifier: createNotifierRecorder(),
      threadId: "thr_1",
      turnId: "turn_1",
    });
    await turn.ready;
    const checkpoint = await git.run(root, ["log", "-1", "--format=%an|%s"]);
    expect(checkpoint.stdout.trim()).toBe("inteligir|vault: update note.md");
    const checkpointed = await git.run(root, ["show", "HEAD:note.md"]);
    expect(checkpointed.stdout).toBe("typed just before the agent was asked\n");

    await writeFile(path.join(root, "note.md"), "the agent's rewrite\n", "utf-8");
    turn.recordPaths(["note.md"]);
    await turn.finish();
    const agent = await git.run(root, ["log", "-1", "--format=%H|%an"]);
    const [agentSha, agentName] = agent.stdout.trim().split("|");
    expect(agentName).toBe("inteligir-agent");
    const parentBytes = await git.run(root, ["show", `${agentSha ?? ""}^:note.md`]);
    expect(parentBytes.stdout).toBe("typed just before the agent was asked\n");
    await expectCleanRepo(root);
  });

  it("a checkpoint leaves every live turn's claimed paths to that turn and commits the rest", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    await writeFile(path.join(root, "gone.md"), "tracked\n", "utf-8");
    await engine.commitNow();

    const holdA = engine.holdCommits();
    onTestFinished(holdA.release);
    await writeFile(path.join(root, "[a].md"), "turn A's note\n", "utf-8");
    await rm(path.join(root, "gone.md"));
    holdA.claim(["[a].md", "gone.md"]);
    await writeFile(path.join(root, "a.md"), "the user's note\n", "utf-8");
    await writeFile(path.join(root, "user.md"), "the user's other note\n", "utf-8");
    expect(engine.claimedPaths()).toEqual(["[a].md", "gone.md"]);

    expect(await engine.checkpointUnclaimed()).toEqual({ files: 2 });
    const shown = await git.run(root, ["show", "--name-only", "--format=%an", "HEAD"]);
    expect(shown.stdout.split("\n").filter((line) => line.length > 0)).toEqual([
      "inteligir",
      "a.md",
      "user.md",
    ]);
    const { stdout } = await git.run(root, ["status", "--porcelain"]);
    expect(stdout).toBe(" D gone.md\n?? [a].md\n");

    holdA.release();
    holdA.claim(["late.md"]);
    expect(engine.claimedPaths()).toEqual([]);
    expect(await engine.checkpointUnclaimed()).toEqual({ files: 2 });
    await expectCleanRepo(root);
  });
});

describe("dispose", () => {
  it("surfaces a failed shutdown flush instead of swallowing it", async () => {
    const root = scratchDir("inteligir-git-dispose-");
    await initVault(root);
    const engine = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git,
      remote: () => null,
      root,
    });
    await writeFile(path.join(root, "pending.md"), "unflushed\n", "utf-8");
    // break the repo so the flush's own git call fails.
    await rm(path.join(root, ".git"), { force: true, recursive: true });
    await expect(engine.dispose()).rejects.toThrow(/git/u);
  });
});
