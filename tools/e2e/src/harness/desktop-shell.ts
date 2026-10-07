import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveAppConfig } from "inteligir/server/config";
import { resolveCheckoutRoot } from "inteligir/server/dev-instance";
import { loopbackOrigin } from "inteligir/server/server-file";
import { SHUTDOWN_TIMEOUT_MS } from "inteligir/server/shutdown";
import { skip } from "./assert";
import { appLaunchEnv } from "./exec";
import { createInstanceApi, makeVendorDirs, vendorEnv } from "./instance";
import type { InstanceApi, VendorDirs } from "./instance";
import { pollUntil } from "./poll";
import { bootWithPorts, spawnSupervised } from "./tracked-child";
import type { TrackedProcess } from "./tracked-child";
import { NO_AUTO_SYNC } from "./vault-sync";
import { openSession } from "./webdriver";
import type { WebDriverSession } from "./webdriver";

// the first-run window's page, the one the shell carries inside it (src-tauri/tauri.conf.json)
export const SHELL_FIRST_RUN_URL = "tauri://localhost/first-run.html";
// what the shell notes in a vault's server log as each app window loads (src-tauri/src/window.rs)
export const WINDOW_LOADED = "[desktop] window loaded";
const SERVER_LOG = path.join("logs", "server.log");

// a cold boot starts the driver, the shell, its server, migrates, indexes and paints the window
const READY_DEADLINE_MS = 90_000;
const READY_POLL_INTERVAL_MS = 500;
// a killed shell's server sees its lifeline close and runs its whole teardown
const QUIT_DEADLINE_MS = SHUTDOWN_TIMEOUT_MS + 30_000;

export interface ShellTarget {
  dataDir: string;
  vaultDir: string;
}

export interface DesktopShell extends TrackedProcess {
  // the server the shell runs now: the port is pinned across a switch, the bearer re-read per call,
  // so on a first run it answers once the chosen vault's server.json appears
  api: InstanceApi;
  serverOrigin: string;
  // what the shell resolves now, derived as the shell's CLI door derives it, so a switch moves it
  target: () => ShellTarget;
  // the shell's own folder: its recent-vaults list, its debug choice, each vault's web store
  ownDir: string;
  // the shell's first window, and only it (harness/webdriver.ts says why)
  window: WebDriverSession;
  // the lines a vault's server log holds, the shell's notes of its windows among them
  serverLog: (target: ShellTarget) => Promise<string[]>;
  // SIGTERM to the shell, as a session's end or a crash sends it: its server must not outlive it
  quit: () => Promise<void>;
}

export type DesktopShellOptions = {
  // the shell's own folder (its recent-vaults list, its debug choice)
  seedOwnDir?: (ownDir: string) => Promise<void>;
} & (
  | {
      firstRun?: false;
      // the vault the shell opens, made before launch so the shell boots it rather than asking
      // for one; seeded before its server's repo init commits it
      seedVault?: (vaultDir: string) => Promise<void>;
    }
  // no vault and nothing seeded: the shell opens its first run and boots nothing until a vault
  // is chosen. A relaunch over the same scratch finds the vault that run made
  | { firstRun: true }
);

export type LaunchDesktopShellArgs = DesktopShellOptions & {
  repoRoot: string;
  scratchDir: string;
  onLog: (line: string) => void;
  register: (shell: DesktopShell) => void;
};

// what `pnpm turbo run build:shell --filter=@repo/desktop` leaves, which the runner builds before a
// shell scenario: an unbundled debug build, its first-run page inside it
export const shellBinary = (repoRoot: string): string =>
  path.join(repoRoot, "apps", "desktop", "src-tauri", "target", "debug", "Inteligir");

const onPath = (name: string): boolean =>
  (process.env.PATH ?? "")
    .split(path.delimiter)
    .some((dir) => dir !== "" && existsSync(path.join(dir, name)));

// a window needs a display and the drivers WebDriver speaks through; the suite's CI job provides
// all three, so a skip there is a FAIL
const requireShellSetup = (binary: string): void => {
  if (process.platform !== "linux") {
    skip("the shell scenarios drive WebKitGTK through tauri-driver, which runs on Linux alone");
  }
  const { DISPLAY: x11, WAYLAND_DISPLAY: wayland } = process.env;
  if (x11 === undefined && wayland === undefined) {
    skip("no display for the shell's window: run the suite under `xvfb-run -a`");
  }
  if (!onPath("tauri-driver") || !onPath("WebKitWebDriver")) {
    skip(
      "no WebDriver for the shell: install webkit2gtk-driver, then `cargo install tauri-driver --locked`",
    );
  }
  if (!existsSync(binary)) {
    skip(`no built shell at ${binary}: run \`pnpm turbo run build:shell --filter=@repo/desktop\``);
  }
};

type ShellDirs = VendorDirs & { homeDir: string };

// HOME, not INTELIGIR_DATA_DIR/INTELIGIR_VAULT_DIR: the shell refuses a switch while either is
// pinned, so the scratch is reached through the dev instance a home derives. The driver passes
// its environment down to the shell it starts.
const shellEnv = (dirs: ShellDirs, serverPort: number): NodeJS.ProcessEnv =>
  Object.assign(appLaunchEnv(), vendorEnv(dirs), NO_AUTO_SYNC, {
    HOME: dirs.homeDir,
    INTELIGIR_AGENT: "scripted",
    INTELIGIR_PORT: String(serverPort),
    XDG_CONFIG_HOME: path.join(dirs.homeDir, ".config"),
    XDG_DATA_HOME: path.join(dirs.homeDir, ".local", "share"),
  });

// the shell is the driver's grandchild: found by its binary and the scratch home it runs under
const shellPid = (binary: string, homeDir: string): number | null => {
  const wanted = realpathSync(binary);
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/u.test(entry)) {
      continue;
    }
    try {
      if (readlinkSync(`/proc/${entry}/exe`) !== wanted) {
        continue;
      }
      const environ = readFileSync(`/proc/${entry}/environ`, "utf-8").split("\0");
      if (environ.includes(`HOME=${homeDir}`)) {
        return Number(entry);
      }
    } catch {
      // gone between the listing and the read, or not ours to read
    }
  }
  return null;
};

const driverListening = async (origin: string): Promise<boolean> => {
  try {
    const response = await fetch(`${origin}/status`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
};

// a zombie still answers kill(pid, 0), and a killed shell's server is an orphan whose reaping is
// the init process's; its state says it is done
export const running = (pid: number): boolean => {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf-8");
    return !/^\d+ \(.*\) Z/u.test(stat);
  } catch {
    return false;
  }
};

export const launchDesktopShell = async (args: LaunchDesktopShellArgs): Promise<DesktopShell> => {
  const binary = shellBinary(args.repoRoot);
  requireShellSetup(binary);
  const desktopDir = path.join(args.repoRoot, "apps", "desktop");
  const shellDir = path.join(args.scratchDir, "shell");
  const homeDir = path.join(shellDir, "home");
  // Tauri's app data dir under that home (src-tauri/src/lib.rs names the folder)
  const ownDir = path.join(homeDir, ".local", "share", "Inteligir (Dev)");
  await mkdir(ownDir, { recursive: true });
  const dirs: ShellDirs = { ...(await makeVendorDirs(shellDir)), homeDir };
  const checkoutPath = resolveCheckoutRoot(desktopDir);
  // an unbundled shell's door resolves in development mode, for the checkout it belongs to; the
  // rest of the env it hands the resolution moves neither dir
  const target = (): ShellTarget => {
    const { dataDir, vaultDir } = resolveAppConfig({
      checkoutPath,
      env: { NODE_ENV: "development" },
      homeDir,
    });
    return { dataDir, vaultDir };
  };

  // the default vault already there is what a launch before first run left, so the shell boots it
  if (args.firstRun !== true) {
    const { vaultDir } = target();
    await mkdir(vaultDir, { recursive: true });
    await args.seedVault?.(vaultDir);
  }
  await args.seedOwnDir?.(ownDir);

  let session: WebDriverSession | null = null;
  const live = (): WebDriverSession => {
    if (session === null) {
      throw new Error("the shell's window has no WebDriver session yet");
    }
    return session;
  };
  // one ask: the driver starts a shell per session it is asked for, so a failed one ends the boot
  let driverOrigin = "";
  return await bootWithPorts<DesktopShell>({
    deadlineMs: READY_DEADLINE_MS,
    label: "the desktop shell",
    onLog: args.onLog,
    pollIntervalMs: READY_POLL_INTERVAL_MS,
    portCount: 3,
    // the session opens once the shell's first window exists, which is the shell being up
    ready: async () => {
      if (session !== null) {
        return true;
      }
      if (!(await driverListening(driverOrigin))) {
        return false;
      }
      session = await openSession(driverOrigin, binary);
      return true;
    },
    spawn: ([port = 0, nativePort = 0, serverPort = 0]) => {
      driverOrigin = loopbackOrigin(port);
      const child = spawnSupervised({
        argv: ["--port", String(port), "--native-port", String(nativePort)],
        cwd: desktopDir,
        env: shellEnv(dirs, serverPort),
        file: "tauri-driver",
        name: "shell",
      });
      const serverOrigin = loopbackOrigin(serverPort);
      const shell: DesktopShell = {
        ...child,
        api: createInstanceApi(serverOrigin, () => target().dataDir),
        ownDir,
        async quit() {
          const pid = shellPid(binary, homeDir);
          if (pid !== null) {
            process.kill(pid, "SIGTERM");
            await pollUntil(
              async () => await Promise.resolve(running(pid)),
              (alive) => !alive,
              {
                deadlineMs: QUIT_DEADLINE_MS,
                describe: () => `the shell (pid ${String(pid)}) was still running after SIGTERM`,
              },
            );
          }
          await session?.close();
        },
        serverLog: async (of) =>
          await readFile(path.join(of.dataDir, SERVER_LOG), "utf-8").then(
            (text) => text.split("\n"),
            () => [],
          ),
        serverOrigin,
        target,
        get window() {
          return live();
        },
      };
      args.register(shell);
      args.onLog(
        `launching the desktop shell (WebDriver on ${String(port)}, server on ${serverOrigin})`,
      );
      return { child, handle: shell };
    },
  });
};
