// turbo hashes another workspace's files into a task's cache key only through a `^` edge. a task
// whose dependsOn carries none hashes its own directory alone, so an edit confined to a package it
// bundles is a cache hit that replays the stale output, and nothing errors. `^topo` is the edge for
// a task that cannot take `^<itself>` without a cycle: it runs no script and puts every
// dependency's files in the key.

import fs from "node:fs";
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

// turbo's microsyntax for "the root's list, then these" inside a workspace's override.
const EXTENDS_ROOT = "$TURBO_EXTENDS$";

// `<workspace>#<task>` → why its output reads none of its dependencies; drains when the task gains
// a `^` edge or stops being a cached task.
const WITHOUT_DEPENDENCY_EDGE = new Map<string, string>();

const turboTaskSchema = z.looseObject({
  cache: z.boolean().optional(),
  dependsOn: z.array(z.string()).optional(),
  inputs: z.array(z.string()).optional(),
});
type TurboTask = z.infer<typeof turboTaskSchema>;

const scriptsSchema = z.looseObject({ scripts: z.record(z.string(), z.string()).optional() });

const turboTasks = (configPath: string): Map<string, TurboTask> => {
  const tasks = new Map<string, TurboTask>();
  for (const [name, body] of turboTaskBodies(configPath)) {
    const task = turboTaskSchema.safeParse(body);
    if (!task.success) {
      throw new Error(
        `${configPath}: tasks.${name} must be an object whose dependsOn and inputs are arrays of strings and whose cache is a boolean`,
      );
    }
    tasks.set(name, task.data);
  }
  return tasks;
};

const rootTasks = (): Map<string, TurboTask> => {
  const tasks = turboTasks(ROOT_CONFIG);
  for (const name of tasks.keys()) {
    if (name.includes("#")) {
      throw new Error(
        `${ROOT_CONFIG}: cannot read the package-scoped task "${name}".\n` +
          `  rule: tools/repo-guards/src/turbo-cache-keys.test.ts layers a workspace's own turbo.json over the root's unscoped tasks, and knows no third layer\n` +
          `  fix: move it to that workspace's turbo.json, or teach this guard the layer — skipping it would judge the task by the wrong dependsOn`,
      );
    }
  }
  return tasks;
};

const scriptsOf = (workspace: Workspace): Set<string> => {
  const relative = `${workspace.dir}/package.json`;
  const parsed = scriptsSchema.safeParse(
    JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8")),
  );
  if (!parsed.success) {
    throw new Error(`${relative}: "scripts" must map names to strings`);
  }
  return new Set(Object.keys(parsed.data.scripts ?? {}));
};

interface JudgedTask {
  // `<workspace>#<task>`, turbo's own spelling.
  id: string;
  task: string;
  dependsOn: string[];
  // where the list the judgement read is spelled.
  declaredIn: string;
  dependencies: string[];
}

// a workspace's override replaces the root's field whole, unless it spells EXTENDS_ROOT.
const effectiveList = (
  rootTask: TurboTask | undefined,
  ownTask: TurboTask | undefined,
  field: "dependsOn" | "inputs",
): string[] => {
  const rootList = rootTask?.[field] ?? [];
  const ownList = ownTask?.[field];
  if (ownList === undefined) {
    return rootList;
  }
  if (!ownList.includes(EXTENDS_ROOT)) {
    return ownList;
  }
  return [...rootList, ...ownList.filter((each) => each !== EXTENDS_ROOT)];
};

const cachedTasks = (): JudgedTask[] => {
  const root = rootTasks();
  const judged: JudgedTask[] = [];
  for (const workspace of workspaces()) {
    const dependencies = [...manifestWorkspaceDeps(workspace.manifest)].toSorted();
    if (dependencies.length === 0) {
      continue;
    }
    const ownConfig = workspaceTurboConfig(workspace);
    const own = ownConfig === null ? new Map<string, TurboTask>() : turboTasks(ownConfig);
    const scripts = scriptsOf(workspace);
    for (const name of new Set([...root.keys(), ...own.keys()])) {
      const rootTask = root.get(name);
      const ownTask = own.get(name);
      if (!scripts.has(name) || (ownTask?.cache ?? rootTask?.cache ?? true) === false) {
        continue;
      }
      judged.push({
        declaredIn:
          ownConfig !== null && ownTask?.dependsOn !== undefined ? ownConfig : ROOT_CONFIG,
        dependencies,
        dependsOn: effectiveList(rootTask, ownTask, "dependsOn"),
        id: `${workspace.name}#${name}`,
        task: name,
      });
    }
  }
  return judged;
};

const hashesDependencies = (task: JudgedTask): boolean =>
  task.dependsOn.some((each) => each.startsWith("^"));

describe("every cached turbo task hashes the workspaces it depends on", () => {
  const judged = cachedTasks();

  it("finds the tasks it judges", () => {
    expect(
      judged.map((task) => task.id),
      "the desktop build inlines the editor and the ui — the sweep is broken, not the tree",
    ).toContain("@repo/desktop#build");
  });

  it("every cached task with workspace dependencies carries a ^ edge", () => {
    const violations: string[] = [];
    for (const task of judged) {
      if (hashesDependencies(task) || WITHOUT_DEPENDENCY_EDGE.has(task.id)) {
        continue;
      }
      violations.push(
        `UNHASHED DEPENDENCIES  ${task.id}\n` +
          `  rule: turbo puts another workspace's files in a task's cache key only through a "^" edge — without one, an edit confined to ${task.dependencies.join(", ")} is a cache hit that replays stale output\n` +
          `  at ${task.declaredIn} tasks.${task.task}.dependsOn (${JSON.stringify(task.dependsOn)})\n` +
          `  fix: add "^${task.task}", or "^topo" where that would be a cycle — or a WITHOUT_DEPENDENCY_EDGE row saying why this output reads none of them`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("no entry in WITHOUT_DEPENDENCY_EDGE is stale", () => {
    const stale: string[] = [];
    for (const [id, why] of WITHOUT_DEPENDENCY_EDGE) {
      const task = judged.find((candidate) => candidate.id === id);
      if (task === undefined) {
        stale.push(
          `STALE EXCEPTION  ${id} is no longer a cached task with workspace dependencies\n` +
            `  fix: delete the entry from WITHOUT_DEPENDENCY_EDGE`,
        );
        continue;
      }
      if (hashesDependencies(task)) {
        stale.push(
          `STALE EXCEPTION  ${id} now carries a "^" edge\n` +
            `  the reason it named ("${why}") no longer excuses anything\n` +
            `  fix: delete the entry from WITHOUT_DEPENDENCY_EDGE`,
        );
      }
    }
    expect(stale, `\n${stale.join("\n\n")}\n`).toEqual([]);
  });
});

// a file in no workspace is hashed by no task until one names it, so a build that bundles it
// through a relative import replays its stale output after an edit to that file alone.

// turbo's microsyntax for the repo root inside an input glob.
const TURBO_ROOT = "$TURBO_ROOT$/";

interface StrayImport {
  workspace: Workspace;
  file: string;
  // repo-relative, its query dropped.
  target: string;
}

const buildInputs = (workspace: Workspace): string[] => {
  const ownConfig = workspaceTurboConfig(workspace);
  const own = ownConfig === null ? undefined : turboTasks(ownConfig).get("build");
  return effectiveList(rootTasks().get("build"), own, "inputs");
};

const namesInput = (inputs: readonly string[], target: string): boolean =>
  inputs.some((input) => {
    if (!input.startsWith(TURBO_ROOT)) {
      return false;
    }
    const glob = input.slice(TURBO_ROOT.length);
    return glob === target || (glob.endsWith("/**") && target.startsWith(glob.slice(0, -2)));
  });

const strayImports = (): StrayImport[] => {
  const dirs = workspaces().map((workspace) => workspace.dir);
  const found: StrayImport[] = [];
  for (const workspace of workspaces()) {
    if (!scriptsOf(workspace).has("build")) {
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
        found.push({ file, target, workspace });
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
      if (namesInput(buildInputs(stray.workspace), stray.target)) {
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
