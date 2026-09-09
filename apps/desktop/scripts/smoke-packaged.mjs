// boots the packaged server through the app's own Electron binary; cannot open a window
// (BrowserWindow needs a display). outside CI: it needs a macOS runner.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
// the workspace link, not the packaged copy: `files` does not ship scripts
import { proveWatcherAlive } from "inteligir/scripts/smoke-lib.mjs";

const CLI_BIN_NAME = "inteligir";

const packageRoot = path.resolve(import.meta.dirname, "..");
const appDir = path.join(packageRoot, ".output", "bin", "mac-arm64", "Inteligir.app");
const electronBinary = path.join(appDir, "Contents", "MacOS", "Inteligir");
// the same walk src/main/server-instance.ts does at runtime
const unpacked = path.join(appDir, "Contents", "Resources", "app.asar.unpacked");
const runtimeRoot = path.join(unpacked, "node_modules", CLI_BIN_NAME);
const serverEntry = path.join(runtimeRoot, "dist", "index.js");
const BOOT_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 20_000;
// the prod layout the packaged server derives under a home (apps/cli/src/server/config.ts)
const PROD_DATA_DIR_NAME = ".inteligir";
const PROD_VAULT_DIR_NAME = "Inteligir";
const VAULTS_DIR_NAME = "vaults";
const CONFIG_FILE_NAME = "config.json";

/**
 * @param {string} message what went wrong, for stderr and the thrown error
 * @returns {never} the exit code is already set; the throw unwinds to the cleanup
 */
const fail = (message) => {
  process.stderr.write(`smoke: ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
};

const log = (line) => {
  process.stdout.write(`smoke: ${line}\n`);
};

const waitForUrl = async (url, deadlineMs) => {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        return response;
      }
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      return null;
    }
    await delay(250);
  }
};

const run = async (file, argv, options = {}) => {
  const child = spawn(file, argv, { stdio: ["ignore", "pipe", "pipe"], ...options });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  // `once` rejects on "error", as the close listener never fires for a spawn that failed
  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(`${file} ${argv.join(" ")} exited ${code}\n${stdout}\n${stderr}`);
  }
  return stdout;
};

// the server alone: no window, no shell, so nothing here reaches the bridge
const spawnServer = (env) =>
  spawn(electronBinary, [serverEntry, "serve"], {
    detached: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      INTELIGIR_AGENT: "off",
      INTELIGIR_SYNC_INTERVAL_MS: "0",
      NODE_ENV: "production",
      ...env,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

const waitHealthy = async (baseUrl) => {
  const health = await waitForUrl(`${baseUrl}/health`, BOOT_TIMEOUT_MS);
  if (health === null) {
    fail(`no health answer within ${BOOT_TIMEOUT_MS}ms — see the output above`);
  }
  log(`health -> ${await health.text()}`);
};

// hand-rolled: the typed client needs a bundler this script does not have
const rpcClient = (baseUrl, dataDir) => {
  const row = JSON.parse(readFileSync(path.join(dataDir, "server.json"), "utf-8"));
  return async (procedure, input) => {
    const response = await fetch(`${baseUrl}/rpc/${procedure}`, {
      body: input === undefined ? "{}" : JSON.stringify({ json: input }),
      headers: { authorization: `Bearer ${row.token}`, "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      fail(`${procedure} answered ${response.status}`);
    }
    const body = await response.json();
    return body.json;
  };
};

const exitOf = async (server) => {
  const [code, signal] = await once(server, "close");
  return { code, signal };
};

// the leader only: kill(-pid) would take the forked watcher too and make the check a tautology
const stopServer = async (server) => {
  const { pid } = server;
  if (pid === undefined) {
    fail("the packaged server has no pid — it never spawned");
  }
  log(`SIGTERM ${pid} (the server alone)`);
  process.kill(pid, "SIGTERM");
  const exit = await Promise.race([exitOf(server), delay(EXIT_TIMEOUT_MS, null)]);
  if (exit === null) {
    fail(`the packaged server did not exit within ${EXIT_TIMEOUT_MS}ms of SIGTERM`);
  }
  if (exit.code !== 0) {
    fail(`the packaged server exited ${exit.code ?? exit.signal} — a graceful stop must exit 0`);
  }
  log("exited 0");
};

const killGroup = (server) => {
  if (server?.pid !== undefined) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
};

if (!existsSync(electronBinary)) {
  fail(`no packaged app at ${appDir} — run \`pnpm package:desktop\` first`);
}
if (!existsSync(serverEntry)) {
  fail(`the packaged app carries no server entry at ${serverEntry}`);
}
const notesSkill = path.join(runtimeRoot, "dist", "skills", "inteligir-notes", "SKILL.md");
if (!existsSync(notesSkill)) {
  fail(`the packaged app carries no dialect skills at ${notesSkill}`);
}

// the agent's PATH resolver refuses a bin without the execute bit, silently
const cliBin = path.join(runtimeRoot, "bin", CLI_BIN_NAME);
if (!existsSync(cliBin)) {
  fail(`the packaged CLI is missing at ${cliBin}`);
}
try {
  accessSync(cliBin, constants.X_OK);
} catch {
  fail(`the packaged CLI is not executable (${cliBin})`);
}

const scratch = await mkdtemp(path.join(tmpdir(), "inteligir-desktop-smoke-"));
const port = 4900 + Math.floor(Math.random() * 90);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = path.join(scratch, "data");
const vaultDir = path.join(scratch, "vault");

let server = null;

try {
  log(`booting the packaged server on ${baseUrl}`);
  server = spawnServer({
    INTELIGIR_DATA_DIR: dataDir,
    INTELIGIR_PORT: String(port),
    INTELIGIR_VAULT_DIR: vaultDir,
  });
  await waitHealthy(baseUrl);
  const rpc = rpcClient(baseUrl, dataDir);

  const shell = await fetch(baseUrl, { headers: { accept: "text/html" } });
  const html = await shell.text();
  if (!shell.ok || !html.includes("<title>inteligir</title>")) {
    fail(`the SPA shell did not answer (${shell.status}, ${html.length} bytes)`);
  }
  log(`SPA shell -> ${shell.status} ${html.length} bytes`);

  // exercises better-sqlite3, @parcel/watcher and git init, the first to fail on an ABI mismatch
  const tree = await rpc("vault/tree");
  log(`vault tree -> ${tree.entries.length} entries under ${tree.root}`);
  await proveWatcherAlive({ fail, log, rpc, vaultDir });

  // proves a worker thread can dlopen the addon from app.asar.unpacked. `ready` is
  // allowed (shared model dir); `unavailable` is refused (this .app ships the prebuild)
  const voiceStatus = await rpc("voice/status");
  if (!["no-model", "ready"].includes(voiceStatus.state)) {
    fail(
      `packaged voice status is ${JSON.stringify(voiceStatus)}; expected no-model or ready — ` +
        `the transcription worker could not dlopen its binding from app.asar.unpacked`,
    );
  }
  log(`voice -> ${voiceStatus.state}`);

  const status = await run(cliBin, ["status", "--json"], {
    env: { ...process.env, INTELIGIR_DATA_DIR: dataDir },
  });
  if (!status.includes(baseUrl)) {
    fail(`the packaged CLI did not reach the packaged server: ${status}`);
  }
  log("packaged CLI drove the packaged server");

  await stopServer(server);
  server = null;

  // the shell's vault switch is a rewrite of the root config.json's vaultDir and a restart of
  // its child; the window and the bridge need a display, so this proves the server half under
  // a scratch home: the default vault keeps the root data dir, the selector boots the packaged
  // server on a data dir of that vault's own, and each stop exits 0.
  const home = path.join(scratch, "home");
  const rootDataDir = path.join(home, PROD_DATA_DIR_NAME);
  const secondVault = path.join(scratch, "second-vault");
  await mkdir(home, { recursive: true });
  const selectorPort = port + 1;
  const selectorUrl = `http://127.0.0.1:${selectorPort}`;
  const selectorEnv = { ...process.env, HOME: home, INTELIGIR_PORT: String(selectorPort) };
  delete selectorEnv.INTELIGIR_DATA_DIR;
  delete selectorEnv.INTELIGIR_VAULT_DIR;

  log(`booting under a scratch home on ${selectorUrl}: the default vault`);
  server = spawnServer(selectorEnv);
  await waitHealthy(selectorUrl);
  const defaultStatus = await rpcClient(selectorUrl, rootDataDir)("system/status");
  if (
    defaultStatus.dataDir !== rootDataDir ||
    defaultStatus.vaultDir !== path.join(home, PROD_VAULT_DIR_NAME)
  ) {
    fail(
      `the default vault did not keep the root data dir: ${JSON.stringify({ dataDir: defaultStatus.dataDir, vaultDir: defaultStatus.vaultDir })}`,
    );
  }
  log(`default vault -> ${defaultStatus.vaultDir} on ${defaultStatus.dataDir}`);
  await stopServer(server);
  server = null;

  await writeFile(
    path.join(rootDataDir, CONFIG_FILE_NAME),
    `${JSON.stringify({ vaultDir: secondVault }, null, 2)}\n`,
  );
  log(`booting the selector's vault ${secondVault}`);
  server = spawnServer(selectorEnv);
  await waitHealthy(selectorUrl);
  const vaultDirs = readdirSync(path.join(rootDataDir, VAULTS_DIR_NAME));
  if (vaultDirs.length !== 1) {
    fail(
      `expected one per-vault data dir under ${VAULTS_DIR_NAME}/, found ${vaultDirs.join(", ")}`,
    );
  }
  const secondDataDir = path.join(rootDataDir, VAULTS_DIR_NAME, vaultDirs[0]);
  const secondStatus = await rpcClient(selectorUrl, secondDataDir)("system/status");
  if (secondStatus.dataDir !== secondDataDir || secondStatus.vaultDir !== secondVault) {
    fail(
      `the selector's vault did not get its own data dir: ${JSON.stringify({ dataDir: secondStatus.dataDir, vaultDir: secondStatus.vaultDir })}`,
    );
  }
  if (
    !existsSync(path.join(rootDataDir, "inteligir.db")) ||
    !existsSync(path.join(secondDataDir, "inteligir.db"))
  ) {
    fail("the two vaults do not each hold a database of their own");
  }
  log(`selector vault -> ${secondStatus.vaultDir} on ${secondStatus.dataDir}`);
  await stopServer(server);
  server = null;

  log("PASS (the window and the bridge are not covered — they need a display)");
} finally {
  killGroup(server);
  await rm(scratch, { force: true, recursive: true });
}
