import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createGitEngine } from "../git-engine";
import type { GitEngineArgs } from "../git-engine";
import { git, initVault, makeBareRemote, scratchDir, TEST_DEVICE } from "./git-fixtures";
import { hermeticGit } from "./git-test-env";

const KiB = 1024;

// a bare remote whose receive-pack logs each push before it runs the real one
const makeCountingRemote = async () => {
  const bare = await makeBareRemote();
  const dir = scratchDir("inteligir-git-steps-");
  const log = path.join(dir, "pushes");
  const script = path.join(dir, "receive-pack.sh");
  await writeFile(
    script,
    ["#!/bin/sh", `echo push >> '${log}'`, 'exec git receive-pack "$@"', ""].join("\n"),
    "utf-8",
  );
  await chmod(script, 0o755);
  return {
    bare,
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

const accountEngine = async (
  remote: Awaited<ReturnType<typeof makeCountingRemote>>,
  overrides: Partial<GitEngineArgs>,
) => {
  const root = scratchDir("inteligir-git-steps-vault-");
  await initVault(root);
  const engine = createGitEngine({
    deviceName: () => TEST_DEVICE,
    git: hermeticGit(remote.env),
    remote: () => ({ accountId: "user-a", source: "account", url: remote.bare }),
    root,
    ...overrides,
  });
  onTestFinished(async () => {
    await engine.dispose();
  });
  return { engine, root };
};

// incompressible, so what a pack sends is what the files hold
const writeScans = async (root: string, count: number, bytes: number): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await writeFile(path.join(root, `scan-${String(index)}.pdf`), randomBytes(bytes));
  }
};

const headOf = async (dir: string, rev: string): Promise<string> => {
  const { stdout } = await git.run(dir, ["rev-parse", rev]);
  return stdout.trim();
};

describe("the account push in steps", { timeout: 60_000 }, () => {
  it("sends a history past the cap as several pushes, each under it, and lands HEAD", async () => {
    const remote = await makeCountingRemote();
    const { engine, root } = await accountEngine(remote, {
      maxPushBytes: 160 * KiB,
      staging: { budgetBytes: 60 * KiB },
    });
    await writeScans(root, 6, 50 * KiB);
    // six files of 50 KiB, one per commit under a 60 KiB budget, and at most three per push
    expect(await engine.commitNow()).toEqual({ files: 6 });

    const status = await engine.syncNow();
    expect(status.lastError).toBeNull();
    expect(status.state).toBe("clean");
    expect(await headOf(remote.bare, "main")).toBe(await headOf(root, "HEAD"));
    expect(await remote.pushes()).toBeGreaterThanOrEqual(2);
  });

  it("takes a lower cap from the vault's own git config", async () => {
    const remote = await makeCountingRemote();
    const { engine, root } = await accountEngine(remote, {
      staging: { budgetBytes: 60 * KiB },
    });
    await git.run(root, ["config", "inteligir.pushCapBytes", String(160 * KiB)]);
    await writeScans(root, 4, 50 * KiB);
    await engine.commitNow();

    const synced = await engine.syncNow();
    expect(synced.state).toBe("clean");
    expect(await headOf(remote.bare, "main")).toBe(await headOf(root, "HEAD"));
    expect(await remote.pushes()).toBeGreaterThanOrEqual(2);
  });

  it("refuses only a single commit over the cap, sending what came before it, and says too-large", async () => {
    const remote = await makeCountingRemote();
    const { engine, root } = await accountEngine(remote, { maxPushBytes: 160 * KiB });
    // one commit of 200 KiB: the budget is the real one, so it lands whole
    await writeScans(root, 4, 50 * KiB);
    await engine.commitNow();

    const refused = await engine.syncNow();
    expect(refused.state).toBe("too-large");
    // the vault's first commit fit, and went; the one over the cap never left
    expect(await remote.pushes()).toBe(1);
    expect(await headOf(remote.bare, "main")).toBe(await headOf(root, "HEAD~1"));
    // and the next pass sends nothing more while the history stands
    const again = await engine.syncNow();
    expect(again.state).toBe("too-large");
    expect(await remote.pushes()).toBe(1);
  });
});
