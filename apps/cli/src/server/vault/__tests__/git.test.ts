import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { VaultStatusResponse } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ensureVaultRepo } from "../git-bootstrap";
import type { EnsureVaultRepoArgs } from "../git-bootstrap";
import { createGitEngine } from "../git-engine";
import type { GitEngine, GitEngineArgs } from "../git-engine";
import { GitError, runGit } from "../git-run";
import { boundAddressSchema } from "../../__tests__/bound-address";
import { hermeticGitEnv } from "./git-test-env";
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
}): Promise<{ root: string; engine: GitEngine; statusChanges: () => number }> => {
  const root = scratchDir("inteligir-git-vault-");
  await ensureVaultRepo({ env, root });
  let statusChanges = 0;
  const engineArgs: GitEngineArgs = {
    env,
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
  return { engine, root, statusChanges: () => statusChanges };
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

const expectCleanRepo = async (root: string): Promise<void> => {
  const { stdout } = await runGit(root, ["status", "--porcelain"], { env });
  expect(stdout).toBe("");
  expect(existsSync(path.join(root, ".git", "rebase-merge"))).toBe(false);
  expect(existsSync(path.join(root, ".git", "rebase-apply"))).toBe(false);
  await runGit(root, ["fsck", "--no-progress"], { env });
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
    await expectCleanRepo(root);

    const again = await ensureVaultRepo({ env, root });
    expect(again.created).toBe(false);
    expect(await commitCount(root)).toBe(1);
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

describe("auto-commit", () => {
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

    const releaseA = engine.holdCommits();
    const releaseB = engine.holdCommits();
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
    releaseA();
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
    releaseB();
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

    const release = engine.holdCommits();
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
    release();

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
});

describe("sync", () => {
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

  it("surfaces diverging edits as a typed conflict and leaves the repo clean", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    const b = await makeEngine({ remoteUrl: remote });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    await writeFile(path.join(a.root, "shared.md"), "from A\n", "utf-8");
    await a.engine.commitNow();
    await a.engine.syncNow();

    await writeFile(path.join(b.root, "shared.md"), "from B\n", "utf-8");
    await b.engine.commitNow();
    const status = await b.engine.syncNow();

    expect(status.state).toBe("conflict");
    if (status.state !== "conflict") {
      throw new Error("unreachable");
    }
    expect(status.conflict.files).toEqual(["shared.md"]);
    expect(status.conflict.ours.commits).toBeGreaterThanOrEqual(1);
    expect(status.conflict.theirs.commits).toBeGreaterThanOrEqual(1);

    await expectCleanRepo(b.root);
    expect(await readFile(path.join(b.root, "shared.md"), "utf-8")).toBe("from B\n");

    expect(await reportedState(b.engine)).toBe("conflict");
  });

  it("says a hold is holding it instead of answering as if a pass ran", async () => {
    const remote = await makeBareRemote();
    const { engine } = await makeEngine({ remoteUrl: remote });
    expect(await syncState(engine)).toBe("clean");

    const release = engine.holdCommits();
    expect(await syncState(engine)).toBe("held");
    expect(await reportedState(engine)).toBe("held");

    release();
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
});

describe("runGit", () => {
  const gitEnvValue = async (root: string, name: string): Promise<string> => {
    const { stdout } = await runGit(
      root,
      ["-c", `alias.dumpenv=!printenv ${name} || true`, "dumpenv"],
      { env },
    );
    return stdout.trim();
  };

  it("never lets git ask this process a question", async () => {
    // a git prompt blocks under the repo lock, stalling every vault write until the timeout.
    const root = scratchDir("inteligir-git-env-");
    await ensureVaultRepo({ env, root });
    expect(await gitEnvValue(root, "GIT_TERMINAL_PROMPT")).toBe("0");
    expect(await gitEnvValue(root, "GIT_SSH_COMMAND")).toBe("ssh -o BatchMode=yes");
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
        account: "user-a",
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

describe("the cross-account fence", () => {
  it("refuses a pass when the vault last synced with a different account", async () => {
    const remote = await makeBareRemote();
    const root = scratchDir("inteligir-git-fence-");
    await ensureVaultRepo({ env, root });
    let account = "user-a";
    const engine = createGitEngine({
      env,
      remote: () => ({ account, source: "account", url: remote }),
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
      remote: () => ({ account, source: "account", url: remote }),
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
      remote: { source: "account", url: `http://127.0.0.1:${String(port)}/vault.git` },
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

  // init creates .git/info because ensureLocalExclude appends there.
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
        case "init": {
          await mkdir(path.join(cwd, ".git", "info"), { recursive: true });
          return { stdout: "" };
        }
        case "rev-parse": {
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

  it("drives clone-miss → init → seed → born HEAD through the injected run", async () => {
    const root = path.join(scratchDir("inteligir-git-port-"), "vault");
    const fake = fakeGit("missing");
    let seeded = false;
    const args: EnsureVaultRepoArgs = {
      remote: { account: "user-x", source: "account", url: "https://cloud.test/v1/git/me/" },
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
    expect(fake.calls.map((call) => call.args[0])).toEqual([
      "clone",
      "init",
      "rev-parse",
      "add",
      "-c",
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
      remote: { account: "user-x", source: "account", url: "https://cloud.test/v1/git/me/" },
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
    let current: { url: string; source: "account"; account: string } | null = null;
    const engine = createGitEngine({ env, remote: () => current, root });
    onTestFinished(async () => {
      await engine.dispose();
    });

    expect(await reportedState(engine)).toBe("no-remote");

    current = { account: "user-live", source: "account", url: remote };
    await writeFile(path.join(root, "note.md"), "# signed in\n");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");

    current = null;
    expect(await reportedState(engine)).toBe("no-remote");
  });
});
