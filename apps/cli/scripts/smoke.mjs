// packs a real tarball so `files` is under test too. outside verify: builds, installs, binds a port.

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_BIN_NAME = "inteligir";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");
const BOOT_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 20_000;
const WATCHER_TIMEOUT_MS = 20_000;

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
    } catch {}
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
  // pnpm pack, not npm: only pnpm rewrites catalog: ranges on the way out
  process.stdout.write(`smoke: packing ${packageRoot}\n`);
  const { stdout: packOutput } = await run("pnpm", ["pack", "--pack-destination", scratch], {
    cwd: packageRoot,
  });
  const tarball = packOutput.trim().split("\n").at(-1);
  if (!existsSync(tarball)) {
    fail(`pnpm pack did not name a tarball (got ${JSON.stringify(packOutput)})`);
  }
  process.stdout.write(`smoke: installing ${tarball}\n`);
  await run("npm", ["install", "--prefix", installDir, "--no-audit", "--no-fund", tarball], {
    env: { ...process.env, npm_config_cache: join(scratch, "npm-cache") },
  });

  const bin = join(installDir, "node_modules", ".bin", CLI_BIN_NAME);
  if (!existsSync(bin)) {
    fail(`the installed package exposes no bin at ${bin}`);
  }
  // npm strips the execute bit from every packed file not named in `bin`
  const installRoot = join(installDir, "node_modules", CLI_BIN_NAME);
  const cliBin = join(installRoot, "bin", CLI_BIN_NAME);
  try {
    accessSync(cliBin, constants.X_OK);
  } catch {
    fail(`the packaged CLI is not executable (${cliBin}) — it must stay in package.json's bin map`);
  }
  // each of these silently disables a capability when missing
  for (const [what, path] of [
    ["the dialect skills", join(installRoot, "dist", "skills", "inteligir-notes", "SKILL.md")],
    ["the workspace UI", join(installRoot, "dist", "ui", "index.html")],
    ["the starter vault", join(installRoot, "seed", "Welcome.md")],
  ]) {
    if (!existsSync(path)) {
      fail(`the packaged install carries no ${what} (${path})`);
    }
  }

  // nothing reads the licence texts, so only this can notice them missing
  for (const name of await readdir(join(repoRoot, "tools", "licenses"))) {
    const staged = join(installRoot, "dist", "licenses", name);
    if (!existsSync(staged)) {
      fail(`the packaged install carries no ${name} (${staged})`);
    }
  }

  const { stdout: cliVersion } = await run(bin, ["--version"]);
  process.stdout.write(`smoke: packaged CLI --version -> ${cliVersion.trim()}\n`);

  const authHeaders = () => ({
    authorization: `Bearer ${JSON.parse(readFileSync(join(dataDir, "server.json"), "utf8")).token}`,
  });

  // hand-rolled: no bundler and no workspace link against a packed tarball
  const rpc = async (procedure, input) => {
    const response = await fetch(`${baseUrl}/rpc/${procedure}`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: input === undefined ? "{}" : JSON.stringify({ json: input }),
    });
    if (!response.ok) {
      fail(`${procedure} answered ${response.status}`);
    }
    return (await response.json()).json;
  };

  process.stdout.write(`smoke: booting on ${baseUrl}\n`);
  server = spawn(
    bin,
    ["serve", "--port", String(port), "--data-dir", dataDir, "--vault", vaultDir],
    {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, INTELIGIR_AGENT: "off", INTELIGIR_SYNC_INTERVAL_MS: "0" },
    },
  );

  const health = await waitForUrl(`${baseUrl}/health`, BOOT_TIMEOUT_MS);
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

  const vaultList = await rpc("vault/tree");
  process.stdout.write(`smoke: vault tree -> ${vaultList.entries.length} entries\n`);

  // the watcher is a forked child its proxy respawns forever, so a child that cannot load its
  // platform binding never reaches the server's status; an external write reaching the index
  // is the only proof it lives. Written again on each round: the first can land before the
  // child's first subscribe.
  const watchToken = `smokewatch${Date.now()}`;
  const watchedNote = join(vaultDir, "Smoke Watch.md");
  const watcherDeadline = Date.now() + WATCHER_TIMEOUT_MS;
  let watcherSaw = false;
  for (let round = 0; !watcherSaw && Date.now() < watcherDeadline; round += 1) {
    writeFileSync(watchedNote, `# Smoke Watch\n\n${watchToken} round ${round}\n`);
    for (let poll = 0; poll < 10 && !watcherSaw; poll += 1) {
      await delay(500);
      const found = await rpc("knowledge/search", { q: watchToken });
      watcherSaw = found.results.length > 0;
    }
  }
  if (!watcherSaw) {
    fail(
      `the vault watcher never reported an external write to ${watchedNote} within ${WATCHER_TIMEOUT_MS}ms — ` +
        "the forked child is not watching (is @parcel/watcher's platform package in the tree?)",
    );
  }
  process.stdout.write("smoke: the watcher reported an external write\n");

  // exercises the bundled client half the hand-rolled fetch above bypasses
  const { stdout: statusJson } = await run(bin, ["status", "--json"], {
    env: { ...process.env, INTELIGIR_DATA_DIR: dataDir },
  });
  const status = JSON.parse(statusJson);
  if (status.dataDir !== dataDir) {
    fail(`packed \`status --json\` reported dataDir ${status.dataDir}, expected ${dataDir}`);
  }
  process.stdout.write(`smoke: packaged CLI status --json -> dataDir ${status.dataDir}\n`);

  // `ready` is allowed because the model dir is shared across installs; `unavailable`
  // is refused because this platform ships a prebuild, so a load failure is an ABI regression
  const voiceStatus = await rpc("voice/status");
  if (!["no-model", "ready"].includes(voiceStatus.state)) {
    fail(
      `voice status is ${JSON.stringify(voiceStatus)}; expected no-model or ready — ` +
        `the native transcription binding did not load from the installed tree`,
    );
  }
  process.stdout.write(`smoke: voice -> ${voiceStatus.state}\n`);

  const pid = server.pid;
  if (pid === undefined) {
    fail("the server process has no pid — it never spawned");
  }
  // the leader only: kill(-pid) would take the forked watcher too and make the
  // orphan check below a tautology
  process.stdout.write(`smoke: SIGTERM ${pid} (the server alone)\n`);
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

  // POSIX: signal 0 against -pid asks whether the group still has members
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
    } catch {}
  }
  await rm(scratch, { recursive: true, force: true });
}
