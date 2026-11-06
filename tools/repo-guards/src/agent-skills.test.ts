// The skills are the built-in agent's dialect, and its system prompt is built from them:
// apps/web/scripts/agent-prompt.ts writes the prompt every conversation freezes as a module of the
// Worker's, from this package in the order the hub's index names the skills. This holds the set and
// the hub's index together, and the module to what the script writes.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./repo";

const SKILLS_DIR = "packages/agent-skills/skills";
const HUB = "inteligir-notes";
const HUB_INDEX_HEADING = "## Focused Contracts";

const FRONTMATTER_NAME = /^name:\s*(?<name>\S+)\s*$/mu;
const FRONTMATTER_DESCRIPTION = /^description:\s*(?<description>\S.*)$/mu;
const HUB_ROW = /^- .*`(?<skill>inteligir-[a-z-]+)`/gmu;

// read as text: @repo/notes is no dependency of this package, and the constants are plain literals.
const FENCE_LANGS = "packages/notes/src/markdown/fence-langs.ts";
const EXPORTED_LANG = /^export const \w+_LANG = "(?<lang>[^"]+)";$/gmu;
const FENCE_OPENING = /^\s*(?:`{3,}|~{3,})\s*(?<lang>inteligir-[a-z-]+)(?=\s|$)/u;

const AGENT_PROMPT_SCRIPT = "apps/web/scripts/agent-prompt.ts";

const readRepoFile = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");

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
    const exported = [...readRepoFile(FENCE_LANGS).matchAll(EXPORTED_LANG)].map(
      (match) => match.groups?.lang ?? "",
    );

    it("finds both sides at all", () => {
      expect(
        exported.length,
        `${FENCE_LANGS} exports no *_LANG literal a skill teaches`,
      ).toBeGreaterThan(1);
      expect(taughtFenceLangs().length).toBeGreaterThan(1);
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

describe("the built-in agent's system prompt", () => {
  it("is what scripts/agent-prompt.ts writes from the skills", { timeout: 30_000 }, () => {
    // node starts and reads every skill: well under a second here, seconds on a loaded runner;
    // the script refuses a prompt past its cap, and writes nothing of an account or a request
    expect(() =>
      execFileSync("node", [AGENT_PROMPT_SCRIPT, "--check"], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
