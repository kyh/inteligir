import { loadSkills } from "@earendil-works/pi-coding-agent";

import type { SkillInfo } from "@repo/bridge/ipc-registry";

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
 * collisions already resolved. Returns the IPC contract's `SkillInfo` — a
 * plain projection of pi's `Skill` that serializes over the Bridge.
 */
export function listSkills(options: ListSkillsOptions): SkillInfo[] {
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
