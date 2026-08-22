// The packaging smoke: pack the tarball npm would publish, install it into a
// scratch prefix, boot it from a scratch data dir through its own bin, and
// check the four things a published artifact can be wrong about — that it
// serves, that the CLI inside it runs, that its native runtime dependencies
// resolve from the installed tree, and that it leaves nothing behind.
//
// It packs a real tarball rather than reading dist/ directly, so `files` is
// under test too: an omitted entry fails here instead of on someone's machine.
//
// Deliberately outside `pnpm verify` (it builds, installs and binds a port);
// run it with `pnpm smoke:package`.

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { accessSync, constants, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLI_BIN_NAME,
  appBundleDir,
  appServerEntry,
  cliBinDirFromAppBundle,
  installRootIn,
} from "./staged-layout.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
        resolvePromise({ stdout, stderr });
        return;
      }
      rejectPromise(new Error(`${file} ${argv.join(" ")} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
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

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const scratch = await mkdtemp(join(tmpdir(), "inteligir-smoke-"));
const installDir = join(scratch, "install");
const dataDir = join(scratch, "data");
const vaultDir = join(scratch, "vault");
const port = 4_500 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;
let server = null;

try {
  // `pnpm pack`, never `npm pack`: the catalog: protocol on the runtime
  // dependencies (the native pair and the ACP adapters) is a pnpm workspace fact, and only pnpm rewrites it to real
  // ranges on the way out. An npm-packed tarball installs with
  // EUNSUPPORTEDPROTOCOL — which is also what publishing with npm would do.
  process.stdout.write(`smoke: packing ${packageRoot}\n`);
  const { stdout: packOutput } = await run("pnpm", ["pack", "--pack-destination", scratch], {
    cwd: packageRoot,
  });
  const tarball = packOutput.trim().split("\n").at(-1);
  if (!existsSync(tarball)) {
    fail(`pnpm pack did not name a tarball (got ${JSON.stringify(packOutput)})`);
  }
  // A scratch npm cache, so the run is hermetic and never contends with the
  // developer's own — this install exists to prove the tarball, not to warm
  // anything.
  process.stdout.write(`smoke: installing ${tarball}\n`);
  await run("npm", ["install", "--prefix", installDir, "--no-audit", "--no-fund", tarball], {
    env: { ...process.env, npm_config_cache: join(scratch, "npm-cache") },
  });

  const bin = join(installDir, "node_modules", ".bin", CLI_BIN_NAME);
  if (!existsSync(bin)) {
    fail(`the installed package exposes no bin at ${bin}`);
  }

  // The agent's PATH resolver reaches the CLI by walking UP from the running
  // app bundle (apps/app/src/node/agent/agent-shell-env.ts::resolveCliBinDir:
  // `dist-node/../../cli/bin`), so the same walk is done here rather than a
  // hardcoded path — a layout drift on either side has to fail somewhere, and
  // the failure it produces in production is the agent silently losing the
  // ability to drive the product.
  const installRoot = installRootIn(installDir);
  const bundleDir = appBundleDir(installRoot);
  if (!existsSync(appServerEntry(installRoot))) {
    fail(`the packaged app bundle is missing at ${bundleDir}`);
  }
  const cliBin = join(cliBinDirFromAppBundle(bundleDir), CLI_BIN_NAME);
  if (!existsSync(cliBin)) {
    fail(`the packaged CLI is missing at ${cliBin}`);
  }
  // The execute bit, explicitly: npm strips it from every packed file not
  // named in `bin`, and the resolver refuses a non-executable file — which is
  // the capability disappearing with no error anywhere.
  try {
    accessSync(cliBin, constants.X_OK);
  } catch {
    fail(`the packaged CLI is not executable (${cliBin}) — it must stay in package.json's bin map`);
  }
  const { stdout: cliVersion } = await run(cliBin, ["--version"]);
  process.stdout.write(`smoke: packaged CLI --version -> ${cliVersion.trim()}\n`);

  const { stdout: launcherVersion } = await run(bin, ["--version"]);
  process.stdout.write(`smoke: launcher --version -> ${launcherVersion.trim()}\n`);

  process.stdout.write(`smoke: booting on ${baseUrl}\n`);
  server = spawn(
    bin,
    ["--port", String(port), "--data-dir", dataDir, "--vault", vaultDir, "--no-open"],
    {
      // Its own process group, so the teardown can prove no orphan survived.
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, INTELIGIR_AGENT: "off", INTELIGIR_SYNC_INTERVAL_MS: "0" },
    },
  );

  const health = await waitForUrl(`${baseUrl}/api/v1/health`, BOOT_TIMEOUT_MS);
  if (health === null) {
    fail(`no health answer on ${baseUrl} within ${BOOT_TIMEOUT_MS}ms`);
  }
  process.stdout.write(`smoke: health -> ${await health.text()}\n`);

  const shell = await fetch(baseUrl, { headers: { accept: "text/html" } });
  const html = await shell.text();
  if (!shell.ok || !html.includes("<title>inteligir</title>")) {
    fail(`the SPA shell did not answer (${shell.status}, ${html.length} bytes)`);
  }
  process.stdout.write(`smoke: SPA shell -> ${shell.status} ${html.length} bytes\n`);

  const vaultList = await fetch(`${baseUrl}/api/v1/vault/tree`);
  process.stdout.write(`smoke: vault tree -> ${vaultList.status}\n`);

  // Dictation's native binding is the ONE runtime dependency this smoke checks
  // by BEHAVIOUR rather than presence, and it is a real check because the
  // status is computed from a worker that spawns from the staged bundle,
  // resolves `sherpa-onnx-node` from the installed tree and dlopens the
  // addon. So a fresh install must answer `no-model` (binding loaded, no model
  // downloaded) — `ready` is also accepted, since the model dir is shared
  // across installs and this machine may already hold one. `unavailable` is
  // REFUSED: this smoke runs on a platform the artifact ships a prebuild for,
  // so a runtime that will not load there is a packaging or ABI regression,
  // which is exactly the class a green smoke on `unavailable` would hide.
  const voice = await fetch(`${baseUrl}/api/v1/voice/status`);
  if (!voice.ok) {
    fail(`the voice status route answered ${voice.status}`);
  }
  const voiceStatus = await voice.json();
  if (!["no-model", "ready"].includes(voiceStatus.state)) {
    fail(
      `voice status is ${JSON.stringify(voiceStatus)}; expected no-model or ready — ` +
        `the native transcription binding did not load from the installed tree`,
    );
  }
  process.stdout.write(`smoke: voice -> ${voiceStatus.state}\n`);

  const pid = server.pid;
  if (pid === undefined) {
    fail("the launcher process has no pid — it never spawned");
  }
  // Signalled by PID, never by process GROUP. `kill(-pid)` reaches the forked
  // watcher too, so the launcher would never have had to clean it up and the
  // orphan assertion below would prove nothing — it would be checking that a
  // process this script killed is dead. Signalling only the leader is what a
  // terminal's ^C and a supervisor's stop both do, and it is what makes the
  // group check a real question about the launcher's own teardown.
  process.stdout.write(`smoke: SIGTERM ${pid} (the launcher alone)\n`);
  process.kill(pid, "SIGTERM");
  const exit = await Promise.race([
    new Promise((resolvePromise) =>
      server.on("close", (code, signal) => resolvePromise({ code, signal })),
    ),
    delay(EXIT_TIMEOUT_MS).then(() => null),
  ]);
  if (exit === null) {
    fail(`the server did not exit within ${EXIT_TIMEOUT_MS}ms of SIGTERM`);
  }
  if (exit.code !== 0) {
    fail(`the server exited ${exit.code ?? exit.signal} — a graceful stop must exit 0`);
  }
  process.stdout.write("smoke: exited 0\n");

  // POSIX-only: signal 0 against a negative pid asks "does this process group
  // still have members". The launcher was spawned detached, so it IS the group
  // leader and its forked watcher child is the only other member — anything
  // left here is an orphan the teardown failed to take with it.
  await delay(500);
  if (processAlive(-pid)) {
    fail(`process group ${pid} still has members — the watcher child was orphaned`);
  }
  process.stdout.write("smoke: no orphan processes\n");

  const dataEntries = await readdir(dataDir);
  process.stdout.write(`smoke: data dir -> ${dataEntries.toSorted().join(", ")}\n`);
  server = null;
  process.stdout.write("smoke: PASS\n");
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
