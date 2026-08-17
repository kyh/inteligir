// ---------------------------------------------------------------------------
// Vendored-code provenance: the licensing story, kept honest by a walk.
//
// Two MIT codebases are copied into this repo rather than depended on
// (@repo/agent-runtime from bb, packages/editor/src/vendor/prosemark from
// ProseMark). MIT's one obligation is that the notice travels with the copy, so
// the failure this guards is a file that arrives with no attribution: a
// re-vendor that adds a module, a house file dropped into a vendored directory,
// or the header quietly lost to a reformat.
//
// Nothing here is a list. The vendored directories are discovered by finding
// PROVENANCE.md; the header each one requires and the paths it exempts are read
// FROM that document, so the record and the tree are checked against each other
// rather than both against a copy in this file.
//
// Adding a vendored directory: drop a PROVENANCE.md in it with an `##
// Attribution` section. This guard picks it up with no edit.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./repo";

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "dist-node", ".cache", ".turbo", ".git"]);
const PROVENANCE_FILE = "PROVENANCE.md";
/** Everything a copyright notice can ride in. Data files (LICENSE, .json,
 *  fixtures) carry no comment syntax, so they are not asked for one. */
const ATTRIBUTABLE = /\.(?:tsx?|mts|cts|mjs|cjs|jsx?|css)$/;

const UPSTREAM_URL = /\*\*Upstream\*\*:\s*(https?:\/\/\S+)/;
const PINNED_COMMIT = /\*\*Commit\*\*:\s*`([\da-f]{40})`/;
const LICENSE_NAME = /\*\*License\*\*:\s*(\S+)/;
const ATTRIBUTION_SECTION = /^##\s+Attribution\s*$/m;
const FENCED_BLOCK = /```[a-z]*\n([\S\s]*?)```/g;

interface VendoredDir {
  /** Repo-relative directory holding the PROVENANCE.md. */
  dir: string;
  upstream: string;
  commit: string;
  license: string;
  /** The literal every attributable file under `dir` must contain. */
  header: string;
  /** Repo-relative glob prefixes the header is not required of. */
  exemptions: string[];
}

function findProvenanceDirs(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      findProvenanceDirs(path.join(dir, entry.name), out);
    } else if (entry.name === PROVENANCE_FILE) {
      out.push(path.relative(REPO_ROOT, dir));
    }
  }
}

function firstGroup(pattern: RegExp, text: string, what: string, file: string): string {
  const match = pattern.exec(text);
  const value = match?.[1];
  if (value === undefined) {
    throw new Error(
      `${file}: no ${what}.\n` +
        `  rule: a vendored directory states where the copy came from — an upstream URL, a 40-hex commit pin and a license — or the licensing story is unverifiable`,
    );
  }
  return value;
}

/** Read the record. It is prose for humans with two fenced blocks for this
 *  guard; parsing beats a second copy of the same facts in a test file. */
function parseProvenance(dir: string): VendoredDir {
  const file = path.posix.join(dir, PROVENANCE_FILE);
  const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  const section = ATTRIBUTION_SECTION.exec(text);
  if (section === null) {
    throw new Error(
      `${file}: no "## Attribution" section.\n` +
        `  rule: the header every vendored file carries, and the paths exempt from it, are declared HERE — a guard holding its own copy is not a record`,
    );
  }
  const attribution = text.slice(section.index);
  const blocks: string[] = [];
  FENCED_BLOCK.lastIndex = 0;
  let block = FENCED_BLOCK.exec(attribution);
  while (block !== null) {
    const body = block[1];
    if (body !== undefined) blocks.push(body);
    block = FENCED_BLOCK.exec(attribution);
  }
  const header = blocks[0]?.trim();
  if (header === undefined || header.length === 0) {
    throw new Error(`${file}: the "## Attribution" section declares no header line.`);
  }
  const exemptions = (blocks[1] ?? "")
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((entry): entry is string => entry !== undefined && entry.length > 0)
    .map((entry) => path.posix.join(dir, entry.replace(/\/\*\*$/, "")));

  return {
    dir,
    upstream: firstGroup(UPSTREAM_URL, text, "**Upstream** URL", file),
    commit: firstGroup(PINNED_COMMIT, text, "**Commit** pin (40 hex chars, backticked)", file),
    license: firstGroup(LICENSE_NAME, text, "**License**", file),
    header,
    exemptions,
  };
}

function attributableFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        walk(full);
      } else if (ATTRIBUTABLE.test(entry.name)) {
        out.push(path.relative(REPO_ROOT, full));
      }
    }
  };
  walk(path.join(REPO_ROOT, dir));
  return out;
}

const vendored: VendoredDir[] = (() => {
  const dirs: string[] = [];
  for (const group of ["apps", "packages", "tools"]) {
    const groupDir = path.join(REPO_ROOT, group);
    if (fs.existsSync(groupDir)) findProvenanceDirs(groupDir, dirs);
  }
  return dirs.toSorted().map(parseProvenance);
})();

describe("vendored provenance", () => {
  it("finds the vendored directories", () => {
    // A walk that found nothing would pass every assertion below for the wrong
    // reason. Which directories it finds is deliberately NOT pinned: adding a
    // vendored copy is adding its PROVENANCE.md, and this guard should cover it
    // without an edit.
    expect(
      vendored.length,
      "No PROVENANCE.md found anywhere — the walk is broken, not the tree.",
    ).toBeGreaterThan(0);
  });

  it("every record names an upstream, a pinned commit and a license", () => {
    // parseProvenance throws with the rule when one is missing; this asserts
    // the values are the shape a re-vendor can actually be driven from.
    for (const entry of vendored) {
      expect(entry.upstream, `${entry.dir}/PROVENANCE.md`).toMatch(/^https?:\/\//);
      expect(entry.commit, `${entry.dir}/PROVENANCE.md`).toMatch(/^[\da-f]{40}$/);
      expect(entry.license.length, `${entry.dir}/PROVENANCE.md`).toBeGreaterThan(0);
    }
  });

  it("every vendored directory carries the upstream license text", () => {
    // The per-file notice is not the license. MIT (and every permissive
    // licence this repo vendors) requires the license text itself to travel
    // with the copy, and that text names a copyright holder no notice line
    // carries. A PROVENANCE.md naming "MIT" while the tree holds no license
    // file is the exact gap this asserts away.
    const violations: string[] = [];
    for (const entry of vendored) {
      const found = fs
        .readdirSync(path.join(REPO_ROOT, entry.dir))
        .some((name) => /^licen[cs]e/i.test(name));
      if (found) continue;
      violations.push(
        `MISSING LICENSE  ${entry.dir}\n` +
          `  rule: a directory vendoring ${entry.license} code carries that license's own text\n` +
          `  fix: copy the license file from ${entry.upstream} at ${entry.commit} into ${entry.dir}/`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every file under a vendored directory carries its attribution", () => {
    const violations: string[] = [];
    for (const entry of vendored) {
      for (const file of attributableFiles(entry.dir)) {
        if (entry.exemptions.some((exempt) => file.startsWith(exempt))) continue;
        if (fs.readFileSync(path.join(REPO_ROOT, file), "utf8").includes(entry.header)) continue;
        violations.push(
          `MISSING ATTRIBUTION  ${file}\n` +
            `  rule: every file under ${entry.dir} carries "${entry.header}" (${entry.license} requires the notice to travel with the copy)\n` +
            `  fix: prepend the header, or add the path to the exemption block in ${entry.dir}/PROVENANCE.md with its reason`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every declared exemption still covers a file", () => {
    const violations: string[] = [];
    for (const entry of vendored) {
      const files = attributableFiles(entry.dir);
      for (const exempt of entry.exemptions) {
        if (files.some((file) => file.startsWith(exempt))) continue;
        violations.push(
          `STALE EXEMPTION  ${exempt}\n` +
            `  rule: an exemption names files that exist; this one matches none\n` +
            `  fix: delete the line from ${entry.dir}/PROVENANCE.md`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });
});
