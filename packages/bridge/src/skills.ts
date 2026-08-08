// ---------------------------------------------------------------------------
// Skills — `skills/<slug>/SKILL.md` folders in the user's own vault, as the
// listing and the scaffold channel describe them.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

/** How widely a skill applies. Skills live in the vault, so every one of them
 * is the user's own and this host only ever answers `user`. */
export type SkillScope = "user" | "project" | "temporary";

/** Where a skill came from, as far as the app can honestly tell. There is no
 * publisher or author concept here: "added" means someone put the folder in
 * the vault (the user, or an agent). Nothing is shipped into a vault after the
 * seed, so this host only ever answers `added`. */
export type SkillSource = "bundled" | "added";

/** What the agent's system prompt actually received for a skill.
 *
 * The listing budget sheds description CHARACTERS before it sheds skills — a
 * skill the model knows by name alone is still invocable, a skill missing from
 * the listing is not — so `description-trimmed` is the routine outcome and
 * `not-loaded` is the backstop for a pathological skills folder. */
export type SkillBudgetState =
  /** Whole description reached the prompt. */
  | { kind: "loaded" }
  /** Name reached the prompt; the description was clipped to `promptChars`. */
  | { kind: "description-trimmed"; promptChars: number; originalChars: number }
  /** Nothing reached the prompt — the agent cannot invoke this skill. */
  | { kind: "not-loaded"; reason: "skill-count" };

/** One `skills/<slug>/SKILL.md` in the vault, as the listing reports it. */
export type SkillInfo = {
  name: string;
  /** The description as the prompt received it — already clamped by the
   * budget. `budget` says whether that is all of what is on disk. */
  description: string;
  scope: SkillScope;
  filePath: string;
  source: SkillSource;
  /** SKILL.md mtime as epoch MILLISECONDS, or null when it can't be stat'd.
   * A number on purpose: formatting a date is the client's job and the wire
   * stays locale-free. */
  updatedAt: number | null;
  budget: SkillBudgetState;
};

export type SkillsList = {
  skills: SkillInfo[];
};

/** Result of createSkill: the skill that was just written, plus the refreshed
 * listing so the caller needs no follow-up round trip. */
export type SkillCreated = {
  skill: SkillInfo;
  skills: SkillInfo[];
};

// `name` is a display name, not a path — the host slugifies it and refuses
// anything that doesn't reduce to a `[a-z0-9-]` folder name, so no traversal
// can cross this schema. `description` is capped at the Agent Skills
// description limit — a description written over the cap would be clipped
// back out on the very next listing.
export const CreateSkillSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 64 }),
    description: Type.String({ minLength: 1, maxLength: 1536 }),
    /** SKILL.md body — the instructions themselves. Empty gets a placeholder
     * body, so a caller can scaffold first and write later. */
    instructions: Type.String({ maxLength: 100_000 }),
  },
  { additionalProperties: false },
);
