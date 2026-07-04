import { loadSkills } from "@mariozechner/pi-coding-agent";

/**
 * Plain projection of pi's `Skill` so callers can serialize it over IPC.
 * Structurally mirrors core's `SkillInfo` (the IPC contract type); the two are
 * kept in lockstep at the host boundary, where `listSkills()` here feeds
 * `host/agent/setup.ts::listSkills(): SkillInfo[]` — a drift makes that
 * assignment a type error. Defined locally so this vendor wrapper stays a leaf
 * (no @repo/features dependency, no pulling core's module graph into its compile).
 */
export type PiAgentSkill = {
  name: string;
  description: string;
  /** Where the skill came from, e.g. "user", "project", or a package name. */
  source: string;
  /** "user" (<agentDir>/skills) or "project" (<cwd>/.pi/skills). */
  scope: string;
  filePath: string;
  /** True when the skill is invoke-only (excluded from the model's prompt). */
  disableModelInvocation: boolean;
};

export type ListSkillsOptions = {
  /** Working directory — project skills live under `<cwd>/.pi/skills`. */
  cwd: string;
  /** Agent config directory — user skills live under `<agentDir>/skills`. */
  agentDir: string;
};

/**
 * Discover skills the same way pi does at session start, straight from disk so
 * it works regardless of agent lifecycle state. Covers both the user scope
 * (`<agentDir>/skills`) and the project scope (`<cwd>/.pi/skills`), with name
 * collisions already resolved.
 */
export function listSkills(options: ListSkillsOptions): PiAgentSkill[] {
  const { skills } = loadSkills({
    cwd: options.cwd,
    agentDir: options.agentDir,
    skillPaths: [],
    includeDefaults: true,
  });
  return skills.map((s) => ({
    name: s.name,
    description: s.description,
    source: s.sourceInfo.source,
    scope: s.sourceInfo.scope,
    filePath: s.filePath,
    disableModelInvocation: s.disableModelInvocation,
  }));
}
