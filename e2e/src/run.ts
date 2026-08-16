// The e2e runner: boots real app instances on scratch dirs, runs each
// scenario in order, tears everything down, and exits non-zero on any
// failure with a readable transcript. Deliberately NOT a test framework —
// the value here is orchestration (processes, ports, git remotes, a
// browser) plus plain assertions; see e2e/README.md.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ScenarioSkip } from "./harness/assert";
import type { BootMode } from "./harness/instance";
import type { AppInstance } from "./harness/instance";
import { createScenarioContext, type Scenario } from "./harness/scenario";
import { browserSmoke } from "./scenarios/browser-smoke";
import { threadsScripted } from "./scenarios/threads-scripted";
import { vaultCrud } from "./scenarios/vault-crud";
import { vaultSync } from "./scenarios/vault-sync";

const SCENARIOS: readonly Scenario[] = [vaultCrud, vaultSync, threadsScripted, browserSmoke];

const USAGE = `Usage: pnpm e2e [--prod] [--only <names>] [--keep] [--list]

  --prod          run the built bundle (pnpm --filter @repo/app build first)
                  instead of the dev entry
  --only <names>  comma-separated scenario names (repeatable)
  --keep          keep the scratch dirs for post-mortem
  --list          print the scenario names and exit
`;

interface CliOptions {
  mode: BootMode;
  only: string[];
  keep: boolean;
  list: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { mode: "dev", only: [], keep: false, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--prod") {
      options.mode = "prod";
    } else if (arg === "--keep") {
      options.keep = true;
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
}

function selectScenarios(options: CliOptions): readonly Scenario[] {
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
}

type ScenarioOutcome =
  | { kind: "pass"; durationMs: number }
  | { kind: "skip"; durationMs: number; reason: string }
  | { kind: "fail"; durationMs: number; error: string };

function seconds(durationMs: number): string {
  return `${(durationMs / 1_000).toFixed(1)}s`;
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

async function runScenario(
  scenario: Scenario,
  options: CliOptions,
  repoRoot: string,
  scratchRoot: string,
): Promise<ScenarioOutcome> {
  const startedAt = Date.now();
  const scratchDir = join(scratchRoot, scenario.name);
  await mkdir(scratchDir, { recursive: true });
  const instances: AppInstance[] = [];
  const log = (message: string) => {
    console.log(`${timestamp()} [${scenario.name}] ${message}`);
  };
  const context = createScenarioContext({
    mode: options.mode,
    repoRoot,
    scratchDir,
    log,
    instances,
  });

  let outcome: ScenarioOutcome;
  try {
    await scenario.run(context);
    outcome = { kind: "pass", durationMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof ScenarioSkip) {
      outcome = { kind: "skip", durationMs: Date.now() - startedAt, reason: error.message };
    } else {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
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
        kind: "fail",
        durationMs: Date.now() - startedAt,
        error: tails.length === 0 ? message : `${message}\n${tails}`,
      };
    }
  } finally {
    for (const instance of instances.toReversed()) {
      await instance.stop();
    }
    if (!options.keep) {
      await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return outcome;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    for (const scenario of SCENARIOS) {
      console.log(`${scenario.name}  —  ${scenario.description}`);
    }
    return 0;
  }
  const selected = selectScenarios(options);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const scratchRoot = await mkdtemp(join(tmpdir(), "inteligir-e2e-"));
  console.log(`e2e: ${selected.length} scenario(s), mode=${options.mode}, scratch=${scratchRoot}`);

  const outcomes = new Map<string, ScenarioOutcome>();
  for (const scenario of selected) {
    console.log(`\n${timestamp()} ── ${scenario.name}: ${scenario.description}`);
    const outcome = await runScenario(scenario, options, repoRoot, scratchRoot);
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

  if (options.keep) {
    console.log(`\nscratch kept at ${scratchRoot}`);
  } else {
    await rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined);
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
  return failed === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
