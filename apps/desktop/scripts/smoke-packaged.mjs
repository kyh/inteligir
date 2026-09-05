// boots the packaged server through the app's own Electron binary; cannot open a window
// (BrowserWindow needs a display). outside CI: it needs a macOS runner.

import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// the workspace link, not the packaged copy: `files` does not ship scripts
import { proveWatcherAlive } from "inteligir/scripts/smoke-lib.mjs";
const CLI_BIN_NAME = "inteligir";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(packageRoot, ".output", "bin", "mac-arm64", "Inteligir.app");
const electronBinary = join(appDir, "Contents", "MacOS", "Inteligir");
// the same walk src/main/server-instance.ts does at runtime
const unpacked = join(appDir, "Contents", "Resources", "app.asar.unpacked");
const runtimeRoot = join(unpacked, "node_modules", CLI_BIN_NAME);
const serverEntry = join(runtimeRoot, "dist", "index.js");
const BOOT_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 20_000;

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`smoke: ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForUrl(url, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return response;
      }
    } catch {}
    if (Date.now() > deadline) {
      return null;
    }
    await delay(250);
  }
}

function run(file, argv, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(file, argv, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      rejectPromise(new Error(`${file} ${argv.join(" ")} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

if (!existsSync(electronBinary)) {
  fail(`no packaged app at ${appDir} — run \`pnpm package:desktop\` first`);
}
if (!existsSync(serverEntry)) {
  fail(`the packaged app carries no server entry at ${serverEntry}`);
}
const notesSkill = join(runtimeRoot, "dist", "skills", "inteligir-notes", "SKILL.md");
if (!existsSync(notesSkill)) {
  fail(`the packaged app carries no dialect skills at ${notesSkill}`);
}

// the agent's PATH resolver refuses a bin without the execute bit, silently
const cliBin = join(runtimeRoot, "bin", CLI_BIN_NAME);
if (!existsSync(cliBin)) {
  fail(`the packaged CLI is missing at ${cliBin}`);
}
try {
  accessSync(cliBin, constants.X_OK);
} catch {
  fail(`the packaged CLI is not executable (${cliBin})`);
}

const scratch = await mkdtemp(join(tmpdir(), "inteligir-desktop-smoke-"));
const port = 4_900 + Math.floor(Math.random() * 90);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = join(scratch, "data");
const vaultDir = join(scratch, "vault");

function authHeaders() {
  const row = JSON.parse(readFileSync(join(dataDir, "server.json"), "utf8"));
  return { authorization: `Bearer ${row.token}` };
}

// hand-rolled: the typed client needs a bundler this script does not have
async function rpc(procedure, input) {
  const response = await fetch(`${baseUrl}/rpc/${procedure}`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: input === undefined ? "{}" : JSON.stringify({ json: input }),
  });
  if (!response.ok) {
    fail(`${procedure} answered ${response.status}`);
  }
  const body = await response.json();
  return body.json;
}

let server = null;

try {
  process.stdout.write(`smoke: booting the packaged server on ${baseUrl}\n`);
  server = spawn(electronBinary, [serverEntry, "serve"], {
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      INTELIGIR_DATA_DIR: dataDir,
      INTELIGIR_VAULT_DIR: vaultDir,
      INTELIGIR_PORT: String(port),
      INTELIGIR_AGENT: "off",
      INTELIGIR_SYNC_INTERVAL_MS: "0",
    },
  });

  const health = await waitForUrl(`${baseUrl}/health`, BOOT_TIMEOUT_MS);
  if (health === null) {
    fail(`no health answer within ${BOOT_TIMEOUT_MS}ms — see the output above`);
  }
  process.stdout.write(`smoke: health -> ${await health.text()}\n`);

  const shell = await fetch(baseUrl, { headers: { accept: "text/html" } });
  const html = await shell.text();
  if (!shell.ok || !html.includes("<title>inteligir</title>")) {
    fail(`the SPA shell did not answer (${shell.status}, ${html.length} bytes)`);
  }
  process.stdout.write(`smoke: SPA shell -> ${shell.status} ${html.length} bytes\n`);

  // exercises better-sqlite3, @parcel/watcher and git init, the first to fail on an ABI mismatch
  const tree = await rpc("vault/tree");
  process.stdout.write(`smoke: vault tree -> ${tree.entries.length} entries under ${tree.root}\n`);
  await proveWatcherAlive({
    rpc,
    vaultDir,
    fail,
    log: (line) => process.stdout.write(`smoke: ${line}\n`),
  });

  // proves a worker thread can dlopen the addon from app.asar.unpacked. `ready` is
  // allowed (shared model dir); `unavailable` is refused (this .app ships the prebuild)
  const voiceStatus = await rpc("voice/status");
  if (!["no-model", "ready"].includes(voiceStatus.state)) {
    fail(
      `packaged voice status is ${JSON.stringify(voiceStatus)}; expected no-model or ready — ` +
        `the transcription worker could not dlopen its binding from app.asar.unpacked`,
    );
  }
  process.stdout.write(`smoke: voice -> ${voiceStatus.state}\n`);

  const status = await run(cliBin, ["status", "--json"], {
    env: { ...process.env, INTELIGIR_DATA_DIR: dataDir },
  });
  if (!status.includes(baseUrl)) {
    fail(`the packaged CLI did not reach the packaged server: ${status}`);
  }
  process.stdout.write("smoke: packaged CLI drove the packaged server\n");

  const pid = server.pid;
  if (pid === undefined) {
    fail("the packaged server has no pid — it never spawned");
  }
  // the leader only: kill(-pid) would take the forked watcher too and make the check a tautology
  process.stdout.write(`smoke: SIGTERM ${pid} (the server alone)\n`);
  process.kill(pid, "SIGTERM");
  const exit = await Promise.race([
    new Promise((resolvePromise) =>
      server.on("close", (code, signal) => resolvePromise({ code, signal })),
    ),
    delay(EXIT_TIMEOUT_MS).then(() => null),
  ]);
  if (exit === null) {
    fail(`the packaged server did not exit within ${EXIT_TIMEOUT_MS}ms of SIGTERM`);
  }
  if (exit.code !== 0) {
    fail(`the packaged server exited ${exit.code ?? exit.signal} — a graceful stop must exit 0`);
  }
  server = null;
  process.stdout.write("smoke: exited 0\n");
  process.stdout.write("smoke: PASS (the window itself is not covered — it needs a display)\n");
} finally {
  if (server?.pid !== undefined) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {}
  }
  await rm(scratch, { recursive: true, force: true });
}
