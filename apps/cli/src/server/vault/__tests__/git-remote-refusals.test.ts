import { once } from "node:events";
import { existsSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { VAULT_GIT_MAX_PUSH_BYTES } from "@repo/contract/cloud/vault/vault-git";
import { describe, expect, it, onTestFinished } from "vitest";
import { createGitEngine } from "../git-engine";
import { boundAddressSchema } from "../../__tests__/bound-address";
import {
  conflictCopies,
  git,
  initVault,
  makeBareRemote,
  makeEngine,
  reportedState,
  scratchDir,
  syncState,
  TEST_DEVICE,
  trackedFiles,
} from "./git-fixtures";
import { hermeticGit } from "./git-test-env";

describe("the cross-account fence", { timeout: 30_000 }, () => {
  it("refuses a pass when the vault last synced with a different account", async () => {
    const remote = await makeBareRemote();
    const root = scratchDir("inteligir-git-fence-");
    await initVault(root);
    let account = "user-a";
    const engine = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git,
      remote: () => ({ accountId: account, source: "account", url: remote }),
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
      remote: () => ({ accountId: account, source: "account", url: remote }),
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

describe("a build below the cloud's floor", () => {
  it("surfaces as `outdated` on the hosted vault, and as `rejected` on a remote of the user's own", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(426, { "content-type": "text/plain" });
      response.end("this version of inteligir is older than the hosted vault accepts; update it\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    onTestFinished(async () => {
      server.close();
      await once(server, "close");
    });
    const { port } = boundAddressSchema.parse(server.address());
    const url = `http://127.0.0.1:${String(port)}/vault.git`;

    const root = scratchDir("inteligir-git-outdated-");
    await initVault(root);
    const hosted = createGitEngine({
      deviceName: () => TEST_DEVICE,
      git,
      remote: () => ({ accountId: "user-a", source: "account", url }),
      root,
    });
    onTestFinished(async () => {
      await hosted.dispose();
    });
    const hostedStatus = await hosted.syncNow();
    expect(hostedStatus.state).toBe("outdated");
    const asked = requests;
    const again = await hosted.syncNow();
    expect(again.state).toBe("outdated");
    expect(requests).toBe(asked);

    const { engine: own } = await makeEngine({ remoteUrl: url });
    const ownStatus = await own.syncNow();
    expect(ownStatus.state).toBe("rejected");
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
        accountId: "user-a",
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
        accountId: "user-a",
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
    // a pass whose fetched tip already holds its head pushes nothing, so give it a change of its own
    await writeFile(path.join(root, "first.md"), "this device's own\n", "utf-8");
    await engine.commitNow();

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
        accountId: "user-a",
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
    expect(refused.lastError).toBe("Your online library is full. New saves stay on this Mac.");
  });
});
