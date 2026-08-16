// ---------------------------------------------------------------------------
// What the agent image's install layer is keyed on.
//
// `apps/web/container/Dockerfile` copies the workspace MANIFESTS, installs, and
// only then copies the sources — so a source edit re-bundles the daemon instead
// of re-resolving the workspace. The install is FILTERED to the daemon's own
// package, so what it resolves is the workspace root plus that package's
// workspace closure, not every member.
//
// Both halves are one line away from being undone, and neither failure names
// itself in a build log:
//
//   • A `COPY . .` above the install puts a full install on every deploy. It
//     still works; it just costs minutes.
//   • pnpm refuses NEITHER shape of a missing manifest, and both exit 0. A
//     `--filter` matching nothing installs nothing at all; a workspace
//     dependency whose manifest is absent installs as a dangling
//     `node_modules` symlink. Which step reads the gap first — the bundle, the
//     deploy, or the daemon on a wake — is left to luck, and none of them name
//     the COPY line that is missing.
//
// So the manifest list is DERIVED from the install line's own filter and diffed
// against the COPY lines, rather than trusted. Widening the filter widens what
// this demands; dropping it demands every member back.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const DOCKERFILE = path.join(REPO_ROOT, "apps/web/container/Dockerfile");

/** What the install reads besides the members' manifests. */
const WORKSPACE_ROOT_FILES = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"];

/** Members link to each other by the `workspace:` protocol and nothing else:
 * pnpm's `link-workspace-packages` is off by default, so a bare range resolves
 * from the registry even where a member declares that name. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

type Project = {
  name: string;
  /** Repo-relative path of the manifest, as a COPY source spells it. */
  manifest: string;
  /** Names of the workspace members this one links to. */
  workspaceDeps: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readProject(manifest: string): Project {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, manifest), "utf8"));
  if (!isRecord(parsed)) throw new Error(`${manifest} is not an object`);
  const { name } = parsed;
  if (typeof name !== "string") throw new Error(`${manifest} declares no name`);

  const workspaceDeps = DEPENDENCY_FIELDS.flatMap((field) => {
    const deps = parsed[field];
    if (!isRecord(deps)) return [];
    return Object.entries(deps)
      .filter(([, spec]) => typeof spec === "string" && spec.startsWith("workspace:"))
      .map(([dep]) => dep);
  });

  return { name, manifest, workspaceDeps };
}

/** Every project the install can see: the `packages:` globs expanded, plus the
 * workspace ROOT, which pnpm installs whatever a filter selects. The YAML is
 * read line-wise rather than parsed — this package has no YAML dependency, and
 * the block is a flat list of strings. */
function workspaceProjects(): Project[] {
  const lines = fs.readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8").split("\n");
  const start = lines.indexOf("packages:");
  if (start < 0) throw new Error("pnpm-workspace.yaml declares no `packages:` block");

  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const entry = /^\s+-\s+"?([^"\s]+)"?\s*$/.exec(line)?.[1];
    if (entry !== undefined) globs.push(entry);
  }
  return [
    "package.json",
    ...globs.flatMap((glob) => fs.globSync(`${glob}/package.json`, { cwd: REPO_ROOT })).toSorted(),
  ].map(readProject);
}

/** The projects a `pnpm install` with this filter resolves — the selected
 * package, the workspace root pnpm installs beside it whatever the filter says,
 * and the workspace closure of both. Only the selector shapes this Dockerfile
 * can use are understood, and anything else THROWS rather than being
 * approximated: a selector read as narrower than it is yields a smaller
 * manifest set, which is the silent gap this guard exists to catch. */
function resolvedBy(filter: string | undefined, projects: Project[]): Project[] {
  // No filter is the whole workspace — the shape this Dockerfile had before the
  // install was narrowed, and still the correct answer if it is widened back.
  if (filter === undefined) return projects;

  // `<name>...` selects the package and its dependencies; a bare `<name>`
  // selects only the package. The closure is walked either way, because pnpm
  // links a `workspace:` dependency in both cases and only the link's TARGET
  // decides whether that link dangles. Demanding a manifest the install merely
  // links to costs one COPY line; not demanding one is the failure above.
  const selector = filter.endsWith("...") ? filter.slice(0, -"...".length) : filter;
  const byName = new Map(projects.map((project) => [project.name, project]));
  const selected = byName.get(selector);
  if (selected === undefined) {
    throw new Error(
      `\`--filter ${filter}\` names no workspace package. This guard reads only\n` +
        "`<name>` and `<name>...` — teach it the new shape rather than leaving it\n" +
        "to resolve a narrower set than the install does.",
    );
  }

  const root = projects.filter((project) => project.manifest === "package.json");
  const queue = [selected, ...root];
  const seen = new Map<string, Project>();
  while (queue.length > 0) {
    const project = queue.pop();
    if (project === undefined || seen.has(project.name)) continue;
    seen.set(project.name, project);
    for (const dep of project.workspaceDeps) {
      const linked = byName.get(dep);
      if (linked !== undefined) queue.push(linked);
    }
  }
  return [...seen.values()];
}

type Dockerfile = {
  /** Sources of every `COPY` that runs before the install, in file order. */
  copiedBeforeInstall: string[];
  /** The `--filter` selector the install carries, if any. */
  installFilter: string | undefined;
  installLine: number;
  contextCopyLine: number;
};

function readDockerfile(): Dockerfile {
  const lines = fs.readFileSync(DOCKERFILE, "utf8").split("\n");
  // Instructions only: both of these are spelled out in the comments too, and a
  // guard that read those would pin the prose rather than the build.
  const instructions = lines.map((line) => (line.startsWith("#") ? "" : line));
  const installLine = instructions.findIndex((line) => /\bpnpm install\b/.test(line));
  const contextCopyLine = instructions.findIndex((line) => /^COPY \. \.$/.test(line));

  const copiedBeforeInstall = lines
    .slice(0, installLine === -1 ? lines.length : installLine)
    .filter((line) => /^COPY (?!--)/.test(line))
    // The last token is the destination; everything before it is a source.
    .flatMap((line) => line.slice("COPY ".length).trim().split(/\s+/).slice(0, -1));

  return {
    copiedBeforeInstall,
    installFilter: /--filter[= ]"?([^"\s]+)"?/.exec(instructions[installLine] ?? "")?.[1],
    installLine,
    contextCopyLine,
  };
}

describe("the agent image's install layer", () => {
  const dockerfile = readDockerfile();

  it("installs before the sources arrive", () => {
    expect(dockerfile.installLine, "no `pnpm install` line found").toBeGreaterThanOrEqual(0);
    expect(dockerfile.contextCopyLine, "no `COPY . .` line found").toBeGreaterThanOrEqual(0);
    expect(
      dockerfile.contextCopyLine,
      "`COPY . .` above the install puts a full workspace resolve behind every\n" +
        "source edit — copy the manifests, install, then copy the tree",
    ).toBeGreaterThan(dockerfile.installLine);
  });

  const projects = workspaceProjects();
  // A floor: an expansion that names nothing would pass these vacuously.
  it("expands pnpm-workspace.yaml to the members it declares", () => {
    expect(projects.length, "pnpm-workspace.yaml expanded to no manifests").toBeGreaterThan(5);
  });

  const required = [
    ...WORKSPACE_ROOT_FILES,
    ...resolvedBy(dockerfile.installFilter, projects).map((project) => project.manifest),
  ];
  const copied = new Set(dockerfile.copiedBeforeInstall);

  it("copies every manifest the install resolves", () => {
    const missing = [...new Set(required)]
      .filter((file) => !copied.has(file))
      .map((file) => `  COPY ${file} ${path.dirname(file)}/`);
    expect(
      missing,
      "a member pnpm cannot see installs as a dangling symlink, not an error —\n" +
        `add these to the Dockerfile above the install:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("copies nothing the install does not read", () => {
    const surplus = [...copied].filter((file) => !required.includes(file));
    expect(
      surplus,
      "every file copied above the install is part of that layer's cache key, so\n" +
        "one the install never reads re-resolves the workspace whenever it changes.\n" +
        `Drop these, or name why the install needs them:\n${surplus.join("\n")}`,
    ).toEqual([]);
  });
});
