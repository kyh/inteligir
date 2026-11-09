// `pnpm --filter @repo/service agent-prompt`: writes the built-in agent's system prompt into
// src/agent/agent-prompt.ts, the module every thread freezes its system from
// (src/agent/thread-request.ts). The prompt is @repo/agent-skills as it stands, the agent's
// own instructions and then every skill in the order the hub lists them, with nothing of an account
// or a request in it, so its bytes change only with those files and every conversation of every
// account reads one cached prefix. Run it after editing the skills and commit what it writes;
// `--check` writes nothing and exits 1 when the module differs from what it would write
// (tools/repo-guards/src/agent-skills.test.ts runs it).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// a prompt past this is one no turn should pay to cache: about 25,000 tokens
const SYSTEM_MAX_CHARS = 100_000;

const HUB = "inteligir-notes";
const HUB_INDEX_HEADING = "## Focused Contracts";
const HUB_ROW = /^- .*`(?<skill>inteligir-[a-z-]+)`/gmu;

const MODULE = "src/agent/agent-prompt.ts";

const serviceRoot = path.resolve(import.meta.dirname, "..");

const skillsFile = (relative: string): string =>
  readFileSync(fileURLToPath(import.meta.resolve(`@repo/agent-skills/${relative}`)), "utf-8");

// the hub's index, in its own order: the hub is read first and names where every other skill sits
const focusedSkills = (hub: string): string[] => {
  const headingAt = hub.indexOf(HUB_INDEX_HEADING);
  if (headingAt === -1) {
    throw new Error(`${HUB} has no "${HUB_INDEX_HEADING}" section`);
  }
  const nextHeading = hub.indexOf("\n## ", headingAt + HUB_INDEX_HEADING.length);
  const section = hub.slice(headingAt, nextHeading === -1 ? undefined : nextHeading);
  return [...section.matchAll(HUB_ROW)].map((match) => match.groups?.skill ?? "");
};

const systemPrompt = (): string => {
  const hub = skillsFile(`skills/${HUB}/SKILL.md`);
  const parts = [
    skillsFile("built-in-agent.md"),
    hub,
    ...focusedSkills(hub).map((skill) => skillsFile(`skills/${skill}/SKILL.md`)),
  ];
  const system = parts.map((part) => part.trim()).join("\n\n");
  if (system.length > SYSTEM_MAX_CHARS) {
    throw new Error(
      `the system prompt is ${String(system.length)} characters, over ${String(SYSTEM_MAX_CHARS)}`,
    );
  }
  return system;
};

// the module as the formatter leaves it: one string literal, on the line after its name
const moduleText = (system: string): string =>
  [
    "// Written by packages/service/scripts/agent-prompt.ts from @repo/agent-skills: edit the skills",
    "// or that script, then run `pnpm --filter @repo/service agent-prompt`. The built-in agent's",
    "// system prompt, the same bytes for every account and every turn.",
    "",
    "export const AGENT_SYSTEM_PROMPT =",
    `  ${JSON.stringify(system)};`,
    "",
  ].join("\n");

const readOrNull = (file: string): string | null => {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return null;
  }
};

const file = path.join(serviceRoot, MODULE);
const text = moduleText(systemPrompt());
if (readOrNull(file) !== text) {
  if (process.argv.includes("--check")) {
    console.error(
      `packages/service/${MODULE} differs from what scripts/agent-prompt.ts writes: run \`pnpm --filter @repo/service agent-prompt\``,
    );
    process.exitCode = 1;
  } else {
    writeFileSync(file, text);
    console.log(`wrote packages/service/${MODULE}`);
  }
}
