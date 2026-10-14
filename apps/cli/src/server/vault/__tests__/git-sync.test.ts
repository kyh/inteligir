import { once } from "node:events";
import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { VaultStatusResponse } from "@repo/contract/local/vault/vault-schema";
import { CAPTURE_INBOX_PATH } from "@repo/notes/sync/reconcile-file";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { beginAgentTurnWrites } from "../../agents/agent-commits";
import { ensureVaultRepo } from "../git-bootstrap";
import { createGitEngine } from "../git-engine";
import type { GitEngine, GitEngineArgs } from "../git-engine";
import type { VaultFilesChange } from "../vault-changes";
import { createVaultRuntime } from "../vault-runtime";
import { createVaultService } from "../vault-service";
import { boundAddressSchema } from "../../__tests__/bound-address";
import { ignoreFromDisk } from "../../__tests__/ignore-from-disk";
import {
  conflictCopies,
  expectCleanRepo,
  failFlush,
  FAST_COMMIT,
  git,
  lastMessage,
  makeBareRemote,
  makeEngine,
  markingHook,
  refusingHook,
  reportedState,
  scratchDir,
  syncState,
  TEST_DEVICE,
  trackedFiles,
} from "./git-fixtures";
import { createNotifierRecorder } from "./notifier-recorder";
import { scriptedWatcher } from "./scripted-watcher";
import { makeTempDir } from "../../__tests__/temp-dir";

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

// a pass is real git; a slow runner takes far longer than waitFor's one second for a few of them
const PASS_WAIT = { timeout: 10_000 };

// counts the remote side of every push: git runs the receive-pack an origin names for a local url.
const countPushes = async (root: string): Promise<() => Promise<number>> => {
  const dir = scratchDir("inteligir-git-push-count-");
  const log = path.join(dir, "pushes.log");
  const script = path.join(dir, "receive-pack");
  await writeFile(log, "");
  await writeFile(script, `#!/bin/sh\necho push >> "${log}"\nexec git-receive-pack "$@"\n`);
  await chmod(script, 0o755);
  await git.run(root, ["config", "remote.origin.receivepack", script]);
  return async () => {
    const lines = await readFile(log, "utf-8");
    return lines.split("\n").filter(Boolean).length;
  };
};

const accountEngine = async (
  remote: string,
  options: { reach: () => boolean; quietFetchMs?: number },
): Promise<{ engine: GitEngine; root: string; passes: () => number }> => {
  const root = scratchDir("inteligir-git-quiet-");
  await ensureVaultRepo({ git, root });
  let passes = 0;
  const engineArgs: GitEngineArgs = {
    accountPingsReach: options.reach,
    deviceName: () => TEST_DEVICE,
    git,
    remote: () => {
      passes += 1;
      return { accountId: "user-quiet", source: "account", url: remote };
    },
    root,
  };
  if (options.quietFetchMs !== undefined) {
    engineArgs.quietFetchMs = options.quietFetchMs;
  }
  const engine = createGitEngine(engineArgs);
  onTestFinished(async () => {
    await engine.dispose();
  });
  return { engine, passes: () => passes, root };
};

const pushFromAnotherDevice = async (remote: string, file: string): Promise<void> => {
  const other = await makeEngine({ device: "Other Device", remoteUrl: remote });
  await writeFile(path.join(other.root, file), `# ${file}\n`);
  await other.engine.commitNow();
  expect(await syncState(other.engine)).toBe("clean");
};

const ticks = async (passes: () => number, count: number): Promise<void> => {
  const from = passes();
  await vi.waitFor(() => {
    expect(passes()).toBeGreaterThanOrEqual(from + count);
  }, PASS_WAIT);
};

describe("the account remote's quiet tick", { timeout: 30_000 }, () => {
  it("leaves the remote alone while a ping would reach this device and nothing waits to go up", async () => {
    const remote = await makeBareRemote();
    let reach = true;
    const { engine, passes, root } = await accountEngine(remote, { reach: () => reach });
    await writeFile(path.join(root, "mine.md"), "# mine\n");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");

    await pushFromAnotherDevice(remote, "theirs.md");
    engine.startAutoSync(30);
    await ticks(passes, 6);
    expect(existsSync(path.join(root, "theirs.md"))).toBe(false);

    // with the socket down no ping can come, so the next tick fetches.
    reach = false;
    await vi.waitFor(() => {
      expect(existsSync(path.join(root, "theirs.md"))).toBe(true);
    }, PASS_WAIT);
  });

  it("still sends a commit up on the next tick, and a forced pass always fetches", async () => {
    const remote = await makeBareRemote();
    const { engine, passes, root } = await accountEngine(remote, { reach: () => true });
    await writeFile(path.join(root, "first.md"), "# first\n");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");

    engine.startAutoSync(30);
    await writeFile(path.join(root, "second.md"), "# second\n");
    await engine.commitNow();
    await vi.waitFor(async () => {
      const listed = await git.run(remote, ["ls-tree", "--name-only", "main"]);
      expect(listed.stdout).toContain("second.md");
    }, PASS_WAIT);

    await pushFromAnotherDevice(remote, "theirs.md");
    await ticks(passes, 4);
    expect(existsSync(path.join(root, "theirs.md"))).toBe(false);
    // a ping, a sign-in and Sync now all arrive as syncNow.
    await engine.syncNow();
    expect(existsSync(path.join(root, "theirs.md"))).toBe(true);
  });

  it("reaches the remote again once the quiet window has passed", async () => {
    const remote = await makeBareRemote();
    const { engine, root } = await accountEngine(remote, { quietFetchMs: 200, reach: () => true });
    await writeFile(path.join(root, "mine.md"), "# mine\n");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");

    await pushFromAnotherDevice(remote, "theirs.md");
    engine.startAutoSync(30);
    await vi.waitFor(() => {
      expect(existsSync(path.join(root, "theirs.md"))).toBe(true);
    }, PASS_WAIT);
  });

  it("sends no push when the fetched tip already holds this device's head", async () => {
    const remote = await makeBareRemote();
    const { engine, root } = await accountEngine(remote, { reach: () => false });
    await writeFile(path.join(root, "mine.md"), "# mine\n");
    await engine.commitNow();
    expect(await syncState(engine)).toBe("clean");
    const pushes = await countPushes(root);

    const inSync = await engine.syncNow();
    expect(inSync.state).toBe("clean");
    expect(await pushes()).toBe(0);

    await writeFile(path.join(root, "more.md"), "# more\n");
    await engine.commitNow();
    const pushed = await engine.syncNow();
    expect(pushed.state).toBe("clean");
    expect(await pushes()).toBe(1);
  });
});
