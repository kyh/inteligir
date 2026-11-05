// The built Mac shell on a scratch home, driven over WebDriver: tauri-driver starts the debug build
// (`build:shell`) for the session it is asked for, and the shell opens its one window on the
// library's page it carries, calling the cloud origin the harness names (`INTELIGIR_CLOUD_ORIGIN`,
// which a debug build alone reads). The home is the scenario's own and outlives a launch, so a
// relaunch finds the credential and the replica the one before it kept.

import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { skip } from "./assert";
import { appLaunchEnv } from "./exec";
import { pollUntil } from "./poll";
import { BACK_TO_LIBRARY, LIBRARY_GRID } from "./selectors";
import { loopbackOrigin } from "./ports";
import { bootWithPorts, spawnSupervised } from "./tracked-child";
import type { TrackedProcess } from "./tracked-child";
import { openSession } from "./webdriver";
import type { WebDriverSession } from "./webdriver";

// the page as the shell carries it (src-tauri/src/window.rs)
export const SHELL_PAGE_URL = "tauri://localhost/library/";
// the debug build's bundle id, which names the app's data dir under XDG_DATA_HOME
// (src-tauri/tauri.local.conf.json, which build:shell builds under)
const APP_ID = "com.inteligir.desktop.dev";
// a cold launch starts the driver, the shell and its window
const READY_DEADLINE_MS = 90_000;
const READY_POLL_INTERVAL_MS = 500;
// a quit installs nothing in a debug build and closes the replica's file
const QUIT_DEADLINE_MS = 30_000;

export interface DesktopShell extends TrackedProcess {
  // the shell's one window
  window: WebDriverSession;
  // where the shell keeps the account's replica, its staged files and the credential's stand-in
  dataDir: string;
  // the replica's files, one an account the shell holds
  replicaFiles: () => string[];
  // SIGTERM to the shell, as Quit, a session's end or launchd at shutdown sends it
  quit: () => Promise<void>;
}

export interface DesktopShellOptions {
  // the cloud the shell calls: a Worker's origin, or a link to one the scenario can cut
  cloudOrigin: string;
}

export type LaunchDesktopShellArgs = DesktopShellOptions & {
  repoRoot: string;
  scratchDir: string;
  onLog: (line: string) => void;
  register: (shell: DesktopShell) => void;
};

// what `pnpm turbo run build:shell --filter=@repo/desktop` leaves, which the runner builds before a
// shell scenario: an unbundled debug build with the page inside it
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
      "no WebDriver for the shell: install webkitgtk-webdriver (webkit2gtk-driver before Ubuntu 26.04), then `cargo install tauri-driver --locked`",
    );
  }
  if (!existsSync(binary)) {
    skip(`no built shell at ${binary}: run \`pnpm turbo run build:shell --filter=@repo/desktop\``);
  }
};

interface ShellHome {
  home: string;
  dataHome: string;
  cacheHome: string;
}

// HOME and the XDG dirs, which place the app's data and caches; the driver passes its environment
// down to the shell it starts
const shellEnv = (home: ShellHome, cloudOrigin: string): NodeJS.ProcessEnv =>
  Object.assign(appLaunchEnv(), {
    HOME: home.home,
    INTELIGIR_CLOUD_ORIGIN: cloudOrigin,
    XDG_CACHE_HOME: home.cacheHome,
    XDG_CONFIG_HOME: path.join(home.home, ".config"),
    XDG_DATA_HOME: home.dataHome,
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

// a zombie still answers kill(pid, 0); its state says it is done
const running = (pid: number): boolean => {
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
  const homeDir = path.join(args.scratchDir, "shell", "home");
  const home: ShellHome = {
    cacheHome: path.join(homeDir, ".cache"),
    dataHome: path.join(homeDir, ".local", "share"),
    home: homeDir,
  };
  await mkdir(home.dataHome, { recursive: true });
  const dataDir = path.join(home.dataHome, APP_ID);
  const libraryDir = path.join(dataDir, "library");

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
    portCount: 2,
    // the session opens once the shell's window exists, which is the shell being up
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
    spawn: ([port = 0, nativePort = 0]) => {
      driverOrigin = loopbackOrigin(port);
      const child = spawnSupervised({
        argv: ["--port", String(port), "--native-port", String(nativePort)],
        cwd: desktopDir,
        env: shellEnv(home, args.cloudOrigin),
        file: "tauri-driver",
        name: "shell",
      });
      const shell: DesktopShell = {
        ...child,
        dataDir,
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
          await child.stop();
        },
        replicaFiles: () =>
          existsSync(libraryDir)
            ? readdirSync(libraryDir)
                .filter((name) => name.endsWith(".sqlite"))
                .map((name) => path.join(libraryDir, name))
            : [],
        get window() {
          return live();
        },
      };
      args.register(shell);
      args.onLog(
        `launching the desktop shell (WebDriver on ${String(port)}, the cloud at ${args.cloudOrigin})`,
      );
      return { child, handle: shell };
    },
  });
};

const titleRowSchema = z.object({ title: z.string() });

// an item's title as the shell's replica holds it, read off the file the shell wrote, or null when
// the replica holds no such item: the oracle that the page read the Rust replica, not the cloud
export const replicaTitle = (file: string, itemId: string): string | null => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("SELECT title FROM items WHERE id = ?").get(itemId);
    return row === undefined ? null : titleRowSchema.parse(row).title;
  } finally {
    db.close();
  }
};

const SIGN_IN_DEADLINE_MS = 60_000;
const LIBRARY_DEADLINE_MS = 60_000;

// from an open item, its topbar's way back, and the grid drawn again
export const backToLibrary = async (page: WebDriverSession): Promise<void> => {
  await page.clickWhenThere(BACK_TO_LIBRARY, LIBRARY_DEADLINE_MS);
  await page.waitUntil(
    `document.querySelector(${JSON.stringify(LIBRARY_GRID)}) !== null`,
    LIBRARY_DEADLINE_MS,
  );
};

// the first run as a person meets it: the window's sign-in, the account's email and password typed
// through the browser's own keys, then Sign in, which keeps the credential and opens the library
export const signInThroughWindow = async (
  page: WebDriverSession,
  account: { readonly email: string; readonly password: string },
): Promise<void> => {
  await page.waitForText("Sign in to your library", SIGN_IN_DEADLINE_MS);
  await page.typeInto('input[type="email"]', account.email);
  await page.typeInto('input[type="password"]', account.password);
  await page.clickButton("Sign in", SIGN_IN_DEADLINE_MS);
};
