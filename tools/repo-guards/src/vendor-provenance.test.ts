// ---------------------------------------------------------------------------
// Vendored-code provenance: the licensing story, kept honest by a walk.
//
// Code from other MIT codebases is copied into this repo rather than depended
// on. MIT's one obligation is that the notice travels with the copy, and the
// obligation this repo adds is that the copy names WHERE it came from — an
// upstream path and a commit — or a re-vendor is archaeology.
//
// A copy arrives in one of two shapes, and a record declares which by its own
// contents rather than by a flag:
//
//   WHOLE DIRECTORY — the record has no `## Files` manifest, so every
//   attributable file under it must carry the notice. Adding a module to the
//   copy needs no edit here. `packages/agent-runtime` and `packages/agent-skills`.
//
//   PER FILE — the record has a `## Files` manifest, because the package holds
//   vendored files among house-authored ones. The manifest IS the boundary:
//   exactly the listed files carry the notice, each row names its upstream
//   path, and a file that gains the notice without a row fails. The bb copies
//   in `apps/*` and `packages/*`.
//
// Nothing here is a list. Records are discovered by finding PROVENANCE.md, and
// every value compared — the notice literal, the exempt paths, the file
// manifest — is read FROM the record, so the tree and the record are checked
// against each other rather than both against a copy in this file.
//
// What this CANNOT catch, stated so nobody reads more into a green run: a file
// copied in with no notice at all is invisible to every rule below. The notice
// is what a walk can see; whether one is owed is a judgement made when the code
// is copied.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, isSkippedDir, workspaces } from "./repo";

const PROVENANCE_FILE = "PROVENANCE.md";
/** How a record points at a shared text: `licenses/<upstream>.LICENSE`. */
const SHARED_LICENSE_REFERENCE = /`(licenses\/[^`]+)`/;
/** Everything a copyright notice can ride in. Data files (LICENSE, .json,
 *  fixtures) carry no comment syntax, so they are not asked for one. */
const ATTRIBUTABLE = /\.(?:tsx?|mts|cts|mjs|cjs|jsx?|css)$/;

/**
 * Where a copy can live: the top-level directory of every workspace, so a
 * group folder and a standalone workspace are both covered. Derived
 * rather than listed — a new workspace group would otherwise be swept by
 * nothing, and the failure would be silence.
 */
const SEARCH_ROOTS: string[] = [
  ...new Set(workspaces().map((workspace) => workspace.dir.split("/")[0] ?? workspace.dir)),
].toSorted();

/**
 * The phrase that makes a file's header a CLAIM rather than a citation. A file
 * saying its shape follows an upstream's is crediting an influence and owes
 * nothing; "Vendored from" says bytes were copied, which is what MIT's notice
 * requirement and the manifest below both attach to. Keep the two spellings
 * distinct when writing a header — this guard reads the difference.
 */
const VENDORING_CLAIM = "Vendored from";

const UPSTREAM_URL = /\*\*Upstream\*\*:\s*(https?:\/\/\S+)/;
const PINNED_COMMIT = /\*\*Commit\*\*:\s*`([\da-f]{40})`/;
const LICENSE_NAME = /\*\*License\*\*:\s*(\S+)/;
const ATTRIBUTION_SECTION = /^##\s+Attribution\s*$/m;
const FILES_SECTION = /^##\s+Files\s*$/m;
const NEXT_SECTION = /^##\s+/m;
const FENCED_BLOCK = /```[a-z]*\n([\S\s]*?)```/g;
/** `| \`file\` | \`upstream\` … | vendored |` — the manifest's one row shape. */
const MANIFEST_ROW = /^\|\s*`([^`]+)`\s*\|(.+?)\|\s*(vendored|adapted)\s*\|\s*$/;
const BACKTICKED = /`([^`]+)`/;

/** How much of a listed file is upstream's, as the manifest may state it. */
type Relationship = "vendored" | "adapted";

interface ManifestEntry {
  /** Repo-relative path to the vendored file. */
  file: string;
  /** The upstream cell verbatim — one path, or several when a file merges. */
  upstream: string;
  relationship: Relationship;
}

interface VendoredDir {
  /** Repo-relative directory holding the PROVENANCE.md. */
  dir: string;
  upstream: string;
  commit: string;
  license: string;
  /** The literal every vendored file under `dir` must contain. */
  header: string;
  /** Repo-relative path prefixes the header is not required of. */
  exemptions: string[];
  /**
   * The listed files, or null when the record covers its whole directory.
   * Presence is what selects the mode, so a record cannot claim one and be
   * checked as the other.
   */
  files: ManifestEntry[] | null;
}

function findProvenanceDirs(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name)) continue;
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
        `  rule: a vendored copy states where it came from — an upstream URL, a 40-hex commit pin and a license — or the licensing story is unverifiable`,
    );
  }
  return value;
}

/** The body of a `## Heading` section, up to the next one. */
function sectionBody(text: string, heading: RegExp): string | null {
  const found = heading.exec(text);
  if (found === null) return null;
  const rest = text.slice(found.index + found[0].length);
  const next = NEXT_SECTION.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

function parseManifest(dir: string, file: string, body: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  for (const line of body.split("\n")) {
    const row = MANIFEST_ROW.exec(line.trim());
    if (row === null) continue;
    const [, listed, upstreamCell, relationship] = row;
    if (listed === undefined || upstreamCell === undefined || relationship === undefined) continue;
    if (!BACKTICKED.test(upstreamCell)) {
      throw new Error(
        `${file}: the manifest row for \`${listed}\` names no upstream path.\n` +
          `  rule: every row states the upstream file it was copied from, backticked, so a re-vendor can be driven from this table`,
      );
    }
    entries.push({
      file: path.posix.join(dir, listed),
      upstream: upstreamCell.trim(),
      relationship: relationship === "adapted" ? "adapted" : "vendored",
    });
  }
  if (entries.length === 0) {
    throw new Error(
      `${file}: the "## Files" section lists no files.\n` +
        `  rule: a manifest section declares the per-file boundary; an empty one would exempt the whole directory silently\n` +
        `  fix: add rows, or delete the section to make this a whole-directory record`,
    );
  }
  return entries;
}

/** Read the record. It is prose for humans with two machine-read parts — the
 *  fenced notice and the file manifest; parsing beats a second copy of the same
 *  facts in a test file. */
function parseProvenance(dir: string): VendoredDir {
  const file = path.posix.join(dir, PROVENANCE_FILE);
  const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  const attribution = sectionBody(text, ATTRIBUTION_SECTION);
  if (attribution === null) {
    throw new Error(
      `${file}: no "## Attribution" section.\n` +
        `  rule: the notice every vendored file carries, and the paths exempt from it, are declared HERE — a guard holding its own copy is not a record`,
    );
  }
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
    throw new Error(`${file}: the "## Attribution" section declares no notice line.`);
  }
  if (!header.includes(VENDORING_CLAIM)) {
    throw new Error(
      `${file}: the declared notice does not say "${VENDORING_CLAIM}".\n` +
        `  rule: that phrase is what the repo-wide sweep looks for; a notice spelled otherwise leaves its files uncovered`,
    );
  }
  const exemptions = (blocks[1] ?? "")
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((entry): entry is string => entry !== undefined && entry.length > 0)
    .map((entry) => path.posix.join(dir, entry.replace(/\/\*\*$/, "")));

  const manifest = sectionBody(text, FILES_SECTION);

  return {
    dir,
    upstream: firstGroup(UPSTREAM_URL, text, "**Upstream** URL", file),
    commit: firstGroup(PINNED_COMMIT, text, "**Commit** pin (40 hex chars, backticked)", file),
    license: firstGroup(LICENSE_NAME, text, "**License**", file),
    header,
    exemptions,
    files: manifest === null ? null : parseManifest(dir, file, manifest),
  };
}

function attributableFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (isSkippedDir(entry.name)) continue;
        walk(full);
      } else if (ATTRIBUTABLE.test(entry.name)) {
        out.push(path.relative(REPO_ROOT, full));
      }
    }
  };
  walk(path.join(REPO_ROOT, dir));
  return out;
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const vendored: VendoredDir[] = (() => {
  const dirs: string[] = [];
  for (const group of SEARCH_ROOTS) {
    const groupDir = path.join(REPO_ROOT, group);
    if (fs.existsSync(groupDir)) findProvenanceDirs(groupDir, dirs);
  }
  return dirs.toSorted().map(parseProvenance);
})();

/** This file, which has to be skipped: it spells the phrase it searches for,
 *  so a sweep that included it would always find itself. Derived rather than
 *  written down, so moving this guard cannot silently stop the exclusion. */
const SELF = path.relative(REPO_ROOT, import.meta.filename);

/** Every file in the repo claiming to be a copy of someone else's code. */
const claimants: string[] = SEARCH_ROOTS.filter((group) =>
  fs.existsSync(path.join(REPO_ROOT, group)),
)
  .flatMap((group) => attributableFiles(group))
  .filter((file) => file !== SELF && readFile(file).includes(VENDORING_CLAIM))
  .toSorted();

/** The record governing a file: the DEEPEST one whose directory contains it. */
function recordFor(file: string): VendoredDir | null {
  let best: VendoredDir | null = null;
  for (const entry of vendored) {
    if (!file.startsWith(`${entry.dir}/`)) continue;
    if (best === null || entry.dir.length > best.dir.length) best = entry;
  }
  return best;
}

describe("vendored provenance", () => {
  it("finds the records and the files that claim to need one", () => {
    // A walk that found nothing would pass every assertion below for the wrong
    // reason. Neither count is pinned: adding a vendored copy is adding its
    // PROVENANCE.md, and this guard should cover it without an edit.
    expect(
      vendored.length,
      "No PROVENANCE.md found anywhere — the walk is broken, not the tree.",
    ).toBeGreaterThan(0);
    expect(
      claimants.length,
      `No file anywhere says "${VENDORING_CLAIM}" — the sweep is broken, not the tree.`,
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

  it("every record carries the upstream license text", () => {
    // The per-file notice is not the license. MIT (and every permissive
    // licence this repo vendors) requires the license text itself to travel
    // with the copy, and that text names a copyright holder no notice line
    // carries. A PROVENANCE.md naming "MIT" while the tree holds no license
    // file is the exact gap this asserts away.
    // The text may sit beside the record, or in the repo-root `licenses/`
    // directory when several records share one upstream — seven byte-identical
    // copies of bb's MIT text was duplication, not diligence. Every workspace
    // here is `private: true` except the published launcher, so the license
    // travels with the artifact that ships, not with a package nobody
    // installs. A record naming a license whose text exists NOWHERE is still
    // the gap this asserts away.
    const violations: string[] = [];
    for (const entry of vendored) {
      const beside = fs
        .readdirSync(path.join(REPO_ROOT, entry.dir))
        .some((name) => /^licen[cs]e/i.test(name));
      // A shared text counts only when the record NAMES it: "a license exists
      // somewhere in licenses/" would let an Apache record pass on an MIT
      // file, which is the confusion this whole guard exists to prevent.
      const named = SHARED_LICENSE_REFERENCE.exec(readFile(`${entry.dir}/${PROVENANCE_FILE}`));
      const shared = named !== null && fs.existsSync(path.join(REPO_ROOT, named[1] ?? ""));
      if (beside || shared) continue;
      violations.push(
        `MISSING LICENSE  ${entry.dir}\n` +
          `  rule: ${entry.license} code carries that license's own text — beside the record, or in licenses/ when records share an upstream\n` +
          `  fix: copy the license file from ${entry.upstream} at ${entry.commit} into ${entry.dir}/ or licenses/`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("every file claiming to be vendored is covered by a record", () => {
    // The rule that makes the two shapes one system: a notice anywhere in
    // apps/, packages/ or tools/ has to be answerable. Without this, a file
    // copied into a package with no record carries an attribution that names
    // no commit — which is the state this guard was extended to end.
    const violations: string[] = [];
    for (const file of claimants) {
      const record = recordFor(file);
      if (record === null) {
        violations.push(
          `UNRECORDED COPY  ${file}\n` +
            `  rule: a file saying "${VENDORING_CLAIM}" is a copy of someone else's code, and a copy names the commit it came from\n` +
            `  fix: add a PROVENANCE.md to this file's package (upstream URL, 40-hex commit, license, an "## Attribution" notice and a "## Files" manifest row for this file), and put the upstream license text beside it`,
        );
        continue;
      }
      if (!readFile(file).includes(record.header)) {
        violations.push(
          `WRONG NOTICE  ${file}\n` +
            `  rule: it claims to be vendored but does not carry the notice ${record.dir}/PROVENANCE.md declares\n` +
            `  expected to contain: "${record.header}"`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("a whole-directory record covers every file under it", () => {
    const violations: string[] = [];
    for (const entry of vendored) {
      if (entry.files !== null) continue;
      for (const file of attributableFiles(entry.dir)) {
        if (entry.exemptions.some((exempt) => file.startsWith(exempt))) continue;
        if (readFile(file).includes(entry.header)) continue;
        violations.push(
          `MISSING ATTRIBUTION  ${file}\n` +
            `  rule: every file under ${entry.dir} carries "${entry.header}" (${entry.license} requires the notice to travel with the copy)\n` +
            `  fix: prepend the notice, or add the path to the exemption block in ${entry.dir}/PROVENANCE.md with its reason`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("a per-file manifest and the tree agree in both directions", () => {
    // The manifest is the boundary in a package that is only partly vendored,
    // so it is checked from both ends: a listed file that lost its notice (or
    // its existence) is as broken as a file that gained one without a row.
    const violations: string[] = [];
    for (const entry of vendored) {
      const manifest = entry.files;
      if (manifest === null) continue;
      const listed = new Set(manifest.map((row) => row.file));
      for (const row of manifest) {
        if (!fs.existsSync(path.join(REPO_ROOT, row.file))) {
          violations.push(
            `STALE MANIFEST ROW  ${row.file}\n` +
              `  rule: a manifest row names a file that exists; this one matches none\n` +
              `  fix: delete the row from ${entry.dir}/PROVENANCE.md, or restore the file`,
          );
          continue;
        }
        if (readFile(row.file).includes(entry.header)) continue;
        violations.push(
          `MISSING ATTRIBUTION  ${row.file}\n` +
            `  rule: ${entry.dir}/PROVENANCE.md lists this file as ${row.relationship} from ${row.upstream}, so it carries the notice\n` +
            `  fix: prepend "${entry.header}", or delete the row if the file is no longer a copy`,
        );
      }
      for (const file of attributableFiles(entry.dir)) {
        if (listed.has(file)) continue;
        if (!readFile(file).includes(entry.header)) continue;
        violations.push(
          `UNLISTED COPY  ${file}\n` +
            `  rule: ${entry.dir} is vendored per file, so the "## Files" manifest is the boundary — this file carries the notice with no row\n` +
            `  fix: add a row naming its upstream path and whether it is vendored or adapted, or drop the notice`,
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
