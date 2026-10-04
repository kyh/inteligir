// boots the packaged app itself, window and all: the shell, the node it ships beside it and the CLI
// it carries as a resource, which the shell starts as its server, and the server its watcher and
// ACP adapters on that same node. needs a macOS arm64 host with a display: CI's test-macos job runs
// it on an ad-hoc pack.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
// the workspace's links, not the packaged copies: `files` does not ship scripts, and the route
// constants are the contract's own source, which node strips of its types
import { HEALTH_PATH, RPC_PREFIX } from "@repo/contract/local/routes";
import { proveWatcherAlive } from "inteligir/scripts/smoke-lib.mjs";

const CLI_BIN_NAME = "inteligir";
const TEST_DIR_NAME = "__tests__";

const packageRoot = path.resolve(import.meta.dirname, "..");
const appDir = path.join(
  packageRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "Inteligir.app",
);
const appBinary = path.join(appDir, "Contents", "MacOS", "Inteligir");
// the same walk src-tauri/src/runtime.rs does at runtime: node beside the shell, the CLI a resource
const bundledNode = path.join(appDir, "Contents", "MacOS", "node");
const runtimeRoot = path.join(appDir, "Contents", "Resources", "server");
const serverEntry = path.join(runtimeRoot, "dist", "desktop.js");
// scripts/package.mjs's resources, which the CLI's bundled-git.ts resolves beside itself
const bundledGitRoot = path.join(appDir, "Contents", "Resources", "git");
const bundledNodeNotices = path.join(appDir, "Contents", "Resources", "notices", "node");
// scripts/rust-notices.mjs's, for the crates the shell's own binary links
const bundledRustNotices = path.join(appDir, "Contents", "Resources", "notices");
// the plugin's machine-wide socket (tauri-plugin-single-instance): an installed Inteligir that
// answers on it would take this launch over, and the smoke would watch the wrong app
const SINGLE_INSTANCE_SOCKET = "/tmp/com_inteligir_desktop_si.sock";
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
const CODEX_SIGNED_OUT = "ChatGPT is signed out on this Mac";
// the shell's notes in the server's log as it starts a child and once that child has stopped
// (src-tauri/src/server.rs)
const SERVER_STARTING = "[desktop] starting the server";
const SERVER_STOPPED_CLEANLY = "server exited (code 0)";
const SERVER_LOG = path.join("logs", "server.log");
// the shell's lines once a window's page has loaded (src-tauri/src/window.rs)
const WINDOW_LOADED = "[desktop] window loaded";
const FIRST_RUN_LOADED = "[desktop] first run loaded";
// each would steer the agent off the bundled vendors and their empty stores: the host's own vendor
// binaries, its credentials, or an agent mode that is not ACP
const HOST_AGENT_ENV = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_EXECUTABLE",
  "CLAUDE_CODE_OAUTH_TOKEN",
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
if (!existsSync(bundledNode)) {
  fail(`the packaged app carries no node beside the shell at ${bundledNode}`);
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

// the staged CLI is the package as npm would publish it, so the allowed names come from the
// manifest's own `files`, with the README npm always adds and the dependencies it installed
const cliManifest = JSON.parse(readFileSync(path.join(runtimeRoot, "package.json"), "utf-8"));
const shippedNames = new Set([
  "README.md",
  "node_modules",
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
  (entry) => path.basename(entry) === TEST_DIR_NAME && !entry.startsWith("node_modules"),
);
if (testDirs.length > 0) {
  fail(`the packaged CLI carries test files: ${testDirs.join(", ")}`);
}
log(`packaged CLI -> ${readdirSync(runtimeRoot).join(", ")}`);

// git's licence obliges the pack to carry its text and say where the source is, node's its own,
// and the shell's crates theirs
for (const [root, name] of [
  [bundledGitRoot, "COPYING"],
  [bundledGitRoot, "SOURCE"],
  [bundledNodeNotices, "LICENSE"],
  [bundledNodeNotices, "SOURCE"],
  [bundledRustNotices, "rust-crates.txt"],
]) {
  if (!existsSync(path.join(root, name))) {
    fail(`the packaged app carries no ${name} at ${root}`);
  }
}

const answers = async (socket) => {
  const probe = createConnection(socket);
  try {
    await once(probe, "connect");
    return true;
  } catch {
    return false;
  } finally {
    probe.destroy();
  }
};
if (await answers(SINGLE_INSTANCE_SOCKET)) {
  fail(
    "an Inteligir is running on this Mac, and the packaged app would hand over to it: quit it first",
  );
}

const scratch = await mkdtemp(path.join(tmpdir(), "inteligir-desktop-smoke-"));
const port = 4900 + Math.floor(Math.random() * 90);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = path.join(scratch, "data");
const vaultDir = path.join(scratch, "vault");
// a home of its own, so the shell's folder (its recent vaults, its debug choice, its web stores)
// lands in the scratch rather than beside an installed Inteligir's
const pinnedHome = path.join(scratch, "pinned-home");
// no sign-in lives in either, so each vendor answers signed out and the turn stops at its refusal
const claudeConfigDir = path.join(scratch, "claude-config");
const codexHome = path.join(scratch, "codex-home");

await mkdir(claudeConfigDir, { recursive: true });
await mkdir(codexHome, { recursive: true });
await mkdir(pinnedHome, { recursive: true });

// the first launch plays a Mac without the developer tools: xcode-select names a dir holding no git,
// and the git first on the login shell's PATH fails, as the stub does, noting each call. the login
// shell is the smoke's own so that PATH is exactly this one, whatever the host's rc files add
const hostBinDir = path.join(scratch, "host-bin");
const hostGitCalls = path.join(scratch, "host-git-calls.log");
const loginShell = path.join(scratch, "login-shell");
const POISONED_HOST_ENV = {
  DEVELOPER_DIR: path.join(scratch, "no-developer-tools"),
  PATH: `${hostBinDir}:${process.env.PATH ?? ""}`,
  SHELL: loginShell,
};
await mkdir(hostBinDir, { recursive: true });
await writeFile(
  path.join(hostBinDir, "git"),
  `#!/bin/sh\necho "$*" >> '${hostGitCalls}'\nexit 1\n`,
);
await writeFile(
  loginShell,
  `#!/bin/sh\nPATH='${hostBinDir}:/usr/bin:/bin:/usr/sbin:/sbin' exec /bin/sh -c "$2"\n`,
);
await chmod(path.join(hostBinDir, "git"), 0o755);
await chmod(loginShell, 0o755);

// an undefined value unsets the variable
const appEnv = (env) =>
  Object.fromEntries(
    Object.entries({
      ...process.env,
      CLAUDE_CONFIG_DIR: claudeConfigDir,
      CODEX_HOME: codexHome,
      INTELIGIR_SYNC_INTERVAL_MS: "0",
      ...env,
    }).filter(([name, value]) => value !== undefined && !HOST_AGENT_ENV.has(name)),
  );

const launchApp = (env) => {
  const app = spawn(appBinary, [], {
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
  const health = await waitForUrl(`${url}${HEALTH_PATH}`, BOOT_TIMEOUT_MS);
  if (health === null) {
    fail(`no health answer within ${BOOT_TIMEOUT_MS}ms — see the output above`);
  }
  log(`health -> ${await health.text()}`);
};

// a healthy server is not a loaded window: the pin and the handoff decide what the page loads
const waitPageLoaded = async (launched, { loaded, page }) => {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  for (;;) {
    const output = launched.output();
    if (output.includes(loaded)) {
      log(`${page} loaded`);
      return;
    }
    if (Date.now() > deadline) {
      fail(`the ${page} had not loaded within ${BOOT_TIMEOUT_MS}ms`);
    }
    await delay(250);
  }
};

const waitWindowLoaded = async (launched) => {
  await waitPageLoaded(launched, { loaded: WINDOW_LOADED, page: "window" });
};

// hand-rolled: the typed client needs a bundler this script does not have
const rpcClient = (url, forDataDir) => {
  const row = JSON.parse(readFileSync(path.join(forDataDir, "server.json"), "utf-8"));
  return async (procedure, input) => {
    const response = await fetch(`${url}${RPC_PREFIX}/${procedure}`, {
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

// the shell alone, which quits on SIGTERM as on Quit
const quitApp = async (launched) => {
  const { pid } = launched.app;
  if (pid === undefined) {
    fail("the packaged app has no pid — it never spawned");
  }
  log(`SIGTERM ${pid} (the shell)`);
  process.kill(pid, "SIGTERM");
  const exit = await Promise.race([exitOf(launched.app), delay(EXIT_TIMEOUT_MS, null)]);
  if (exit === null) {
    fail(`the packaged app did not exit within ${EXIT_TIMEOUT_MS}ms of SIGTERM`);
  }
  return exit;
};

// the quit stops the server first, which is the ordered shutdown under test; the shell notes how
// its child ended in the server's log. Looked for in this launch's part of the log rather than at
// its end: the child's last buffered lines may still land after the note
const stopApp = async (launched, forDataDir) => {
  const exit = await quitApp(launched);
  const serverLog = readFileSync(path.join(forDataDir, SERVER_LOG), "utf-8");
  const thisLaunch = serverLog.slice(Math.max(serverLog.lastIndexOf(SERVER_STARTING), 0));
  if (!thisLaunch.includes(SERVER_STOPPED_CLEANLY)) {
    fail("the app quit without its server stopping cleanly — a graceful stop must exit 0");
  }
  if (exit.code !== 0) {
    fail(`the packaged app exited ${exit.code ?? exit.signal} — a quit must exit 0`);
  }
  log("the server stopped cleanly and the app exited 0");
};

// a first run has no server to stop, so its quit is the shell's alone
const quitFirstRun = async (launched) => {
  const exit = await quitApp(launched);
  if (exit.code !== 0) {
    fail(
      `the packaged app exited ${exit.code ?? exit.signal} from its first run — a quit must exit 0`,
    );
  }
  log("the first run quit and the app exited 0");
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

// the server runs each vendor's bundled binary itself and asks it for the sign-in: both must be
// there in the pack, and over an empty store both must answer signed out, never unknown.
const proveVendorsBundled = async (rpc) => {
  const { harnesses } = await rpc("agents/status");
  for (const id of ["claude", "codex"]) {
    const harness = harnesses.find((row) => row.id === id);
    if (harness?.runtime !== "bundled") {
      fail(`the packaged app does not carry the ${id} runtime: ${JSON.stringify(harness)}`);
    }
    if (harness.account.state !== "signed-out") {
      fail(`${id} over an empty store did not answer signed out: ${JSON.stringify(harness)}`);
    }
  }
  log("agents -> claude and codex bundled, both signed out");
};

// the server starts the codex adapter on the bundled node, the adapter starts its bundled native
// codex, and the ACP handshake runs; with no sign-in the vendor then refuses the session. only a
// live adapter can say that: one the server could not start, or a codex it could not run, fails
// the turn differently.
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

// the boot's init and first commit ran before the server listened, so a healthy server already
// proves those; an API write committing proves the engine's later runs.
const proveBundledGitCommits = async (rpc) => {
  const note = "Smoke Bundled Git.md";
  await rpc("vault/write", {
    content: "# Smoke Bundled Git\n",
    guard: { kind: "absent" },
    path: note,
  });
  await rpc("vault/commitNow", { paths: [note] });
  const { revisions } = await rpc("vault/history", { path: note });
  if (revisions.length === 0) {
    fail(`a write to ${note} was never committed`);
  }
  log(`bundled git -> ${note} committed as ${revisions[0].sha.slice(0, 7)}`);
};

// read once the app has quit, so the engine's shutdown flush and the agent's turn are counted too
const proveHostGitUntouched = () => {
  if (existsSync(hostGitCalls)) {
    fail(`the host's git ran instead of the bundled one:\n${readFileSync(hostGitCalls, "utf-8")}`);
  }
  log("the host's git never ran");
};

let launched = null;

try {
  log(`launching the packaged app on ${baseUrl}, as a Mac without the developer tools`);
  launched = launchApp({
    ...POISONED_HOST_ENV,
    HOME: pinnedHome,
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

  await proveVendorsBundled(rpc);
  await proveAgentTurn(rpc);
  await proveBundledGitCommits(rpc);

  // an agent's `inteligir` is the launcher the server wrote into its data dir, which runs the
  // bundled node on the bundled CLI, so a PATH holding no node still reaches the server
  const agentCli = path.join(dataDir, "bin", CLI_BIN_NAME);
  const status = await run(agentCli, ["status", "--json"], {
    env: { HOME: pinnedHome, INTELIGIR_DATA_DIR: dataDir, PATH: "/usr/bin:/bin" },
  });
  if (!status.includes(baseUrl)) {
    fail(`the agent's CLI did not reach the packaged server: ${status}`);
  }
  log("the agent's CLI drove the packaged server on the bundled node");

  await stopApp(launched, dataDir);
  launched = null;
  proveHostGitUntouched();

  // a home with no vault and nothing pinning one opens the first run, whose window loads the page
  // the shell carries and boots nothing until a vault is chosen
  const firstRunHome = path.join(scratch, "first-run-home");
  await mkdir(firstRunHome, { recursive: true });
  log("launching under a fresh home: the first run");
  launched = launchApp({
    HOME: firstRunHome,
    INTELIGIR_DATA_DIR: undefined,
    INTELIGIR_VAULT_DIR: undefined,
  });
  await waitPageLoaded(launched, { loaded: FIRST_RUN_LOADED, page: "first run" });
  const firstRunServerFile = path.join(firstRunHome, PROD_DATA_DIR_NAME, "server.json");
  if (existsSync(firstRunServerFile)) {
    fail(`the first run started a server before any vault was chosen (${firstRunServerFile})`);
  }
  await quitFirstRun(launched);
  launched = null;

  // the shell's vault switch is a rewrite of the root config.json's vaultDir and a restart of
  // its child; the switch itself is a click in the window, so this proves what the app boots
  // under a scratch home: the default vault keeps the root data dir, the selector boots the
  // server on a data dir of that vault's own, and each quit stops it cleanly. these two launches
  // run on the host as it is: its own login shell, and its own git where it has the tools.
  const home = path.join(scratch, "home");
  const rootDataDir = path.join(home, PROD_DATA_DIR_NAME);
  const secondVault = path.join(scratch, "second-vault");
  // a home with no default vault opens the first run and boots nothing until one is chosen, so
  // the folder is made first, as a launch before first run left it
  await mkdir(path.join(home, PROD_VAULT_DIR_NAME), { recursive: true });
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
  await stopApp(launched, rootDataDir);
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
  await stopApp(launched, secondDataDir);
  launched = null;

  log("PASS (each window loaded its page; their rendering is not checked)");
} finally {
  killGroup(launched);
  await rm(scratch, { force: true, recursive: true });
}
