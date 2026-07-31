import fs from "node:fs";
import path from "node:path";

import { loadSkills } from "@earendil-works/pi-coding-agent";
import type { ResourceDiagnostic, Skill } from "@earendil-works/pi-coding-agent";

import type { SkillInfo, SkillSource } from "@repo/bridge/ipc-registry";
import {
  applySkillBudget,
  skillBudgetNotices,
  type BudgetableSkill,
  type BudgetedSkill,
} from "./skill-budget";

export type ListSkillsOptions = {
  /** Working directory — project skills live under `<cwd>/.pi/skills`. */
  cwd: string;
  /** Agent config directory — user skills live under `<agentDir>/skills`. */
  agentDir: string;
  /** Directory of the skills the app SHIPS (`<resources>/agent/skills`). Read
   * only for its folder NAMES: seeding copies those folders into
   * `<agentDir>/skills`, so the copy's path can't say where it came from. */
  bundledSkillsDir: string;
};

/**
 * Apply the prompt budget and surface what it changed: pi's diagnostics for
 * the session, plus the console (teed to `~/.inteligir/logs/agent.log`) so a
 * shortened or unloaded skill is discoverable outside a running session.
 *
 * The ONE entry point for budgeting. Both callers — the agent's resource
 * loader and the Settings listing — go through it, so Settings can never
 * advertise more of a skill than the model was told about.
 */
export function budgetSkills<T extends BudgetableSkill>(
  skills: readonly T[],
): { entries: BudgetedSkill<T>[]; skills: T[]; diagnostics: ResourceDiagnostic[] } {
  const { entries, skills: kept } = applySkillBudget(skills);
  const notices = skillBudgetNotices(entries);
  for (const notice of notices) {
    console.warn(`[agent] skill budget: ${notice.message} — ${notice.path}`);
  }
  return {
    entries,
    skills: kept,
    diagnostics: notices.map(({ message, path: noticePath }) => ({
      type: "warning",
      message,
      path: noticePath,
    })),
  };
}

/** pi resource-loader hook (`DefaultResourceLoaderOptions.skillsOverride`):
 * the budget applied to the skills a session is about to load, with its
 * notices appended to the loader's own diagnostics. */
export function budgetSkillsOverride(base: {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
  const budgeted = budgetSkills(base.skills);
  return {
    skills: budgeted.skills,
    diagnostics: [...base.diagnostics, ...budgeted.diagnostics],
  };
}

/** Folder names under the app's shipped skills dir. Missing dir (dev checkout
 * without built resources) → nothing is bundled, which reads as "added": a
 * wrong label is better than a fabricated one. */
function bundledFolderNames(dir: string): ReadonlySet<string> {
  try {
    return new Set(
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );
  } catch {
    return new Set();
  }
}

/** epoch ms of the SKILL.md itself — pi's `Skill` carries no mtime, so the
 * host stats the file it already knows the path of. */
function lastModified(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function skillSource(
  skill: Skill,
  userSkillsRoot: string,
  bundled: ReadonlySet<string>,
): SkillSource {
  const folder = path.resolve(skill.baseDir);
  if (path.dirname(folder) !== userSkillsRoot) return "added";
  return bundled.has(path.basename(folder)) ? "bundled" : "added";
}

/**
 * Discover skills the same way pi does at session start, straight from disk so
 * it works regardless of agent lifecycle state. Covers both the user scope
 * (`<agentDir>/skills`) and the project scope (`<cwd>/.pi/skills`), with name
 * collisions already resolved, then applies the same prompt budget a session
 * does. Returns the IPC contract's `SkillInfo` — a plain projection of pi's
 * `Skill` that serializes over the Bridge, carrying what the budget did to
 * each one so a row can say so.
 */
export function listSkills(options: ListSkillsOptions): SkillInfo[] {
  const { skills } = loadSkills({
    cwd: options.cwd,
    agentDir: options.agentDir,
    skillPaths: [],
    includeDefaults: true,
  });
  const userSkillsRoot = path.resolve(options.agentDir, "skills");
  const bundled = bundledFolderNames(options.bundledSkillsDir);
  return budgetSkills(skills).entries.map(({ skill, budget }) => ({
    name: skill.name,
    description: skill.description,
    scope: skill.sourceInfo.scope,
    filePath: skill.filePath,
    source: skillSource(skill, userSkillsRoot, bundled),
    updatedAt: lastModified(skill.filePath),
    budget,
  }));
}
