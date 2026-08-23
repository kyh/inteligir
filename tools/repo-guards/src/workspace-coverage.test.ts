// ---------------------------------------------------------------------------
// What the guards can SEE: the tree walk every other guard in this workspace
// is built on, held against pnpm's own workspace manifest.
//
// `repo.ts` used to carry the workspace globs as a literal. That is the one
// failure mode a fitness test may not have: adding a workspace group means
// every guard quietly stops covering it, and the symptom is a green run over a
// smaller tree. Nothing else in the repo notices — turbo reads
// pnpm-workspace.yaml, pnpm reads pnpm-workspace.yaml, and the guards read a
// copy that no longer agreed with either.
//
// So the globs come from the manifest, an unreadable glob shape THROWS rather
// than being skipped, and the walk is checked from the other end too: a
// package.json that no glob reaches is a workspace pnpm ignores and every
// guard here is blind to.
//
// What this CANNOT see, stated rather than implied: `workspaceFiles` walks
// `src/**` only, so a workspace's build scripts, its `bin/`, its configs and
// the repo-root `.github`/`.githooks` trees are outside every guard built on
// it. Guards that need those read them directly and say so in their own header.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, isSkippedDir, WORKSPACE_MANIFEST, workspaceGlobs, workspaces } from "./repo";

/** Every package.json in the tree except the repo root's, which is the
 *  monorepo's own and is a member of no glob. */
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

/** How many globs the manifest declares, counted from its raw text rather
 *  than from the reader under test — the cross-check that no entry was parsed
 *  into neither arm. Negated globs are pnpm's exclusions, not workspaces. */
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
    // A reader that silently returned nothing would satisfy every assertion
    // below by covering nothing, so pin that it came back populated and that
    // the guards' own home is among them — `tools/` is the group a
    // hand-copied list in this repo had already lost. The arms are checked by
    // COUNT rather than by requiring a member of each: every layout here is a
    // `<dir>/*` group today, so demanding a standalone workspace would pin a
    // shape the repo does not have, while the sum still fails the moment an
    // entry lands in neither arm.
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
    // The globs are the claim; this is the check. A manifest under a directory
    // no glob matches is a package pnpm does not link and no guard here walks
    // — it would sit outside the dependency DAG, the change-kind sweep and the
    // provenance sweep at once, with nothing failing.
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
