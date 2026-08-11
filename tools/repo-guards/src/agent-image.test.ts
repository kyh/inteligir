// ---------------------------------------------------------------------------
// What the agent image's install layer is keyed on.
//
// `apps/web/container/Dockerfile` copies the workspace MANIFESTS, installs, and
// only then copies the sources — so a source edit re-bundles the daemon instead
// of re-resolving ~1,700 packages. Both halves of that are one line away from
// being undone, and neither failure is visible from a build log:
//
//   • A `COPY . .` above the install puts a full install on every deploy. It
//     still works; it just costs minutes.
//   • A workspace member whose manifest is not copied is NOT refused by
//     `--frozen-lockfile`. pnpm installs the members it can see, leaves a
//     dangling `node_modules` symlink where the missing one should be, and the
//     image fails at RUNTIME on a missing dependency — after a deploy.
//
// So the list of manifests is derived from `pnpm-workspace.yaml` and diffed
// against the COPY lines, rather than trusted.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const DOCKERFILE = path.join(REPO_ROOT, "apps/web/container/Dockerfile");

/** What the install reads besides the members' manifests. */
const WORKSPACE_ROOT_FILES = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"];

/** Every `packages:` glob in pnpm-workspace.yaml, expanded to the manifests it
 * names. The file is read line-wise rather than parsed: this package has no
 * YAML dependency, and the block is a flat list of strings. */
function workspaceManifests(): string[] {
  const lines = fs.readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8").split("\n");
  const start = lines.indexOf("packages:");
  expect(start, "pnpm-workspace.yaml declares no `packages:` block").toBeGreaterThanOrEqual(0);

  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const entry = /^\s+-\s+"?([^"\s]+)"?\s*$/.exec(line)?.[1];
    if (entry !== undefined) globs.push(entry);
  }
  return globs
    .flatMap((glob) => fs.globSync(`${glob}/package.json`, { cwd: REPO_ROOT }))
    .toSorted();
}

type Dockerfile = {
  /** Sources of every `COPY` that runs before the install, in file order. */
  copiedBeforeInstall: string[];
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

  return { copiedBeforeInstall, installLine, contextCopyLine };
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

  it("copies every workspace manifest the install resolves", () => {
    const manifests = workspaceManifests();
    // A floor: an expansion that names nothing would pass this vacuously.
    expect(manifests.length, "pnpm-workspace.yaml expanded to no manifests").toBeGreaterThan(5);

    const copied = new Set(dockerfile.copiedBeforeInstall);
    const missing = [...WORKSPACE_ROOT_FILES, ...manifests]
      .filter((file) => !copied.has(file))
      .map((file) => `  COPY ${file} ${path.dirname(file)}/`);
    expect(
      missing,
      "a member pnpm cannot see installs as a dangling symlink, not an error —\n" +
        `add these to the Dockerfile above the install:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
