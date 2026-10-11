// packs a real tarball so `files` is under test too. outside verify: builds, installs, binds a port.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { accessSync, constants, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { HEALTH_PATH } from "@repo/contract/local/routes";
import { z } from "zod";
import {
  exitOf,
  fail,
  log,
  proveWatcherAlive,
  readServerToken,
  rpcClient,
  run,
  waitForUrl,
} from "./smoke-lib.ts";

const CLI_BIN_NAME = "inteligir";

const packageRoot = nodePath.resolve(import.meta.dirname, "..");
const repoRoot = nodePath.resolve(packageRoot, "..", "..");
const BOOT_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 20_000;

const vaultTreeSchema = z.object({ entries: z.array(z.unknown()) });
const statusSchema = z.object({ dataDir: z.string() });

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const scratch = await mkdtemp(nodePath.join(tmpdir(), "inteligir-smoke-"));
const installDir = nodePath.join(scratch, "install");
const dataDir = nodePath.join(scratch, "data");
const vaultDir = nodePath.join(scratch, "vault");
const port = 4500 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;
let server: ChildProcess | null = null;

try {
  // pnpm pack, not npm: only pnpm rewrites catalog: ranges on the way out
  log(`packing ${packageRoot}`);
  const { stdout: packOutput } = await run("pnpm", ["pack", "--pack-destination", scratch], {
    cwd: packageRoot,
  });
  const tarball = packOutput.trim().split("\n").at(-1);
  if (tarball === undefined || !existsSync(tarball)) {
    fail(`pnpm pack did not name a tarball (got ${JSON.stringify(packOutput)})`);
  }
  log(`installing ${tarball}`);
  await run("npm", ["install", "--prefix", installDir, "--no-audit", "--no-fund", tarball], {
    env: { ...process.env, npm_config_cache: nodePath.join(scratch, "npm-cache") },
  });

  const bin = nodePath.join(installDir, "node_modules", ".bin", CLI_BIN_NAME);
  if (!existsSync(bin)) {
    fail(`the installed package exposes no bin at ${bin}`);
  }
  // npm strips the execute bit from every packed file not named in `bin`
  const installRoot = nodePath.join(installDir, "node_modules", CLI_BIN_NAME);
  const cliBin = nodePath.join(installRoot, "bin", CLI_BIN_NAME);
  try {
    accessSync(cliBin, constants.X_OK);
  } catch {
    fail(`the packaged CLI is not executable (${cliBin}) — it must stay in package.json's bin map`);
  }
  // each of these silently disables a capability when missing
  for (const [what, path] of [
    [
      "the dialect skills",
      nodePath.join(installRoot, "dist", "skills", "inteligir-notes", "SKILL.md"),
    ],
    ["the workspace UI", nodePath.join(installRoot, "dist", "ui", "index.html")],
    ["the starter vault", nodePath.join(installRoot, "seed", "Welcome.md")],
  ] as const) {
    if (!existsSync(path)) {
      fail(`the packaged install carries no ${what} (${path})`);
    }
  }

  // derived from what the build emitted: the split bundle's chunk names are content hashes, so
  // no fixed list could name them, and a `files` rule that dropped one would fail only the verb
  // that loads it.
  for (const name of await readdir(nodePath.join(packageRoot, "dist"))) {
    if (!/\.m?js$/u.test(name)) {
      continue;
    }
    const staged = nodePath.join(installRoot, "dist", name);
    if (!existsSync(staged)) {
      fail(`the packaged install carries no dist/${name} (${staged})`);
    }
  }

  // nothing reads the licence texts, so only this can notice them missing
  for (const name of await readdir(nodePath.join(repoRoot, "tools", "licenses"))) {
    const staged = nodePath.join(installRoot, "dist", "licenses", name);
    if (!existsSync(staged)) {
      fail(`the packaged install carries no ${name} (${staged})`);
    }
  }

  const { stdout: cliVersion } = await run(bin, ["--version"]);
  log(`packaged CLI --version -> ${cliVersion.trim()}`);

  log(`booting on ${baseUrl}`);
  const child = spawn(
    bin,
    ["serve", "--port", String(port), "--data-dir", dataDir, "--vault", vaultDir],
    {
      detached: true,
      env: { ...process.env, INTELIGIR_AGENT: "off", INTELIGIR_SYNC_INTERVAL_MS: "0" },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  server = child;

  const health = await waitForUrl(`${baseUrl}${HEALTH_PATH}`, BOOT_TIMEOUT_MS);
  if (health === null) {
    fail(`no health answer on ${baseUrl} within ${BOOT_TIMEOUT_MS}ms`);
  }
  log(`health -> ${await health.text()}`);

  // read once the server listens, which is when it publishes the file
  const token = readServerToken(dataDir);
  const rpc = rpcClient(baseUrl, token);

  // with the bearer: a request carrying no credential gets the signed-out page instead
  const shell = await fetch(baseUrl, {
    headers: { accept: "text/html", authorization: `Bearer ${token}` },
  });
  const html = await shell.text();
  if (!shell.ok || !html.includes("<title>inteligir</title>")) {
    fail(`the SPA shell did not answer (${shell.status}, ${html.length} bytes)`);
  }
  log(`SPA shell -> ${shell.status} ${html.length} bytes`);

  const vaultList = await rpc("vault/tree", vaultTreeSchema);
  log(`vault tree -> ${vaultList.entries.length} entries`);
  await proveWatcherAlive(rpc, vaultDir);

  // exercises the bundled client half the hand-rolled fetch above bypasses
  const { stdout: statusJson } = await run(bin, ["status", "--json"], {
    env: { ...process.env, INTELIGIR_DATA_DIR: dataDir },
  });
  const status = statusSchema.parse(JSON.parse(statusJson));
  if (status.dataDir !== dataDir) {
    fail(`packed \`status --json\` reported dataDir ${status.dataDir}, expected ${dataDir}`);
  }
  log(`packaged CLI status --json -> dataDir ${status.dataDir}`);

  const { pid } = child;
  if (pid === undefined) {
    fail("the server process has no pid — it never spawned");
  }
  // the leader only: kill(-pid) would take the forked watcher too and make the
  // orphan check below a tautology
  log(`SIGTERM ${pid} (the server alone)`);
  process.kill(pid, "SIGTERM");
  const exit = await Promise.race([exitOf(child), delay(EXIT_TIMEOUT_MS, null)]);
  if (exit === null) {
    fail(`the server did not exit within ${EXIT_TIMEOUT_MS}ms of SIGTERM`);
  }
  if (exit.code !== 0) {
    fail(`the server exited ${exit.code ?? exit.signal} — a graceful stop must exit 0`);
  }
  log("exited 0");

  // POSIX: signal 0 against -pid asks whether the group still has members
  await delay(500);
  if (processAlive(-pid)) {
    fail(`process group ${pid} still has members — the watcher child was orphaned`);
  }
  log("no orphan processes");

  const dataEntries = await readdir(dataDir);
  log(`data dir -> ${dataEntries.toSorted().join(", ")}`);
  server = null;
  log("PASS");
} finally {
  if (server?.pid !== undefined) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // the group is already gone — nothing left to kill
    }
  }
  await rm(scratch, { force: true, recursive: true });
}
