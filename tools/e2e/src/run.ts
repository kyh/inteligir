import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { buildProcessEnv, describeExecError, exec } from "./harness/exec";
import { ScenarioSkipError } from "./harness/scenario-skip-error";
import { killAllLiveGroups } from "./harness/tracked-child";
import type { TrackedProcess } from "./harness/tracked-child";
import { createScenarioContext } from "./harness/scenario";
import type { Scenario, ScenarioContext } from "./harness/scenario";
import { accountHosted } from "./scenarios/account-hosted";
import { actionScripted } from "./scenarios/action-scripted";
import { agentSignInBrowser } from "./scenarios/agent-sign-in-browser";
import { browserSmoke } from "./scenarios/browser-smoke";
import { builtCliBoot } from "./scenarios/built-cli-boot";
import { builtWorkerBoot } from "./scenarios/built-worker-boot";
import { cliDrive } from "./scenarios/cli-drive";
import { debugLogTrace } from "./scenarios/debug-log";
import { desktopDiagnostics } from "./scenarios/desktop-diagnostics";
import { desktopOnboarding } from "./scenarios/desktop-onboarding";
import { desktopShell } from "./scenarios/desktop-shell";
import { editorConstructsBrowser } from "./scenarios/editor-constructs-browser";
import { externalEditBrowser } from "./scenarios/external-edit-browser";
import { extractNoteBrowser } from "./scenarios/extract-note-browser";
import { hostedVaultPhoneWrite } from "./scenarios/hosted-vault-phone-write";
import { hostedVaultSecondMac } from "./scenarios/hosted-vault-second-mac";
import { hostedVaultSync } from "./scenarios/hosted-vault-sync";
import { noteCreateBrowser } from "./scenarios/note-create-browser";
import { onboardingAccountBrowser } from "./scenarios/onboarding-account-browser";
import { phoneDispatchHosted } from "./scenarios/phone-dispatch-hosted";
import { phoneEditorPage } from "./scenarios/phone-editor-page";
import { phoneFileOpsHosted } from "./scenarios/phone-file-ops-hosted";
import { phoneOfflineEdit } from "./scenarios/phone-offline-edit";
import { remoteContentBrowser } from "./scenarios/remote-content-browser";
import { settingsBrowser } from "./scenarios/settings-browser";
import { slashMenuBrowser } from "./scenarios/slash-menu-browser";
import { slowStorage } from "./scenarios/slow-storage";
import { threadSyncHosted } from "./scenarios/thread-sync-hosted";
import { threadsScripted } from "./scenarios/threads-scripted";
import { treeOpsBrowser } from "./scenarios/tree-ops-browser";
import { undoBrowser } from "./scenarios/undo-browser";
import { undoScripted } from "./scenarios/undo-scripted";
import { vaultCrud } from "./scenarios/vault-crud";
import { vaultSearchBrowser } from "./scenarios/vault-search-browser";
import { vaultRemoteSetting } from "./scenarios/vault-remote-setting";
import { vaultSync } from "./scenarios/vault-sync";
import { viewContextBrowser } from "./scenarios/view-context-browser";

const SCENARIOS: readonly Scenario[] = [
  vaultCrud,
  slowStorage,
  vaultSync,
  vaultRemoteSetting,
  hostedVaultSync,
  hostedVaultSecondMac,
  hostedVaultPhoneWrite,
  phoneOfflineEdit,
  phoneFileOpsHosted,
  phoneEditorPage,
  threadSyncHosted,
  phoneDispatchHosted,
  accountHosted,
  onboardingAccountBrowser,
  builtWorkerBoot,
  builtCliBoot,
  desktopShell,
  desktopDiagnostics,
  desktopOnboarding,
  threadsScripted,
  actionScripted,
  undoScripted,
  cliDrive,
  debugLogTrace,
  browserSmoke,
  noteCreateBrowser,
  editorConstructsBrowser,
  slashMenuBrowser,
  externalEditBrowser,
  viewContextBrowser,
  undoBrowser,
  settingsBrowser,
  agentSignInBrowser,
  vaultSearchBrowser,
  treeOpsBrowser,
  extractNoteBrowser,
  remoteContentBrowser,
];

const USAGE = `Usage: pnpm e2e [--only <names>] [--keep] [--list] [--no-skip]

  --only <names>  comma-separated scenario names (repeatable)
  --keep          keep the scratch dirs for post-mortem
  --list          print the scenario names and exit
  --no-skip       every SKIP FAILS; for a run whose environment was provisioned, browser and
                  display, so a skip is a broken setup
`;

// a hang backstop, far above any scenario's green run: they pass in seconds.
const DEFAULT_SCENARIO_TIMEOUT_MS = 180_000;
// a cold build runs the desktop renderer's vite build before the CLI bundles it.
const CLI_BUILD_TIMEOUT_MS = 300_000;

interface CliOptions {
  only: string[];
  keep: boolean;
  list: boolean;
  noSkip: boolean;
}

const parseArgs = (argv: readonly string[]): CliOptions => {
  const options: CliOptions = { keep: false, list: false, noSkip: false, only: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--keep") {
      options.keep = true;
    } else if (arg === "--no-skip") {
      options.noSkip = true;
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--only") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`--only needs a value\n${USAGE}`);
      }
      options.only.push(...value.split(",").map((name) => name.trim()));
      index += 1;
    } else {
      throw new Error(`unknown argument "${arg ?? ""}"\n${USAGE}`);
    }
  }
  return options;
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

const seconds = (durationMs: number): string => `${(durationMs / 1000).toFixed(1)}s`;

const timestamp = (): string => new Date().toISOString().slice(11, 19);

// the losing run is abandoned, not cancelled: the teardown after it kills the processes it awaits,
// which settles it, and the race has already taken its rejection.
const runWithinDeadline = async (scenario: Scenario, context: ScenarioContext): Promise<void> => {
  const timeoutMs = scenario.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS;
  const deadline = new AbortController();
  const expire = async (): Promise<never> => {
    await delay(timeoutMs, undefined, { signal: deadline.signal });
    throw new Error(`still running after ${seconds(timeoutMs)}: abandoned and torn down`);
  };
  try {
    await Promise.race([scenario.run(context), expire()]);
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

const runScenario = async (
  scenario: Scenario,
  options: CliOptions,
  repoRoot: string,
  scratchRoot: string,
): Promise<{ outcome: ScenarioOutcome; teardownClean: boolean }> => {
  const startedAt = Date.now();
  const scratchDir = path.join(scratchRoot, scenario.name);
  await mkdir(scratchDir, { recursive: true });
  const instances: TrackedProcess[] = [];
  let closed = false;
  const log = (message: string) => {
    console.log(`${timestamp()} [${scenario.name}] ${message}`);
  };
  const context = createScenarioContext({
    instances,
    isClosed: () => closed,
    log,
    repoRoot,
    scratchDir,
  });

  let outcome: ScenarioOutcome;
  let teardownClean = true;
  try {
    await runWithinDeadline(scenario, context);
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
        console.error(
          `${timestamp()} [${scenario.name}] teardown: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    // an undead process could still be writing into the scratch.
    if (!teardownClean) {
      console.error(`${timestamp()} [${scenario.name}] scratch kept at ${scratchDir}`);
    } else if (!options.keep) {
      try {
        await rm(scratchDir, { force: true, recursive: true });
      } catch (error) {
        console.error(
          `${timestamp()} [${scenario.name}] could not remove scratch ${scratchDir}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return { outcome, teardownClean };
};

// SIGKILL of the runner itself cannot be trapped; those orphans are accepted (scratch is per-run
// under tmpdir).
const installSignalCleanup = (): void => {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, () => {
      killAllLiveGroups("SIGKILL");
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
};

// built through turbo, not looked for on disk: a present dist/ may be last week's server and UI.
const buildCli = async (repoRoot: string): Promise<void> => {
  const startedAt = Date.now();
  console.log(`${timestamp()} building the CLI bundle and the workspace UI it stages`);
  try {
    await exec(
      "pnpm",
      ["turbo", "run", "build", "--filter=inteligir", "--output-logs=errors-only"],
      { cwd: repoRoot, env: buildProcessEnv(), timeoutMs: CLI_BUILD_TIMEOUT_MS },
    );
  } catch (error) {
    throw new Error(`the suite-start build failed:\n${describeExecError(error)}`, { cause: error });
  }
  console.log(`${timestamp()} built (${seconds(Date.now() - startedAt)})`);
};

const main = async (): Promise<number> => {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    for (const scenario of SCENARIOS) {
      console.log(`${scenario.name}  —  ${scenario.description}`);
    }
    return 0;
  }
  installSignalCleanup();
  const selected = selectScenarios(options);
  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  await buildCli(repoRoot);
  const scratchRoot = await mkdtemp(path.join(tmpdir(), "inteligir-e2e-"));
  console.log(`e2e: ${selected.length} scenario(s), scratch=${scratchRoot}`);

  const outcomes = new Map<string, ScenarioOutcome>();
  let everyTeardownClean = true;
  for (const scenario of selected) {
    console.log(`\n${timestamp()} ── ${scenario.name}: ${scenario.description}`);
    const { outcome, teardownClean } = await runScenario(scenario, options, repoRoot, scratchRoot);
    everyTeardownClean &&= teardownClean;
    outcomes.set(scenario.name, outcome);
    if (outcome.kind === "pass") {
      console.log(`${timestamp()} [${scenario.name}] PASS (${seconds(outcome.durationMs)})`);
    } else if (outcome.kind === "skip") {
      console.log(`${timestamp()} [${scenario.name}] SKIP — ${outcome.reason}`);
    } else {
      console.error(`${timestamp()} [${scenario.name}] FAIL (${seconds(outcome.durationMs)})`);
      console.error(outcome.error);
    }
  }

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
