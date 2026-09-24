// The skills reach an agent as files: the CLI resolves ONE probe file through the package's
// exports map and hands the directory over. A renamed probe resolves nothing, and the resolver
// answers null rather than throwing, so the pointer disappears from every checkout with no error
// anywhere. This holds the probe, the set and the hub's index together.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, sourceOf } from "./repo";

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
const TAUGHT_FENCE = /^\s*`{3,}(?<lang>inteligir-[a-z-]+)\s*$/u;

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

interface TaughtLang {
  lang: string;
  site: string;
}

const taughtFenceLangs = (): TaughtLang[] =>
  skillDirs().flatMap((dir) =>
    (skillText(dir) ?? "").split("\n").flatMap((line, index) => {
      const lang = TAUGHT_FENCE.exec(line)?.groups?.lang;
      return lang === undefined
        ? []
        : [{ lang, site: `${SKILLS_DIR}/${dir}/SKILL.md:${String(index + 1)}` }];
    }),
  );

const fenceLangDrift = (exported: readonly string[], taught: readonly TaughtLang[]): string[] => [
  ...taught
    .filter(({ lang }) => !exported.includes(lang))
    .map(({ lang, site }) => `${site} — teaches \`${lang}\`, which ${FENCE_LANGS} does not export`),
  ...exported
    .filter((lang) => !taught.some((entry) => entry.lang === lang))
    .map((lang) => `${FENCE_LANGS} — exports \`${lang}\`, which no skill's example fence uses`),
];

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

  describe("the fence languages the skills teach", () => {
    const exported = [...sourceOf(FENCE_LANGS).matchAll(EXPORTED_LANG)].map(
      (match) => match.groups?.lang ?? "",
    );

    it("finds both sides at all", () => {
      expect(exported.length, `${FENCE_LANGS} exports no *_LANG literal`).toBeGreaterThan(1);
      expect(taughtFenceLangs().length).toBeGreaterThan(1);
    });

    it("are exactly the ones the parser spells", () => {
      const drift = fenceLangDrift(exported, taughtFenceLangs());
      expect(
        drift,
        drift.length === 0
          ? ""
          : `SKILLS AND THE PARSER SPELL THE FENCES DIFFERENTLY\n${drift.map((line) => `  ${line}`).join("\n")}\n` +
              `  rule: a fence the parser does not know opens as plain code, so a skill that teaches it has the agent write blocks nobody sees; a fence no skill teaches is a construct the agent never writes`,
      ).toEqual([]);
    });

    it("catches a renamed spelling from both sides", () => {
      const [first = "", ...rest] = exported;
      const drift = fenceLangDrift([`${first}s`, ...rest], taughtFenceLangs());
      expect(drift.some((line) => line.includes(`teaches \`${first}\``))).toBe(true);
      expect(drift.some((line) => line.includes(`exports \`${first}s\``))).toBe(true);
    });
  });
});
