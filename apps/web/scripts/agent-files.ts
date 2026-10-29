// `pnpm --filter @repo/web agents`: writes the built-in agent's files for `ant apply`, one
// directory per target under agents/: `agent.md`, whose frontmatter is the agent
// (src/worker/agent/library-agent.ts) and whose body is its system prompt, and `environment.yaml`.
// The prompt is @repo/agent-skills as it stands, the agent's own instructions and then every
// skill in the order the hub lists them, with nothing of an account or a request in it, so its
// bytes change only with those files and a cached prefix holds across every session. Run it after
// editing either and commit what it writes; `--check` writes nothing and exits 1 when a file
// differs from what it would write (tools/repo-guards/src/agent-skills.test.ts runs it). Each
// directory's claude-lock.json is ant's, written by `ant apply` alone.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

import { CONNECTOR_PATH } from "@repo/contract/cloud/connector";
import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/cloud/origin";

import {
  AGENT_DESCRIPTION,
  AGENT_MODEL,
  AGENT_NAME,
  agentMcpServers,
  agentTools,
} from "../src/worker/agent/library-agent.ts";

// Managed Agents takes a system prompt of at most this many characters
// (platform.claude.com/docs/en/managed-agents/sessions, the override's `system`)
const SYSTEM_MAX_CHARS = 100_000;

const HUB = "inteligir-notes";
const HUB_INDEX_HEADING = "## Focused Contracts";
const HUB_ROW = /^- .*`(?<skill>inteligir-[a-z-]+)`/gmu;
const FRONTMATTER = /^---\n[\s\S]*?\n---\n/u;

// each target's connector, the address its applied agent declares. A preview's is a name no host
// answers (RFC 2606's `.invalid`): every preview session overrides the servers with its own PR's
// connector (src/worker/agent/session-agent.ts), so the applied agent's is never dialed
const TARGETS = [
  { connector: `${PRODUCTION_CLOUD_ORIGIN}${CONNECTOR_PATH}`, name: "production" },
  { connector: `https://preview.inteligir.invalid${CONNECTOR_PATH}`, name: "preview" },
] as const;

// a limited network that reaches the agent's MCP server and nothing else: no packages and no hosts,
// since the agent has no shell to use them (platform.claude.com/docs/en/managed-agents/mcp-connector)
const ENVIRONMENT = {
  config: { networking: { allow_mcp_servers: true, type: "limited" }, type: "cloud" },
  description: "The built-in agent's sandbox: no tools of its own, and only the library's server.",
  name: "inteligir-library-agent",
};

const webRoot = path.resolve(import.meta.dirname, "..");

const skillsFile = (relative: string): string =>
  readFileSync(fileURLToPath(import.meta.resolve(`@repo/agent-skills/${relative}`)), "utf-8");

const withoutFrontmatter = (text: string): string => text.replace(FRONTMATTER, "").trim();

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
  const system = parts.map(withoutFrontmatter).join("\n\n");
  if (system.length > SYSTEM_MAX_CHARS) {
    throw new Error(
      `the system prompt is ${String(system.length)} characters, over ${String(SYSTEM_MAX_CHARS)}`,
    );
  }
  return system;
};

const GENERATED =
  "# written by apps/web/scripts/agent-files.ts: edit that, or the skills, and run it";

const agentFile = (connector: string, system: string): string => {
  const frontmatter = stringify(
    {
      description: AGENT_DESCRIPTION,
      mcp_servers: agentMcpServers(connector),
      model: AGENT_MODEL,
      name: AGENT_NAME,
      tools: agentTools(),
    },
    { lineWidth: 0 },
  );
  // ant takes the body, trimmed, as the agent's `system`
  return `---\n${GENERATED}\n${frontmatter}---\n\n${system}\n`;
};

const environmentFile = (): string => `${GENERATED}\n${stringify(ENVIRONMENT, { lineWidth: 0 })}`;

const wanted = (): Map<string, string> => {
  const system = systemPrompt();
  const files = new Map<string, string>();
  for (const target of TARGETS) {
    const dir = path.join("agents", target.name, "library-agent");
    files.set(path.join(dir, "agent.md"), agentFile(target.connector, system));
    files.set(path.join(dir, "environment.yaml"), environmentFile());
  }
  return files;
};

const readOrNull = (file: string): string | null => {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return null;
  }
};

const check = process.argv.includes("--check");
const drifted: string[] = [];
for (const [relative, text] of wanted()) {
  const file = path.join(webRoot, relative);
  if (readOrNull(file) === text) {
    continue;
  }
  if (check) {
    drifted.push(`apps/web/${relative}`);
    continue;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote apps/web/${relative}`);
}
if (drifted.length > 0) {
  console.error(
    `${drifted.join("\n")}\ndiffers from what scripts/agent-files.ts writes: run \`pnpm --filter @repo/web agents\``,
  );
  process.exitCode = 1;
}
