// The packaged-app smoke: everything the shipped .app does EXCEPT open a
// window.
//
// It boots the packaged server the way the shell does — the app's own Electron
// binary with ELECTRON_RUN_AS_NODE=1 — and checks the parts a build
// can silently get wrong: that the native modules load under Electron's
// runtime, that the SPA and API are served, that the bundled CLI is reachable
// and executable where the agent's PATH resolver looks for it, and that
// SIGTERM ends it cleanly.
//
// What it CANNOT check is the window: `BrowserWindow` needs a display, so the
// origin pin is proven by its unit tests and by nothing here.
//
// Run it with `pnpm smoke:desktop`, which packages first. Deliberately outside
// `pnpm verify` AND outside CI, and the CI half is a fact rather than a budget:
// the gate runs on ubuntu, this drives a macOS arm64 .app through that app's
// own Electron binary, and there is no Linux runner on which either half can
// happen. Moving it into CI means adding a macOS job — worth doing the day the
// packaged shell is something users install, and not before.

import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const CLI_BIN_NAME = "inteligir";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(packageRoot, ".output", "bin", "mac-arm64", "Inteligir.app");
const electronBinary = join(appDir, "Contents", "MacOS", "Inteligir");
// The packaged server is an ORDINARY dependency in an ordinary node_modules —
// electron-builder unpacks the tree npm laid down, so the walk below is the one
// src/main/server-instance.ts::serverEntryPath does at runtime.
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
    } catch {
      // Not listening yet.
    }
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

// The agent's PATH resolver looks for the bin beside the running bundle
// (apps/cli/src/server/agents/agent-shell-env.ts::resolveCliBinDir), and the
// execute bit is checked because the resolver refuses a file without one —
// which is the capability disappearing with no error anywhere.
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

/** The device token the packaged server published for this scratch instance.
 *  Every privileged route is behind it, so a smoke that skipped it would be
 *  asserting 401s. */
function authHeaders() {
  const row = JSON.parse(readFileSync(join(dataDir, "server.json"), "utf8"));
  return { authorization: `Bearer ${row.token}` };
}

/**
 * ONE procedure call over the RPC protocol, hand-rolled because this script has
 * no bundler and no workspace link — the wire is `POST /rpc/<path>` with a JSON
 * body and an answer under `json`.
 */
async function rpc(procedure) {
  const response = await fetch(`${baseUrl}/rpc/${procedure}`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: "{}",
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
  // `serve` is the argument the shell passes too: the entry is the CLI, and
  // every other verb is a client against a server this one IS.
  server = spawn(electronBinary, [serverEntry, "serve"], {
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      // The packaged runtime's own composition (src/main/server-instance.ts):
      // NODE_ENV from isPackaged, and the instance's data + vault dirs.
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      INTELIGIR_DATA_DIR: dataDir,
      INTELIGIR_VAULT_DIR: join(scratch, "vault"),
      // The smoke's own pins: a fixed port to probe deterministically (the shell
      // lets the child derive one), and the agent/sync loops off for isolation.
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

  // A vault listing exercises better-sqlite3, @parcel/watcher and the git repo
  // init — the parts that would fail first on an ABI mismatch.
  const tree = await rpc("vault/tree");
  process.stdout.write(`smoke: vault tree -> ${tree.entries.length} entries under ${tree.root}\n`);

  // The third native module, and the only one reached from a WORKER THREAD, so
  // this is the one check that proves the worker entry was staged inside
  // app.asar.unpacked AND that a thread can dlopen the addon from there — the
  // status is computed from exactly that load. A fresh packaged install must
  // answer `no-model` (loaded, nothing downloaded); `ready` is accepted for the
  // shared model dir. `unavailable` is REFUSED: this .app is built for
  // darwin-arm64 and ships that prebuild, so a runtime that will not load is a
  // staging or ABI regression — the very thing a green smoke on `unavailable`
  // (its old, false, "legitimate answer") would have hidden.
  const voiceStatus = await rpc("voice/status");
  if (!["no-model", "ready"].includes(voiceStatus.state)) {
    fail(
      `packaged voice status is ${JSON.stringify(voiceStatus)}; expected no-model or ready — ` +
        `the transcription worker could not dlopen its binding from app.asar.unpacked`,
    );
  }
  process.stdout.write(`smoke: voice -> ${voiceStatus.state}\n`);

  // The packaged CLI is told WHICH instance, never where or with what: it
  // reads the port and the token out of the same server.json this smoke does.
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
  // Only the leader, never the group: `kill(-pid)` would take the forked
  // watcher with it and turn the graceful-exit assertion into a tautology.
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
    } catch {
      // Already gone.
    }
  }
  await rm(scratch, { recursive: true, force: true });
}
