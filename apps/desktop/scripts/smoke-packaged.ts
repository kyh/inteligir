// boots the packaged app itself, window and all, on a home of its own, against a Worker on this
// machine: the bundle carries the shell and nothing else to run, its signature holds, it asks for
// no entitlement, and its window opens the library's page the local Worker serves, at the path the
// release opens on the site. No check of the app loads production. needs a macOS arm64 host with
// a display: CI's test-macos job runs it on an ad-hoc pack.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const packageRoot = path.resolve(import.meta.dirname, "..");
const e2eDir = path.resolve(packageRoot, "..", "..", "tools", "e2e");
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
// scripts/rust-notices.ts's, for the crates the shell's own binary links
const rustNotices = path.join(appDir, "Contents", "Resources", "notices", "rust-crates.txt");
// the Worker the e2e suite boots, alone, and its line once it answers
const TSX = path.join(e2eDir, "node_modules", ".bin", "tsx");
const SERVE_WORKER = "src/serve-worker.ts";
const WORKER_READY = /^\[serve-worker\] (?<origin>http:\/\/\S+)$/mu;
// the variable the shell loads a Worker on this machine by (src-tauri/src/window.rs)
const LOCAL_SITE_VAR = "INTELIGIR_CLOUD_ORIGIN";
// the shell's line once its window's page has loaded (src-tauri/src/window.rs)
const PAGE_LOADED = "[desktop] window loaded ";
// a cold build of the Worker and the page it serves, its schema and its boot
const WORKER_TIMEOUT_MS = 600_000;
const BOOT_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 30_000;
// what the hardened runtime may never be asked for here: the shell runs no JIT, loads no unsigned
// code and, unsandboxed, needs no network grant
const REFUSED_ENTITLEMENTS = [
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.network.client",
];

const configSchema = z.object({ build: z.object({ frontendDist: z.url() }) });

const log = (line: string): void => {
  process.stdout.write(`smoke: ${line}\n`);
};

const fail = (reason: string): never => {
  throw new Error(`smoke: ${reason}`);
};

// the path the release opens on the site, read from the config the pack is built from
const libraryPath = (): string => {
  const config = configSchema.parse(
    JSON.parse(readFileSync(path.join(packageRoot, "src-tauri", "tauri.conf.json"), "utf-8")),
  );
  return new URL(config.build.frontendDist).pathname;
};

// every file under a folder, as paths relative to it
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)));

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

// what the pack carries: the shell alone in MacOS, and nothing to run among its resources
const checkPackContents = (): void => {
  if (!existsSync(appBinary)) {
    fail(`no packaged app at ${appDir}: run \`pnpm package:desktop\` first`);
  }
  const executables = readdirSync(path.join(appDir, "Contents", "MacOS"));
  if (executables.join(",") !== "Inteligir") {
    fail(`the bundle runs more than the shell: ${executables.join(", ")}`);
  }
  if (!existsSync(rustNotices) || statSync(rustNotices).size === 0) {
    fail(`the bundle carries no notices for the crates it links (${rustNotices})`);
  }
  const resourcesDir = path.join(appDir, "Contents", "Resources");
  const resources = filesUnder(resourcesDir);
  const runnable = resources.filter((file) => isExecutable(path.join(resourcesDir, file)));
  if (runnable.length > 0) {
    fail(`the bundle carries something runnable: ${runnable.slice(0, 5).join(", ")}`);
  }
  log(
    `the bundle carries the shell and ${String(resources.length)} resources, none of them runnable`,
  );
};

const checkSignature = (): void => {
  const verified = spawnSync("codesign", ["--verify", "--deep", "--strict", appDir], {
    encoding: "utf-8",
  });
  if (verified.status !== 0) {
    fail(`the bundle's signature does not hold: ${verified.stderr}`);
  }
  const entitlements = spawnSync("codesign", ["-d", "--entitlements", "-", "--xml", appDir], {
    encoding: "utf-8",
  });
  const granted = REFUSED_ENTITLEMENTS.filter((key) => entitlements.stdout.includes(key));
  if (granted.length > 0) {
    fail(`the shell is signed with ${granted.join(", ")}`);
  }
  log("the signature holds and asks for no entitlement");
};

// what a child has written to either stream so far, and whether it has exited
const watch = (child: ChildProcess) => {
  let output = "";
  let exited: number | null = null;
  const append = (chunk: Buffer): void => {
    output += chunk.toString("utf-8");
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("exit", (code) => {
    exited = code ?? -1;
  });
  return { exited: () => exited, output: () => output };
};

// waits for `found` to answer, failing when the child exits first or the deadline passes
const waitFor = async <T>(
  child: ReturnType<typeof watch>,
  what: string,
  timeoutMs: number,
  found: () => T | null,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (let answer = found(); ; answer = found()) {
    if (answer !== null) {
      return answer;
    }
    const exited = child.exited();
    if (exited !== null) {
      fail(`it exited (${String(exited)}) before ${what}:\n${child.output()}`);
    }
    if (Date.now() > deadline) {
      fail(`${what} did not happen within ${String(timeoutMs)}ms:\n${child.output()}`);
    }
    await delay(250);
  }
};

const stop = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const closed = once(child, "close");
  child.kill("SIGTERM");
  if ((await Promise.race([closed, delay(EXIT_TIMEOUT_MS).then(() => null)])) === null) {
    child.kill("SIGKILL");
    await closed;
  }
};

// the app on a home of its own, on the local Worker, until its window has loaded the library's page
const bootOnLocalWorker = async (): Promise<void> => {
  const page = libraryPath();
  const worker = spawn(TSX, [SERVE_WORKER], { cwd: e2eDir, stdio: ["ignore", "pipe", "pipe"] });
  const home = await mkdtemp(path.join(tmpdir(), "inteligir-smoke-"));
  let app: ChildProcess | null = null;
  try {
    log(`booting a Worker on this machine (tools/e2e/${SERVE_WORKER})`);
    const watchedWorker = watch(worker);
    const origin = await waitFor(
      watchedWorker,
      "the Worker answered",
      WORKER_TIMEOUT_MS,
      () => WORKER_READY.exec(watchedWorker.output())?.groups?.origin ?? null,
    );
    log(`the Worker answers on ${origin}`);
    app = spawn(appBinary, [], {
      env: { HOME: home, [LOCAL_SITE_VAR]: origin, PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const watchedApp = watch(app);
    const expected = `${PAGE_LOADED}${origin}${page}`;
    await waitFor(watchedApp, `the window loaded ${origin}${page}`, BOOT_TIMEOUT_MS, () =>
      watchedApp
        .output()
        .split("\n")
        .some((line) => line === expected)
        ? true
        : null,
    );
    const elsewhere = watchedApp
      .output()
      .split("\n")
      .filter(
        (line) => line.startsWith(PAGE_LOADED) && !line.startsWith(`${PAGE_LOADED}${origin}`),
      );
    if (elsewhere.length > 0) {
      fail(`the window loaded a page off the local Worker:\n${elsewhere.join("\n")}`);
    }
    log(`the window opened the library's page the local Worker serves (${origin}${page})`);
  } finally {
    if (app !== null) {
      await stop(app);
    }
    await stop(worker);
    await rm(home, { force: true, recursive: true });
  }
};

if (process.platform !== "darwin" || process.arch !== "arm64") {
  fail("the packaged app boots on a macOS arm64 host alone");
}
checkPackContents();
checkSignature();
await bootOnLocalWorker();
