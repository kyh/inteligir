// boots the packaged app itself, window and all, on a home of its own: the bundle carries the shell
// and the library's page and nothing else to run, its signature holds, it asks for no entitlement,
// its window loads the page it carries, and a SIGTERM quits it as Quit does. needs a macOS arm64
// host with a display: CI's test-macos job runs it on an ad-hoc pack.

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

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
// scripts/rust-notices.ts's, for the crates the shell's own binary links
const rustNotices = path.join(appDir, "Contents", "Resources", "notices", "rust-crates.txt");
// the plugin's machine-wide socket (tauri-plugin-single-instance): an installed Inteligir that
// answers on it would take this launch over, and the smoke would watch the wrong app
const SINGLE_INSTANCE_SOCKET = "/tmp/com_inteligir_desktop_si.sock";
// the shell's line once its window's page has loaded (src-tauri/src/window.rs)
const PAGE_LOADED = "[desktop] window loaded /library/";
const BOOT_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 30_000;
// what the hardened runtime may never be asked for here: the shell runs no JIT, loads no unsigned
// code and, unsandboxed, needs no network grant
const REFUSED_ENTITLEMENTS = [
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.network.client",
];

const log = (line: string): void => {
  process.stdout.write(`smoke: ${line}\n`);
};

const fail = (reason: string): never => {
  throw new Error(`smoke: ${reason}`);
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

// the app on a home of its own, until its window has loaded the page, then SIGTERM, as a quit
const bootAndQuit = async (): Promise<void> => {
  if (existsSync(SINGLE_INSTANCE_SOCKET)) {
    fail(`an Inteligir is running (${SINGLE_INSTANCE_SOCKET}): quit it first`);
  }
  const home = await mkdtemp(path.join(tmpdir(), "inteligir-smoke-"));
  try {
    const app = spawn(appBinary, [], {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let exited: number | null = null;
    app.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
    });
    app.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
    });
    const exiting = once(app, "exit");
    app.on("exit", (code) => {
      exited = code ?? -1;
    });
    const bootDeadline = Date.now() + BOOT_TIMEOUT_MS;
    while (!output.includes(PAGE_LOADED)) {
      if (exited !== null) {
        fail(`the app exited (${String(exited)}) before its window loaded:\n${output}`);
      }
      if (Date.now() > bootDeadline) {
        app.kill("SIGKILL");
        fail(`the window never loaded the page within ${String(BOOT_TIMEOUT_MS)}ms:\n${output}`);
      }
      await delay(250);
    }
    log("the window loaded the page the bundle carries");
    app.kill("SIGTERM");
    const quit = await Promise.race([exiting, delay(EXIT_TIMEOUT_MS).then(() => null)]);
    if (quit === null) {
      app.kill("SIGKILL");
      return fail(`the app was still running ${String(EXIT_TIMEOUT_MS)}ms after SIGTERM`);
    }
    if (quit[0] !== 0) {
      fail(`a SIGTERM quit the app with ${String(quit[0] ?? quit[1])}:\n${output}`);
    }
    log("a SIGTERM quit the app as Quit does");
  } finally {
    await rm(home, { force: true, recursive: true });
  }
};

if (process.platform !== "darwin" || process.arch !== "arm64") {
  fail("the packaged app boots on a macOS arm64 host alone");
}
checkPackContents();
checkSignature();
await bootAndQuit();
