// The skills reach an agent as files: the CLI resolves ONE probe file through the package's
// exports map and hands the directory over. A renamed probe resolves nothing, and the resolver
// answers null rather than throwing, so the pointer disappears from every checkout with no error
// anywhere. This holds the probe, the set and the hub's index together.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, sourceOf, trackedFiles } from "./repo";

const SKILLS_DIR = "packages/agent-skills/skills";
const RESOLVER = "apps/cli/src/server/agents/agent-shell-env.ts";
const HUB = "inteligir-notes";
const HUB_INDEX_HEADING = "## Focused Contracts";

const PROBE_LITERAL = /require\.resolve\("@repo\/agent-skills\/skills\/(?<probe>[^"]+)"\)/u;
const FRONTMATTER_NAME = /^name:\s*(?<name>\S+)\s*$/mu;
const FRONTMATTER_DESCRIPTION = /^description:\s*(?<description>\S.*)$/mu;
const HUB_ROW = /^- .*`(?<skill>inteligir-[a-z-]+)`/gmu;

// read as text: @repo/notes is no dependency of this package, and the constants are plain literals.
const FENCE_LANGS = "packages/notes/src/markdown/fence-langs.ts";
const EXPORTED_LANG = /^export const \w+_LANG = "(?<lang>[^"]+)";$/gmu;
const FENCE_OPENING = /^\s*(?:`{3,}|~{3,})\s*(?<lang>inteligir-[a-z-]+)(?=\s|$)/u;

// the starter vault a first run copies: the notes a new user reads first and imitates after.
const SEED_DIR = "apps/cli/seed/";

const skillDirs = (): string[] =>
  fs
    .readdirSync(path.join(REPO_ROOT, SKILLS_DIR), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();

const skillText = (dir: string): string | null => {
  const file = path.join(REPO_ROOT, SKILLS_DIR, dir, "SKILL.md");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
};

interface FenceSite {
  lang: string;
  site: string;
}

const fenceOpenings = (file: string, text: string): FenceSite[] =>
  text.split("\n").flatMap((line, index) => {
    const lang = FENCE_OPENING.exec(line)?.groups?.lang;
    return lang === undefined ? [] : [{ lang, site: `${file}:${String(index + 1)}` }];
  });

const taughtFenceLangs = (): FenceSite[] =>
  skillDirs().flatMap((dir) =>
    fenceOpenings(`${SKILLS_DIR}/${dir}/SKILL.md`, skillText(dir) ?? ""),
  );

const seedNotes = (): string[] =>
  trackedFiles().filter((file) => file.startsWith(SEED_DIR) && file.endsWith(".md"));

const seededFenceLangs = (): FenceSite[] =>
  seedNotes().flatMap((file) =>
    fenceOpenings(file, fs.readFileSync(path.join(REPO_ROOT, file), "utf-8")),
  );

const unknownOpenings = (exported: readonly string[], sites: readonly FenceSite[]): string[] =>
  sites
    .filter(({ lang }) => !exported.includes(lang))
    .map(({ lang, site }) => `${site} — opens \`${lang}\`, which ${FENCE_LANGS} does not export`);

const fenceLangDrift = (exported: readonly string[], taught: readonly FenceSite[]): string[] => [
  ...unknownOpenings(exported, taught),
  ...exported
    .filter((lang) => !taught.some((site) => site.lang === lang))
    .map((lang) => `${FENCE_LANGS} — exports \`${lang}\`, which no skill's example fence uses`),
];

const UNKNOWN_RULE =
  "a fence the parser does not know opens as plain code, so the block it names is never drawn";

describe("the agent skills", () => {
  it("finds the set at all", () => {
    expect(skillDirs().length).toBeGreaterThan(1);
    expect(skillDirs()).toContain(HUB);
  });

  it("every skill directory carries a SKILL.md whose frontmatter names the directory", () => {
    const violations: string[] = [];
    for (const dir of skillDirs()) {
      const text = skillText(dir);
      if (text === null) {
        violations.push(`${SKILLS_DIR}/${dir} — no SKILL.md`);
        continue;
      }
      const name = FRONTMATTER_NAME.exec(text)?.groups?.name;
      if (name !== dir) {
        violations.push(`${SKILLS_DIR}/${dir}/SKILL.md — frontmatter name is ${name ?? "missing"}`);
      }
      if (FRONTMATTER_DESCRIPTION.exec(text) === null) {
        violations.push(`${SKILLS_DIR}/${dir}/SKILL.md — frontmatter has no description`);
      }
    }
    expect(
      violations,
      violations.length === 0
        ? ""
        : `SKILL FILES OUT OF SHAPE\n${violations.map((line) => `  ${line}`).join("\n")}\n` +
            `  rule: a skill is one directory with one SKILL.md whose frontmatter name is the directory — the agent reads these by that name`,
    ).toEqual([]);
  });

  it("the resolver's probe file exists, so a rename cannot silently drop the pointer", () => {
    const probe = PROBE_LITERAL.exec(sourceOf(RESOLVER))?.groups?.probe;
    expect(probe, `${RESOLVER} no longer resolves a skill file with require.resolve`).toBeDefined();
    if (probe === undefined) {
      return;
    }
    const file = path.join(SKILLS_DIR, probe);
    expect(
      fs.existsSync(path.join(REPO_ROOT, file)),
      `${RESOLVER} probes ${file}, which does not exist\n` +
        `  rule: resolveSkillsDir answers null when the probe is missing, and a null pointer is a prompt with no skills and no error — move the probe with the file`,
    ).toBe(true);
  });

  it("the hub names every focused skill and nothing that is not one", () => {
    const hub = skillText(HUB);
    expect(hub, `${SKILLS_DIR}/${HUB}/SKILL.md is missing`).not.toBeNull();
    if (hub === null) {
      return;
    }
    const headingAt = hub.indexOf(HUB_INDEX_HEADING);
    expect(headingAt, `${HUB} has no "${HUB_INDEX_HEADING}" section`).toBeGreaterThanOrEqual(0);
    const nextHeading = hub.indexOf("\n## ", headingAt + HUB_INDEX_HEADING.length);
    const section = hub.slice(headingAt, nextHeading === -1 ? undefined : nextHeading);
    const named = new Set([...section.matchAll(HUB_ROW)].map((match) => match.groups?.skill ?? ""));
    const focused = skillDirs().filter((dir) => dir !== HUB);

    const missing = focused.filter((dir) => !named.has(dir));
    const phantom = [...named].filter((name) => !focused.includes(name)).toSorted();
    expect(
      [...missing.map((dir) => `unlisted: ${dir}`), ...phantom.map((name) => `phantom: ${name}`)],
      `THE HUB'S INDEX DISAGREES WITH THE SKILL SET\n` +
        `  rule: the first turn points the agent at ${HUB} and the hub is where it learns the rest exist — a skill it does not list is never read, a name it lists that has no directory is a dead end`,
    ).toEqual([]);
  });

  describe("the dialect's fence languages", () => {
    const exported = [...sourceOf(FENCE_LANGS).matchAll(EXPORTED_LANG)].map(
      (match) => match.groups?.lang ?? "",
    );

    it("finds both sides and the seed notes at all", () => {
      expect(
        exported.length,
        `${FENCE_LANGS} exports no *_LANG literal a skill teaches`,
      ).toBeGreaterThan(1);
      expect(taughtFenceLangs().length).toBeGreaterThan(1);
      expect(seedNotes().length, `no tracked .md under ${SEED_DIR}`).toBeGreaterThan(1);
    });

    it("are taught exactly as the parser spells them", () => {
      const drift = fenceLangDrift(exported, taughtFenceLangs());
      expect(
        drift,
        drift.length === 0
          ? ""
          : `SKILLS AND THE PARSER SPELL THE FENCES DIFFERENTLY\n${drift.map((line) => `  ${line}`).join("\n")}\n` +
              `  rule: ${UNKNOWN_RULE}, and a skill that teaches one has the agent write blocks nobody sees; a fence no skill teaches is a construct the agent never writes`,
      ).toEqual([]);
    });

    it("are seeded only as the parser spells them", () => {
      const seeded = unknownOpenings(exported, seededFenceLangs());
      expect(
        seeded,
        seeded.length === 0
          ? ""
          : `A SEED NOTE OPENS A FENCE THE PARSER DOES NOT KNOW\n${seeded.map((line) => `  ${line}`).join("\n")}\n` +
              `  rule: ${UNKNOWN_RULE}; the seed is what a new user reads first and copies`,
      ).toEqual([]);
    });

    it("catches a renamed spelling from both sides", () => {
      const [lang = "", ...rest] = exported;
      const drift = fenceLangDrift([`${lang}s`, ...rest], taughtFenceLangs());
      expect(drift.some((line) => line.includes(`opens \`${lang}\``))).toBe(true);
      expect(drift.some((line) => line.includes(`exports \`${lang}s\``))).toBe(true);
    });

    it("catches an unknown fence however it opens", () => {
      const lang = "inteligir-unknown";
      const ticks = "`".repeat(3);
      const note = [
        `${ticks}${lang}`,
        "info",
        ticks,
        "",
        "- item",
        "",
        `  ~~~~${lang} x`,
        "  ~~~~",
      ];
      expect(unknownOpenings(exported, fenceOpenings("note.md", note.join("\n")))).toEqual([
        `note.md:1 — opens \`${lang}\`, which ${FENCE_LANGS} does not export`,
        `note.md:7 — opens \`${lang}\`, which ${FENCE_LANGS} does not export`,
      ]);
    });
  });
});
