import { createScenarioBrowser, requireHeadlessBrowser } from "./agent-browser";
import type { ScenarioBrowser, ScenarioBrowserOptions } from "./agent-browser";
import { openCloudLink } from "./cloud-link";
import type { CloudLink } from "./cloud-link";
import { launchCloudWorker } from "./cloud-worker";
import type { CloudWorker, LaunchCloudWorkerArgs } from "./cloud-worker";
import { launchDesktopShell } from "./desktop-shell";
import type { DesktopShell, DesktopShellOptions } from "./desktop-shell";
import type { TrackedProcess } from "./tracked-child";

export interface ScenarioContext {
  repoRoot: string;
  scratchDir: string;
  log: (message: string) => void;
  cloudWorker: (
    options?: Pick<LaunchCloudWorkerArgs, "json" | "pages" | "vars">,
  ) => Promise<CloudWorker>;
  // a relay to a booted Worker the scenario can cut and restore, closed at teardown
  cloudLink: (worker: CloudWorker) => Promise<CloudLink>;
  // the built Tauri shell on the scenario's scratch home, which outlives a launch, driven over
  // WebDriver; skips with no display, no driver or no built shell.
  desktopShell: (options: DesktopShellOptions) => Promise<DesktopShell>;
  // skips the scenario when no headless browser can launch; closed at teardown like a Worker.
  browser: (label: string, options?: ScenarioBrowserOptions) => Promise<ScenarioBrowser>;
}

// what one scenario at a time may hold, whatever the lane count: the desktop shell is a window on
// the run's one display, driven through WebKit's WebDriver, and two at once would share its focus.
// Everything else a scenario touches is its own (a scratch dir, ephemeral ports, a browser session
// named for it), so a scenario that holds none of these runs beside any other
export type ExclusiveResource = "desktop-shell";

export interface Scenario {
  name: string;
  description: string;
  // the runner fails a run still going past this, so a hang costs one scenario, not the job.
  timeoutMs?: number;
  // never beside another scenario holding the same one. "desktop-shell" also has the runner build
  // the shell before the first scenario, outside every deadline
  exclusive?: readonly ExclusiveResource[];
  run: (context: ScenarioContext) => Promise<void>;
}

export interface CreateScenarioContextArgs {
  // the scenario's own name, which every browser session it opens carries
  scenarioName: string;
  repoRoot: string;
  scratchDir: string;
  log: (message: string) => void;
  instances: TrackedProcess[];
  isClosed: () => boolean;
}

// a run abandoned at its deadline keeps going, and what it starts once the teardown began would be
// owned by nothing: it is stopped and refused instead.
const own = (args: CreateScenarioContextArgs, instance: TrackedProcess): void => {
  if (!args.isClosed()) {
    args.instances.push(instance);
    return;
  }
  void (async () => {
    try {
      await instance.stop();
    } catch (error) {
      args.log(`teardown: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
  throw new Error(`${instance.name} started after its scenario was torn down`);
};

export const createScenarioContext = (args: CreateScenarioContextArgs): ScenarioContext => ({
  async browser(label, options) {
    await requireHeadlessBrowser(args.log);
    const browser = createScenarioBrowser(`${args.scenarioName}-${label}`, options);
    own(args, { name: `browser "${label}"`, outputTail: () => "", stop: browser.close });
    return browser;
  },
  async cloudLink(worker) {
    const link = await openCloudLink(worker.origin);
    own(args, { name: "the cloud link", outputTail: () => "", stop: link.close });
    return link;
  },
  async cloudWorker(options) {
    const launch: LaunchCloudWorkerArgs = {
      onLog: args.log,
      register: (process) => {
        own(args, process);
      },
      repoRoot: args.repoRoot,
      scratchDir: args.scratchDir,
    };
    if (options?.vars !== undefined) {
      launch.vars = options.vars;
    }
    if (options?.json !== undefined) {
      launch.json = options.json;
    }
    if (options?.pages !== undefined) {
      launch.pages = options.pages;
    }
    return await launchCloudWorker(launch);
  },
  async desktopShell(options) {
    return await launchDesktopShell({
      ...options,
      onLog: args.log,
      register: (shell) => {
        own(args, shell);
      },
      repoRoot: args.repoRoot,
      scratchDir: args.scratchDir,
    });
  },
  log: args.log,
  repoRoot: args.repoRoot,
  scratchDir: args.scratchDir,
});
