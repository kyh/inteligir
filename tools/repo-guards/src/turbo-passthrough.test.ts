// turbo runs in strict env mode: a variable a task does not name is stripped before the process
// starts, with no error on either side. the scope is derived (every workspace whose shipped source
// reaches resolveAppConfig), and a task reads the config when it is persistent or already names a
// variable. a workspace that reads the config through a path turbo never runs is invisible here.

import fs from "node:fs";
import path from "node:path";
import { ENV_VAR_NAMES } from "inteligir/server/config";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { REPO_ROOT, sourceOf, workspaceFiles, workspaces, type Workspace } from "./repo";

const CONFIG_READER = "resolveAppConfig";

// reads the config but runs through no turbo task, with the path that starts it; drains when one
// gains a turbo.json.
const RUNS_OUTSIDE_TURBO = new Map<string, string>([]);

interface TurboTask {
  name: string;
  persistent: boolean;
  // absent is not empty: a task with no list declares nothing at all.
  passThroughEnv: string[] | null;
}

const turboConfigSchema = z.looseObject({ tasks: z.record(z.string(), z.unknown()) });
const turboTaskSchema = z.looseObject({
  persistent: z.literal(true).optional().catch(undefined),
  passThroughEnv: z.array(z.string()).optional(),
});

// turbo.json is JSONC; sourceOf drops full-line comments, which is every comment this repo's turbo
// configs use.
function turboTasks(configPath: string): TurboTask[] {
  const parsed = turboConfigSchema.safeParse(JSON.parse(sourceOf(configPath)));
  if (!parsed.success) throw new Error(`${configPath}: expected an object at "tasks"`);
  return Object.entries(parsed.data.tasks).map(([name, body]) => {
    const task = turboTaskSchema.safeParse(body);
    if (!task.success) {
      throw new Error(
        `${configPath}: tasks.${name} must be an object whose passThroughEnv is an array of strings`,
      );
    }
    return {
      name,
      persistent: task.data.persistent === true,
      passThroughEnv: task.data.passThroughEnv ?? null,
    };
  });
}

function configConsumers(): Workspace[] {
  const reader = new RegExp(`\\b${CONFIG_READER}\\b`);
  return workspaces().filter((workspace) =>
    workspaceFiles(workspace).shipped.some((file) => reader.test(sourceOf(file))),
  );
}

function turboConfigOf(workspace: Workspace): string | null {
  const relative = `${workspace.dir}/turbo.json`;
  return fs.existsSync(path.join(REPO_ROOT, relative)) ? relative : null;
}

function readsTheConfig(task: TurboTask): boolean {
  return (
    task.persistent || (task.passThroughEnv ?? []).some((name) => ENV_VAR_NAMES.includes(name))
  );
}

describe("turbo passes through the whole environment contract", () => {
  const consumers = configConsumers();
  const declared = [...ENV_VAR_NAMES].toSorted();

  it("finds the readers and the table it holds them against", () => {
    expect(
      consumers.map((workspace) => workspace.name),
      `no workspace's shipped source calls ${CONFIG_READER}() — the sweep is broken, not the tree`,
    ).toContain("inteligir");
    expect(ENV_VAR_NAMES).toContain("INTELIGIR_AGENT");
  });

  it("every task that runs the config names exactly the declared variables", () => {
    const violations: string[] = [];
    for (const workspace of consumers) {
      const config = turboConfigOf(workspace);
      if (config === null) continue;
      for (const task of turboTasks(config)) {
        if (!readsTheConfig(task)) continue;
        const passedThrough = (task.passThroughEnv ?? []).toSorted();
        for (const name of declared.filter((each) => !passedThrough.includes(each))) {
          violations.push(
            `STRIPPED ENV VAR  ${name}\n` +
              `  rule: turbo runs in strict env mode — a variable apps/cli/src/server/config.ts declares and this task does not name is dropped before the process starts, silently\n` +
              `  at ${config} tasks.${task.name}.passThroughEnv (${workspace.name} calls ${CONFIG_READER}())\n` +
              `  fix: add "${name}" there`,
          );
        }
        for (const name of passedThrough.filter((each) => !declared.includes(each))) {
          violations.push(
            `UNDECLARED ENV VAR  ${name}\n` +
              `  rule: passThroughEnv states what the process READS; nothing in apps/cli/src/server/config.ts declares this one\n` +
              `  at ${config} tasks.${task.name}.passThroughEnv\n` +
              `  fix: remove it, or declare it in that module's ENV_VARS`,
          );
        }
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every config reader is either checked here or declared to run outside turbo", () => {
    const violations: string[] = [];
    for (const workspace of consumers) {
      if (turboConfigOf(workspace) !== null) continue;
      if (RUNS_OUTSIDE_TURBO.has(workspace.name)) continue;
      violations.push(
        `UNCHECKED CONFIG READER  ${workspace.name}\n` +
          `  rule: a workspace calling ${CONFIG_READER}() has an environment contract, and this one has no turbo.json for it to be held against\n` +
          `  fix: add ${workspace.dir}/turbo.json declaring the task that runs it, or add a row to RUNS_OUTSIDE_TURBO naming the path that actually starts it`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("no entry in RUNS_OUTSIDE_TURBO is stale", () => {
    const stale: string[] = [];
    for (const [name, why] of RUNS_OUTSIDE_TURBO) {
      const workspace = consumers.find((candidate) => candidate.name === name);
      if (workspace === undefined) {
        stale.push(
          `STALE EXCEPTION  ${name} no longer calls ${CONFIG_READER}()\n` +
            `  fix: delete the entry from RUNS_OUTSIDE_TURBO`,
        );
        continue;
      }
      if (turboConfigOf(workspace) !== null) {
        stale.push(
          `STALE EXCEPTION  ${name} now HAS a turbo.json\n` +
            `  the reason it named ("${why}") no longer holds\n` +
            `  fix: delete the entry and declare the variables on the task that runs the process`,
        );
      }
    }
    expect(stale, `\n${stale.join("\n\n")}\n`).toEqual([]);
  });
});
