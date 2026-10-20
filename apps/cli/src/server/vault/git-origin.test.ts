import { writeFile } from "node:fs/promises";
import path from "node:path";
import { TEST_BUILD } from "@repo/contract/cloud/test-support/fake-cloud-client";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { writeDeviceCredential } from "../cloud/credential-store";
import { createVaultRemoteProvider, hostedVaultRemoteUrl, NO_ORIGIN } from "../cloud/vault-remote";
import type { VaultRemoteSpec } from "../cloud/vault-remote";
import { REMOTE_MARKER_KEY } from "./folder-facts";
import { ACCOUNT_MARKER_KEY, ensureVaultRepo } from "./git-bootstrap";
import { createGitEngine } from "./git-engine";
import type { GitEngine, GitEngineArgs } from "./git-engine";
import {
  git,
  initVault,
  makeBareRemote,
  makeEngine,
  reportedState,
  scratchDir,
  syncState,
  TEST_DEVICE,
  tipOf,
} from "./test-support/git-fixtures";

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

    current = { accountId: "user-live", source: "account", url: remote };
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
      deviceName: TEST_DEVICE,
      email: "owner@example.test",
      userId: "user-a",
    });
  }
  return createVaultRemoteProvider({
    build: TEST_BUILD,
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

describe("a clone after sign-in", () => {
  it("pins the account it came from at once, before any pass", async () => {
    const remote = await makeBareRemote();
    const a = await makeEngine({ remoteUrl: remote });
    await writeFile(path.join(a.root, "note.md"), "# from A\n");
    await a.engine.commitNow();
    expect(await syncState(a.engine)).toBe("clean");

    const signedIn = composedProvider(true)(NO_ORIGIN);
    if (signedIn?.source !== "account") {
      throw new Error("a signed-in provider answers the account's remote");
    }
    const root = path.join(scratchDir("inteligir-git-clone-account-"), "vault");
    const { cloned } = await ensureVaultRepo({ git, remote: { ...signedIn, url: remote }, root });
    expect(cloned).toBe(true);
    const marker = await git.run(root, ["config", "--get", ACCOUNT_MARKER_KEY]);
    expect(marker.stdout.trim()).toBe("user-a");
  });
});

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
      tooLarge: { count: 0, files: [] },
      state: "no-remote",
    });
  });

  it("an account pass that meets an origin of the user's own leaves it and pushes nothing", async () => {
    const own = await makeBareRemote();
    const hosted = await makeBareRemote();
    const root = await repoWithOrigin(`file://${own}`);
    // a provider that hands out the account remote past the origin, as none the server composes does
    const engine = engineOn(root, () => ({
      accountId: "user-a",
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
      accountId: "user-a",
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
        build: TEST_BUILD,
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
