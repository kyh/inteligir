// a copy of the workspace globs in repo.ts would let a new group drop out of every guard with a
// green run over a smaller tree; so the globs come from the manifest and every package.json on disk
// must be reached by one. workspaceFiles walks src/** only: build scripts, bin/, configs and
// .github are outside every guard built on it.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, isSkippedDir, WORKSPACE_MANIFEST, workspaceGlobs, workspaces } from "./repo";

// except the repo root's, which is a member of no glob.
function manifestsOnDisk(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (isSkippedDir(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name === "package.json") {
        const relative = path.relative(REPO_ROOT, path.join(dir, entry.name));
        if (relative !== "package.json") found.push(relative);
      }
    }
  };
  walk(REPO_ROOT);
  return found.toSorted();
}

// counted from the raw text rather than the reader under test; negated globs are pnpm's exclusions.
function declaredGlobCount(): number {
  const raw = fs.readFileSync(path.join(REPO_ROOT, WORKSPACE_MANIFEST), "utf8");
  const packages = raw.match(/^packages:\n(?:[ \t]+-.*\n)+/m);
  if (packages === null) throw new Error(`${WORKSPACE_MANIFEST}: no "packages" list`);
  return packages[0]
    .split("\n")
    .filter((line) => /^\s+-\s*\S/.test(line))
    .filter((line) => !line.includes('"!') && !/-\s*!/.test(line)).length;
}

describe("the guards' tree walk", () => {
  const globs = workspaceGlobs();

  it("reads its globs from pnpm's manifest, not from a copy", () => {
    // arms checked by count rather than a member of each: every layout is a `<dir>/*` group today,
    // so demanding a standalone workspace would pin a shape the repo does not have.
    expect(globs.groups.length, `${WORKSPACE_MANIFEST} declares no "<dir>/*" glob`).toBeGreaterThan(
      0,
    );
    expect(globs.groups).toContain("tools");
    expect(
      globs.groups.length + globs.standalone.length,
      `${WORKSPACE_MANIFEST}: an entry landed in neither arm of workspaceGlobs()`,
    ).toBe(declaredGlobCount());
  });

  it("every workspace pnpm's globs reach is discovered", () => {
    const discovered = new Set(workspaces().map((workspace) => `${workspace.dir}/package.json`));
    const violations = manifestsOnDisk()
      .filter((manifest) => !discovered.has(manifest))
      .map(
        (manifest) =>
          `UNREACHED WORKSPACE  ${manifest}\n` +
          `  rule: every package in this repo is matched by a glob in ${WORKSPACE_MANIFEST}; this one is matched by none, so pnpm does not link it and no guard in tools/repo-guards walks it\n` +
          `  fix: move it under one of the declared globs (${[...globs.groups.map((group) => `${group}/*`), ...globs.standalone].join(", ")}), or add its glob to ${WORKSPACE_MANIFEST}`,
      );
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every discovered workspace still has the manifest it was found by", () => {
    const violations = workspaces()
      .filter((workspace) => !fs.existsSync(path.join(REPO_ROOT, workspace.dir, "package.json")))
      .map(
        (workspace) =>
          `PHANTOM WORKSPACE  ${workspace.dir}\n` +
          `  rule: discovery is a walk of the real tree; a workspace with no package.json means the walk is broken, not the tree`,
      );
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });
});
