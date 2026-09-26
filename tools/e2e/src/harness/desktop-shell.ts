import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";
import { resolveAppConfig } from "inteligir/server/config";
import { resolveCheckoutRoot } from "inteligir/server/dev-instance";
import { loopbackOrigin } from "inteligir/server/server-file";
import { SHUTDOWN_TIMEOUT_MS } from "inteligir/server/shutdown";
import { parseEval } from "./agent-browser";
import type { AgentBrowser } from "./agent-browser";
import { skip } from "./assert";
import { appLaunchEnv, describeExecError, exec } from "./exec";
import { createInstanceApi } from "./instance";
import type { InstanceApi } from "./instance";
import { pollUntil } from "./poll";
import { bootWithPorts, spawnSupervised } from "./tracked-child";
import type { TrackedProcess } from "./tracked-child";

// the window's one origin (apps/desktop/src/main/protocol-handler.ts)
export const SHELL_APP_URL = "inteligir://app/";
// the page a launch with no vault opens instead, on the same origin (apps/desktop/src/main/index.ts)
export const SHELL_FIRST_RUN_URL = `${SHELL_APP_URL}first-run.html`;

// a bridge call awaited in the page; the answer crosses back as a JSON string
export const askBridge = async <T>(
  browser: AgentBrowser,
  call: string,
  schema: z.ZodType<T>,
): Promise<T> =>
  parseEval(await browser(["eval", `${call}.then((answer) => JSON.stringify(answer))`]), schema);

// a cold boot forks the server, migrates, indexes and paints the window before the page target
// answers; a cold install is a ~100MB download, so it has a budget of its own
const READY_DEADLINE_MS = 90_000;
const READY_POLL_INTERVAL_MS = 250;
const ELECTRON_INSTALL_TIMEOUT_MS = 300_000;
// the shell waits out its server child's whole teardown, then Chromium's own, which on macOS
// was measured at up to half a minute after the child had gone
const QUIT_DEADLINE_MS = SHUTDOWN_TIMEOUT_MS + 30_000;

export interface ShellTarget {
  dataDir: string;
  vaultDir: string;
}

export interface ShellPage {
  id: string;
  url: string;
}

export interface DesktopShell extends TrackedProcess {
  // the Chrome DevTools port an agent-browser session connects to
  cdpPort: number;
  // the server the shell runs now: the port is pinned across a switch, the bearer re-read per call,
  // so on a first run it answers once the chosen vault's server.json appears
  api: InstanceApi;
  serverOrigin: string;
  // what the shell resolves now, derived as main derives it, so a vault switch moves it
  target: () => ShellTarget;
  // the shell's own userData: its recent-vaults list, its diagnostics choice, its sessions
  userDataDir: string;
  // the window's pages as DevTools lists them, the app's origin only
  appPages: () => Promise<ShellPage[]>;
  // SIGTERM to main alone, as the OS's quit sends: its own teardown must stop the server
  quit: () => Promise<void>;
}

export type DesktopShellOptions = {
  // the shell's own userData (its recent-vaults list, its session partitions)
  seedUserData?: (userDataDir: string) => Promise<void>;
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

const cdpTargetsSchema = z.array(
  z.looseObject({ id: z.string(), type: z.string(), url: z.string() }),
);

const appPagesOn = async (cdpPort: number): Promise<ShellPage[]> => {
  try {
    const response = await fetch(`${loopbackOrigin(cdpPort)}/json/list`, {
      signal: AbortSignal.timeout(2000),
    });
    const targets = cdpTargetsSchema.safeParse(response.ok ? await response.json() : null);
    if (!targets.success) {
      return [];
    }
    return targets.data
      .filter((target) => target.type === "page" && target.url.startsWith(SHELL_APP_URL))
      .map(({ id, url }) => ({ id, url }));
  } catch {
    return [];
  }
};

// the binary the desktop pins. pnpm runs no install script, so electron's own installer fetches it
// on first use and is a no-op once it is there
const electronBinary = async (desktopDir: string): Promise<string> => {
  const fromDesktop = createRequire(path.join(desktopDir, "package.json"));
  try {
    await exec(process.execPath, [fromDesktop.resolve("electron/install.js")], {
      timeoutMs: ELECTRON_INSTALL_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Error(`the Electron binary did not install:\n${describeExecError(error)}`, {
      cause: error,
    });
  }
  return z.string().parse(fromDesktop("electron"));
};

// a window needs a display; the suite's CI job runs under xvfb-run, so a skip there is a FAIL
const requireDisplay = (): void => {
  const { DISPLAY: x11, WAYLAND_DISPLAY: wayland } = process.env;
  if (process.platform === "linux" && x11 === undefined && wayland === undefined) {
    skip("no display for the shell's window: run the suite under `xvfb-run -a`");
  }
};

interface ShellDirs {
  homeDir: string;
  claudeConfigDir: string;
  codexHome: string;
}

// HOME, not INTELIGIR_DATA_DIR/INTELIGIR_VAULT_DIR: the shell refuses a switch while either is
// pinned, so the scratch is reached through the dev instance a home derives. the vendors' stores
// are the scratch's own and empty: a keychain entry is not under HOME, so a scratch home alone
// would still find the signed-in account of the machine running the suite.
const shellEnv = (dirs: ShellDirs, serverPort: number): NodeJS.ProcessEnv =>
  Object.assign(appLaunchEnv(), {
    CLAUDE_CONFIG_DIR: dirs.claudeConfigDir,
    CODEX_HOME: dirs.codexHome,
    HOME: dirs.homeDir,
    INTELIGIR_AGENT: "scripted",
    INTELIGIR_PORT: String(serverPort),
    INTELIGIR_SYNC_INTERVAL_MS: "0",
  });

export const launchDesktopShell = async (args: LaunchDesktopShellArgs): Promise<DesktopShell> => {
  requireDisplay();
  const desktopDir = path.join(args.repoRoot, "apps", "desktop");
  const shellDir = path.join(args.scratchDir, "shell");
  const homeDir = path.join(shellDir, "home");
  const userDataDir = path.join(shellDir, "user-data");
  const dirs: ShellDirs = {
    claudeConfigDir: path.join(shellDir, "claude-config"),
    codexHome: path.join(shellDir, "codex-home"),
    homeDir,
  };
  await mkdir(homeDir, { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  await mkdir(dirs.claudeConfigDir, { recursive: true });
  await mkdir(dirs.codexHome, { recursive: true });
  const checkoutPath = resolveCheckoutRoot(desktopDir);
  // main resolves an unpackaged shell in development mode, for the checkout its cwd names; the
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
  await args.seedUserData?.(userDataDir);
  const binary = await electronBinary(desktopDir);

  return await bootWithPorts<DesktopShell>({
    deadlineMs: READY_DEADLINE_MS,
    label: "the desktop shell",
    onLog: args.onLog,
    pollIntervalMs: READY_POLL_INTERVAL_MS,
    portCount: 2,
    ready: async (shell) => {
      const pages = await shell.appPages();
      return pages.length > 0;
    },
    spawn: ([cdpPort = 0, serverPort = 0]) => {
      const child = spawnSupervised({
        argv: [
          desktopDir,
          `--remote-debugging-port=${String(cdpPort)}`,
          `--user-data-dir=${userDataDir}`,
        ],
        cwd: desktopDir,
        env: shellEnv(dirs, serverPort),
        file: binary,
        name: "shell",
      });
      const serverOrigin = loopbackOrigin(serverPort);
      const shell: DesktopShell = {
        ...child,
        api: createInstanceApi(serverOrigin, () => target().dataDir),
        appPages: async () => await appPagesOn(cdpPort),
        cdpPort,
        quit: async () => {
          child.signalLeader("SIGTERM");
          await pollUntil(
            async () => await Promise.resolve(child.exited()),
            (exited) => exited,
            {
              deadlineMs: QUIT_DEADLINE_MS,
              describe: () =>
                `the shell was still running ${String(QUIT_DEADLINE_MS)}ms after SIGTERM`,
            },
          );
        },
        serverOrigin,
        target,
        userDataDir,
      };
      args.register(shell);
      args.onLog(
        `launching the desktop shell (DevTools on ${String(cdpPort)}, server on ${serverOrigin})`,
      );
      return { child, handle: shell };
    },
  });
};
