// turbo hashes another workspace's files into a task's cache key only through a `^` edge. a task
// whose dependsOn carries none hashes its own directory alone, so an edit confined to a package it
// bundles is a cache hit that replays the stale output, and nothing errors. `^topo` is the edge for
// a task that cannot take `^<itself>` without a cycle: it runs no script and puts every
// dependency's files in the key.
//
// every task is read from turbo's own dry run, so the layering of the root's config, a
// workspace's override and `$TURBO_EXTENDS$` is turbo's resolution rather than a copy of it.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  REPO_ROOT,
  importsOf,
  manifestWorkspaceDeps,
  turboTaskBodies,
  workspaceFiles,
  workspaceTurboConfig,
  workspaces,
} from "./repo";
import type { Workspace } from "./repo";

const ROOT_CONFIG = "turbo.json";

// `//#<task>` is the root package's own, run by no workspace this guard judges.
const ROOT_PACKAGE_TASK = "//#";

// turbo's `command` for a package with no script of the task's name.
const NO_SCRIPT = "<NONEXISTENT>";

const dryRunSchema = z.looseObject({
  tasks: z.array(
    z.looseObject({
      command: z.string(),
      // every file hashed into the key, relative to the package's directory.
      inputs: z.record(z.string(), z.string()),
      package: z.string(),
      resolvedTaskDefinition: z.looseObject({
        cache: z.boolean(),
        dependsOn: z.array(z.string()),
      }),
      task: z.string(),
      taskId: z.string(),
    }),
  ),
});
type DryRunTask = z.infer<typeof dryRunSchema>["tasks"][number];

const taskNames = (): string[] => {
  const configs = [
    ROOT_CONFIG,
    ...workspaces().flatMap((workspace) => workspaceTurboConfig(workspace) ?? []),
  ];
  const names = new Set<string>();
  for (const config of configs) {
    for (const key of turboTaskBodies(config).keys()) {
      if (!key.startsWith(ROOT_PACKAGE_TASK)) {
        names.add(key.slice(key.indexOf("#") + 1));
      }
    }
  }
  return [...names].toSorted();
};

let cachedDryRun: DryRunTask[] | undefined;

// the binary itself: pnpm prints a banner on stdout ahead of the JSON.
const dryRun = (): DryRunTask[] => {
  if (cachedDryRun !== undefined) {
    return cachedDryRun;
  }
  const args = ["run", ...taskNames(), "--dry=json"];
  const output = execFileSync(path.join(REPO_ROOT, "node_modules/.bin/turbo"), args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = dryRunSchema.safeParse(JSON.parse(output));
  if (!parsed.success) {
    throw new Error(
      `turbo ${args.join(" ")}: expected a "tasks" list with each task's command, hashed inputs and resolved cache and dependsOn`,
    );
  }
  cachedDryRun = parsed.data.tasks.filter((task) => task.command !== NO_SCRIPT);
  return cachedDryRun;
};

const workspaceNamed = (name: string): Workspace | undefined =>
  workspaces().find((workspace) => workspace.name === name);

const ownDependsOnSchema = z.looseObject({ dependsOn: z.array(z.string()).optional() });

// a workspace's turbo.json spells the list only where its own task declares one: an override of
// just inputs or outputs inherits the root's dependsOn, and the fix lands there.
const dependsOnConfig = (workspace: Workspace, task: string): string => {
  const config = workspaceTurboConfig(workspace);
  if (config === null) {
    return ROOT_CONFIG;
  }
  const own = ownDependsOnSchema.optional().safeParse(turboTaskBodies(config).get(task));
  if (!own.success) {
    throw new Error(
      `${config}: tasks.${task} must be an object whose dependsOn is an array of strings`,
    );
  }
  return own.data?.dependsOn === undefined ? ROOT_CONFIG : config;
};

interface JudgedTask {
  task: DryRunTask;
  workspace: Workspace;
  dependencies: string[];
}

const cachedTasks = (): JudgedTask[] =>
  dryRun().flatMap((task) => {
    const workspace = workspaceNamed(task.package);
    if (workspace === undefined || !task.resolvedTaskDefinition.cache) {
      return [];
    }
    const dependencies = [...manifestWorkspaceDeps(workspace.manifest)].toSorted();
    return dependencies.length === 0 ? [] : [{ dependencies, task, workspace }];
  });

describe("every cached turbo task hashes the workspaces it depends on", () => {
  const judged = cachedTasks();

  it("finds the tasks it judges", () => {
    expect(
      judged.map((each) => each.task.taskId),
      "the workspace build inlines the editor and the ui — the sweep is broken, not the tree",
    ).toContain("@repo/workspace#build");
  });

  it("every cached task with workspace dependencies carries a ^ edge", () => {
    const violations: string[] = [];
    for (const { dependencies, task, workspace } of judged) {
      const { dependsOn } = task.resolvedTaskDefinition;
      if (dependsOn.some((each) => each.startsWith("^"))) {
        continue;
      }
      violations.push(
        `UNHASHED DEPENDENCIES  ${task.taskId}\n` +
          `  rule: turbo puts another workspace's files in a task's cache key only through a "^" edge — without one, an edit confined to ${dependencies.join(", ")} is a cache hit that replays stale output\n` +
          `  at ${dependsOnConfig(workspace, task.task)} tasks.${task.task}.dependsOn (resolved: ${JSON.stringify(dependsOn)})\n` +
          `  fix: add "^${task.task}", or "^topo" where that would be a cycle`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });
});

// a file in no workspace is hashed by no task until one names it, so a build that bundles it
// through a relative import replays its stale output after an edit to that file alone.

// turbo's microsyntax for the repo root inside an input glob.
const TURBO_ROOT = "$TURBO_ROOT$/";

interface StrayImport {
  build: DryRunTask;
  workspace: Workspace;
  file: string;
  // repo-relative, its query dropped.
  target: string;
}

const strayImports = (): StrayImport[] => {
  const dirs = workspaces().map((workspace) => workspace.dir);
  const found: StrayImport[] = [];
  for (const workspace of workspaces()) {
    const build = dryRun().find((task) => task.package === workspace.name && task.task === "build");
    if (build === undefined) {
      continue;
    }
    for (const file of workspaceFiles(workspace).shipped) {
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith(".")) {
          continue;
        }
        const [bare = specifier] = specifier.split("?");
        const target = path.join(path.dirname(file), bare);
        if (dirs.some((dir) => target === dir || target.startsWith(`${dir}/`))) {
          continue;
        }
        found.push({ build, file, target, workspace });
      }
    }
  }
  return found;
};

describe("a bundled file outside every workspace is a named build input", () => {
  const judged = strayImports();

  it("finds the imports it judges", () => {
    expect(
      judged.map((stray) => stray.target),
      "apps/web's /privacy bundles docs/privacy.md — the sweep is broken, not the tree",
    ).toContain(path.join("docs", "privacy.md"));
  });

  it("every one is named in its workspace's build inputs", () => {
    const violations: string[] = [];
    for (const stray of judged) {
      if (path.relative(stray.workspace.dir, stray.target) in stray.build.inputs) {
        continue;
      }
      violations.push(
        `UNHASHED INPUT  ${stray.target}, imported by ${stray.file}\n` +
          `  rule: turbo hashes a file in no workspace only where a task names it — without that, an edit to it alone is a cache hit that replays the stale ${stray.workspace.name} build\n` +
          `  fix: add "${TURBO_ROOT}${stray.target}" to tasks.build.inputs in ${stray.workspace.dir}/turbo.json, beside "$TURBO_DEFAULT$"`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });
});
