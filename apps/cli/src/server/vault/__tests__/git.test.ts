import { once } from "node:events";
import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { VAULT_GIT_MAX_PUSH_BYTES } from "@repo/api/cloud/vault/vault-git";
import type { VaultConflict, VaultStatusResponse } from "@repo/api/local/vault/vault-schema";
import { VAULT_TMP_PREFIX } from "@repo/notes/knowledge/vault-path";
import { CAPTURE_INBOX_PATH } from "@repo/notes/sync/reconcile-file";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { beginAgentTurnWrites } from "../../agents/agent-commits";
import type { VaultRemoteSpec } from "../../cloud/vault-remote";
import { ensureVaultRepo } from "../git-bootstrap";
import type { EnsureVaultRepoArgs } from "../git-bootstrap";
import { createGitEngine } from "../git-engine";
import type { GitEngine, GitEngineArgs } from "../git-engine";
import { classifyNetworkFailure, GitError, gitPath, runGit } from "../git-run";
import type { RunGitCommand } from "../git-run";
import type { VaultFilesChange } from "../vault-changes";
import { createVaultRuntime } from "../vault-runtime";
import { createVaultService } from "../vault-service";
import { boundAddressSchema } from "../../__tests__/bound-address";
import { ignoreFromDisk } from "../../__tests__/ignore-from-disk";
import { hermeticGitEnv } from "./git-test-env";
import { createNotifierRecorder } from "./notifier-recorder";
import { scriptedWatcher } from "./scripted-watcher";
import { makeTempDir } from "../../__tests__/temp-dir";

const env = hermeticGitEnv();

const scratchDir = (prefix: string): string => {
  const dir = makeTempDir(prefix);
  return dir;
};

const makeBareRemote = async (): Promise<string> => {
  const dir = scratchDir("inteligir-git-remote-");
  await runGit(dir, ["init", "--bare", "-b", "main"], { env });
  return dir;
};

interface AutoCommitTiming {
  quietMs: number;
  maxWaitMs: number;
}

const FAST_COMMIT: AutoCommitTiming = { maxWaitMs: 500, quietMs: 50 };

const makeEngine = async (args: {
  remoteUrl: string | null;
  timing?: AutoCommitTiming;
  env?: Record<string, string>;
  root?: string;
}): Promise<{
  root: string;
  engine: GitEngine;
  statusChanges: () => number;
  filesChanges: () => VaultFilesChange[];
}> => {
  const root = args.root ?? scratchDir("inteligir-git-vault-");
  await ensureVaultRepo({ env, root });
  let statusChanges = 0;
  const filesChanges: VaultFilesChange[] = [];
  const engineArgs: GitEngineArgs = {
    env: { ...env, ...args.env },
    onFilesChanged: (change) => {
      filesChanges.push(change);
    },
    onStatusChanged: () => {
      statusChanges += 1;
    },
    remote: () => (args.remoteUrl === null ? null : { source: "explicit", url: args.remoteUrl }),
    root,
    ...args.timing,
  };
  const engine = createGitEngine(engineArgs);
  onTestFinished(async () => {
    await engine.dispose();
  });
  return {
    engine,
    filesChanges: () => [...filesChanges],
    root,
    statusChanges: () => statusChanges,
  };
};

const syncState = async (engine: GitEngine): Promise<VaultStatusResponse["state"]> => {
  const status = await engine.syncNow();
  return status.state;
};

const reportedState = async (engine: GitEngine): Promise<VaultStatusResponse["state"]> => {
  const status = await engine.status();
  return status.state;
};

const commitCount = async (root: string): Promise<number> => {
  const { stdout } = await runGit(root, ["rev-list", "--count", "HEAD"], { env });
  return Math.trunc(Number(stdout.trim()));
};

const lastMessage = async (root: string): Promise<string> => {
  const { stdout } = await runGit(root, ["log", "-1", "--format=%s"], { env });
  return stdout.trim();
};

const gitIn =
  (root: string): RunGitCommand =>
  async (gitArgs) =>
    await runGit(root, gitArgs, { env });

const expectCleanRepo = async (root: string): Promise<void> => {
  const git = gitIn(root);
  const { stdout } = await git(["status", "--porcelain"]);
  expect(stdout).toBe("");
  expect(existsSync(await gitPath(git, root, "rebase-merge"))).toBe(false);
  expect(existsSync(await gitPath(git, root, "rebase-apply"))).toBe(false);
  await git(["fsck", "--no-progress"]);
};

const trackedFiles = async (root: string): Promise<string[]> => {
  const { stdout } = await runGit(root, ["ls-tree", "-r", "--name-only", "HEAD"], { env });
  return stdout.split("\n").filter((line) => line.length > 0);
};

const refusingHook = async (hooksDir: string, name: string): Promise<void> => {
  await mkdir(hooksDir, { recursive: true });
  const hook = path.join(hooksDir, name);
  await writeFile(hook, "#!/bin/sh\nexit 1\n", "utf-8");
  await chmod(hook, 0o755);
};

// a hook that runs and succeeds, leaving the named file behind as its trace.
const markingHook = async (hooksDir: string, name: string, marker: string): Promise<void> => {
  await mkdir(hooksDir, { recursive: true });
  const hook = path.join(hooksDir, name);
  await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`, "utf-8");
  await chmod(hook, 0o755);
};

// a vault that is a linked worktree: its `.git` is a file, and its rebase state lives under the
// main checkout's git dir. main parks on another branch so the worktree can take `main`.
const makeWorktreeVault = async (): Promise<string> => {
  const main = scratchDir("inteligir-git-main-");
  await ensureVaultRepo({ env, root: main });
  await runGit(main, ["switch", "-q", "-c", "parked"], { env });
  const root = path.join(scratchDir("inteligir-git-worktree-"), "vault");
  await runGit(main, ["worktree", "add", "-q", root, "main"], { env });
  return root;
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

const expectConflict = (status: VaultStatusResponse): VaultConflict => {
  if (status.state !== "conflict") {
    throw new Error(`expected a conflict, got ${status.state}`);
  }
  return status.conflict;
};

// A pushes an edit to one note; B commits its own edit to it, which B's next pass meets.
const divergedPair = async (bRoot?: string) => {
  const remote = await makeBareRemote();
  const a = await makeEngine({ remoteUrl: remote });
  const b = await makeEngine(
    bRoot === undefined ? { remoteUrl: remote } : { remoteUrl: remote, root: bRoot },
  );
  await a.engine.syncNow();
  await b.engine.syncNow();
  await a.engine.syncNow();

  await writeFile(path.join(a.root, "shared.md"), "from A\n", "utf-8");
  await a.engine.commitNow();
  await a.engine.syncNow();

  await writeFile(path.join(b.root, "shared.md"), "from B\n", "utf-8");
  await b.engine.commitNow();
  return { a, b };
};

// no checkout writes this date, so a rewrite of the file shows in its mtime.
const UNTOUCHED = new Date("2020-01-01T00:00:00Z");

const mtimeOf = async (file: string): Promise<number> => {
  const { mtimeMs } = await stat(file);
  return mtimeMs;
};

describe("ensureVaultRepo", () => {
  it("creates, inits and seeds a missing vault, and leaves HEAD born", async () => {
    const parent = scratchDir("inteligir-git-boot-");
    const root = path.join(parent, "vault");
    const { created } = await ensureVaultRepo({
      env,
      root,
      seed: async (dir) => {
        await writeFile(path.join(dir, "Welcome.md"), "hello\n", "utf-8");
      },
    });
    expect(created).toBe(true);
    expect(await readFile(path.join(root, "Welcome.md"), "utf-8")).toBe("hello\n");
    expect(await commitCount(root)).toBe(1);

    const again = await ensureVaultRepo({ env, root });
    expect(again.created).toBe(false);
    expect(await commitCount(root)).toBe(1);
  });

  it("stages nothing before the listen: a folder of notes gets an empty HEAD, and the sweep commits them", async () => {
    const root = scratchDir("inteligir-git-folder-");
    await writeFile(path.join(root, "existing.md"), "already here\n", "utf-8");
    await ensureVaultRepo({ env, root });
    expect(await commitCount(root)).toBe(1);
    expect(await trackedFiles(root)).toEqual([]);

    const engine = createGitEngine({ env, remote: () => null, root });
    onTestFinished(async () => {
      await engine.dispose();
    });
    expect(await engine.commitNow()).toEqual({ files: 1 });
    expect(await trackedFiles(root)).toEqual(["existing.md"]);
  });

  it("boots a repo a hooks-only template made, past a hook that refuses every commit", async () => {
    const template = scratchDir("inteligir-git-template-");
    await refusingHook(path.join(template, "hooks"), "commit-msg");
    const root = path.join(scratchDir("inteligir-git-templated-"), "vault");
    await ensureVaultRepo({ env: { ...env, GIT_TEMPLATE_DIR: template }, root });

    expect(await commitCount(root)).toBe(1);
    const exclude = await readFile(await gitPath(gitIn(root), root, "info/exclude"), "utf-8");
    expect(exclude.split("\n")).toContain(`${VAULT_TMP_PREFIX}*`);
  });

  it("boots a linked worktree, whose .git is a file, and excludes in the info/ it shares", async () => {
    const root = await makeWorktreeVault();
    await ensureVaultRepo({ env, root });
    await ensureVaultRepo({ env, root });

    const exclude = await readFile(await gitPath(gitIn(root), root, "info/exclude"), "utf-8");
    expect(exclude.split("\n").filter((line) => line === `${VAULT_TMP_PREFIX}*`)).toHaveLength(1);
    await writeFile(path.join(root, `${VAULT_TMP_PREFIX}staged`), "mid-write\n", "utf-8");
    await expectCleanRepo(root);
  });

  it("marks the root capture inbox, and only it, merge=union, once however many boots", async () => {
    const root = scratchDir("inteligir-git-inbox-attr-");
    await ensureVaultRepo({ env, root });
    await ensureVaultRepo({ env, root });

    const line = `/${CAPTURE_INBOX_PATH} merge=union`;
    const attributes = await readFile(await gitPath(gitIn(root), root, "info/attributes"), "utf-8");
    expect(attributes.split("\n").filter((entry) => entry === line)).toHaveLength(1);
    const nested = path.join("notes", CAPTURE_INBOX_PATH);
    const { stdout } = await runGit(
      root,
      ["check-attr", "merge", "--", CAPTURE_INBOX_PATH, nested],
      {
        env,
      },
    );
    expect(stdout).toBe(`${CAPTURE_INBOX_PATH}: merge: union\n${nested}: merge: unspecified\n`);
  });
});

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
    const { stdout } = await runGit(root, ["show", "--name-only", "--format=", "HEAD"], { env });
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
    const { stdout } = await runGit(root, ["show", "--name-status", "--format=", "HEAD"], { env });
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
  made.engine.scheduleCommit(["stuck.md"]);
  await vi.waitFor(
    () => {
      expect(made.statusChanges()).toBeGreaterThanOrEqual(1);
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
    await runGit(root, ["config", "core.hooksPath", hooks], { env });

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
    await runGit(root, ["config", "status.showUntrackedFiles", "no"], { env });
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
    const head = await runGit(root, ["log", "-1", "--format=%an <%ae>|%s"], { env });
    expect(head.stdout.trim()).toBe("inteligir <vault@inteligir.local>|vault: update restored.md");
    const { stdout } = await runGit(root, ["status", "--porcelain"], { env });
    expect(stdout).toBe("?? mid-turn.md\n");
  });

  it("commitNow is a no-op on a clean tree and commits as the engine", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    expect(await engine.commitNow()).toBeNull();

    await writeFile(path.join(root, "note.md"), "a user edit\n", "utf-8");
    expect(await engine.commitNow()).toEqual({ files: 1 });
    const { stdout } = await runGit(root, ["log", "-1", "--format=%an <%ae>|%cn"], { env });
    expect(stdout.trim()).toBe("inteligir <vault@inteligir.local>|inteligir");
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
    let shown = await runGit(root, ["show", "--name-only", "--format=%an", "HEAD"], { env });
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
    shown = await runGit(root, ["show", "--name-only", "--format=%an", "HEAD"], { env });
    expect(shown.stdout).toContain("agent-b");
    expect(shown.stdout).toContain("b.md");
    expect(shown.stdout).not.toContain("user.md");

    await awaitCommitCount(root, before + 3);
    shown = await runGit(root, ["show", "--name-only", "--format=%an", "HEAD"], { env });
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
    const identity = await runGit(root, ["log", "-1", "--format=%an <%ae>|%cn"], { env });
    expect(identity.stdout.trim()).toBe("inteligir-agent <agent@inteligir.local>|inteligir");
    const { stdout } = await runGit(root, ["log", "-1", "--format=%(trailers:key=Thread)"], {
      env,
    });
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
    const checkpoint = await runGit(root, ["log", "-1", "--format=%an|%s"], { env });
    expect(checkpoint.stdout.trim()).toBe("inteligir|vault: update note.md");
    const checkpointed = await runGit(root, ["show", "HEAD:note.md"], { env });
    expect(checkpointed.stdout).toBe("typed just before the agent was asked\n");

    await writeFile(path.join(root, "note.md"), "the agent's rewrite\n", "utf-8");
    turn.recordPaths(["note.md"]);
    await turn.finish();
    const agent = await runGit(root, ["log", "-1", "--format=%H|%an"], { env });
    const [agentSha, agentName] = agent.stdout.trim().split("|");
    expect(agentName).toBe("inteligir-agent");
    const parentBytes = await runGit(root, ["show", `${agentSha ?? ""}^:note.md`], { env });
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
    const shown = await runGit(root, ["show", "--name-only", "--format=%an", "HEAD"], { env });
    expect(shown.stdout.split("\n").filter((line) => line.length > 0)).toEqual([
      "inteligir",
      "a.md",
      "user.md",
    ]);
    const { stdout } = await runGit(root, ["status", "--porcelain"], { env });
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

  it("surfaces diverging edits as a typed conflict and leaves the repo clean", async () => {
    const { b } = await divergedPair();
    const conflict = expectConflict(await b.engine.syncNow());

    expect(conflict.files).toEqual(["shared.md"]);
    expect(conflict.ours.commits).toBeGreaterThanOrEqual(1);
    expect(conflict.theirs.commits).toBeGreaterThanOrEqual(1);

    await expectCleanRepo(b.root);
    expect(await readFile(path.join(b.root, "shared.md"), "utf-8")).toBe("from B\n");

    expect(await reportedState(b.engine)).toBe("conflict");
  });

  it("leaves a recorded conflict's worktree alone while neither side moves", async () => {
    const { b } = await divergedPair();
    expectConflict(await b.engine.syncNow());
    const shared = path.join(b.root, "shared.md");
    await utimes(shared, UNTOUCHED, UNTOUCHED);
    const filesChanges = b.filesChanges();

    expectConflict(await b.engine.syncNow());
    expect(await mtimeOf(shared)).toBe(UNTOUCHED.getTime());
    expect(b.filesChanges()).toEqual(filesChanges);
  });

  it("replays a recorded conflict once the remote moves", async () => {
    const { a, b } = await divergedPair();
    const first = expectConflict(await b.engine.syncNow());
    await writeFile(path.join(a.root, "other.md"), "more from A\n", "utf-8");
    await a.engine.commitNow();
    await a.engine.syncNow();
    const shared = path.join(b.root, "shared.md");
    await utimes(shared, UNTOUCHED, UNTOUCHED);

    const second = expectConflict(await b.engine.syncNow());
    expect(second.theirs.commits).toBe(first.theirs.commits + 1);
    expect(await mtimeOf(shared)).not.toBe(UNTOUCHED.getTime());
    await expectCleanRepo(b.root);
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

    await runGit(parent, ["init", "--bare", "-b", "main", "late.git"], { env });
    const recovered = await engine.syncNow();
    expect(recovered.state).toBe("clean");
    expect(recovered.lastError).toBeNull();
  });

  it("says detached, never synced, while HEAD names no branch", async () => {
    const remote = await makeBareRemote();
    const { root, engine } = await makeEngine({ remoteUrl: remote });
    expect(await syncState(engine)).toBe("clean");

    await runGit(root, ["switch", "-q", "--detach"], { env });
    expect(await syncState(engine)).toBe("detached");
    expect(await reportedState(engine)).toBe("detached");

    await runGit(root, ["switch", "-q", "main"], { env });
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

  it("records a conflict in a linked-worktree vault instead of calling the repo broken", async () => {
    const { b } = await divergedPair(await makeWorktreeVault());
    const conflict = expectConflict(await b.engine.syncNow());
    expect(conflict.files).toEqual(["shared.md"]);
    await expectCleanRepo(b.root);
    expect(await readFile(path.join(b.root, "shared.md"), "utf-8")).toBe("from B\n");
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
    const headBefore = await runGit(b.root, ["rev-parse", "HEAD"], { env });

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
    const headAfter = await runGit(b.root, ["rev-parse", "HEAD"], { env });
    expect(headAfter.stdout).toBe(headBefore.stdout);
    expect(existsSync(path.join(b.root, "from-a.md"))).toBe(false);

    await turn.finish();
    expect(await lastMessage(b.root)).toBe("agent: vault update");
    expect(await syncState(b.engine)).toBe("clean");
    expect(await readFile(path.join(b.root, "from-a.md"), "utf-8")).toBe("pushed by A\n");
  });

  it("says dirty, not rejected, when its push loses a race to another device's", async () => {
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
    expect(raced.lastError).toMatch(/fetch first/u);
    expect(await syncState(b.engine)).toBe("clean");
    expect(await readFile(path.join(b.root, "from-a.md"), "utf-8")).toBe("pushed by A\n");
  });

  it("keeps a save's own watcher echo out of the post-pass reconcile", async () => {
    const remote = await makeSilentRemote();
    const vaultDir = makeTempDir("inteligir-git-echo-vault-", { realpath: true });
    const watcher = scriptedWatcher();
    const changes: VaultFilesChange[] = [];
    const runtime = await createVaultRuntime({
      dataDir: scratchDir("inteligir-git-echo-data-"),
      gitEnv: env,
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

    const pass = runtime.syncNow();
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
      gitEnv: env,
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

    await expect(runtime.syncNow()).resolves.toMatchObject({ state: "clean" });
    expect(changes).toEqual([{ kind: "paths", paths: ["one.md", "two.md"] }]);
  });
});

const gitEnvValue = async (root: string, name: string): Promise<string> => {
  const { stdout } = await runGit(
    root,
    ["-c", `alias.dumpenv=!printenv ${name} || true`, "dumpenv"],
    { env },
  );
  return stdout.trim();
};

describe("runGit", () => {
  it("never lets git ask this process a question", async () => {
    // nobody can answer a git prompt, so it only holds the invocation until the timeout.
    const root = scratchDir("inteligir-git-env-");
    await ensureVaultRepo({ env, root });
    expect(await gitEnvValue(root, "GIT_TERMINAL_PROMPT")).toBe("0");
    expect(await gitEnvValue(root, "GIT_SSH_COMMAND")).toBe(
      "ssh -o BatchMode=yes -o ConnectTimeout=20",
    );
  });

  it("gives up on a stalled transfer long before the network timeout", async () => {
    const root = scratchDir("inteligir-git-stall-");
    await ensureVaultRepo({ env, root });
    expect(await gitEnvValue(root, "GIT_HTTP_LOW_SPEED_LIMIT")).toBe("1000");
    expect(await gitEnvValue(root, "GIT_HTTP_LOW_SPEED_TIME")).toBe("30");
  });

  it("passes every pathspec literally — the builder carries the flag, not each caller", async () => {
    const { root, engine } = await makeEngine({ remoteUrl: null });
    await writeFile(path.join(root, "a.md"), "plain\n", "utf-8");
    await writeFile(path.join(root, "[a].md"), "bracketed\n", "utf-8");
    await engine.commitNow();

    // tracked files: the glob reaches through the index, where an untracked walk only matches by name.
    await writeFile(path.join(root, "a.md"), "plain edit\n", "utf-8");
    await writeFile(path.join(root, "[a].md"), "bracketed edit\n", "utf-8");
    await runGit(root, ["add", "-A", "--", "[a].md"], { env });
    const { stdout } = await runGit(root, ["diff", "--cached", "--name-only"], { env });
    expect(stdout.trim()).toBe("[a].md");
  });

  it("leaves a caller's own GIT_SSH_COMMAND alone", async () => {
    const root = scratchDir("inteligir-git-ssh-");
    await ensureVaultRepo({ env, root });
    const { stdout } = await runGit(
      root,
      ["-c", "alias.dumpenv=!printenv GIT_SSH_COMMAND || true", "dumpenv"],
      { env: { ...env, GIT_SSH_COMMAND: "ssh -F /custom/config" } },
    );
    expect(stdout.trim()).toBe("ssh -F /custom/config");
  });
});

const failedPush = (stderr: string, signal: string | null = null) =>
  new GitError("git push failed", stderr, signal);

describe("classifyNetworkFailure", () => {
  it.each([
    ["fatal: Authentication failed for 'https://cloud.test/v1/git/me/'", "unauthorized"],
    [
      "fatal: unable to access 'https://cloud.test/': Could not resolve host: cloud.test",
      "offline",
    ],
    [
      "ssh: connect to host h port 22: Connection refused\nfatal: Could not read from remote repository.",
      "offline",
    ],
    ["error: RPC failed; curl 28 Operation too slow\nfatal: early EOF", "offline"],
    [
      "fatal: unable to access 'https://cloud.test/': The requested URL returned error: 503",
      "offline",
    ],
    [
      "fatal: unable to access 'https://cloud.test/': The requested URL returned error: 429",
      "offline",
    ],
    [
      "error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413\nfatal: the remote end hung up unexpectedly",
      "too-large",
    ],
    [
      "error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413 Request Entity Too Large",
      "too-large",
    ],
    [
      " ! [remote rejected] main -> main (pre-receive hook declined)\nerror: failed to push some refs",
      "rejected",
    ],
    [
      " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs",
      "lost-race",
    ],
    [" ! [rejected]        main -> main (non-fast-forward)", "lost-race"],
  ])("%s → %s", (stderr, expected) => {
    expect(classifyNetworkFailure(failedPush(stderr))).toBe(expected);
  });

  it("calls a git the timeout killed offline, whatever it had printed", () => {
    expect(classifyNetworkFailure(failedPush("", "SIGTERM"))).toBe("offline");
  });
});

describe("the clone path", () => {
  it("clones a populated remote instead of init+seed — a second device joins the vault", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    await writeFile(path.join(a.root, "note.md"), "# from A\n");
    await a.engine.commitNow();
    expect(await syncState(a.engine)).toBe("clean");

    const bRoot = path.join(scratchDir("inteligir-git-clone-"), "vault");
    let seeded = false;
    const { created, cloned } = await ensureVaultRepo({
      env,
      remote: { source: "explicit", url: remote },
      root: bRoot,
      seed: () => {
        seeded = true;
      },
    });
    expect(created).toBe(true);
    expect(cloned).toBe(true);
    expect(seeded).toBe(false);
    expect(await readFile(path.join(bRoot, "note.md"), "utf-8")).toBe("# from A\n");
  });

  it("seeds only the HOSTED missing-repo miss; an explicit remote's miss boots empty", async () => {
    // GitHub-style hosts answer 404 for a private repo the credential cannot see.
    const bRoot = path.join(scratchDir("inteligir-git-clone-miss-"), "vault");
    let seeded = false;
    const { created, cloned } = await ensureVaultRepo({
      env,
      remote: {
        source: "explicit",
        url: path.join(scratchDir("inteligir-git-nowhere-"), "gone.git"),
      },
      root: bRoot,
      seed: () => {
        seeded = true;
      },
    });
    expect(created).toBe(true);
    expect(cloned).toBe(false);
    expect(seeded).toBe(false);
    expect(existsSync(path.join(bRoot, ".git"))).toBe(true);

    const accountRoot = path.join(scratchDir("inteligir-git-clone-miss-account-"), "vault");
    let accountSeeded = false;
    const viaAccount = await ensureVaultRepo({
      env,
      remote: {
        account: { id: "user-a", state: "known" },
        source: "account",
        url: path.join(scratchDir("inteligir-git-nowhere-2-"), "gone.git"),
      },
      root: accountRoot,
      seed: () => {
        accountSeeded = true;
      },
    });
    expect(viaAccount.cloned).toBe(false);
    expect(accountSeeded).toBe(true);
  });
});

describe("the cross-account fence", { timeout: 30_000 }, () => {
  it("refuses a pass when the vault last synced with a different account", async () => {
    const remote = await makeBareRemote();
    const root = scratchDir("inteligir-git-fence-");
    await ensureVaultRepo({ env, root });
    let account = "user-a";
    const engine = createGitEngine({
      env,
      remote: () => ({ account: { id: account, state: "known" }, source: "account", url: remote }),
      root,
    });
    onTestFinished(async () => {
      await engine.dispose();
    });

    await writeFile(path.join(root, "note.md"), "# a\n");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");
    const marker = await runGit(root, ["config", "--get", "inteligir.account"], { env });
    expect(marker.stdout.trim()).toBe("user-a");

    const pushed = await runGit(remote, ["rev-list", "--count", "main"], { env });
    const pushedCount = Number(pushed.stdout.trim());
    account = "user-b";
    const status = await engine.syncNow();
    expect(status.state).toBe("account-mismatch");
    const afterRefusal = await runGit(remote, ["rev-list", "--count", "main"], { env });
    expect(Number(afterRefusal.stdout.trim())).toBe(pushedCount);

    account = "user-a";
    expect(await syncState(engine)).toBe("clean");
  });

  it("drops the previous account's conflict, which outranks the mismatch", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const root = scratchDir("inteligir-git-fence-conflict-");
    await ensureVaultRepo({ env, root });
    let account = "user-a";
    const engine = createGitEngine({
      env,
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
    expect(await syncState(engine)).toBe("conflict");

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
    const initialized = await runGit(root, ["rev-parse", "HEAD"], { env });
    await writeFile(path.join(root, "scan.md"), "a history over the cap\n", "utf-8");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("too-large");

    await runGit(root, ["reset", "-q", "--hard", initialized.stdout.trim()], { env });
    await writeFile(path.join(root, "small.md"), "a rewritten history\n", "utf-8");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("too-large");
    expect(remote.pushes()).toBe(2);
  });

  it("names the hosted vault's stated cap on the account remote", async () => {
    const remote = await makeTooLargeRemote();
    const root = scratchDir("inteligir-git-too-large-");
    await ensureVaultRepo({ env, root });
    const engine = createGitEngine({
      env,
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
    await ensureVaultRepo({ env, root });
    const engine = createGitEngine({
      env,
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

describe("clone failure classes", () => {
  it("an unreachable remote boots EMPTY — the seed waits for a remote that answered", async () => {
    // an empty init commit is dropped by the eventual rebase's --empty=drop, so the vault heals into a clean join.
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

    const root = path.join(scratchDir("inteligir-git-clone-fail-"), "vault");
    let seeded = false;
    const { created, cloned } = await ensureVaultRepo({
      env,
      remote: {
        account: { state: "pending" },
        source: "account",
        url: `http://127.0.0.1:${String(port)}/vault.git`,
      },
      root,
      seed: () => {
        seeded = true;
      },
    });
    expect(created).toBe(true);
    expect(cloned).toBe(false);
    expect(seeded).toBe(false);
    const count = await runGit(root, ["rev-list", "--count", "HEAD"], { env });
    expect(count.stdout.trim()).toBe("1");
  });
});

describe("the bootstrap port", () => {
  interface Invocation {
    cwd: string;
    args: string[];
    timeoutMs: number | undefined;
    env: Record<string, string> | undefined;
  }

  // answers --git-path as a plain repo would; the bootstrap makes the dir it appends in.
  const fakeGit = (clone: "missing" | "failed") => {
    const calls: Invocation[] = [];
    const run = async (
      cwd: string,
      args: readonly string[],
      options: { timeoutMs?: number; env?: Record<string, string> } = {},
    ): Promise<{ stdout: string }> => {
      calls.push({ args: [...args], cwd, env: options.env, timeoutMs: options.timeoutMs });
      switch (args[0]) {
        case "clone": {
          throw new GitError(
            "git clone failed",
            clone === "missing"
              ? "fatal: repository 'https://cloud.test/v1/git/me/' not found"
              : "fatal: unable to access 'https://cloud.test/v1/git/me/': could not resolve host",
          );
        }
        case "rev-parse": {
          if (args[1] === "--git-path") {
            return { stdout: `.git/${args[2] ?? ""}\n` };
          }
          throw new GitError("git rev-parse failed", "");
        }
        case undefined: {
          throw new Error("Not implemented yet: undefined case");
        }
        default: {
          return { stdout: "" };
        }
      }
    };
    return { calls, run };
  };

  it("drives clone-miss → init → seed → born HEAD through the injected run, staging nothing", async () => {
    const root = path.join(scratchDir("inteligir-git-port-"), "vault");
    const fake = fakeGit("missing");
    let seeded = false;
    const args: EnsureVaultRepoArgs = {
      remote: {
        account: { id: "user-x", state: "known" },
        source: "account",
        url: "https://cloud.test/v1/git/me/",
      },
      root,
      run: fake.run,
      seed: () => {
        seeded = true;
      },
    };
    const { created, cloned } = await ensureVaultRepo(args);

    expect(created).toBe(true);
    expect(cloned).toBe(false);
    expect(seeded).toBe(true);
    expect(fake.calls.map((call) => call.args.slice(0, 2).join(" "))).toEqual([
      "clone --",
      "init -b",
      "rev-parse --git-path",
      "rev-parse --git-path",
      "rev-parse --verify",
      "-c commit.gpgsign=false",
    ]);
    const [clone] = fake.calls;
    expect(clone?.cwd).not.toBe(root);
    expect(clone?.timeoutMs).toBe(120_000);
    const commit = fake.calls.at(-1);
    expect(commit?.args).toContain("vault: initialize");
    expect(commit?.env?.GIT_AUTHOR_NAME).toBe("inteligir");
  });

  it("boots EMPTY on a clone failure that is not a missing repo", async () => {
    const root = path.join(scratchDir("inteligir-git-port-fail-"), "vault");
    const fake = fakeGit("failed");
    let seeded = false;
    await ensureVaultRepo({
      remote: {
        account: { id: "user-x", state: "known" },
        source: "account",
        url: "https://cloud.test/v1/git/me/",
      },
      root,
      run: fake.run,
      seed: () => {
        seeded = true;
      },
    });
    expect(seeded).toBe(false);
    expect(fake.calls.at(-1)?.args).toContain("vault: initialize");
  });
});

describe("dispose", () => {
  it("surfaces a failed shutdown flush instead of swallowing it", async () => {
    const root = scratchDir("inteligir-git-dispose-");
    await ensureVaultRepo({ env, root });
    const engine = createGitEngine({ env, remote: () => null, root });
    await writeFile(path.join(root, "pending.md"), "unflushed\n", "utf-8");
    // break the repo so the flush's own git call fails.
    await rm(path.join(root, ".git"), { force: true, recursive: true });
    await expect(engine.dispose()).rejects.toThrow(/git/u);
  });
});

describe("a live remote provider", () => {
  it("an armed tick with no remote invokes no network git — no origin is ever written", async () => {
    const root = scratchDir("inteligir-git-idle-");
    await ensureVaultRepo({ env, root });
    let reads = 0;
    const engine = createGitEngine({
      env,
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
    await expect(runGit(root, ["remote", "get-url", "origin"], { env })).rejects.toThrow();
  });

  it("turns sync on mid-life — the sign-in flip needs no engine restart", async () => {
    const remote = await makeBareRemote();
    const root = scratchDir("inteligir-git-live-");
    await ensureVaultRepo({ env, root });
    let current: VaultRemoteSpec | null = null;
    const engine = createGitEngine({ env, remote: () => current, root });
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
