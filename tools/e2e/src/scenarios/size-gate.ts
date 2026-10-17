import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeDeviceCredential } from "inteligir/server/cloud/credential-store";
import { agentShellCli } from "../harness/agent-shell-cli";
import { expect, expectEq } from "../harness/assert";
import { loginDevice, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { gitIn } from "../harness/exec";
import { hostedVaultEnv, signInOwner, syncUntil } from "../harness/hosted-vault";
import type { AppInstance } from "../harness/instance";
import type { Scenario, ScenarioContext } from "../harness/scenario";
import { NO_AUTO_SYNC, syncExpectClean } from "../harness/vault-sync";

const MiB = 1024 * 1024;

const OVER_CAP = "assets/film.mp4";
const GROWN = "assets/scan.mov";

// incompressible, so what history would hold is what the file holds
const writeBytes = async (app: AppInstance, vaultPath: string, bytes: number): Promise<void> => {
  const absolute = path.join(app.vaultDir, vaultPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, randomBytes(bytes));
};

// what the object store holds, loose and packed, in bytes
const objectStoreBytes = async (vaultDir: string): Promise<number> => {
  const counted = await gitIn(vaultDir, ["count-objects", "-v"]);
  const field = (name: string): number =>
    Number(new RegExp(`^${name}: (?<kib>\\d+)$`, "mu").exec(counted)?.groups?.kib ?? "0");
  return (field("size") + field("size-pack")) * 1024;
};

const trackedAt = async (repo: string, rev: string): Promise<string[]> => {
  const listed = await gitIn(repo, ["ls-tree", "-r", "--name-only", rev]);
  return listed.split("\n").filter((line) => line.length > 0);
};

const tracks = async (repo: string, vaultPath: string): Promise<boolean> => {
  const tree = await trackedAt(repo, "main");
  return tree.includes(vaultPath);
};

// the files the status names over the cap, comma-joined
const tooLargeNamed = async (app: AppInstance): Promise<string> => {
  const status = await app.api.vault.status();
  return status.tooLarge.files.map((file) => file.path).join(",");
};

const storeGrewBy = async (vaultDir: string, before: number): Promise<number> => {
  const after = await objectStoreBytes(vaultDir);
  return after - before;
};

const overABareRemote = async (ctx: ScenarioContext): Promise<void> => {
  const remoteUrl = await ctx.bareRemote();
  // the url names the instances' remote; its folder is where the harness reads what it holds
  const remote = fileURLToPath(remoteUrl);
  const a = await ctx.boot({ extraEnv: NO_AUTO_SYNC, name: "a", vaultRemote: remoteUrl });

  ctx.log("a 12 MB file and a note: the note syncs, the file never enters history");
  const before = await objectStoreBytes(a.vaultDir);
  await writeBytes(a, OVER_CAP, 12 * MiB);
  await a.api.vault.write({ content: "# Small\n", guard: { kind: "absent" }, path: "small.md" });
  await syncExpectClean(a.api, "A with a file over the cap");
  const remoteTree = await trackedAt(remote, "main");
  expect(remoteTree.includes("small.md"), "the note reached the remote");
  expect(!remoteTree.includes(OVER_CAP), "the file over the cap never did");
  expect((await storeGrewBy(a.vaultDir, before)) < 2 * MiB, "A's object store never took the file");
  expectEq(await tooLargeNamed(a), OVER_CAP, "A's status names it");

  ctx.log("a synced 9 MB file grows past the cap: it leaves history, and stays on A");
  await writeBytes(a, GROWN, 9 * MiB);
  await syncExpectClean(a.api, "A with the 9 MB file");
  expect(await tracks(remote, GROWN), "the 9 MB version reached the remote");
  const b = await ctx.boot({ extraEnv: NO_AUTO_SYNC, name: "b", vaultRemote: remoteUrl });
  await syncExpectClean(b.api, "B's first sync");
  const nineOnB = await readFile(path.join(b.vaultDir, GROWN));
  expectEq(nineOnB.length, 9 * MiB, "B holds the 9 MB version");

  await writeBytes(a, GROWN, 12 * MiB);
  await syncExpectClean(a.api, "A after the file grew");
  expect(!(await tracks(remote, GROWN)), "the remote no longer tracks it");
  const subject = await gitIn(remote, ["log", "-1", "--format=%s", "main", "--", GROWN]);
  expectEq(subject, "scan.mov is over 10 MB, so it stays on this Mac", "the untracking commit");
  const kept = await stat(path.join(a.vaultDir, GROWN));
  expectEq(kept.size, 12 * MiB, "A keeps the grown file on disk");
  expectEq(await tooLargeNamed(a), `${OVER_CAP},${GROWN}`, "A's status names both, by path");

  ctx.log("on B it is a deletion, which Deleted restores as its 9 MB version");
  await syncExpectClean(b.api, "B after A's untracking");
  expect(!existsSync(path.join(b.vaultDir, GROWN)), "B took the deletion");
  const { entries } = await b.api.vault.deleted();
  const deleted = entries.find((entry) => entry.path === GROWN);
  expect(deleted !== undefined && deleted.kind === "file", "B's Deleted lists the file");
  await agentShellCli(ctx.repoRoot, b.dataDir)("vault", "restore", GROWN, deleted.sha);
  const restored = await readFile(path.join(b.vaultDir, GROWN));
  expect(restored.equals(nineOnB), "B restored the 9 MB version byte-identical");
};

const overTheHostedLibrary = async (ctx: ScenarioContext): Promise<void> => {
  const worker = await ctx.cloudWorker();
  await signUp(worker.origin);
  const a = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "hosted-a" });
  await signInOwner(a, "A", "E2E Device A");
  await syncUntil(a.api, "A's first hosted sync", "clean");

  ctx.log("four 2 MB commits under a 3 MB push cap go up in steps; a 12 MB file never does");
  await gitIn(a.vaultDir, ["config", "inteligir.pushCapBytes", String(3 * MiB)]);
  for (const index of [1, 2, 3, 4]) {
    const scan = `scans/scan-${String(index)}.pdf`;
    await writeBytes(a, scan, 2 * MiB);
    await a.api.vault.commitNow({ paths: [scan] });
  }
  await writeBytes(a, OVER_CAP, 12 * MiB);
  await syncUntil(a.api, "A's stepped push", "clean");
  expectEq(await tooLargeNamed(a), OVER_CAP, "A's status names the file over the cap");
  // two of the scans make a push over the cap, so every scan's commit was the hosted library's
  // head in turn: the tracking ref follows each landed step, and its log keeps every one
  const stepsLogged = await gitIn(a.vaultDir, [
    "log",
    "-g",
    "--format=%H",
    "refs/remotes/origin/main",
  ]);
  const tracked = new Set(stepsLogged.split("\n"));
  for (const index of [1, 2, 3, 4]) {
    const scan = `scans/scan-${String(index)}.pdf`;
    const commit = await gitIn(a.vaultDir, ["log", "-1", "--format=%H", "--", scan]);
    expect(
      tracked.has(commit),
      `the push landed scan ${String(index)}'s commit as a step of its own`,
    );
  }

  ctx.log("B's clone holds the four scans and not the file over the cap");
  const deviceB = await loginDevice(worker.origin, "E2E Device B");
  const b = await ctx.boot({
    extraEnv: hostedVaultEnv(worker.origin),
    name: "hosted-b",
    seedData: (dataDir) => {
      writeDeviceCredential(dataDir, { ...deviceB, deviceName: "E2E Device B" });
    },
  });
  for (const index of [1, 2, 3, 4]) {
    expect(
      existsSync(path.join(b.vaultDir, "scans", `scan-${String(index)}.pdf`)),
      `B's clone holds scan ${String(index)}`,
    );
  }
  expect(!existsSync(path.join(b.vaultDir, OVER_CAP)), "B's clone has no file over the cap");
};

export const sizeGate: Scenario = {
  description:
    "a file over 10 MB never enters history, over a bare remote and over the hosted library's small push cap, and the status names it",
  name: "size-gate",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    await overABareRemote(ctx);
    await overTheHostedLibrary(ctx);
  },
};
