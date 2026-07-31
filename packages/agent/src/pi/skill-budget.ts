// Skills are user-writable input to the system prompt: `~/.inteligir/skills`
// is a folder anyone (the user, an agent, an installer) can drop a SKILL.md
// into, and every loaded skill's name + description + path is injected into
// EVERY turn's prompt. Nothing upstream bounds that — pi warns when a
// description exceeds the Agent Skills spec's limit but loads the skill
// anyway — so the bound lives here, as ONE pure function both the agent's
// resource loader and the Settings listing run, so the list the user sees is
// the set the model is told about.
//
// What the bound sheds is DESCRIPTION CHARACTERS, not skills. A skill the
// model knows by name alone is still invocable; a skill missing from the
// listing cannot be reached at all. So the total budget is spread across the
// whole set by fair share (water-filling): short descriptions survive intact
// and only the longest are clipped, never below
// MAX_TOTAL_SKILL_DESCRIPTION_CHARS / MAX_SKILLS characters each. The skill
// COUNT ceiling is the one thing that can still keep a skill out of the
// prompt, and it is a backstop against a pathological folder rather than a
// routine trim.

import type { SkillBudgetState } from "@repo/bridge/ipc-registry";

/** The fields the budget reasons about. pi's `Skill` and the Bridge's
 * `SkillInfo` both satisfy it, which is what lets one function serve both
 * the agent path and the Settings path. */
export type BudgetableSkill = {
  name: string;
  description: string;
  filePath: string;
};

/** Per-skill description cap. Descriptions are clipped to it before anything
 * else, so no caller — prompt or listing — is ever handed an unbounded one. */
export const MAX_SKILL_DESCRIPTION_CHARS = 1536;

/** Total description budget across all skills, in characters. The bundled
 * browser skill's description is ~410 chars, so this holds ~39 skills of that
 * size (~4k tokens) — spent on every single turn, which is what makes the
 * ceiling worth having. Past it, descriptions shrink; the skills stay. */
export const MAX_TOTAL_SKILL_DESCRIPTION_CHARS = 16_000;

/** Cap on how many skills reach the prompt at all. Descriptions shrink to fit
 * long before this bites; what it bounds is the per-entry name + absolute path
 * (~150 chars each) and the dilution of the model's selection. Far above the
 * bundled skill plus a hand-curated personal set. */
export const MAX_SKILLS = 50;

/** Fair share, so the guaranteed floor is a number and not a hope: with the
 * count ceiling in force, water-filling can never grant a description less
 * than this — enough to route the model to the skill. */
export const MIN_GRANTED_DESCRIPTION_CHARS = Math.floor(
  MAX_TOTAL_SKILL_DESCRIPTION_CHARS / MAX_SKILLS,
);

export type BudgetedSkill<T extends BudgetableSkill> = {
  /** The skill as the prompt receives it — description already clamped. */
  skill: T;
  budget: SkillBudgetState;
};

export type SkillBudgetResult<T extends BudgetableSkill> = {
  /** Every input skill, name-ordered and annotated — including any the count
   * ceiling kept out of the prompt. The Settings listing renders this. */
  entries: BudgetedSkill<T>[];
  /** Just the skills the prompt receives. */
  skills: T[];
};

/** Total order over skills, so which skills survive an over-budget folder is
 * a function of their names alone — never of readdir order, which varies by
 * filesystem and would make the prompt differ between machines and between
 * boots on the same machine. */
function compareSkills(a: BudgetableSkill, b: BudgetableSkill): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  return 0;
}

/** Clip to `limit` characters, the last of which is an ellipsis so a clipped
 * description reads as clipped to the model. */
function clip(description: string, limit: number): string {
  if (description.length <= limit) return description;
  if (limit <= 1) return "";
  return `${description.slice(0, limit - 1)}…`;
}

function withDescription<T extends BudgetableSkill>(skill: T, description: string): T {
  return description === skill.description ? skill : { ...skill, description };
}

/**
 * Water-fill `total` characters across `lengths`: shortest first, each taking
 * at most an equal share of what is left over. A verbose description cannot
 * starve its neighbours, and because the share only grows as short entries
 * hand back their surplus, every entry is granted at least
 * `floor(total / lengths.length)` characters.
 */
function allocate(lengths: readonly number[], total: number): number[] {
  const shortestFirst = lengths
    .map((length, index) => ({ length, index }))
    .toSorted((a, b) => a.length - b.length || a.index - b.index);
  const granted: number[] = Array.from({ length: lengths.length }, () => 0);
  let remaining = total;
  let unallocated = lengths.length;
  for (const { length, index } of shortestFirst) {
    const grant = Math.min(length, Math.floor(remaining / unallocated));
    granted[index] = grant;
    remaining -= grant;
    unallocated -= 1;
  }
  return granted;
}

/**
 * Bound the prompt cost of a skill set. Returns every skill — name-ordered,
 * descriptions clamped — annotated with what the prompt actually got, plus the
 * subset that reached the prompt at all. Nothing is silently lost: a skill
 * past the count ceiling still comes back, marked `not-loaded`.
 */
export function applySkillBudget<T extends BudgetableSkill>(
  skills: readonly T[],
): SkillBudgetResult<T> {
  const ordered = skills.toSorted(compareSkills);
  // The per-skill cap applies to listed and unlisted skills alike — it bounds
  // what crosses the wire as much as what reaches the model.
  const listed = ordered.slice(0, MAX_SKILLS).map((skill) => ({
    skill,
    capped: clip(skill.description, MAX_SKILL_DESCRIPTION_CHARS),
  }));
  const granted = allocate(
    listed.map((entry) => entry.capped.length),
    MAX_TOTAL_SKILL_DESCRIPTION_CHARS,
  );

  const entries: BudgetedSkill<T>[] = listed.map(({ skill, capped }, index) => {
    const description = clip(capped, granted[index] ?? capped.length);
    return {
      skill: withDescription(skill, description),
      budget:
        description === skill.description
          ? { kind: "loaded" }
          : {
              kind: "description-trimmed",
              promptChars: description.length,
              originalChars: skill.description.length,
            },
    };
  });

  const overflow: BudgetedSkill<T>[] = ordered.slice(MAX_SKILLS).map((skill) => ({
    skill: withDescription(skill, clip(skill.description, MAX_SKILL_DESCRIPTION_CHARS)),
    budget: { kind: "not-loaded", reason: "skill-count" },
  }));

  return {
    entries: [...entries, ...overflow],
    skills: entries.map((entry) => entry.skill),
  };
}

/** A budget outcome worth telling someone about, shaped for both pi's
 * `ResourceDiagnostic` and a log line. */
export type SkillBudgetNotice = { message: string; path: string };

const NOT_LOADED_REASON_TEXT = {
  "skill-count": `more than ${MAX_SKILLS} skills found`,
} as const;

/** One notice per skill the budget changed. Empty when everything fit, which
 * is the normal case — callers can log the whole array unconditionally. */
export function skillBudgetNotices<T extends BudgetableSkill>(
  entries: readonly BudgetedSkill<T>[],
): SkillBudgetNotice[] {
  const notices: SkillBudgetNotice[] = [];
  for (const { skill, budget } of entries) {
    if (budget.kind === "loaded") continue;
    notices.push({
      path: skill.filePath,
      message:
        budget.kind === "not-loaded"
          ? `skill "${skill.name}" is not available to the agent: ${NOT_LOADED_REASON_TEXT[budget.reason]}`
          : `skill "${skill.name}" description shortened to ${budget.promptChars} characters ` +
            `(was ${budget.originalChars}) to fit the skill listing budget`,
    });
  }
  return notices;
}
