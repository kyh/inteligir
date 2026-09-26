// CLAUDE.md § Decisions opens with a hand-kept index of its groups, and a group is added or
// renamed by one line far below it. Read from both, the index cannot lose a group or point at one
// that is gone.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./repo";

const CLAUDE_MD = "CLAUDE.md";
const SECTION_HEADING = "## Decisions";

// open-ended so an entry may trail a note, such as its group's bullet count
const INDEX_ENTRY = /^- \[(?<label>[^\]]+)\]\(#(?<anchor>[^)]+)\)/u;
const GROUP_HEADING = /^### (?<title>.+?)\s*$/u;

// GitHub's own anchor rule: lowercase, punctuation dropped, each space a dash
const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replaceAll(" ", "-");

interface Entry {
  label: string;
  anchor: string;
}

interface Group {
  title: string;
  slug: string;
}

interface Section {
  entries: Entry[];
  groups: Group[];
}

// a fenced block is skipped so an example heading inside one is never read as a group
const sectionOf = (markdown: string): Section | null => {
  const lines = markdown.split("\n");
  const start = lines.indexOf(SECTION_HEADING);
  if (start === -1) {
    return null;
  }
  const entries: Entry[] = [];
  const groups: Group[] = [];
  let fenced = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }
    if (line.startsWith("## ")) {
      break;
    }
    const title = GROUP_HEADING.exec(line)?.groups?.title;
    if (title !== undefined) {
      groups.push({ slug: slugOf(title), title });
      continue;
    }
    const entry = INDEX_ENTRY.exec(line)?.groups;
    if (groups.length === 0 && entry?.label !== undefined && entry.anchor !== undefined) {
      entries.push({ anchor: entry.anchor, label: entry.label });
    }
  }
  return { entries, groups };
};

const decisionsIndexDrift = (markdown: string): string[] => {
  const section = sectionOf(markdown);
  if (section === null) {
    return [
      `NO DECISIONS SECTION  ${CLAUDE_MD}\n` +
        `  rule: ${CLAUDE_MD} carries "${SECTION_HEADING}", an index of its groups above one "###" heading per group\n` +
        `  fix: restore the heading, or teach tools/repo-guards/src/decisions-index.test.ts its new name`,
    ];
  }
  const slugs = new Set(section.groups.map((group) => group.slug));
  const anchors = new Set(section.entries.map((entry) => entry.anchor));
  const headless = section.entries
    .filter((entry) => !slugs.has(entry.anchor))
    .map(
      (entry) =>
        `INDEX ENTRY WITH NO HEADING  [${entry.label}](#${entry.anchor})\n` +
        `  in: ${CLAUDE_MD} § Decisions\n` +
        `  rule: every index entry points at a "###" group under ${SECTION_HEADING} whose anchor is #${entry.anchor}\n` +
        `  fix: correct the anchor to the group's, or delete the entry with the group it named`,
    );
  const unindexed = section.groups
    .filter((group) => !anchors.has(group.slug))
    .map(
      (group) =>
        `UNINDEXED GROUP  ### ${group.title}\n` +
        `  in: ${CLAUDE_MD} § Decisions\n` +
        `  rule: every "###" group under ${SECTION_HEADING} has an index entry, in the groups' order\n` +
        `  fix: add "- [${group.title}](#${group.slug})" to the index, where the group sits`,
    );
  if (headless.length > 0 || unindexed.length > 0) {
    return [...headless, ...unindexed];
  }
  const indexed = section.entries.map((entry) => entry.anchor);
  const headed = section.groups.map((group) => group.slug);
  if (indexed.join("\n") !== headed.join("\n")) {
    return [
      `INDEX OUT OF ORDER  ${CLAUDE_MD} § Decisions\n` +
        `  index: ${indexed.join(", ")}\n` +
        `  groups: ${headed.join(", ")}\n` +
        `  rule: the index lists the "###" groups in the order they appear\n` +
        `  fix: reorder the index entries to match`,
    ];
  }
  return [];
};

const readClaudeMd = (): string => fs.readFileSync(path.join(REPO_ROOT, CLAUDE_MD), "utf-8");

const decisionsDocument = (index: readonly string[], groups: readonly string[]): string =>
  [
    "# Doc",
    SECTION_HEADING,
    "",
    ...index,
    "",
    ...groups.flatMap((group) => [`### ${group}`, "", "- **A BULLET.**", ""]),
    "## After",
    "### Not a group",
  ].join("\n");

describe("CLAUDE.md § Decisions' index", () => {
  it("finds the index and its groups", () => {
    const section = sectionOf(readClaudeMd());
    expect(section, `${CLAUDE_MD} has no "${SECTION_HEADING}"`).not.toBeNull();
    expect(section?.entries.length, "no index entry read — the parse is broken").toBeGreaterThan(0);
    expect(section?.groups.length, "no ### group read — the parse is broken").toBeGreaterThan(0);
  });

  it("indexes every group, in order, and nothing else", () => {
    const drift = decisionsIndexDrift(readClaudeMd());
    expect(drift, `\n${drift.join("\n\n")}\n`).toEqual([]);
  });

  it("refuses a missing entry, an entry with no heading and a reordered index", () => {
    const groups = ["Vault: writes, git and containment", "Editor and dialect"];
    const index = [
      "- [Vault: writes, git and containment](#vault-writes-git-and-containment)",
      "- [Editor and dialect](#editor-and-dialect)",
    ];
    expect(decisionsIndexDrift(decisionsDocument(index, groups))).toEqual([]);
    const counted = index.map((entry, at) => `${entry} — ${at + 1}`);
    expect(decisionsIndexDrift(decisionsDocument(counted, groups))).toEqual([]);

    const missing = decisionsIndexDrift(decisionsDocument(index.slice(0, 1), groups));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("UNINDEXED GROUP  ### Editor and dialect");

    const headless = decisionsIndexDrift(decisionsDocument([...index, "- [Gone](#gone)"], groups));
    expect(headless).toHaveLength(1);
    expect(headless[0]).toContain("INDEX ENTRY WITH NO HEADING  [Gone](#gone)");

    const reordered = decisionsIndexDrift(decisionsDocument(index.toReversed(), groups));
    expect(reordered[0]).toContain("INDEX OUT OF ORDER");

    expect(decisionsIndexDrift("# Doc\n")[0]).toContain("NO DECISIONS SECTION");
  });
});
