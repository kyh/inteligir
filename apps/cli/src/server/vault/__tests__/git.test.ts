import { once } from "node:events";
import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { VAULT_GIT_MAX_PUSH_BYTES } from "@repo/contract/cloud/vault/vault-git";
import { VAULT_MAX_CONTENT_LENGTH } from "@repo/contract/local/vault/vault-schema";
import type {
  VaultStatusResponse,
  VaultSyncConflict,
} from "@repo/contract/local/vault/vault-schema";
import {
  commentsStorePath,
  parseSidecar,
  serializeSidecar,
} from "@repo/notes/comments/sidecar-schema";
import type { CommentEntry } from "@repo/notes/comments/sidecar-schema";
import { removeFrontmatterId } from "@repo/notes/markdown/frontmatter";
import { describeSyncConflict } from "@repo/notes/sync/conflict-copy";
import { CAPTURE_INBOX_PATH, reconcileFile } from "@repo/notes/sync/reconcile-file";
import type { ReconcileInput } from "@repo/notes/sync/reconcile-file";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { beginAgentTurnWrites } from "../../agents/agent-commits";
import { writeDeviceCredential } from "../../cloud/credential-store";
import { createVaultRemoteProvider, hostedVaultRemoteUrl } from "../../cloud/vault-remote";
import type { VaultRemoteSpec } from "../../cloud/vault-remote";
import { REMOTE_MARKER_KEY } from "../folder-facts";
import { createGitEngine } from "../git-engine";
import type { GitEngine, GitEngineArgs } from "../git-engine";
import { mergeFetched } from "../git-merge";
import type { Reconcile } from "../git-merge";
import type { VaultFilesChange } from "../vault-changes";
import { createVaultRuntime } from "../vault-runtime";
import { createVaultService } from "../vault-service";
import { boundAddressSchema } from "../../__tests__/bound-address";
import { ignoreFromDisk } from "../../__tests__/ignore-from-disk";
import {
  asDevice,
  commitCount,
  expectCleanRepo,
  git,
  gitDirPath,
  initVault,
  lastMessage,
  makeBareRemote,
  makeEngine,
  makeWorktreeVault,
  refusingHook,
  scratchDir,
  seedMarker,
  syncState,
  TEST_DEVICE,
  trackedFiles,
} from "./git-fixtures";
import type { AutoCommitTiming } from "./git-fixtures";
import { hermeticGit } from "./git-test-env";
import { createNotifierRecorder } from "./notifier-recorder";
import { scriptedWatcher } from "./scripted-watcher";
import { makeTempDir } from "../../__tests__/temp-dir";

const FAST_COMMIT: AutoCommitTiming = { maxWaitMs: 500, quietMs: 50 };

const reportedState = async (engine: GitEngine): Promise<VaultStatusResponse["state"]> => {
  const status = await engine.status();
  return status.state;
};

// a hook that runs and succeeds, leaving the named file behind as its trace.
const markingHook = async (hooksDir: string, name: string, marker: string): Promise<void> => {
  await mkdir(hooksDir, { recursive: true });
  const hook = path.join(hooksDir, name);
  await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`, "utf-8");
  await chmod(hook, 0o755);
};

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

const DEVICE_A = "Device A";
const DEVICE_B = "Device B";

// a note both devices hold, carrying an id a copy must not keep
const SHARED_BASE = "---\nid: 3f0c9a52-shared\n---\n\n# Shared\n\nthe line both edit\n";
const SHARED_A = SHARED_BASE.replace("the line both edit", "edited on A");
const SHARED_B = SHARED_BASE.replace("the line both edit", "edited on B");
const COPY_OF_A = "shared (conflict, Device A).md";

type Side = Awaited<ReturnType<typeof makeEngine>>;

const commitFile = async (side: Side, relPath: string, content: string | Uint8Array) => {
  const file = path.join(side.root, relPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  await side.engine.commitNow();
};

const commitRemoval = async (side: Side, relPath: string) => {
  await rm(path.join(side.root, relPath));
  await side.engine.commitNow();
};

// how B differs: where its vault sits, and the verdict it merges with
type SideOptions = Pick<Parameters<typeof makeEngine>[0], "root" | "reconcile">;

// A on `Device A` and B on `Device B`, one remote, both holding `shared.md` at its base
const sharedPair = async (bOptions: SideOptions = {}) => {
  const remote = await makeBareRemote();
  const a = await makeEngine({ device: DEVICE_A, remoteUrl: remote });
  const b = await makeEngine({ ...bOptions, device: DEVICE_B, remoteUrl: remote });
  await commitFile(a, "shared.md", SHARED_BASE);
  expect(await syncState(a.engine)).toBe("clean");
  expect(await syncState(b.engine)).toBe("clean");
  expect(await syncState(a.engine)).toBe("clean");
  return { a, b, remote };
};

// A pushes its edit of the shared line; B commits its own, which B's next pass meets.
const divergedPair = async (options: SideOptions = {}) => {
  const pair = await sharedPair(options);
  await commitFile(pair.a, "shared.md", SHARED_A);
  expect(await syncState(pair.a.engine)).toBe("clean");
  await commitFile(pair.b, "shared.md", SHARED_B);
  return pair;
};

const readVault = async (side: Side, relPath: string): Promise<string> =>
  await readFile(path.join(side.root, relPath), "utf-8");

const treeOf = async (root: string): Promise<string> => {
  const { stdout } = await git.run(root, ["rev-parse", "HEAD^{tree}"]);
  return stdout.trim();
};

const mergeHeadLeft = async (root: string): Promise<boolean> => {
  try {
    await git.run(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    return true;
  } catch {
    return false;
  }
};

const parentCount = async (root: string, rev: string): Promise<number> => {
  const { stdout } = await git.run(root, ["rev-list", "--parents", "-n", "1", rev]);
  return stdout.trim().split(" ").length - 1;
};

const conflictCopies = async (root: string): Promise<string[]> => {
  const tracked = await trackedFiles(root);
  return tracked.filter((file) => file.includes(" (conflict, "));
};

const rootCommitOf = async (root: string): Promise<string> => {
  const { stdout } = await git.run(root, ["rev-list", "--max-parents=0", "HEAD"]);
  return stdout.trim();
};

const tipOf = async (dir: string, ref: string): Promise<string> => {
  const { stdout } = await git.run(dir, ["rev-parse", ref]);
  return stdout.trim();
};

// bytes no UTF-8 decoder reads as text
const photoBytes = (fill: number): Uint8Array =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, fill, 0x00]);

describe("what a scheduled commit costs", () => {
  it("stages the union of the paths it was told about, and nothing else", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null, timing: FAST_COMMIT });
    const before = await commitCount(root);

    await writeFile(path.join(root, "told-a.md"), "a\n", "utf-8");
    engine.scheduleCommit(["told-a.md"]);
    await writeFile(path.join(root, "told-b.md"), "b\n", "utf-8");
    engine.scheduleCommit(["told-b.md"]);
    await writeFile(path.join(root, "untold.md"), "c\n", "utf-8");

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
    engine.scheduleCommit(["told.md"]);
    await writeFile(path.join(root, "untold.md"), "b\n", "utf-8");
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

// git's own lock, held as a GUI client or a crashed git would leave it, fails the flush.
const failFlush = async (made: Awaited<ReturnType<typeof makeEngine>>): Promise<void> => {
  const lock = path.join(made.root, ".git", "index.lock");
  await writeFile(lock, "", "utf-8");
  await writeFile(path.join(made.root, "stuck.md"), "a\n", "utf-8");
  const changesBefore = made.statusChanges();
  made.engine.scheduleCommit(["stuck.md"]);
  await vi.waitFor(
    () => {
      expect(made.statusChanges()).toBeGreaterThan(changesBefore);
    },
    { timeout: 5000 },
  );
  const failed = await made.engine.status();
  expect(failed.lastError).toMatch(/index\.lock/u);
  await rm(lock);
};

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

// each pass spawns a chain of git processes against a real bare remote; a loaded machine outruns vitest's 5s default.
describe("sync", { timeout: 30_000 }, () => {
  it("stays idle with no remote", async () => {
    const { engine } = await makeEngine({ remoteUrl: null });
    const status = await engine.syncNow();
    expect(status.state).toBe("no-remote");
  });

  it("round-trips a change through two clones of one bare remote", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const b = await makeEngine({ remoteUrl: remote });

    // first contact: A creates the remote branch, B rebases onto it.
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");
    expect(await syncState(a.engine)).toBe("clean");

    await writeFile(path.join(a.root, "shared.md"), "written on A\n", "utf-8");
    expect(await a.engine.commitNow()).toEqual({ files: 1 });
    expect(await reportedState(a.engine)).toBe("dirty");
    expect(await syncState(a.engine)).toBe("clean");

    expect(await syncState(b.engine)).toBe("clean");
    expect(await readFile(path.join(b.root, "shared.md"), "utf-8")).toBe("written on A\n");

    await writeFile(path.join(b.root, "shared.md"), "edited on B\n", "utf-8");
    await b.engine.commitNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(await readFile(path.join(a.root, "shared.md"), "utf-8")).toBe("edited on B\n");

    await expectCleanRepo(a.root);
    await expectCleanRepo(b.root);
  });

  it("runs none of the vault's own hooks through a commit, a rebase and a push", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const b = await makeEngine({ remoteUrl: remote });
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");

    const markers = scratchDir("inteligir-git-hook-markers-");
    // spelled out: runGit's own --git-path answers the hooks path it overrides.
    const hooks = path.join(b.root, ".git", "hooks");
    const hookNames = ["post-commit", "pre-rebase", "post-rewrite", "pre-push"];
    for (const name of hookNames) {
      await markingHook(hooks, name, path.join(markers, name));
    }

    await writeFile(path.join(a.root, "from-a.md"), "a\n", "utf-8");
    await a.engine.commitNow();
    expect(await syncState(a.engine)).toBe("clean");
    await writeFile(path.join(b.root, "from-b.md"), "b\n", "utf-8");
    expect(await b.engine.commitNow()).toEqual({ files: 1 });
    expect(await syncState(b.engine)).toBe("clean");

    expect(await trackedFiles(b.root)).toEqual(["from-a.md", "from-b.md"]);
    for (const name of hookNames) {
      expect(existsSync(path.join(markers, name))).toBe(false);
    }
  });

  it("says a hold is holding it instead of answering as if a pass ran", async () => {
    const remote = await makeBareRemote();
    const { engine } = await makeEngine({ remoteUrl: remote });
    expect(await syncState(engine)).toBe("clean");

    const hold = engine.holdCommits();
    expect(await syncState(engine)).toBe("held");
    expect(await reportedState(engine)).toBe("held");

    hold.release();
    expect(await syncState(engine)).toBe("clean");
  });

  it("says offline rather than clean when the remote cannot be reached", async () => {
    // nothing local to push: unpushed is measured against the remote-tracking ref, so a stale one would answer clean.
    const { engine } = await makeEngine({ remoteUrl: path.join(await makeBareRemote(), "gone") });
    const status = await engine.syncNow();
    expect(status.state).toBe("offline");
    expect(status.lastError).not.toBeNull();
    expect(await reportedState(engine)).toBe("offline");
  });

  it("clears offline once a pass reaches the remote again", async () => {
    const parent = scratchDir("inteligir-git-late-remote-");
    const remote = path.join(parent, "late.git");
    const { engine } = await makeEngine({ remoteUrl: remote });
    expect(await syncState(engine)).toBe("offline");

    await git.run(parent, ["init", "--bare", "-b", "main", "late.git"]);
    const recovered = await engine.syncNow();
    expect(recovered.state).toBe("clean");
    expect(recovered.lastError).toBeNull();
  });

  it("says detached, never synced, while HEAD names no branch", async () => {
    const remote = await makeBareRemote();
    const { root, engine } = await makeEngine({ remoteUrl: remote });
    expect(await syncState(engine)).toBe("clean");

    await git.run(root, ["switch", "-q", "--detach"]);
    expect(await syncState(engine)).toBe("detached");
    expect(await reportedState(engine)).toBe("detached");

    await git.run(root, ["switch", "-q", "main"]);
    expect(await syncState(engine)).toBe("clean");
  });

  it("says rejected, not offline, when the remote answers and refuses the push", async () => {
    const remote = await makeBareRemote();
    await refusingHook(path.join(remote, "hooks"), "pre-receive");
    const { engine } = await makeEngine({ remoteUrl: remote });
    const status = await engine.syncNow();
    expect(status.state).toBe("rejected");
    expect(status.lastError).toMatch(/pre-receive hook declined/u);
    expect(await reportedState(engine)).toBe("rejected");
  });

  it("says stalled, never dirty, when a pass fails on a step of its own", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: await makeBareRemote() });
    expect(await syncState(engine)).toBe("clean");
    const lock = path.join(root, ".git", "index.lock");
    await writeFile(lock, "", "utf-8");
    await writeFile(path.join(root, "stuck.md"), "a\n", "utf-8");

    const failed = await engine.syncNow();
    expect(failed.state).toBe("stalled");
    expect(failed.lastError).toMatch(/index\.lock/u);
    expect(await reportedState(engine)).toBe("stalled");

    await rm(lock);
    expect(await syncState(engine)).toBe("clean");
  });

  it("says stalled, never dirty, while a failed auto-commit strands the tree", async () => {
    const made = await makeEngine({ remoteUrl: await makeBareRemote(), timing: FAST_COMMIT });
    expect(await syncState(made.engine)).toBe("clean");
    await failFlush(made);
    expect(await reportedState(made.engine)).toBe("stalled");
    expect(await syncState(made.engine)).toBe("clean");
  });

  it("keeps both devices' capture appends to the inbox instead of wedging on a conflict", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const b = await makeEngine({ remoteUrl: remote });
    await writeFile(path.join(a.root, CAPTURE_INBOX_PATH), "# Inbox\n\n- first\n", "utf-8");
    await a.engine.commitNow();
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");
    expect(await syncState(a.engine)).toBe("clean");

    await appendFile(path.join(a.root, CAPTURE_INBOX_PATH), "- captured on A\n", "utf-8");
    await a.engine.commitNow();
    await appendFile(path.join(b.root, CAPTURE_INBOX_PATH), "- captured on B\n", "utf-8");
    await b.engine.commitNow();
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");

    const inbox = await readFile(path.join(b.root, CAPTURE_INBOX_PATH), "utf-8");
    expect(inbox).toContain("- captured on A\n");
    expect(inbox).toContain("- captured on B\n");
    expect(await conflictCopies(b.root)).toEqual([]);
    await expectCleanRepo(b.root);
  });
});

const onlyConflict = (status: VaultStatusResponse): VaultSyncConflict => {
  const [report, ...rest] = status.conflicts;
  if (report === undefined || rest.length > 0) {
    throw new Error(`expected one conflict, got ${JSON.stringify(status.conflicts)}`);
  }
  return report;
};

// a person's own git in the vault, whose refusal to finish is the point
const leaveStopped = async (root: string, gitArgs: readonly string[]): Promise<void> => {
  await git.run(root, ["fetch", "-q", "origin"]);
  await expect(git.run(root, gitArgs, asDevice(DEVICE_B))).rejects.toThrow();
};

// a verdict that throws on the note both devices edit, so a merge of it fails outright
const failsOnShared: Reconcile = (input) => {
  if (input.path === "shared.md") {
    throw new Error("injected reconcile failure");
  }
  return reconcileFile(input);
};

// the same note edited on two devices between syncs: every pass ends pushed, and a path whose two
// versions cannot both stay keeps this device's and copies the other's aside.
describe("a pass that meets another device's edit", { timeout: 30_000 }, () => {
  it("keeps its own line, copies the other's aside without its id, pushes, and converges", async () => {
    const { a, b } = await divergedPair();
    const merged = await b.engine.syncNow();
    expect(merged.state).toBe("clean");
    expect(merged.lastError).toBeNull();
    expect(merged.device).toBe(DEVICE_B);
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
    expect(await readVault(b, COPY_OF_A)).not.toContain("id:");
    expect(onlyConflict(merged)).toEqual({
      at: expect.any(Number),
      copyDevice: DEVICE_A,
      copyPath: COPY_OF_A,
      keptDevice: DEVICE_B,
      kind: "copied",
      path: "shared.md",
    });
    expect(await lastMessage(b.root)).toBe("vault: merge 1 note from Device A");
    expect(await parentCount(b.root, "HEAD")).toBe(2);
    await expectCleanRepo(b.root);

    expect(await syncState(a.engine)).toBe("clean");
    expect(await treeOf(a.root)).toBe(await treeOf(b.root));
    expect(await readVault(a, "shared.md")).toBe(SHARED_B);
    const pulled = onlyConflict(await a.engine.status());
    expect(pulled).toMatchObject({
      copyDevice: DEVICE_A,
      copyPath: COPY_OF_A,
      keptDevice: DEVICE_B,
      kind: "copied",
      path: "shared.md",
    });
    expect(describeSyncConflict(pulled, { thisDevice: DEVICE_A })).toBe(
      "Both versions of “shared” were kept: the one from Device B stays, and yours is in “shared (conflict, Device A)”.",
    );
  });

  it("keeps an edit over the other device's deletion, whichever side deleted", async () => {
    const deletedThere = await sharedPair();
    await commitRemoval(deletedThere.a, "shared.md");
    expect(await syncState(deletedThere.a.engine)).toBe("clean");
    await commitFile(deletedThere.b, "shared.md", SHARED_B);
    const keptHere = await deletedThere.b.engine.syncNow();
    expect(keptHere.state).toBe("clean");
    expect(await readVault(deletedThere.b, "shared.md")).toBe(SHARED_B);
    expect(onlyConflict(keptHere)).toMatchObject({
      deletedDevice: DEVICE_A,
      keptDevice: DEVICE_B,
      kind: "kept-edit",
      path: "shared.md",
    });

    const deletedHere = await sharedPair();
    await commitFile(deletedHere.a, "shared.md", SHARED_A);
    expect(await syncState(deletedHere.a.engine)).toBe("clean");
    await commitRemoval(deletedHere.b, "shared.md");
    const keptThere = await deletedHere.b.engine.syncNow();
    expect(keptThere.state).toBe("clean");
    expect(await readVault(deletedHere.b, "shared.md")).toBe(SHARED_A);
    expect(onlyConflict(keptThere)).toMatchObject({
      deletedDevice: DEVICE_B,
      keptDevice: DEVICE_A,
      kind: "kept-edit",
      path: "shared.md",
    });
    for (const { b } of [deletedThere, deletedHere]) {
      expect(await conflictCopies(b.root)).toEqual([]);
      await expectCleanRepo(b.root);
    }
  });

  it("merges two unrelated histories on the first pass, copying only what the two hold differently", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ device: DEVICE_A, remoteUrl: remote });
    await commitFile(a, "same.md", "the same on both\n");
    await commitFile(a, "differs.md", "A's version\n");
    await commitFile(a, "only-a.md", "A alone\n");
    expect(await syncState(a.engine)).toBe("clean");

    const b = await makeEngine({ device: DEVICE_B, remoteUrl: remote });
    await commitFile(b, "same.md", "the same on both\n");
    await commitFile(b, "differs.md", "B's version\n");
    await commitFile(b, "only-b.md", "B alone\n");
    expect(await rootCommitOf(b.root)).not.toBe(await rootCommitOf(a.root));

    const merged = await b.engine.syncNow();
    expect(merged.state).toBe("clean");
    expect(await trackedFiles(b.root)).toEqual([
      "differs (conflict, Device A).md",
      "differs.md",
      "only-a.md",
      "only-b.md",
      "same.md",
    ]);
    expect(await readVault(b, "differs.md")).toBe("B's version\n");
    expect(await readVault(b, "differs (conflict, Device A).md")).toBe("A's version\n");
    expect(onlyConflict(merged)).toMatchObject({
      copyPath: "differs (conflict, Device A).md",
      kind: "copied",
      path: "differs.md",
    });
    await expectCleanRepo(b.root);
  });

  it("reports none of the copies a remote already held when an unrelated history joins it", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ device: DEVICE_A, remoteUrl: remote });
    await commitFile(a, "Foo.md", "the version that stayed\n");
    await commitFile(a, "Foo (conflict, Device A).md", "set aside long ago\n");
    expect(await syncState(a.engine)).toBe("clean");

    const b = await makeEngine({ device: DEVICE_B, remoteUrl: remote });
    await commitFile(b, "only-b.md", "B alone\n");
    expect(await rootCommitOf(b.root)).not.toBe(await rootCommitOf(a.root));

    const joined = await b.engine.syncNow();
    expect(joined.state).toBe("clean");
    expect(await trackedFiles(b.root)).toContain("Foo (conflict, Device A).md");
    expect(joined.conflicts).toEqual([]);
  });

  it("settles a version past the read cap by its blob, never reading it", async () => {
    const { b } = await divergedPair();
    await git.run(b.root, ["fetch", "-q", "origin", "main"]);
    const asked: ReconcileInput[] = [];
    const reports = await mergeFetched(
      {
        readBlob: async () => await Promise.reject(new Error("read a blob past the cap")),
        run: async (gitArgs, options) =>
          gitArgs[0] === "cat-file" && gitArgs[1] === "-s"
            ? { stdout: `${String(VAULT_MAX_CONTENT_LENGTH + 1)}\n` }
            : await git.run(b.root, gitArgs, options),
      },
      {
        device: DEVICE_B,
        reconcile: (input) => {
          asked.push(input);
          return reconcileFile(input);
        },
        remoteRef: "refs/remotes/origin/main",
      },
    );

    expect(asked.flatMap(({ base, mine, theirs }) => [base.kind, mine.kind, theirs.kind])).toEqual([
      "opaque",
      "opaque",
      "opaque",
    ]);
    expect(reports).toEqual([
      {
        copyDevice: DEVICE_A,
        copyPath: COPY_OF_A,
        keptDevice: DEVICE_B,
        kind: "copied",
        path: "shared.md",
      },
    ]);
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    expect(await readVault(b, COPY_OF_A)).toBe(SHARED_A);
    await expectCleanRepo(b.root);
  });

  it("unions two devices' comments on one note, and copies nothing", async () => {
    const store = commentsStorePath("3f0c9a52-shared");
    const at = 1_707_900_000;
    const entry = (text: string): CommentEntry => ({
      createdAt: at,
      source: "user",
      text,
      updatedAt: at,
    });
    const { a, b } = await sharedPair();
    await commitFile(a, store, serializeSidecar({ c1: entry("Why Friday?") }));
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");

    await commitFile(a, store, serializeSidecar({ a1: entry("from A"), c1: entry("Why Friday?") }));
    expect(await syncState(a.engine)).toBe("clean");
    await commitFile(b, store, serializeSidecar({ b1: entry("from B"), c1: entry("Why Friday?") }));

    const merged = await b.engine.syncNow();
    expect(merged.state).toBe("clean");
    expect(merged.conflicts).toEqual([]);
    expect(await conflictCopies(b.root)).toEqual([]);
    const parsed = parseSidecar(await readVault(b, store));
    expect(parsed.ok ? Object.keys(parsed.sidecar).toSorted() : parsed.error).toEqual([
      "a1",
      "b1",
      "c1",
    ]);
    await expectCleanRepo(b.root);
  });

  it("copies aside the other device's version of a file that is not text, blob for blob", async () => {
    const photo = "photo.png";
    const copy = "photo (conflict, Device A).png";
    const { a, b } = await sharedPair();
    await commitFile(a, photo, photoBytes(1));
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");
    await commitFile(a, photo, photoBytes(2));
    expect(await syncState(a.engine)).toBe("clean");
    await commitFile(b, photo, photoBytes(3));

    const merged = await b.engine.syncNow();
    expect(merged.state).toBe("clean");
    expect(await tipOf(b.root, `HEAD:${copy}`)).toBe(await tipOf(a.root, `HEAD:${photo}`));
    expect(new Uint8Array(await readFile(path.join(b.root, photo)))).toEqual(photoBytes(3));
    expect(new Uint8Array(await readFile(path.join(b.root, copy)))).toEqual(photoBytes(2));
    expect(onlyConflict(merged)).toMatchObject({ copyPath: copy, kind: "copied", path: photo });
  });

  it("merges again, never rebases, while its own merge waits unpushed", async () => {
    const { a, b, remote } = await divergedPair();
    const refusal = path.join(remote, "hooks", "pre-receive");
    await refusingHook(path.dirname(refusal), "pre-receive");
    expect(await syncState(b.engine)).toBe("rejected");
    const unpushed = await tipOf(b.root, "HEAD");
    expect(await parentCount(b.root, unpushed)).toBe(2);
    await rm(refusal);

    await commitFile(a, "other.md", "more from A\n");
    expect(await syncState(a.engine)).toBe("clean");

    expect(await syncState(b.engine)).toBe("clean");
    await git.run(b.root, ["merge-base", "--is-ancestor", unpushed, "HEAD"]);
    expect(await parentCount(b.root, "HEAD")).toBe(2);
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
    expect(await readVault(b, "other.md")).toBe("more from A\n");
    await expectCleanRepo(b.root);
  });

  it("aborts a merge that fails half-way, says so plainly, and tries again only once a side moves", async () => {
    let failing = true;
    const asked: string[] = [];
    // the paths settle in order, so `first.md` lands, with its copy, before `shared.md` throws
    const reconcile: Reconcile = (input) => {
      asked.push(input.path);
      if (failing && input.path === "shared.md") {
        throw new Error("injected reconcile failure");
      }
      return reconcileFile(input);
    };
    const { a, b } = await sharedPair({ reconcile });
    await commitFile(a, "first.md", "the line both edit\n");
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");
    await commitFile(a, "first.md", "edited on A\n");
    await commitFile(a, "shared.md", SHARED_A);
    expect(await syncState(a.engine)).toBe("clean");
    await commitFile(b, "first.md", "edited on B\n");
    await commitFile(b, "shared.md", SHARED_B);

    // not dirty: that reads as edits on their way, and says nothing of the failure
    const failed = await b.engine.syncNow();
    expect(failed.state).toBe("stalled");
    expect(failed.lastError).toMatch(/could not be combined/u);
    expect(failed.lastError).not.toMatch(/git|merge|commit|injected/iu);
    expect(failed.conflicts).toEqual([]);
    expect(asked).toEqual(["first.md", "shared.md"]);
    expect(await mergeHeadLeft(b.root)).toBe(false);
    expect(existsSync(path.join(b.root, "first (conflict, Device A).md"))).toBe(false);
    await expectCleanRepo(b.root);
    expect(await readVault(b, "first.md")).toBe("edited on B\n");
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);

    expect(await syncState(b.engine)).toBe("stalled");
    expect(asked).toHaveLength(2);

    failing = false;
    await commitFile(a, "other.md", "more from A\n");
    expect(await syncState(a.engine)).toBe("clean");
    expect(await syncState(b.engine)).toBe("clean");
    expect(asked).toHaveLength(4);
    expect(await readVault(b, "first (conflict, Device A).md")).toBe("edited on A\n");
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
  });

  it("says why it stalled again when a pass that went offline in between meets the same tips", async () => {
    const { b, remote } = await divergedPair({ reconcile: failsOnShared });
    const failed = await b.engine.syncNow();
    expect(failed.state).toBe("stalled");
    expect(failed.lastError).toMatch(/could not be combined/u);

    const away = `${remote}-away`;
    await rename(remote, away);
    const offline = await b.engine.syncNow();
    expect(offline.state).toBe("offline");
    expect(offline.lastError).not.toBe(failed.lastError);
    await rename(away, remote);

    expect(await b.engine.syncNow()).toMatchObject({
      lastError: failed.lastError,
      state: "stalled",
    });
  });

  it("clears a merge a crash left behind before its first commit", async () => {
    const { b } = await divergedPair();
    await leaveStopped(b.root, ["merge", "--no-commit", "refs/remotes/origin/main"]);
    expect(await mergeHeadLeft(b.root)).toBe(true);

    const restarted = await makeEngine({ device: DEVICE_B, remoteUrl: null, root: b.root });
    await commitFile(restarted, "after-crash.md", "written after the crash\n");
    expect(await mergeHeadLeft(b.root)).toBe(false);
    expect(await parentCount(b.root, "HEAD")).toBe(1);
    expect(await lastMessage(b.root)).toBe("vault: update after-crash.md");
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    await expectCleanRepo(b.root);
  });

  it("clears a rebase a crash left behind before its first commit", async () => {
    const { b } = await divergedPair();
    await leaveStopped(b.root, ["rebase", "refs/remotes/origin/main"]);
    const rebaseDir = await gitDirPath(b.root, "rebase-merge");
    expect(existsSync(rebaseDir)).toBe(true);

    const restarted = await makeEngine({ device: DEVICE_B, remoteUrl: null, root: b.root });
    await commitFile(restarted, "after-crash.md", "written after the crash\n");
    expect(existsSync(rebaseDir)).toBe(false);
    const branch = await git.run(b.root, ["symbolic-ref", "--short", "HEAD"]);
    expect(branch.stdout.trim()).toBe("main");
    expect(await lastMessage(b.root)).toBe("vault: update after-crash.md");
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    await expectCleanRepo(b.root);
  });

  it("lands its verdict where the vault's own rerere recorded another resolution", async () => {
    const { b } = await divergedPair();
    await git.run(b.root, ["config", "rerere.enabled", "true"]);
    // the person's own git records it; runGit turns rerere off for every call that names it not
    const rerere = ["-c", "rerere.enabled=true"];
    await leaveStopped(b.root, [...rerere, "merge", "refs/remotes/origin/main"]);
    await writeFile(path.join(b.root, "shared.md"), "what rerere recorded\n", "utf-8");
    await git.run(b.root, ["add", "shared.md"], asDevice(DEVICE_B));
    await git.run(b.root, [...rerere, "commit", "-q", "--no-edit"], asDevice(DEVICE_B));
    await git.run(b.root, ["reset", "-q", "--hard", "HEAD~1"], asDevice(DEVICE_B));
    expect(existsSync(await gitDirPath(b.root, "rr-cache"))).toBe(true);

    expect(await syncState(b.engine)).toBe("clean");
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
  });

  it("runs none of the vault's own hooks through a merge", async () => {
    const { b } = await divergedPair();
    const markers = scratchDir("inteligir-git-merge-hook-markers-");
    const hookNames = [
      "pre-merge-commit",
      "prepare-commit-msg",
      "commit-msg",
      "post-merge",
      "post-commit",
      "post-checkout",
      "reference-transaction",
    ];
    for (const name of hookNames) {
      await markingHook(path.join(b.root, ".git", "hooks"), name, path.join(markers, name));
    }
    expect(await syncState(b.engine)).toBe("clean");
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
    for (const name of hookNames) {
      expect(existsSync(path.join(markers, name))).toBe(false);
    }
  });

  it("names this device as the committer of every commit it makes", async () => {
    const { a, b } = await divergedPair();
    expect(await syncState(b.engine)).toBe("clean");
    expect(await syncState(a.engine)).toBe("clean");
    const { stdout } = await git.run(a.root, ["log", "--format=%cn%x09%s"]);
    const rows = stdout
      .trim()
      .split("\n")
      .map((row) => row.split("\t"));
    for (const [committer] of rows) {
      expect([DEVICE_A, DEVICE_B]).toContain(committer);
    }
    expect(rows).toContainEqual([DEVICE_B, "vault: merge 1 note from Device A"]);
    expect(rows).toContainEqual([DEVICE_B, "vault: update shared.md"]);
    expect(rows).toContainEqual([DEVICE_A, "vault: update shared.md"]);
  });

  it("merges in a linked-worktree vault instead of calling the repo broken", async () => {
    const { b } = await divergedPair({ root: await makeWorktreeVault() });
    expect(await syncState(b.engine)).toBe("clean");
    expect(await readVault(b, "shared.md")).toBe(SHARED_B);
    expect(await readVault(b, COPY_OF_A)).toBe(removeFrontmatterId(SHARED_A));
    await expectCleanRepo(b.root);
  });
});

// answers no request: a network dropping every packet, as git sees it short of its own limits.
const makeSilentRemote = async () => {
  const server = createServer(() => {
    /* never answered */
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const requested = once(server, "request");
  const hangUp = () => {
    server.closeAllConnections();
  };
  onTestFinished(async () => {
    hangUp();
    server.close();
    await once(server, "close");
  });
  const { port } = boundAddressSchema.parse(server.address());
  return { hangUp, requested, url: `http://127.0.0.1:${String(port)}/vault.git` };
};

// holds a local fetch (upload-pack) or push (receive-pack) before the far end starts while
// closed, so a test can act inside a pass: between its pre-fetch step and its rebase, or between
// its rebase and the ref advertisement its push is judged against. the loop also ends with its
// dir, so a failed test leaks no shell.
const makeGatedService = async (service: "upload-pack" | "receive-pack") => {
  const dir = scratchDir("inteligir-git-gate-");
  const reached = path.join(dir, "reached");
  const opened = path.join(dir, "open");
  const script = path.join(dir, `${service}.sh`);
  await writeFile(
    script,
    [
      "#!/bin/sh",
      `: > '${reached}'`,
      `while [ -d '${dir}' ] && [ ! -e '${opened}' ]; do sleep 0.05; done`,
      `exec git-${service} "$@"`,
      "",
    ].join("\n"),
    "utf-8",
  );
  await chmod(script, 0o755);
  return {
    close: async () => {
      await rm(opened, { force: true });
      await rm(reached, { force: true });
    },
    env: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `remote.origin.${service.replace("-", "")}`,
      GIT_CONFIG_VALUE_0: script,
    },
    open: async () => {
      await writeFile(opened, "", "utf-8");
    },
    reached: async () => {
      await vi.waitFor(
        () => {
          expect(existsSync(reached)).toBe(true);
        },
        { timeout: 10_000 },
      );
    },
  };
};

// far under any network limit, far over a file write.
const LOCAL_STEP_MS = 5000;
// past the watcher's debounce, so an echo reaches the runtime before the pass ends.
const WATCHER_FLUSH_MS = 600;

describe("a pass waiting on the network", { timeout: 30_000 }, () => {
  it("lets a save through while its fetch hangs", async () => {
    const remote = await makeSilentRemote();
    const { engine, root } = await makeEngine({ remoteUrl: remote.url });
    const service = createVaultService({
      ignore: ignoreFromDisk(root),
      lock: engine.runExclusive,
      notifier: createNotifierRecorder(),
      root,
    });

    const pass = engine.syncNow();
    try {
      await remote.requested;
      const saved = await Promise.race([
        service.write("saved.md", "mid-fetch\n").then(() => "written"),
        delay(LOCAL_STEP_MS, "stalled"),
      ]);
      expect(saved).toBe("written");
      expect(await reportedState(engine)).toBe("syncing");
    } finally {
      remote.hangUp();
    }
    await expect(pass).resolves.toMatchObject({ state: "offline" });
  });

  it("ends the pass before its rebase when a turn takes its hold during the fetch", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const gate = await makeGatedService("upload-pack");
    const b = await makeEngine({ env: gate.env, remoteUrl: remote });
    await a.engine.syncNow();
    await gate.open();
    await b.engine.syncNow();
    await gate.close();

    await writeFile(path.join(a.root, "from-a.md"), "pushed by A\n", "utf-8");
    await a.engine.commitNow();
    await a.engine.syncNow();
    const headBefore = await git.run(b.root, ["rev-parse", "HEAD"]);

    const pass = b.engine.syncNow();
    await gate.reached();
    const turn = beginAgentTurnWrites({
      git: b.engine,
      notifier: createNotifierRecorder(),
      threadId: "thr_mid",
      turnId: "turn_mid",
    });
    try {
      const ready = await Promise.race([
        turn.ready.then(() => "ready"),
        delay(LOCAL_STEP_MS, "stalled"),
      ]);
      expect(ready).toBe("ready");
      await writeFile(path.join(b.root, "agent.md"), "agent writing\n", "utf-8");
      turn.recordPaths(["agent.md"]);
    } finally {
      await gate.open();
    }

    await expect(pass).resolves.toMatchObject({ state: "held" });
    const headAfter = await git.run(b.root, ["rev-parse", "HEAD"]);
    expect(headAfter.stdout).toBe(headBefore.stdout);
    expect(existsSync(path.join(b.root, "from-a.md"))).toBe(false);

    await turn.finish();
    expect(await lastMessage(b.root)).toBe("agent: vault update");
    expect(await syncState(b.engine)).toBe("clean");
    expect(await readFile(path.join(b.root, "from-a.md"), "utf-8")).toBe("pushed by A\n");
  });

  it("leaves no offline standing once a held pass's fetch reached the remote", async () => {
    const remote = await makeBareRemote();
    const gate = await makeGatedService("upload-pack");
    const { engine, root } = await makeEngine({ env: gate.env, remoteUrl: remote });
    await gate.open();
    expect(await syncState(engine)).toBe("clean");
    const away = `${remote}-away`;
    await rename(remote, away);
    expect(await syncState(engine)).toBe("offline");
    await rename(away, remote);
    await gate.close();

    const pass = engine.syncNow();
    await gate.reached();
    const turn = beginAgentTurnWrites({
      git: engine,
      notifier: createNotifierRecorder(),
      threadId: "thr_held",
      turnId: "turn_held",
    });
    try {
      await turn.ready;
      await writeFile(path.join(root, "agent.md"), "agent writing\n", "utf-8");
      turn.recordPaths(["agent.md"]);
    } finally {
      await gate.open();
    }

    await expect(pass).resolves.toMatchObject({ lastError: null, state: "held" });
    await turn.finish();
    expect(await engine.status()).toMatchObject({ lastError: null, state: "dirty" });
  });

  it("says dirty with no error, never rejected, when its push loses a race to another device's", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const gate = await makeGatedService("receive-pack");
    const b = await makeEngine({ env: gate.env, remoteUrl: remote });
    await a.engine.syncNow();
    await gate.open();
    await b.engine.syncNow();
    await gate.close();

    await writeFile(path.join(b.root, "from-b.md"), "pushed by B\n", "utf-8");
    await b.engine.commitNow();
    const pass = b.engine.syncNow();
    try {
      await gate.reached();
      await writeFile(path.join(a.root, "from-a.md"), "pushed by A\n", "utf-8");
      await a.engine.commitNow();
      expect(await syncState(a.engine)).toBe("clean");
    } finally {
      await gate.open();
    }

    const raced = await pass;
    expect(raced.state).toBe("dirty");
    expect(raced.lastError).toBeNull();
    expect(await syncState(b.engine)).toBe("clean");
    expect(await readFile(path.join(b.root, "from-a.md"), "utf-8")).toBe("pushed by A\n");
  });

  it("runs once more for a call that lands mid-pass, so a push it fetched before is pulled", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const gate = await makeGatedService("receive-pack");
    const b = await makeEngine({ env: gate.env, remoteUrl: remote });
    await a.engine.syncNow();
    await gate.open();
    await b.engine.syncNow();
    await gate.close();

    await writeFile(path.join(b.root, "from-b.md"), "pushed by B\n", "utf-8");
    await b.engine.commitNow();
    const pass = b.engine.syncNow();
    let ping: Promise<VaultStatusResponse> | null = null;
    try {
      await gate.reached();
      await writeFile(path.join(a.root, "from-a.md"), "pushed by A\n", "utf-8");
      await a.engine.commitNow();
      expect(await syncState(a.engine)).toBe("clean");
      // A's push pings B while B's pass is past its fetch
      ping = b.engine.syncNow();
    } finally {
      await gate.open();
    }

    expect(await pass).toMatchObject({ lastError: null, state: "clean" });
    expect(await ping).toMatchObject({ lastError: null, state: "clean" });
    expect(await readFile(path.join(b.root, "from-a.md"), "utf-8")).toBe("pushed by A\n");
  });

  it("keeps a save's own watcher echo out of the post-pass reconcile", async () => {
    const remote = await makeSilentRemote();
    const vaultDir = makeTempDir("inteligir-git-echo-vault-", { realpath: true });
    const watcher = scriptedWatcher();
    const changes: VaultFilesChange[] = [];
    const runtime = await createVaultRuntime({
      dataDir: scratchDir("inteligir-git-echo-data-"),
      deviceName: () => TEST_DEVICE,
      git,
      notifier: createNotifierRecorder(),
      onFilesChanged: (change) => {
        changes.push(change);
      },
      remote: () => ({ source: "explicit", url: remote.url }),
      syncIntervalMs: null,
      vaultDir,
      watcherBackend: watcher.backend,
    });
    onTestFinished(async () => {
      await runtime.dispose();
    });

    const pass = runtime.git.syncNow();
    try {
      await remote.requested;
      await runtime.service.write("saved.md", "mid-fetch\n");
      watcher.emit(path.join(vaultDir, "saved.md"));
      await delay(WATCHER_FLUSH_MS);
    } finally {
      remote.hangUp();
    }
    await expect(pass).resolves.toMatchObject({ state: "offline" });
    expect(changes).toEqual([{ kind: "paths", paths: ["saved.md"] }]);
  });
});

describe("a pass that pulls", { timeout: 30_000 }, () => {
  it("names the paths a rebase rewrote, and none of this device's own", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const b = await makeEngine({ remoteUrl: remote });
    await a.engine.syncNow();
    await b.engine.syncNow();

    await mkdir(path.join(a.root, "notes"));
    await writeFile(path.join(a.root, "one.md"), "from A\n", "utf-8");
    await writeFile(path.join(a.root, "notes", "two words.md"), "from A\n", "utf-8");
    await a.engine.commitNow();
    await a.engine.syncNow();
    // B's own commit makes the pass a replay rather than a fast-forward.
    await writeFile(path.join(b.root, "own.md"), "from B\n", "utf-8");
    await b.engine.commitNow();

    const before = b.filesChanges().length;
    expect(await syncState(b.engine)).toBe("clean");
    expect(b.filesChanges().slice(before)).toEqual([
      { kind: "paths", paths: ["notes/two words.md", "one.md"] },
    ]);
  });

  it("hands the index those paths, never a whole-vault reconcile", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    expect(await syncState(a.engine)).toBe("clean");
    const changes: VaultFilesChange[] = [];
    const runtime = await createVaultRuntime({
      dataDir: scratchDir("inteligir-git-pull-data-"),
      deviceName: () => TEST_DEVICE,
      git,
      notifier: createNotifierRecorder(),
      onFilesChanged: (change) => {
        changes.push(change);
      },
      remote: () => ({ source: "explicit", url: remote }),
      syncIntervalMs: null,
      vaultDir: path.join(scratchDir("inteligir-git-pull-vault-"), "vault"),
      watcherBackend: scriptedWatcher().backend,
    });
    onTestFinished(async () => {
      await runtime.dispose();
    });

    await writeFile(path.join(a.root, "one.md"), "from A\n", "utf-8");
    await writeFile(path.join(a.root, "two.md"), "from A\n", "utf-8");
    await a.engine.commitNow();
    await a.engine.syncNow();

    await expect(runtime.git.syncNow()).resolves.toMatchObject({ state: "clean" });
    expect(changes).toEqual([{ kind: "paths", paths: ["one.md", "two.md"] }]);
  });
});

const STARTER_WELCOME = "# Welcome\n\nThe note every new vault starts with.\n";
const WELCOME_ON_A = "# Welcome\n\nRewritten on A.\n";

const seedStarters = async (dir: string): Promise<void> => {
  await writeFile(path.join(dir, "Welcome.md"), STARTER_WELCOME, "utf-8");
  await writeFile(path.join(dir, "Tour.md"), "# Tour\n\nA second starter.\n", "utf-8");
};

// A seeded, rewrote one starter, deleted the other, wrote a note of its own and pushed it all.
const accountWithHistory = async () => {
  const remote = await makeBareRemote();
  const a = await makeEngine({ device: DEVICE_A, remoteUrl: remote, seed: seedStarters });
  await commitFile(a, "Welcome.md", WELCOME_ON_A);
  await commitRemoval(a, "Tour.md");
  await commitFile(a, "only-on-a.md", "# Only on A\n");
  expect(await syncState(a.engine)).toBe("clean");
  return { a, remote };
};

describe("a starter vault meeting a remote with history", { timeout: 30_000 }, () => {
  it("records the commit it seeded, and only for a folder it seeded", async () => {
    const seeded = await makeEngine({ remoteUrl: null, seed: seedStarters });
    expect(await seedMarker(seeded.root)).toBe(await tipOf(seeded.root, "HEAD"));
    expect(await trackedFiles(seeded.root)).toEqual(["Tour.md", "Welcome.md"]);

    const opened = await makeEngine({ remoteUrl: null });
    expect(await seedMarker(opened.root)).toBeNull();
  });

  it("takes the remote's history whole: no starter kept over it, copied aside or brought back", async () => {
    const { a, remote } = await accountWithHistory();
    const b = await makeEngine({ device: DEVICE_B, remoteUrl: remote, seed: seedStarters });

    const status = await b.engine.syncNow();
    expect(status.state).toBe("clean");
    expect(status.conflicts).toEqual([]);
    expect(await tipOf(b.root, "HEAD")).toBe(await tipOf(a.root, "HEAD"));
    expect(await treeOf(b.root)).toBe(await treeOf(a.root));
    expect(await conflictCopies(b.root)).toEqual([]);
    expect(await readVault(b, "Welcome.md")).toBe(WELCOME_ON_A);
    expect(existsSync(path.join(b.root, "Tour.md"))).toBe(false);
    expect(await seedMarker(b.root)).toBeNull();
    expect(b.filesChanges()).toEqual([
      { kind: "paths", paths: ["Tour.md", "Welcome.md", "only-on-a.md"] },
    ]);
    expect(b.notices()).toHaveLength(1);
    await expectCleanRepo(b.root);

    const aHead = await tipOf(a.root, "HEAD");
    expect(await syncState(a.engine)).toBe("clean");
    expect(await tipOf(a.root, "HEAD")).toBe(aHead);
    expect(await syncState(b.engine)).toBe("clean");
    expect(b.notices()).toHaveLength(1);
  });

  it("merges as ever once anything was written here, and keeps what was written", async () => {
    const { remote } = await accountWithHistory();
    const b = await makeEngine({ device: DEVICE_B, remoteUrl: remote, seed: seedStarters });
    await commitFile(b, "Welcome.md", "# Welcome\n\nRewritten on B.\n");

    expect(await syncState(b.engine)).toBe("clean");
    expect(await readVault(b, "Welcome.md")).toBe("# Welcome\n\nRewritten on B.\n");
    expect(await readVault(b, "Welcome (conflict, Device A).md")).toBe(WELCOME_ON_A);
    expect(await readVault(b, "only-on-a.md")).toBe("# Only on A\n");
    expect(await seedMarker(b.root)).toBeNull();
    expect(b.notices()).toEqual([]);
  });

  it("never takes over a folder it did not seed, whatever it holds", async () => {
    const { remote } = await accountWithHistory();
    const root = scratchDir("inteligir-git-opened-");
    await writeFile(path.join(root, "Welcome.md"), STARTER_WELCOME, "utf-8");
    const b = await makeEngine({ device: DEVICE_B, remoteUrl: remote, root });

    expect(await syncState(b.engine)).toBe("clean");
    expect(await readVault(b, "Welcome.md")).toBe(STARTER_WELCOME);
    expect(await conflictCopies(b.root)).toEqual(["Welcome (conflict, Device A).md"]);
    expect(b.notices()).toEqual([]);
  });

  it("keeps the seed's claim across a restart", async () => {
    const { a, remote } = await accountWithHistory();
    const root = path.join(scratchDir("inteligir-git-restarted-"), "vault");
    const before = await makeEngine({
      device: DEVICE_B,
      remoteUrl: null,
      root,
      seed: seedStarters,
    });
    const seed = await tipOf(root, "HEAD");
    await before.engine.dispose();

    const after = await makeEngine({
      device: DEVICE_B,
      remoteUrl: remote,
      root,
      seed: seedStarters,
    });
    expect(await seedMarker(root)).toBe(seed);
    expect(await syncState(after.engine)).toBe("clean");
    expect(await treeOf(root)).toBe(await treeOf(a.root));
    expect(await seedMarker(root)).toBeNull();
  });
});

describe("the cross-account fence", { timeout: 30_000 }, () => {
  it("refuses a pass when the vault last synced with a different account", async () => {
    const remote = await makeBareRemote();
    const root = scratchDir("inteligir-git-fence-");
    await initVault(root);
    let account = "user-a";
    const engine = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git,
      remote: () => ({ account: { id: account, state: "known" }, source: "account", url: remote }),
      root,
    });
    onTestFinished(async () => {
      await engine.dispose();
    });

    await writeFile(path.join(root, "note.md"), "# a\n");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");
    const marker = await git.run(root, ["config", "--get", "inteligir.account"]);
    expect(marker.stdout.trim()).toBe("user-a");

    const pushed = await git.run(remote, ["rev-list", "--count", "main"]);
    const pushedCount = Number(pushed.stdout.trim());
    account = "user-b";
    const status = await engine.syncNow();
    expect(status.state).toBe("account-mismatch");
    const afterRefusal = await git.run(remote, ["rev-list", "--count", "main"]);
    expect(Number(afterRefusal.stdout.trim())).toBe(pushedCount);

    account = "user-a";
    expect(await syncState(engine)).toBe("clean");
  });

  it("refuses a different account after a pass that merged the previous one's notes", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const root = scratchDir("inteligir-git-fence-conflict-");
    await initVault(root);
    let account = "user-a";
    const engine = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git,
      remote: () => ({ account: { id: account, state: "known" }, source: "account", url: remote }),
      root,
    });
    onTestFinished(async () => {
      await engine.dispose();
    });

    await a.engine.syncNow();
    await engine.syncNow();
    await a.engine.syncNow();

    await writeFile(path.join(a.root, "shared.md"), "from A\n", "utf-8");
    await a.engine.commitNow();
    await a.engine.syncNow();

    await writeFile(path.join(root, "shared.md"), "from B\n", "utf-8");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");
    expect(await conflictCopies(root)).toEqual(["shared (conflict, Test Device).md"]);

    account = "user-b";
    expect(await syncState(engine)).toBe("account-mismatch");
    expect(await reportedState(engine)).toBe("account-mismatch");
  });
});

describe("a refused credential", () => {
  it("surfaces as `unauthorized`, not `offline`", async () => {
    // offline heals on its own; a revoked device fails every retry until the user signs in again.
    const server = createServer((_request, response) => {
      response.writeHead(401, { "www-authenticate": 'Basic realm="test"' });
      response.end("auth required\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    onTestFinished(async () => {
      server.close();
      await once(server, "close");
    });
    const { port } = boundAddressSchema.parse(server.address());

    const { engine } = await makeEngine({
      remoteUrl: `http://127.0.0.1:${String(port)}/vault.git`,
    });
    const status = await engine.syncNow();
    expect(status.state).toBe("unauthorized");
  });
});

const pktLine = (payload: string): string =>
  `${(Buffer.byteLength(payload) + 4).toString(16).padStart(4, "0")}${payload}`;

// refuses every pack the way the hosted vault refuses one over its cap: the fetch finds no repo,
// the advertisement is an empty repo's, and the push itself answers 413.
const makeTooLargeRemote = async () => {
  let pushes = 0;
  const server = createServer((request, response) => {
    const url = request.url ?? "";
    if (request.method === "GET" && url.endsWith("/info/refs?service=git-receive-pack")) {
      response.writeHead(200, { "content-type": "application/x-git-receive-pack-advertisement" });
      response.end(
        `${pktLine("# service=git-receive-pack\n")}0000` +
          `${pktLine(`${"0".repeat(40)} capabilities^{}\0report-status\n`)}0000`,
      );
      return;
    }
    if (request.method === "POST" && url.endsWith("/git-receive-pack")) {
      pushes += 1;
      request.resume();
      request.on("end", () => {
        response.writeHead(413, { "content-type": "text/plain" });
        response.end("push exceeds the limit\n");
      });
      return;
    }
    response.writeHead(404);
    response.end("not found\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(async () => {
    server.close();
    await once(server, "close");
  });
  const { port } = boundAddressSchema.parse(server.address());
  return { pushes: () => pushes, url: `http://127.0.0.1:${String(port)}/vault.git` };
};

describe("a push too large for the remote", { timeout: 30_000 }, () => {
  it("says too-large, not rejected, and resends nothing while the refused history stands", async () => {
    const remote = await makeTooLargeRemote();
    const { engine, root } = await makeEngine({ remoteUrl: remote.url });
    await writeFile(path.join(root, "scan.md"), "a history over the cap\n", "utf-8");
    await engine.commitNow();

    const refused = await engine.syncNow();
    expect(refused.state).toBe("too-large");
    expect(refused.lastError).toBe("The git remote refused the push as too large.");
    expect(remote.pushes()).toBe(1);

    expect(await syncState(engine)).toBe("too-large");
    await writeFile(path.join(root, "more.md"), "grown past the refused head\n", "utf-8");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("too-large");
    expect(await reportedState(engine)).toBe("too-large");
    expect(remote.pushes()).toBe(1);
  });

  it("pushes again once the branch no longer holds the refused head", async () => {
    const remote = await makeTooLargeRemote();
    const { engine, root } = await makeEngine({ remoteUrl: remote.url });
    const initialized = await git.run(root, ["rev-parse", "HEAD"]);
    await writeFile(path.join(root, "scan.md"), "a history over the cap\n", "utf-8");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("too-large");

    await git.run(root, ["reset", "-q", "--hard", initialized.stdout.trim()]);
    await writeFile(path.join(root, "small.md"), "a rewritten history\n", "utf-8");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("too-large");
    expect(remote.pushes()).toBe(2);
  });

  it("names the hosted vault's stated cap on the account remote", async () => {
    const remote = await makeTooLargeRemote();
    const root = scratchDir("inteligir-git-too-large-");
    await initVault(root);
    const engine = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git,
      remote: () => ({
        account: { id: "user-a", state: "known" },
        source: "account",
        url: remote.url,
      }),
      root,
    });
    onTestFinished(async () => {
      await engine.dispose();
    });
    await writeFile(path.join(root, "scan.md"), "a history over the cap\n", "utf-8");
    await engine.commitNow();

    const refused = await engine.syncNow();
    expect(refused.state).toBe("too-large");
    expect(refused.lastError).toContain(
      `${String(VAULT_GIT_MAX_PUSH_BYTES / (1024 * 1024))} MiB push limit`,
    );
    expect(remote.pushes()).toBe(1);
  });

  it("measures a push to the account remote first, and uploads nothing over the cap", async () => {
    const remote = await makeTooLargeRemote();
    const root = scratchDir("inteligir-git-over-cap-");
    await initVault(root);
    const engine = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git,
      maxPushBytes: 64,
      remote: () => ({
        account: { id: "user-a", state: "known" },
        source: "account",
        url: remote.url,
      }),
      root,
    });
    onTestFinished(async () => {
      await engine.dispose();
    });
    await writeFile(path.join(root, "scan.md"), "a history over a 64-byte cap\n", "utf-8");
    await engine.commitNow();

    const refused = await engine.syncNow();
    expect(refused.state).toBe("too-large");
    expect(refused.lastError).toContain("push limit");
    expect(await syncState(engine)).toBe("too-large");
    expect(remote.pushes()).toBe(0);
  });
});

// a remote with no room left: every push fails as git reports the hosted vault's 507, while the
// fetch reads the real repo, so another device's push still moves its tip. counts the pushes.
const makeFullRemote = async () => {
  const bare = await makeBareRemote();
  const dir = scratchDir("inteligir-git-full-");
  const log = path.join(dir, "pushes");
  const script = path.join(dir, "receive-pack.sh");
  await writeFile(
    script,
    [
      "#!/bin/sh",
      `echo push >> '${log}'`,
      "echo 'error: RPC failed; HTTP 507 curl 22 The requested URL returned error: 507' >&2",
      "exit 1",
      "",
    ].join("\n"),
    "utf-8",
  );
  await chmod(script, 0o755);
  return {
    bare,
    // after hermeticGitEnv's own row
    env: {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_1: "remote.origin.receivepack",
      GIT_CONFIG_VALUE_1: script,
    },
    pushes: async (): Promise<number> => {
      if (!existsSync(log)) {
        return 0;
      }
      const lines = await readFile(log, "utf-8");
      return lines.split("\n").filter(Boolean).length;
    },
  };
};

describe("a remote with no room left", { timeout: 30_000 }, () => {
  it("says full, keeps committing and pulling, and pushes again only once the remote tip moves", async () => {
    const remote = await makeFullRemote();
    const other = await makeEngine({ remoteUrl: remote.bare });
    expect(await syncState(other.engine)).toBe("clean");
    const { engine, root } = await makeEngine({ env: remote.env, remoteUrl: remote.bare });

    const refused = await engine.syncNow();
    expect(refused.state).toBe("full");
    expect(refused.lastError).toBe("Your sync server is out of space.");
    expect(await remote.pushes()).toBe(1);

    await writeFile(path.join(root, "kept.md"), "stays on this device\n", "utf-8");
    expect(await engine.commitNow()).toEqual({ files: 1 });
    expect(await syncState(engine)).toBe("full");
    expect(await reportedState(engine)).toBe("full");
    expect(await remote.pushes()).toBe(1);

    await writeFile(path.join(other.root, "from-other.md"), "pushed elsewhere\n", "utf-8");
    await other.engine.commitNow();
    expect(await syncState(other.engine)).toBe("clean");
    expect(await syncState(engine)).toBe("full");
    expect(await readFile(path.join(root, "from-other.md"), "utf-8")).toBe("pushed elsewhere\n");
    expect(await remote.pushes()).toBe(2);
    expect(await trackedFiles(other.root)).not.toContain("kept.md");
  });

  it("names the account's cloud vault on the account remote", async () => {
    const remote = await makeFullRemote();
    const root = scratchDir("inteligir-git-full-account-");
    await initVault(root);
    const engine = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git: hermeticGit(remote.env),
      remote: () => ({
        account: { id: "user-a", state: "known" },
        source: "account",
        url: remote.bare,
      }),
      root,
    });
    onTestFinished(async () => {
      await engine.dispose();
    });

    const refused = await engine.syncNow();
    expect(refused.state).toBe("full");
    expect(refused.lastError).toBe("Your cloud vault is full. New changes stay on this Mac.");
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

describe("a live remote provider", () => {
  it("an armed tick with no remote invokes no network git — no origin is ever written", async () => {
    const root = scratchDir("inteligir-git-idle-");
    await initVault(root);
    let reads = 0;
    const engine = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git,
      remote: () => {
        reads += 1;
        return null;
      },
      root,
    });
    onTestFinished(async () => {
      await engine.dispose();
    });
    engine.startAutoSync(50);
    await vi.waitFor(() => {
      expect(reads).toBeGreaterThanOrEqual(2);
    });
    // a pass that ran would have persisted origin into .git/config.
    await expect(git.run(root, ["remote", "get-url", "origin"])).rejects.toThrow();
  });

  it("turns sync on mid-life — the sign-in flip needs no engine restart", async () => {
    const remote = await makeBareRemote();
    const root = scratchDir("inteligir-git-live-");
    await initVault(root);
    let current: VaultRemoteSpec | null = null;
    const engine = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git,
      remote: () => current,
      root,
    });
    onTestFinished(async () => {
      await engine.dispose();
    });

    expect(await reportedState(engine)).toBe("no-remote");

    current = { account: { id: "user-live", state: "known" }, source: "account", url: remote };
    await writeFile(path.join(root, "note.md"), "# signed in\n");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");

    current = null;
    expect(await reportedState(engine)).toBe("no-remote");
  });
});

const OWN_ORIGIN_CLOUD_URL = "https://cloud.test";

// the provider the server composes, over a data dir of its own
const composedProvider = (signedIn: boolean) => {
  const dataDir = scratchDir("inteligir-git-own-origin-data-");
  if (signedIn) {
    writeDeviceCredential(dataDir, {
      credential: `igd_${"a".repeat(64)}`,
      deviceId: "dev_1",
      userId: "user-a",
    });
  }
  return createVaultRemoteProvider({
    cloudUrl: OWN_ORIGIN_CLOUD_URL,
    dataDir,
    externalSync: null,
    pinnedRemote: null,
  });
};

const repoWithOrigin = async (origin: string): Promise<string> => {
  const root = scratchDir("inteligir-git-own-origin-");
  await initVault(root);
  await git.run(root, ["remote", "add", "origin", origin]);
  return root;
};

const originOf = async (root: string): Promise<string> => {
  const { stdout } = await git.run(root, ["config", "--get", "remote.origin.url"]);
  return stdout.trim();
};

const engineOn = (root: string, remote: GitEngineArgs["remote"]): GitEngine => {
  const engine = createGitEngine({ deviceName: () => TEST_DEVICE, git, remote, root });
  onTestFinished(async () => {
    await engine.dispose();
  });
  return engine;
};

describe("the vault's own origin", { timeout: 30_000 }, () => {
  it("a signed-in pass keeps a foreign origin and syncs there, never with the hosted vault", async () => {
    const bare = await makeBareRemote();
    const foreign = `file://${bare}`;
    const root = await repoWithOrigin(foreign);
    const engine = engineOn(root, composedProvider(true));

    await writeFile(path.join(root, "note.md"), "# mine\n", "utf-8");
    await engine.commitNow();
    expect(await engine.syncNow()).toMatchObject({
      remote: foreign,
      remoteSource: "explicit",
      state: "clean",
    });
    expect(await originOf(root)).toBe(foreign);
    expect(await tipOf(bare, "main")).toBe(await tipOf(root, "HEAD"));
    await expect(git.run(root, ["config", "--get", REMOTE_MARKER_KEY])).rejects.toThrow();
  });

  it("an origin changed outside the app is the next pass's, with no restart", async () => {
    const first = await makeBareRemote();
    const second = await makeBareRemote();
    const root = await repoWithOrigin(`file://${first}`);
    const engine = engineOn(root, composedProvider(false));

    await writeFile(path.join(root, "note.md"), "# one\n", "utf-8");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");
    expect(await tipOf(first, "main")).toBe(await tipOf(root, "HEAD"));

    await git.run(root, ["remote", "set-url", "origin", `file://${second}`]);
    await writeFile(path.join(root, "note.md"), "# two\n", "utf-8");
    await engine.commitNow();
    expect(await engine.syncNow()).toMatchObject({
      remote: `file://${second}`,
      state: "clean",
    });
    expect(await tipOf(second, "main")).toBe(await tipOf(root, "HEAD"));
    expect(await tipOf(first, "main")).not.toBe(await tipOf(root, "HEAD"));
  });

  it("a signed-out vault whose origin is the hosted vault has no remote of its own", async () => {
    const root = await repoWithOrigin(hostedVaultRemoteUrl(OWN_ORIGIN_CLOUD_URL));
    const engine = engineOn(root, composedProvider(false));
    expect(await engine.status()).toEqual({
      conflicts: [],
      device: TEST_DEVICE,
      externalSync: null,
      lastError: null,
      lastSyncAt: null,
      state: "no-remote",
    });
  });

  it("an account pass that meets an origin of the user's own leaves it and pushes nothing", async () => {
    const own = await makeBareRemote();
    const hosted = await makeBareRemote();
    const root = await repoWithOrigin(`file://${own}`);
    // a provider that hands out the account remote past the origin, as none the server composes does
    const engine = engineOn(root, () => ({
      account: { id: "user-a", state: "known" },
      source: "account",
      url: hosted,
    }));

    await writeFile(path.join(root, "note.md"), "# mine\n", "utf-8");
    await engine.commitNow();
    const status = await engine.syncNow();
    expect(status.state).toBe("stalled");
    expect(status.lastError).toMatch(/origin/u);
    expect(await originOf(root)).toBe(`file://${own}`);
    for (const remote of [own, hosted]) {
      await expect(git.run(remote, ["rev-parse", "--verify", "main"])).rejects.toThrow();
    }
  });

  it("an account pass marks the origin it writes; an explicit remote takes it over unmarked", async () => {
    const hosted = await makeBareRemote();
    const pinned = await makeBareRemote();
    const root = scratchDir("inteligir-git-marked-");
    await initVault(root);
    let current: VaultRemoteSpec = {
      account: { id: "user-a", state: "known" },
      source: "account",
      url: hosted,
    };
    const engine = engineOn(root, () => current);

    await writeFile(path.join(root, "note.md"), "# hosted\n", "utf-8");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");
    expect(await originOf(root)).toBe(hosted);
    const marker = await git.run(root, ["config", "--get", REMOTE_MARKER_KEY]);
    expect(marker.stdout.trim()).toBe("account");

    current = { source: "explicit", url: pinned };
    expect(await syncState(engine)).toBe("clean");
    expect(await originOf(root)).toBe(pinned);
    await expect(git.run(root, ["config", "--get", REMOTE_MARKER_KEY])).rejects.toThrow();
  });
});

describe("a remote the person chooses", { timeout: 30_000 }, () => {
  it("clears what a pass concluded about the unreachable one, and its first pass lands clean", async () => {
    const unreachable = path.join(scratchDir("inteligir-git-choose-"), "gone.git");
    const root = await repoWithOrigin(unreachable);
    const engine = engineOn(root, composedProvider(false));
    await writeFile(path.join(root, "note.md"), "# mine\n", "utf-8");
    await engine.commitNow();
    const offline = await engine.syncNow();
    expect(offline.state).toBe("offline");
    expect(offline.lastError).not.toBeNull();

    const reachable = await makeBareRemote();
    expect(await engine.setOrigin({ kind: "remote", url: `file://${reachable}` })).toBe("set");
    expect(await engine.status()).toMatchObject({
      lastError: null,
      remote: `file://${reachable}`,
      remoteSource: "explicit",
      state: "dirty",
    });

    expect(await engine.syncNow()).toMatchObject({ lastError: null, state: "clean" });
    expect(await tipOf(reachable, "main")).toBe(await tipOf(root, "HEAD"));
  });

  it("forgets the old remote's tips, so no status calls the vault synced with the new one first", async () => {
    const first = await makeBareRemote();
    const root = await repoWithOrigin(`file://${first}`);
    const engine = engineOn(root, composedProvider(false));
    await writeFile(path.join(root, "note.md"), "# mine\n", "utf-8");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");
    // a symref, as a clone leaves: forgetting it must not delete the branch it names twice
    await git.run(root, ["remote", "set-head", "origin", "main"]);

    const second = await makeBareRemote();
    await engine.setOrigin({ kind: "remote", url: `file://${second}` });
    expect(await reportedState(engine)).toBe("dirty");
    expect(await syncState(engine)).toBe("clean");
    expect(await tipOf(second, "main")).toBe(await tipOf(root, "HEAD"));
  });

  it("drops a hand-set pushurl, so the next push reaches the remote chosen", async () => {
    const first = await makeBareRemote();
    const root = await repoWithOrigin(`file://${first}`);
    await git.run(root, ["config", "remote.origin.pushurl", `file://${first}`]);
    const engine = engineOn(root, composedProvider(false));
    await writeFile(path.join(root, "note.md"), "# mine\n", "utf-8");
    await engine.commitNow();

    const second = await makeBareRemote();
    await engine.setOrigin({ kind: "remote", url: `file://${second}` });
    expect(await syncState(engine)).toBe("clean");
    expect(await tipOf(second, "main")).toBe(await tipOf(root, "HEAD"));
    await expect(git.run(first, ["rev-parse", "--verify", "main"])).rejects.toThrow();
    await expect(git.run(root, ["config", "--get", "remote.origin.pushurl"])).rejects.toThrow();
  });

  it("forgets the old remote's tips and pushurl when a pass moves the origin itself", async () => {
    const first = await makeBareRemote();
    const root = await repoWithOrigin(`file://${first}`);
    let current: VaultRemoteSpec = { source: "explicit", url: `file://${first}` };
    const engine = engineOn(root, () => current);
    await writeFile(path.join(root, "note.md"), "# mine\n", "utf-8");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");
    await git.run(root, ["config", "remote.origin.pushurl", `file://${first}`]);

    const pinned = path.join(scratchDir("inteligir-git-pinned-"), "not-yet.git");
    current = { source: "pinned", url: pinned };
    expect(await syncState(engine)).toBe("offline");
    expect(await originOf(root)).toBe(pinned);
    const tips = await git.run(root, ["for-each-ref", "refs/remotes/origin"]);
    expect(tips.stdout.trim()).toBe("");
    await expect(git.run(root, ["config", "--get", "remote.origin.pushurl"])).rejects.toThrow();
  });

  it("says pinned and changes nothing while INTELIGIR_VAULT_REMOTE decides", async () => {
    const pinned = await makeBareRemote();
    const root = await repoWithOrigin(`file://${pinned}`);
    const statusChanges: string[] = [];
    const engine = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git,
      onStatusChanged: () => {
        statusChanges.push("changed");
      },
      remote: createVaultRemoteProvider({
        cloudUrl: OWN_ORIGIN_CLOUD_URL,
        dataDir: scratchDir("inteligir-git-pinned-data-"),
        externalSync: null,
        pinnedRemote: `file://${pinned}`,
      }),
      root,
    });
    onTestFinished(async () => {
      await engine.dispose();
    });

    expect(await engine.setOrigin({ kind: "account" })).toBe("pinned");
    expect(await originOf(root)).toBe(`file://${pinned}`);
    await expect(git.run(root, ["config", "--get", REMOTE_MARKER_KEY])).rejects.toThrow();
    expect(statusChanges).toEqual([]);
  });
});
