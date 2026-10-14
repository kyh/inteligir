// pnpm resolves membership, so every guard walks exactly the packages pnpm links; this holds the
// other direction, that every package.json on disk is a member, since one pnpm ignores is unlinked
// and walked by no guard. workspaceFiles walks src/** only: build scripts, bin/, configs and
// .github are outside every guard built on it.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, isSkippedDir, WORKSPACE_MANIFEST, workspaces } from "./repo";

// except the repo root's, which is a member of no glob.
const manifestsOnDisk = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (isSkippedDir(entry.name)) {
          continue;
        }
        walk(path.join(dir, entry.name));
      } else if (entry.name === "package.json") {
        const relative = path.relative(REPO_ROOT, path.join(dir, entry.name));
        if (relative !== "package.json") {
          found.push(relative);
        }
      }
    }
  };
  walk(REPO_ROOT);
  return found.toSorted();
};

describe("the guards' tree walk", () => {
  it("every package.json on disk is a pnpm workspace", () => {
    const discovered = new Set(workspaces().map((workspace) => `${workspace.dir}/package.json`));
    const violations = manifestsOnDisk()
      .filter((manifest) => !discovered.has(manifest))
      .map(
        (manifest) =>
          `UNREACHED WORKSPACE  ${manifest}\n` +
          `  rule: every package in this repo is matched by a glob in ${WORKSPACE_MANIFEST}; this one is matched by none, so pnpm does not link it and no guard in tools/repo-guards walks it\n` +
          `  fix: move it under one of the "packages" globs in ${WORKSPACE_MANIFEST}, or add its glob there`,
      );
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every workspace sits one level under its group directory", () => {
    const violations = workspaces()
      .filter((workspace) => {
        const group = path.dirname(workspace.dir);
        return group === "." || path.dirname(group) !== ".";
      })
      .map(
        (workspace) =>
          `UNGROUPED WORKSPACE  ${workspace.dir}\n` +
          `  rule: workspaceGroups() in tools/repo-guards/src/repo.ts is each workspace's parent directory, and dangling-references.test.ts anchors every path it checks on one, so a workspace at another depth names no group\n` +
          `  fix: move it one level under a group directory, or teach workspaceGroups() its shape`,
      );
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });
});
