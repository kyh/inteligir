// A release's GitHub notes are CHANGELOG.md's top section, printed by the release step's script,
// so the file's shape is the release's: sections newest first, and a version bump dates its
// section here, in verify, rather than at `gh release create`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { REPO_ROOT } from "./repo";

const CHANGELOG = "CHANGELOG.md";
const DESKTOP_MANIFEST = "apps/desktop/package.json";
const RELEASE_NOTES_SCRIPT = "apps/desktop/scripts/release-notes.mjs";

const TITLE = "# Changelog";
const UNRELEASED = "Unreleased";
const RELEASED = /^(?<version>\d+\.\d+\.\d+) — (?<date>\d{4}-\d{2}-\d{2})$/u;

interface Section {
  heading: string;
  line: number;
  body: string;
}

const sectionsOf = (text: string): Section[] => {
  const sections: Section[] = [];
  const bodies: string[][] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.startsWith("## ")) {
      sections.push({ body: "", heading: line.slice("## ".length).trim(), line: index + 1 });
      bodies.push([]);
      continue;
    }
    bodies.at(-1)?.push(line);
  }
  return sections.map((section, index) => ({
    ...section,
    body: (bodies[index] ?? []).join("\n").trim(),
  }));
};

interface Release {
  version: [number, number, number];
  spelled: string;
  date: string;
  line: number;
}

const releaseOf = (section: Section): Release | null => {
  const groups = RELEASED.exec(section.heading)?.groups;
  if (groups?.version === undefined || groups.date === undefined) {
    return null;
  }
  const [major = 0, minor = 0, patch = 0] = groups.version.split(".").map(Number);
  return {
    date: groups.date,
    line: section.line,
    spelled: groups.version,
    version: [major, minor, patch],
  };
};

const releasesOf = (sections: readonly Section[]): Release[] =>
  sections.flatMap((section) => {
    const release = releaseOf(section);
    return release === null ? [] : [release];
  });

const isNewer = (a: Release, b: Release): boolean => {
  for (const [index, part] of a.version.entries()) {
    const other = b.version[index] ?? 0;
    if (part !== other) {
      return part > other;
    }
  }
  return false;
};

const readChangelog = (): string => fs.readFileSync(path.join(REPO_ROOT, CHANGELOG), "utf-8");

const desktopVersion = (): string => {
  const manifest = z
    .looseObject({ version: z.string() })
    .safeParse(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, DESKTOP_MANIFEST), "utf-8")));
  if (!manifest.success) {
    throw new Error(`${DESKTOP_MANIFEST}: expected a string "version"`);
  }
  return manifest.data.version;
};

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const runScript = (script: string): Run => {
  const result = spawnSync(process.execPath, [script], { encoding: "utf-8" });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};

const staged: string[] = [];

afterEach(() => {
  for (const dir of staged.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

// the script finds the changelog and the manifest from where it sits, so a copy in a scratch
// tree of the same shape reads the fixture rather than the repo's own.
const runStaged = (changelog: string, version: string): Run => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inteligir-release-notes-"));
  staged.push(root);
  const script = path.join(root, RELEASE_NOTES_SCRIPT);
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, RELEASE_NOTES_SCRIPT), script);
  fs.writeFileSync(path.join(root, DESKTOP_MANIFEST), JSON.stringify({ version }));
  fs.writeFileSync(path.join(root, CHANGELOG), changelog);
  return runScript(script);
};

describe("the changelog", () => {
  it("is titled, and every section is Unreleased or a dated release", () => {
    const text = readChangelog();
    const sections = sectionsOf(text);
    expect(sections.length, `${CHANGELOG} has no "## " section`).toBeGreaterThan(0);

    const violations: string[] = [];
    if (text.split("\n")[0] !== TITLE) {
      violations.push(`${CHANGELOG}:1  must be "${TITLE}"`);
    }
    for (const [index, section] of sections.entries()) {
      const unreleased = section.heading === UNRELEASED;
      if (unreleased && index > 0) {
        violations.push(
          `${CHANGELOG}:${section.line}  "## ${UNRELEASED}" below another section: it collects what no release has shipped yet, so it is only ever the top one`,
        );
      }
      if (!unreleased && releaseOf(section) === null) {
        violations.push(
          `${CHANGELOG}:${section.line}  "## ${section.heading}" is neither "## ${UNRELEASED}" nor "## <major.minor.patch> — <YYYY-MM-DD>"`,
        );
      }
      if (section.body === "") {
        violations.push(`${CHANGELOG}:${section.line}  "## ${section.heading}" says nothing`);
      }
    }
    expect(violations, `\n${violations.join("\n")}\n`).toEqual([]);
  });

  it("lists releases newest first", () => {
    const releases = releasesOf(sectionsOf(readChangelog()));
    const violations: string[] = [];
    for (const [index, release] of releases.entries()) {
      const below = releases[index + 1];
      if (below === undefined) {
        continue;
      }
      if (!isNewer(release, below) || release.date < below.date) {
        violations.push(
          `${CHANGELOG}:${below.line}  ${below.spelled} (${below.date}) sits below ${release.spelled} (${release.date}): a newer release goes above an older one`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n")}\n`).toEqual([]);
  });

  it("dates a section for the version the app ships as", () => {
    const [newest] = releasesOf(sectionsOf(readChangelog()));
    if (newest === undefined) {
      return;
    }
    const version = desktopVersion();
    expect(
      newest.spelled,
      `${DESKTOP_MANIFEST} is ${version}, but ${CHANGELOG}'s newest release is ${newest.spelled}: a version bump retitles "## ${UNRELEASED}" as "## ${version} — <YYYY-MM-DD>", since the release's notes are that section`,
    ).toBe(version);
  });
});

describe("the release notes script", () => {
  it("prints the top section when it is titled for the package's version", () => {
    const run = runStaged(
      `${TITLE}\n\n## 1.2.0 — 2026-10-02\n\n- The new thing.\n\n## 1.1.0 — 2026-09-01\n\n- The old thing.\n`,
      "1.2.0",
    );
    expect(run).toEqual({ status: 0, stderr: "", stdout: "- The new thing.\n" });
  });

  it("refuses an Unreleased top section and names the heading to write", () => {
    const run = runStaged(`${TITLE}\n\n## ${UNRELEASED}\n\n- Not out yet.\n`, "1.2.0");
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(`"${UNRELEASED}"`);
    expect(run.stderr).toContain(`"1.2.0 — <YYYY-MM-DD>"`);
  });

  it("refuses a top section titled for another version", () => {
    const run = runStaged(`${TITLE}\n\n## 1.1.0 — 2026-09-01\n\n- The old thing.\n`, "1.2.0");
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
  });

  it("refuses a release section that says nothing", () => {
    const run = runStaged(
      `${TITLE}\n\n## 1.2.0 — 2026-10-02\n\n## 1.1.0 — 2026-09-01\n\n- x\n`,
      "1.2.0",
    );
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
  });

  it("agrees with the repo's own changelog", () => {
    const [top] = sectionsOf(readChangelog());
    expect(top, `${CHANGELOG} has no "## " section`).toBeDefined();
    const run = runScript(path.join(REPO_ROOT, RELEASE_NOTES_SCRIPT));
    if (top === undefined || top.heading === UNRELEASED) {
      expect(run.status, run.stderr).toBe(1);
      return;
    }
    expect(run).toEqual({ status: 0, stderr: "", stdout: `${top.body}\n` });
  });
});
