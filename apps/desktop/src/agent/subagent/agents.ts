/**
 * Subagent definition discovery.
 *
 * A subagent is a Markdown file with YAML frontmatter (name, description,
 * optional tools/model) and a body that becomes the subagent's system prompt.
 * Definitions live alongside everything else pi discovers:
 *   - user scope:    <agentDir>/agents/*.md      (~/.inteligir/agents)
 *   - project scope: <cwd>/.pi/agents/*.md       (nearest ancestor)
 * Project defs override user defs on name collision.
 *
 * Kept self-contained (no pi internals) so it works regardless of agent
 * lifecycle state, mirroring how skills.ts in @repo/pi-driver reads from disk.
 */

import fs from "node:fs";
import path from "node:path";

export type AgentSource = "user" | "project";

export type AgentConfig = {
  name: string;
  description: string;
  /** Restrict the subagent to this comma-allowlist of built-in tools. */
  tools?: string[];
  /** Override the model; omitted defs inherit the host default. */
  model?: string;
  /** Markdown body — appended to the subagent's system prompt. */
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
};

/**
 * Minimal frontmatter split. Definitions use simple single-line `key: value`
 * scalars; anything else in the block is ignored. Returns an empty frontmatter
 * when the file has no leading `---` fence.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body: match[2] ?? "" };
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents: AgentConfig[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model || undefined,
      systemPrompt: body,
      source,
      filePath,
    });
  }
  return agents;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let current = cwd;
  for (;;) {
    const candidate = path.join(current, ".pi", "agents");
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* not here, keep walking up */
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Discover subagent definitions across user and project scope. */
export function discoverAgents(agentDir: string, cwd: string): AgentConfig[] {
  const userAgents = loadAgentsFromDir(path.join(agentDir, "agents"), "user");
  const projectDir = findNearestProjectAgentsDir(cwd);
  const projectAgents = projectDir ? loadAgentsFromDir(projectDir, "project") : [];

  const byName = new Map<string, AgentConfig>();
  for (const agent of userAgents) byName.set(agent.name, agent);
  for (const agent of projectAgents) byName.set(agent.name, agent);
  return [...byName.values()];
}
