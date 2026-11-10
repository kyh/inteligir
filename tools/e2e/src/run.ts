import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { buildProcessEnv, describeExecError, exec } from "./harness/exec";
import { ScenarioSkipError } from "./harness/scenario-skip-error";
import { killAllLiveGroups } from "./harness/tracked-child";
import { hearingBuildQueueWaits } from "./harness/turbo-build";
import type { TrackedProcess } from "./harness/tracked-child";
import { openScenario } from "./harness/scenario";
import type { Scenario, ScenarioContext } from "./harness/scenario";
import { accountHosted } from "./scenarios/account-hosted";
import { agentCell } from "./scenarios/agent-cell";
import { agentPanelBrowser } from "./scenarios/agent-panel-browser";
import { browserExtension } from "./scenarios/browser-extension";
import { browserSmoke } from "./scenarios/browser-smoke";
import { builtWorkerBoot } from "./scenarios/built-worker-boot";
import { connectorTools } from "./scenarios/connector-tools";
import { editorConstructsBrowser } from "./scenarios/editor-constructs-browser";
import { extensionIntegrated } from "./scenarios/extension-integrated";
import { fileItems } from "./scenarios/file-items";
import { importIntegrated } from "./scenarios/import-integrated";
import { libraryBrowser } from "./scenarios/library-browser";
import { librarySearchBrowser } from "./scenarios/library-search-browser";
import { linkCapture } from "./scenarios/link-capture";
import { liveNoteBrowser } from "./scenarios/live-note-browser";
import { noteLinksBrowser } from "./scenarios/note-links-browser";
import { notePictureBrowser } from "./scenarios/note-picture-browser";
import { phoneEditorPage } from "./scenarios/phone-editor-page";
import { phoneFileOpsHosted } from "./scenarios/phone-file-ops-hosted";
import { phoneOfflineShare } from "./scenarios/phone-offline-share";
import { phoneSaveHosted } from "./scenarios/phone-save-hosted";
import { raindropImport } from "./scenarios/raindrop-import";
import { settingsBrowser } from "./scenarios/settings-browser";
import { slashMenuBrowser } from "./scenarios/slash-menu-browser";
import { tidyLibraryBrowser } from "./scenarios/tidy-library-browser";
import { undoBrowser } from "./scenarios/undo-browser";
import { viewContextBrowser } from "./scenarios/view-context-browser";
import { workerDoorFaults } from "./scenarios/worker-door-faults";
import { workerDoors } from "./scenarios/worker-doors";

const SCENARIOS: readonly Scenario[] = [
  fileItems,
  phoneOfflineShare,
  phoneFileOpsHosted,
  phoneEditorPage,
  phoneSaveHosted,
  accountHosted,
  connectorTools,
  agentCell,
  agentPanelBrowser,
  viewContextBrowser,
  tidyLibraryBrowser,
  builtWorkerBoot,
  workerDoors,
  workerDoorFaults,
  linkCapture,
  raindropImport,
  browserSmoke,
  editorConstructsBrowser,
  slashMenuBrowser,
  undoBrowser,
  settingsBrowser,
  librarySearchBrowser,
  liveNoteBrowser,
  libraryBrowser,
  noteLinksBrowser,
  notePictureBrowser,
  browserExtension,
  importIntegrated,
  extensionIntegrated,
];

// half the machine's cores, at most four: a lane is often a Worker and a browser, and the scenarios
// that bound a wait in wall time are tuned on a machine that is not saturated
const DEFAULT_LANES = Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2)));

const USAGE = `Usage: pnpm e2e [--only <names>] [--lanes <n>] [--keep] [--list] [--no-skip]

  --only <names>  comma-separated scenario names (repeatable)
  --lanes <n>     scenarios run at once (default ${String(DEFAULT_LANES)}: half this machine's cores, at most 4);
                  1 runs them one after another, streaming each line as it happens
  --keep          keep the scratch dirs for post-mortem
  --list          print every scenario and what it proves, then exit
  --no-skip       every SKIP FAILS; for a run whose browser was provisioned, so a skip is a
                  broken setup
`;

// a hang backstop, far above any scenario's green run: they pass in seconds.
const DEFAULT_SCENARIO_TIMEOUT_MS = 180_000;
// a cold build of the browser extension, its reader and its codec bundled
const EXTENSION_BUILD_TIMEOUT_MS = 300_000;

interface CliOptions {
  only: string[];
  lanes: number;
  keep: boolean;
  list: boolean;
  noSkip: boolean;
}

const parseLanes = (value: string | undefined): number => {
  if (value === undefined) {
    return DEFAULT_LANES;
  }
  const lanes = Number(value);
  if (!Number.isInteger(lanes) || lanes < 1) {
    throw new Error(`--lanes takes a whole number of at least 1, not "${value}"`);
  }
  return lanes;
};

const parseCliOptions = (argv: string[]): CliOptions => {
  try {
    const { values } = parseArgs({
      allowPositionals: false,
      args: argv,
      options: {
        keep: { default: false, type: "boolean" },
        lanes: { type: "string" },
        list: { default: false, type: "boolean" },
        "no-skip": { default: false, type: "boolean" },
        only: { default: [], multiple: true, type: "string" },
      },
      strict: true,
    });
    return {
      keep: values.keep,
      lanes: parseLanes(values.lanes),
      list: values.list,
      noSkip: values["no-skip"],
      only: values.only.flatMap((value) => value.split(",").map((name) => name.trim())),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n${USAGE}`, { cause: error });
  }
};

const selectScenarios = (options: CliOptions): readonly Scenario[] => {
  if (options.only.length === 0) {
    return SCENARIOS;
  }
  const known = new Set(SCENARIOS.map((scenario) => scenario.name));
  for (const name of options.only) {
    if (!known.has(name)) {
      throw new Error(
        `unknown scenario "${name}" (have: ${SCENARIOS.map((s) => s.name).join(", ")})`,
      );
    }
  }
  const wanted = new Set(options.only);
  return SCENARIOS.filter((scenario) => wanted.has(scenario.name));
};

type ScenarioOutcome =
  | { kind: "pass"; durationMs: number }
  | { kind: "skip"; durationMs: number; reason: string }
  | { kind: "fail"; durationMs: number; error: string };

interface ScenarioResult {
  outcome: ScenarioOutcome;
  teardownClean: boolean;
}

const seconds = (durationMs: number): string => `${(durationMs / 1000).toFixed(1)}s`;

const timestamp = (): string => new Date().toISOString().slice(11, 19);

// where one scenario's lines go: straight to the terminal in one lane, or held and printed whole
// when it ends, so two lanes never interleave their lines
interface ScenarioOutput {
  out: (line: string) => void;
  err: (line: string) => void;
  // prints what was held, in the order it was written; a no-op when nothing is held
  flush: () => void;
}

const streamedOutput = (): ScenarioOutput => ({
  err: (line) => {
    console.error(line);
  },
  flush: () => {
    // every line is already out
  },
  out: (line) => {
    console.log(line);
  },
});

// what each held output whose scenario has not ended would print, so a run that dies first (a
// signal, a crash, a job's timeout) still shows the steps of every scenario it cut off
const unfinished = new Set<() => void>();

const heldOutput = (scenarioName: string): ScenarioOutput => {
  const held: { stream: "out" | "err"; line: string }[] = [];
  const print = (): void => {
    for (const { line, stream } of held.splice(0)) {
      if (stream === "out") {
        console.log(line);
      } else {
        console.error(line);
      }
    }
  };
  const interrupted = (): void => {
    console.error(`${timestamp()} [${scenarioName}] INTERRUPTED: what it had written so far`);
    print();
  };
  unfinished.add(interrupted);
  return {
    err: (line) => {
      held.push({ line, stream: "err" });
    },
    flush: () => {
      unfinished.delete(interrupted);
      print();
    },
    out: (line) => {
      held.push({ line, stream: "out" });
    },
  };
};

// `exit` runs on process.exit and on an uncaught throw or rejection alike, and writes to a pipe or
// a file are synchronous there, so the lines land before the process ends
const printUnfinished = (): void => {
  for (const interrupted of unfinished) {
    interrupted();
  }
  unfinished.clear();
};

// the losing run is abandoned, not cancelled: the teardown after it kills the processes it awaits,
// which settles it, and the race has already taken its rejection. Time the scenario's build spends
// queued behind another lane's moves its deadline out by as much: the budget is for its own work.
const runWithinDeadline = async (scenario: Scenario, context: ScenarioContext): Promise<void> => {
  const timeoutMs = scenario.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS;
  const startedAt = Date.now();
  let queuedMs = 0;
  const deadline = new AbortController();
  const expire = async (): Promise<never> => {
    for (let left = timeoutMs; left > 0; left = startedAt + timeoutMs + queuedMs - Date.now()) {
      await delay(left, undefined, { signal: deadline.signal });
    }
    const queued = queuedMs > 0 ? ` (and ${seconds(queuedMs)} queued behind other builds)` : "";
    throw new Error(`still running after ${seconds(timeoutMs)}${queued}: abandoned and torn down`);
  };
  const run = async (): Promise<void> => {
    await scenario.run(context);
  };
  try {
    await Promise.race([
      hearingBuildQueueWaits((waitedMs) => {
        queuedMs += waitedMs;
      }, run),
      expire(),
    ]);
  } finally {
    deadline.abort();
  }
};

// a skip reaches here only under --no-skip; every other one is an outcome of its own.
const describeFailure = (cause: unknown): string => {
  if (cause instanceof ScenarioSkipError) {
    return `SKIP not allowed under --no-skip: ${cause.message}`;
  }
  return cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
};

interface RunScenarioArgs {
  scenario: Scenario;
  options: CliOptions;
  repoRoot: string;
  scratchRoot: string;
  output: ScenarioOutput;
}

const runScenario = async ({
  options,
  output,
  repoRoot,
  scenario,
  scratchRoot,
}: RunScenarioArgs): Promise<ScenarioResult> => {
  const startedAt = Date.now();
  const scratchDir = path.join(scratchRoot, scenario.name);
  await mkdir(scratchDir, { recursive: true });
  const instances: TrackedProcess[] = [];
  let closed = false;
  const log = (message: string) => {
    output.out(`${timestamp()} [${scenario.name}] ${message}`);
  };
  const { afterRun, context } = openScenario({
    instances,
    isClosed: () => closed,
    log,
    repoRoot,
    scenarioName: scenario.name,
    scratchDir,
  });

  let outcome: ScenarioOutcome;
  let teardownClean = true;
  try {
    await runWithinDeadline(scenario, context);
    await afterRun();
    outcome = { durationMs: Date.now() - startedAt, kind: "pass" };
  } catch (error) {
    if (error instanceof ScenarioSkipError && !options.noSkip) {
      outcome = { durationMs: Date.now() - startedAt, kind: "skip", reason: error.message };
    } else {
      const message = describeFailure(error);
      const tails = instances
        .map((instance) => {
          const tail = instance.outputTail();
          return tail.length === 0
            ? ""
            : `--- instance "${instance.name}" output tail ---\n${tail}`;
        })
        .filter((tail) => tail.length > 0)
        .join("\n");
      outcome = {
        durationMs: Date.now() - startedAt,
        error: tails.length === 0 ? message : `${message}\n${tails}`,
        kind: "fail",
      };
    }
  } finally {
    closed = true;
    for (const instance of instances.toReversed()) {
      try {
        await instance.stop();
      } catch (error) {
        teardownClean = false;
        output.err(
          `${timestamp()} [${scenario.name}] teardown: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    // an undead process could still be writing into the scratch.
    if (!teardownClean) {
      output.err(`${timestamp()} [${scenario.name}] scratch kept at ${scratchDir}`);
    } else if (!options.keep) {
      try {
        await rm(scratchDir, { force: true, recursive: true });
      } catch (error) {
        output.err(
          `${timestamp()} [${scenario.name}] could not remove scratch ${scratchDir}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return { outcome, teardownClean };
};

// the scenario's header, its run and its verdict, through its own output
const runAndReport = async (args: Omit<RunScenarioArgs, "output">): Promise<ScenarioResult> => {
  const { options, scenario } = args;
  const output = options.lanes === 1 ? streamedOutput() : heldOutput(scenario.name);
  if (options.lanes > 1) {
    console.log(`${timestamp()} [${scenario.name}] started`);
  }
  output.out(`\n${timestamp()} ── ${scenario.name}: ${scenario.description}`);
  let result: ScenarioResult;
  try {
    result = await runScenario({ ...args, output });
  } catch (error) {
    // only the scratch dir's own mkdir runs outside the scenario's catch
    result = {
      outcome: { durationMs: 0, error: describeFailure(error), kind: "fail" },
      teardownClean: true,
    };
  }
  const { outcome } = result;
  if (outcome.kind === "pass") {
    output.out(`${timestamp()} [${scenario.name}] PASS (${seconds(outcome.durationMs)})`);
  } else if (outcome.kind === "skip") {
    output.out(`${timestamp()} [${scenario.name}] SKIP — ${outcome.reason}`);
  } else {
    output.err(`${timestamp()} [${scenario.name}] FAIL (${seconds(outcome.durationMs)})`);
    output.err(outcome.error);
  }
  output.flush();
  return result;
};

// up to `lanes` scenarios at once, each started in registry order once a lane is free
const runInLanes = async (
  selected: readonly Scenario[],
  lanes: number,
  run: (scenario: Scenario) => Promise<void>,
): Promise<void> => {
  const waiting = [...selected];
  const running = new Map<Scenario, Promise<Scenario>>();
  const settle = async (scenario: Scenario): Promise<Scenario> => {
    await run(scenario);
    return scenario;
  };
  const startWhatFits = (): void => {
    while (running.size < lanes) {
      const next = waiting.shift();
      if (next === undefined) {
        return;
      }
      running.set(next, settle(next));
    }
  };
  startWhatFits();
  while (running.size > 0) {
    const done = await Promise.race(running.values());
    running.delete(done);
    startWhatFits();
  }
};

// SIGKILL of the runner itself cannot be trapped; those orphans are accepted (scratch is per-run
// under tmpdir).
const installSignalCleanup = (): void => {
  process.on("exit", printUnfinished);
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, () => {
      killAllLiveGroups("SIGKILL");
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
};

// the extension's dev build, which the browser-extension scenarios load from its .output/chrome-mv3:
// built through turbo, not looked for on disk, since a present output may be last week's
const buildExtension = async (repoRoot: string): Promise<void> => {
  const startedAt = Date.now();
  console.log(`${timestamp()} building the browser extension`);
  try {
    await exec(
      "pnpm",
      ["turbo", "run", "build", "--filter=@repo/extension", "--output-logs=errors-only"],
      { cwd: repoRoot, env: buildProcessEnv(), timeoutMs: EXTENSION_BUILD_TIMEOUT_MS },
    );
  } catch (error) {
    throw new Error(`the suite-start build failed:\n${describeExecError(error)}`, { cause: error });
  }
  console.log(`${timestamp()} built (${seconds(Date.now() - startedAt)})`);
};

const main = async (): Promise<number> => {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.list) {
    for (const scenario of SCENARIOS) {
      console.log(`${scenario.name}  —  ${scenario.description}`);
    }
    return 0;
  }
  installSignalCleanup();
  const selected = selectScenarios(options);
  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  await buildExtension(repoRoot);
  const scratchRoot = await mkdtemp(path.join(tmpdir(), "inteligir-e2e-"));
  const lanes = Math.min(options.lanes, Math.max(1, selected.length));
  console.log(
    `e2e: ${selected.length} scenario(s) in ${String(lanes)} lane(s), scratch=${scratchRoot}`,
  );

  const outcomes = new Map<string, ScenarioOutcome>();
  let everyTeardownClean = true;
  await runInLanes(selected, lanes, async (scenario) => {
    const { outcome, teardownClean } = await runAndReport({
      options: { ...options, lanes },
      repoRoot,
      scenario,
      scratchRoot,
    });
    everyTeardownClean &&= teardownClean;
    outcomes.set(scenario.name, outcome);
  });

  if (options.keep || !everyTeardownClean) {
    console.log(`\nscratch kept at ${scratchRoot}`);
  } else {
    try {
      await rm(scratchRoot, { force: true, recursive: true });
    } catch (error) {
      console.error(
        `could not remove scratch root ${scratchRoot}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log("\n── e2e summary ──");
  let failed = 0;
  for (const scenario of selected) {
    const outcome = outcomes.get(scenario.name);
    if (outcome === undefined) {
      continue;
    }
    if (outcome.kind === "pass") {
      console.log(` PASS  ${scenario.name} (${seconds(outcome.durationMs)})`);
    } else if (outcome.kind === "skip") {
      console.log(` SKIP  ${scenario.name} — ${outcome.reason.split("\n")[0] ?? ""}`);
    } else {
      failed += 1;
      console.log(` FAIL  ${scenario.name} (${seconds(outcome.durationMs)})`);
    }
  }
  if (!everyTeardownClean) {
    console.log(" FAIL  (teardown) — a process group survived SIGKILL; see the log above");
  }
  return failed === 0 && everyTeardownClean ? 0 : 1;
};

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
// a run abandoned at its deadline can still hold a timer or spawn a child after its teardown, and
// either keeps the loop alive, so the job would hang past its own summary.
killAllLiveGroups("SIGKILL");
process.exit(process.exitCode);
