// boots the packaged app itself, window and all: its runAsNode fuse is off, so the binary runs no
// JavaScript as plain Node and the one way in is main, which forks the server and, through the fork
// broker, the server's watcher and ACP adapters. needs a macOS arm64 host with a display: CI's
// test-macos job runs it unsigned.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
// the workspace link, not the packaged copy: `files` does not ship scripts
import { proveWatcherAlive } from "inteligir/scripts/smoke-lib.mjs";

const CLI_BIN_NAME = "inteligir";
const TEST_DIR_NAME = "__tests__";

const packageRoot = path.resolve(import.meta.dirname, "..");
const appDir = path.join(packageRoot, ".output", "bin", "mac-arm64", "Inteligir.app");
const appBinary = path.join(appDir, "Contents", "MacOS", "Inteligir");
// the same walk src/main/server-instance.ts does at runtime
const unpacked = path.join(appDir, "Contents", "Resources", "app.asar.unpacked");
const runtimeRoot = path.join(unpacked, "node_modules", CLI_BIN_NAME);
const serverEntry = path.join(runtimeRoot, "dist", "index.js");
const BOOT_TIMEOUT_MS = 90_000;
const EXIT_TIMEOUT_MS = 40_000;
const AGENT_TIMEOUT_MS = 60_000;
// the prod layout the packaged server derives under a home (apps/cli/src/server/config.ts)
const PROD_DATA_DIR_NAME = ".inteligir";
const PROD_VAULT_DIR_NAME = "Inteligir";
const VAULTS_DIR_NAME = "vaults";
const CONFIG_FILE_NAME = "config.json";
// what the runtime reports when the vendor refuses for want of a sign-in
// (packages/agent-runtime/src/acp/provider-error.ts)
const CODEX_SIGNED_OUT = "Codex is not signed in";
// main's line once the child it started has stopped (src/main/server-process.ts)
const SERVER_STOPPED_CLEANLY = "server exited (code 0)";
// main's lines once the window's page has loaded, or has not (src/main/index.ts)
const WINDOW_LOADED = "[desktop] window loaded";
const WINDOW_FAILED = "[desktop] window failed to load";
// each would steer the agent turn off the bundled adapter and its codex: the host's own codex, its
// credentials, or an agent mode that is not ACP
const HOST_AGENT_ENV = new Set([
  "CODEX_PATH",
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
  "INTELIGIR_AGENT",
]);

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

if (!existsSync(appBinary)) {
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

// electron-builder copies the CLI's whole directory unless electron-builder.yml narrows it, so the
// allowed names come from the manifest's own `files`, the set npm would publish
const cliManifest = JSON.parse(readFileSync(path.join(runtimeRoot, "package.json"), "utf-8"));
const shippedNames = new Set([
  "package.json",
  ...cliManifest.files
    .filter((entry) => !entry.startsWith("!"))
    .map((entry) => entry.split("/")[0]),
]);
const strays = readdirSync(runtimeRoot).filter((name) => !shippedNames.has(name));
if (strays.length > 0) {
  fail(`the packaged CLI carries what its \`files\` does not ship: ${strays.join(", ")}`);
}
const testDirs = readdirSync(runtimeRoot, { recursive: true }).filter(
  (entry) => path.basename(entry) === TEST_DIR_NAME,
);
if (testDirs.length > 0) {
  fail(`the packaged CLI carries test files: ${testDirs.join(", ")}`);
}
log(`packaged CLI -> ${readdirSync(runtimeRoot).join(", ")}`);

const scratch = await mkdtemp(path.join(tmpdir(), "inteligir-desktop-smoke-"));
const port = 4900 + Math.floor(Math.random() * 90);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = path.join(scratch, "data");
const vaultDir = path.join(scratch, "vault");
// its own profile and single-instance lock, so an installed Inteligir neither blocks nor sees it
const userDataDir = path.join(scratch, "electron");
// a send is refused until a vendor CLI is on PATH; the adapter never runs this one
const stubBinDir = path.join(scratch, "bin");
// no sign-in lives here, so the turn stops at the vendor's refusal
const codexHome = path.join(scratch, "codex-home");

await mkdir(stubBinDir, { recursive: true });
await mkdir(codexHome, { recursive: true });
await writeFile(path.join(stubBinDir, "codex"), "#!/bin/sh\nexit 0\n");
await chmod(path.join(stubBinDir, "codex"), 0o755);

// an undefined value unsets the variable
const appEnv = (env) =>
  Object.fromEntries(
    Object.entries({
      ...process.env,
      CODEX_HOME: codexHome,
      INTELIGIR_SYNC_INTERVAL_MS: "0",
      PATH: `${stubBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
      ...env,
    }).filter(([name, value]) => value !== undefined && !HOST_AGENT_ENV.has(name)),
  );

// the mock keychain: an unsigned build must not stop on a prompt for the installed app's cookie key
const launchApp = (env) => {
  const app = spawn(appBinary, [`--user-data-dir=${userDataDir}`, "--use-mock-keychain"], {
    detached: true,
    env: appEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const record = (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  };
  app.stdout.on("data", record);
  app.stderr.on("data", record);
  return { app, output: () => output };
};

const waitHealthy = async (url) => {
  const health = await waitForUrl(`${url}/health`, BOOT_TIMEOUT_MS);
  if (health === null) {
    fail(`no health answer within ${BOOT_TIMEOUT_MS}ms — see the output above`);
  }
  log(`health -> ${await health.text()}`);
};

// a healthy server is not a loaded window: the fuses change what the page itself may load
const waitWindowLoaded = async (launched) => {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  for (;;) {
    const output = launched.output();
    if (output.includes(WINDOW_FAILED)) {
      fail("the window did not load its page — see the output above");
    }
    if (output.includes(WINDOW_LOADED)) {
      log("window loaded");
      return;
    }
    if (Date.now() > deadline) {
      fail(`the window had not loaded within ${BOOT_TIMEOUT_MS}ms`);
    }
    await delay(250);
  }
};

// hand-rolled: the typed client needs a bundler this script does not have
const rpcClient = (url, forDataDir) => {
  const row = JSON.parse(readFileSync(path.join(forDataDir, "server.json"), "utf-8"));
  return async (procedure, input) => {
    const response = await fetch(`${url}/rpc/${procedure}`, {
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

const exitOf = async (child) => {
  const [code, signal] = await once(child, "close");
  return { code, signal };
};

// main alone: its quit stops the server first, which is the ordered shutdown under test
const stopApp = async (launched) => {
  const { pid } = launched.app;
  if (pid === undefined) {
    fail("the packaged app has no pid — it never spawned");
  }
  log(`SIGTERM ${pid} (the app's main process)`);
  process.kill(pid, "SIGTERM");
  const exit = await Promise.race([exitOf(launched.app), delay(EXIT_TIMEOUT_MS, null)]);
  if (exit === null) {
    fail(`the packaged app did not exit within ${EXIT_TIMEOUT_MS}ms of SIGTERM`);
  }
  if (!launched.output().includes(SERVER_STOPPED_CLEANLY)) {
    fail("the app quit without its server stopping cleanly — a graceful stop must exit 0");
  }
  if (exit.code !== 0) {
    fail(`the packaged app exited ${exit.code ?? exit.signal} — a quit must exit 0`);
  }
  log("the server stopped cleanly and the app exited 0");
};

const killGroup = (launched) => {
  if (launched?.app.pid !== undefined) {
    try {
      process.kill(-launched.app.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
};

// main forks the codex adapter through the broker, the adapter starts its bundled native codex, and
// the ACP handshake runs; with no sign-in the vendor then refuses the session. only a live adapter
// can say that: one main could not start, or a codex it could not run, fails the turn differently.
const proveAgentTurn = async (rpc) => {
  await rpc("agents/setDefault", { id: "codex" });
  const { thread } = await rpc("threads/create", {});
  await rpc("threads/send", { text: "smoke", threadId: thread.id });
  const deadline = Date.now() + AGENT_TIMEOUT_MS;
  for (;;) {
    const answer = await rpc("threads/timeline", { threadId: thread.id });
    const rows = answer.kind === "full" ? answer.timeline.rows : [];
    const turn = rows.find((row) => row.kind === "turn");
    if (turn !== undefined && turn.status !== "pending") {
      const said = JSON.stringify(rows);
      if (!said.includes(CODEX_SIGNED_OUT)) {
        fail(`the agent turn ended ${turn.status} without reaching codex: ${said}`);
      }
      log(`agent turn -> ${turn.status}: the adapter reached codex, which asked for a sign-in`);
      return;
    }
    if (Date.now() > deadline) {
      fail(`the agent turn had not settled after ${AGENT_TIMEOUT_MS}ms`);
    }
    await delay(500);
  }
};

let launched = null;

try {
  log(`launching the packaged app on ${baseUrl}`);
  launched = launchApp({
    INTELIGIR_DATA_DIR: dataDir,
    INTELIGIR_PORT: String(port),
    INTELIGIR_VAULT_DIR: vaultDir,
  });
  await waitHealthy(baseUrl);
  await waitWindowLoaded(launched);
  const rpc = rpcClient(baseUrl, dataDir);

  // with the bearer: a request carrying no credential gets the signed-out page instead
  const { token } = JSON.parse(readFileSync(path.join(dataDir, "server.json"), "utf-8"));
  const shell = await fetch(baseUrl, {
    headers: { accept: "text/html", authorization: `Bearer ${token}` },
  });
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

  await proveAgentTurn(rpc);

  const status = await run(cliBin, ["status", "--json"], {
    env: { ...process.env, INTELIGIR_DATA_DIR: dataDir },
  });
  if (!status.includes(baseUrl)) {
    fail(`the packaged CLI did not reach the packaged server: ${status}`);
  }
  log("packaged CLI drove the packaged server");

  await stopApp(launched);
  launched = null;

  // the shell's vault switch is a rewrite of the root config.json's vaultDir and a restart of
  // its child; the switch itself is a click in the window, so this proves what the app boots
  // under a scratch home: the default vault keeps the root data dir, the selector boots the
  // server on a data dir of that vault's own, and each quit stops it cleanly.
  const home = path.join(scratch, "home");
  const rootDataDir = path.join(home, PROD_DATA_DIR_NAME);
  const secondVault = path.join(scratch, "second-vault");
  await mkdir(home, { recursive: true });
  const selectorPort = port + 1;
  const selectorUrl = `http://127.0.0.1:${selectorPort}`;
  const selectorEnv = {
    HOME: home,
    INTELIGIR_DATA_DIR: undefined,
    INTELIGIR_PORT: String(selectorPort),
    INTELIGIR_VAULT_DIR: undefined,
  };

  log(`launching under a scratch home on ${selectorUrl}: the default vault`);
  launched = launchApp(selectorEnv);
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
  await stopApp(launched);
  launched = null;

  await writeFile(
    path.join(rootDataDir, CONFIG_FILE_NAME),
    `${JSON.stringify({ vaultDir: secondVault }, null, 2)}\n`,
  );
  log(`launching on the selector's vault ${secondVault}`);
  launched = launchApp(selectorEnv);
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
  await stopApp(launched);
  launched = null;

  log("PASS (the window loaded its page; its rendering is not checked)");
} finally {
  killGroup(launched);
  await rm(scratch, { force: true, recursive: true });
}
