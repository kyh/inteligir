import { createScenarioBrowser, requireHeadlessBrowser } from "./agent-browser";
import type { ScenarioBrowser, ScenarioBrowserOptions } from "./agent-browser";
import { openCloudLink } from "./cloud-link";
import type { CloudLink } from "./cloud-link";
import { expectNoDroppedThinking, launchCloudWorker } from "./cloud-worker";
import type { CloudWorker, LaunchCloudWorkerArgs } from "./cloud-worker";
import type { RunScope } from "./scope";

export interface ScenarioContext {
  repoRoot: string;
  scratchDir: string;
  log: (message: string) => void;
  cloudWorker: (
    options?: Pick<LaunchCloudWorkerArgs, "json" | "pages" | "vars">,
  ) => Promise<CloudWorker>;
  // a relay to a booted Worker the scenario can cut and restore, closed at teardown
  cloudLink: (worker: CloudWorker) => Promise<CloudLink>;
  // skips the scenario when no headless browser can launch; closed at teardown like a Worker.
  browser: (label: string, options?: ScenarioBrowserOptions) => Promise<ScenarioBrowser>;
}

export interface Scenario {
  name: string;
  description: string;
  // the runner fails a run still going past this, so a hang costs one scenario, not the job.
  timeoutMs?: number;
  run: (context: ScenarioContext) => Promise<void>;
}

// a scenario's context, and what every scenario is held to once its own run passed: no Worker it
// booted replayed a thinking block Claude dropped
export interface ScenarioRun {
  readonly context: ScenarioContext;
  readonly afterRun: () => void;
}

export interface OpenScenarioArgs {
  // the scenario's own name, which every browser session it opens carries
  scenarioName: string;
  repoRoot: string;
  scratchDir: string;
  // what the scenario starts and says, until its teardown
  scope: Pick<RunScope, "log" | "own">;
}

export const openScenario = (args: OpenScenarioArgs): ScenarioRun => {
  const workers: CloudWorker[] = [];
  const context: ScenarioContext = {
    async browser(label, options) {
      await requireHeadlessBrowser(args.scope.log);
      const browser = createScenarioBrowser(`${args.scenarioName}-${label}`, options);
      args.scope.own({ name: `browser "${label}"`, outputTail: () => "", stop: browser.close });
      return browser;
    },
    async cloudLink(worker) {
      const link = await openCloudLink(worker.origin);
      args.scope.own({ name: "the cloud link", outputTail: () => "", stop: link.close });
      return link;
    },
    async cloudWorker(options) {
      const launch: LaunchCloudWorkerArgs = {
        onLog: args.scope.log,
        register: args.scope.own,
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
      const worker = await launchCloudWorker(launch);
      workers.push(worker);
      return worker;
    },
    log: args.scope.log,
    repoRoot: args.repoRoot,
    scratchDir: args.scratchDir,
  };
  return {
    afterRun: () => {
      for (const worker of workers) {
        expectNoDroppedThinking(worker);
      }
    },
    context,
  };
};
