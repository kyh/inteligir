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
const EXPORTED_LANG = /^export const (?<name>\w+_LANG) = "(?<lang>[^"]+)";$/gmu;
// a spelling the parser still reads and round-trips for the notes that hold one, and nothing
// writes new: the constant's name carries the verdict, so the guard and the file cannot disagree.
const COMPAT_PREFIX = "COMPAT_";
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

interface ExportedLang {
  name: string;
  lang: string;
}

interface FenceSite {
  lang: string;
  site: string;
}

const isCompat = ({ name }: ExportedLang): boolean => name.startsWith(COMPAT_PREFIX);

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

const fenceLangDrift = (
  exported: readonly ExportedLang[],
  taught: readonly FenceSite[],
): string[] => [
  ...taught
    .filter(({ lang }) => !exported.some((entry) => entry.lang === lang))
    .map(({ lang, site }) => `${site} — teaches \`${lang}\`, which ${FENCE_LANGS} does not export`),
  ...exported
    .filter((entry) => !isCompat(entry) && !taught.some(({ lang }) => lang === entry.lang))
    .map(({ lang }) => `${FENCE_LANGS} — exports \`${lang}\`, which no skill's example fence uses`),
];

const compatOpenings = (exported: readonly ExportedLang[], sites: readonly FenceSite[]): string[] =>
  sites.flatMap(({ lang, site }) => {
    const compat = exported.find((entry) => entry.lang === lang && isCompat(entry));
    return compat === undefined
      ? []
      : [`${site} — opens \`${lang}\`, which ${FENCE_LANGS} exports as ${compat.name}`];
  });

const COMPAT_RULE =
  "a read-compat fence is rendered and round-tripped for the notes that already hold one, never written new: the editor cannot insert it, and the callout is the GitHub alert (`> [!NOTE]`)";

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
    const exported: ExportedLang[] = [...sourceOf(FENCE_LANGS).matchAll(EXPORTED_LANG)].map(
      (match) => ({ lang: match.groups?.lang ?? "", name: match.groups?.name ?? "" }),
    );
    const teachable = exported.filter((entry) => !isCompat(entry));
    const compat = exported.filter(isCompat);

    it("finds both sides at all", () => {
      expect(
        teachable.length,
        `${FENCE_LANGS} exports no *_LANG literal a skill teaches`,
      ).toBeGreaterThan(1);
      expect(taughtFenceLangs().length).toBeGreaterThan(1);
    });

    it("finds the read-compat callout and the seed notes, so the sweeps below cannot pass empty", () => {
      expect(
        compat.map(({ name }) => name),
        `${FENCE_LANGS} exports no ${COMPAT_PREFIX}*_LANG literal`,
      ).toContain("COMPAT_CALLOUT_LANG");
      expect(seedNotes().length, `no tracked .md under ${SEED_DIR}`).toBeGreaterThan(1);
    });

    it("are taught exactly as the parser spells them", () => {
      const drift = fenceLangDrift(exported, taughtFenceLangs());
      expect(
        drift,
        drift.length === 0
          ? ""
          : `SKILLS AND THE PARSER SPELL THE FENCES DIFFERENTLY\n${drift.map((line) => `  ${line}`).join("\n")}\n` +
              `  rule: a fence the parser does not know opens as plain code, so a skill that teaches it has the agent write blocks nobody sees; a fence no skill teaches is a construct the agent never writes (a ${COMPAT_PREFIX}* spelling excepted: it is never taught)`,
      ).toEqual([]);
    });

    it("never include a read-compat spelling in a skill", () => {
      const taught = compatOpenings(exported, taughtFenceLangs());
      expect(
        taught,
        taught.length === 0
          ? ""
          : `A SKILL TEACHES A READ-COMPAT FENCE\n${taught.map((line) => `  ${line}`).join("\n")}\n` +
              `  rule: ${COMPAT_RULE}; a skill that teaches one has every agent write it`,
      ).toEqual([]);
    });

    it("never include a read-compat spelling in a seed note", () => {
      const seeded = compatOpenings(exported, seededFenceLangs());
      expect(
        seeded,
        seeded.length === 0
          ? ""
          : `A SEED NOTE OPENS A READ-COMPAT FENCE\n${seeded.map((line) => `  ${line}`).join("\n")}\n` +
              `  rule: ${COMPAT_RULE}; the seed is what a new user reads first and copies, so it shows the alert`,
      ).toEqual([]);
    });

    it("catches a renamed spelling from both sides", () => {
      const [first, ...rest] = teachable;
      const lang = first?.lang ?? "";
      const drift = fenceLangDrift(
        [{ lang: `${lang}s`, name: first?.name ?? "" }, ...rest, ...compat],
        taughtFenceLangs(),
      );
      expect(drift.some((line) => line.includes(`teaches \`${lang}\``))).toBe(true);
      expect(drift.some((line) => line.includes(`exports \`${lang}s\``))).toBe(true);
    });

    it("catches a read-compat fence however it opens", () => {
      const [{ lang, name } = { lang: "", name: "" }] = compat;
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
      expect(compatOpenings(exported, fenceOpenings("note.md", note.join("\n")))).toEqual([
        `note.md:1 — opens \`${lang}\`, which ${FENCE_LANGS} exports as ${name}`,
        `note.md:7 — opens \`${lang}\`, which ${FENCE_LANGS} exports as ${name}`,
      ]);
    });
  });
});
