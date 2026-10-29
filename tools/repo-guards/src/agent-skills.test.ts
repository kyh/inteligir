// The skills are the built-in agent's dialect, and its system prompt is built from them:
// apps/web/scripts/agent-files.ts writes each target's agent.md for `ant apply` from this package,
// in the order the hub's index names the skills. This holds the set and the hub's index together,
// the agent files to what the script writes, and what those files declare to the shape an agent
// whose only tools are the connector's needs.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { REPO_ROOT, trackedFiles } from "./repo";

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

// the starter vault a first run copies: the notes a new user reads first and imitates after.
const SEED_DIR = "apps/cli/seed/";

const AGENT_FILES_SCRIPT = "apps/web/scripts/agent-files.ts";
const AGENT_TARGETS = ["production", "preview"] as const;
const agentFile = (target: string, name: string): string =>
  `apps/web/agents/${target}/library-agent/${name}`;

// Managed Agents takes a system prompt of at most this many characters
const SYSTEM_MAX_CHARS = 100_000;

const readRepoFile = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");

// an agent.md as ant reads it: YAML frontmatter, and the body, trimmed, as its `system`
const AGENT_FILE = /^---\n(?<frontmatter>[\s\S]*?)\n---\n(?<body>[\s\S]*)$/u;

interface AgentFile {
  readonly frontmatter: unknown;
  readonly system: string;
}

const agentOf = (target: string): AgentFile => {
  const groups = AGENT_FILE.exec(readRepoFile(agentFile(target, "agent.md")))?.groups;
  if (groups === undefined) {
    throw new Error(`${agentFile(target, "agent.md")}: expected frontmatter, then the prompt`);
  }
  return { frontmatter: parse(groups["frontmatter"] ?? ""), system: (groups["body"] ?? "").trim() };
};

// what a connector-only agent declares: one url server, credential-free, and one toolset for it,
// an allowlist; no agent toolset, no custom tool and no skills
const connectorOnlyAgent = z.strictObject({
  description: z.string().min(1),
  mcp_servers: z.tuple([
    z.strictObject({ name: z.literal("library"), type: z.literal("url"), url: z.url() }),
  ]),
  model: z.strictObject({ effort: z.string().min(1), id: z.string().min(1) }),
  name: z.string().min(1),
  tools: z.tuple([
    z.strictObject({
      configs: z
        .array(
          z.strictObject({
            enabled: z.literal(true),
            name: z.string().min(1),
            permission_policy: z.strictObject({ type: z.enum(["always_allow", "always_ask"]) }),
          }),
        )
        .min(1),
      default_config: z.strictObject({ enabled: z.literal(false) }),
      mcp_server_name: z.literal("library"),
      type: z.literal("mcp_toolset"),
    }),
  ]),
});

// a limited network that reaches MCP servers and nothing else: no packages, no hosts
const mcpOnlyEnvironment = z.strictObject({
  config: z.strictObject({
    networking: z.strictObject({ allow_mcp_servers: z.literal(true), type: z.literal("limited") }),
    type: z.literal("cloud"),
  }),
  description: z.string().min(1),
  name: z.string().min(1),
});

// ant's own lockfile, which only `ant apply` writes: a resource it has not applied has no entry
const antLockfile = z.strictObject({
  origin: z
    .strictObject({
      base_url: z.string().optional(),
      organization_id: z.string().optional(),
      workspace_id: z.string().optional(),
    })
    .optional(),
  resources: z.record(
    z.string(),
    z.looseObject({ id: z.string().min(1), kind: z.string().min(1) }),
  ),
  version: z.literal(1),
});

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

describe("the built-in agent's files", () => {
  it("are what scripts/agent-files.ts writes from the skills", { timeout: 30_000 }, () => {
    // node starts and reads every skill: well under a second here, seconds on a loaded runner
    expect(() =>
      execFileSync("node", [AGENT_FILES_SCRIPT, "--check"], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("carry one system prompt for every target, within the API's cap", () => {
    const [first, ...rest] = AGENT_TARGETS.map((target) => agentOf(target).system);
    expect(first?.length ?? 0).toBeGreaterThan(0);
    expect(first?.length ?? 0).toBeLessThanOrEqual(SYSTEM_MAX_CHARS);
    // a prompt one target alone carries names something of that deployment, and a cached prefix
    // is the prompt's bytes
    for (const other of rest) {
      expect(other).toBe(first);
    }
  });

  it("each declare the connector alone, its tools an allowlist", () => {
    for (const target of AGENT_TARGETS) {
      const declared = connectorOnlyAgent.safeParse(agentOf(target).frontmatter);
      expect(declared.error?.issues ?? [], agentFile(target, "agent.md")).toEqual([]);
      const environment = mcpOnlyEnvironment.safeParse(
        parse(readRepoFile(agentFile(target, "environment.yaml"))),
      );
      expect(environment.error?.issues ?? [], agentFile(target, "environment.yaml")).toEqual([]);
    }
  });

  it("each keep a lockfile in ant's own shape", () => {
    for (const target of AGENT_TARGETS) {
      const file = agentFile(target, "claude-lock.json");
      const lock = antLockfile.safeParse(JSON.parse(readRepoFile(file)));
      expect(lock.error?.issues ?? [], file).toEqual([]);
    }
  });
});
