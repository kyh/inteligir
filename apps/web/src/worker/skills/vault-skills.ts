// ---------------------------------------------------------------------------
// Skills live in the VAULT, at `skills/<slug>/SKILL.md`.
//
// THE DECISION, and the alternative it rejects. The obvious home is beside pi's
// own state on the container's filesystem, which is not a store at all: it is
// DELETED every time the container sleeps, which for an agent nobody is talking
// to is most of the time. A skill written there would be gone before the user
// finished reading the confirmation.
//
// The vault is the only durable, user-owned store this host has, and three
// things make it the right one rather than merely the available one:
//
//   • It is ALREADY materialized into the container on every wake, under
//     `./vault`. So a skill is a file the agent can actually open with its own
//     `read` tool — the body is reachable, not just the name.
//   • It is a markdown file in a folder, which is exactly what a skill is. The
//     user can edit one in the editor they already have open, and a skill that
//     drifts from what it claims is visible rather than hidden in app state.
//   • It syncs and backs up with everything else the user owns. App state does
//     not, and a skill someone spent an afternoon writing is not app state.
//
// The cost is honest and worth naming: `skills/` shows up in the sidebar like
// any other folder, and a user who deletes it deletes their skills. That is the
// same bargain every other thing in the vault makes.
//
// pi does NOT discover these — its own skills directory is inside a container
// that is wiped on every sleep. What reaches the model is the LISTING, rendered
// into the agent's instructions (../agent/agent-instructions), which is what
// pi's own skill loading does anyway: name + description in the prompt, body
// read on demand. Here the read is the agent's ordinary file tool.
// ---------------------------------------------------------------------------

import type { SkillBudgetState, SkillInfo } from "@repo/bridge/skills";
import { splitFrontmatter } from "@repo/notes/markdown/frontmatter";

import type { UserVault } from "../host/vault/user-vault";

/** The vault folder skills live in. */
export const SKILLS_DIR = "skills";

/** The one file a skill folder must contain. */
const SKILL_FILE = "SKILL.md";

/** Agent Skills spec: lowercase alphanumerics and single interior hyphens. */
const SKILL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_CHARS = 64;

/**
 * Per-skill description cap, and the total across the set.
 *
 * Every loaded skill's name and description reach the model in EVERY turn's
 * system prompt, so this is a recurring per-turn cost paid on a folder the user
 * (and the agent) can grow without limit.
 */
const MAX_SKILL_DESCRIPTION_CHARS = 1_536;
const MAX_TOTAL_SKILL_DESCRIPTION_CHARS = 16_000;

/** Cap on how many skills reach the prompt at all. Descriptions shrink to fit
 * long before this bites; what it bounds is the per-entry name + path and the
 * dilution of the model's selection. */
const MAX_SKILLS = 50;

/** One skill as it sits on disk, before the budget touches it. */
type RawSkill = {
  readonly slug: string;
  readonly path: string;
  readonly description: string;
  readonly updatedAt: number | null;
};

/**
 * Fold a display name into a folder name, or `null` when nothing usable
 * survives.
 *
 * The name is attacker-adjacent — it comes from a text field and names a
 * directory the system prompt will later point the model at — so it never
 * reaches a path. Every character outside `[a-z0-9]` becomes a separator, which
 * is what makes `.`, `/`, `\` and every unicode lookalike impossible to smuggle
 * through rather than merely unlikely to.
 */
export function toSkillSlug(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/, "");
  return SKILL_SLUG.test(slug) ? slug : null;
}

/** The vault path a slug's SKILL.md lives at. */
export function skillPath(slug: string): string {
  return `${SKILLS_DIR}/${slug}/${SKILL_FILE}`;
}

/** YAML double-quoted scalars are JSON strings, so quoting through
 * `JSON.stringify` is what stops a description containing `:`, a newline or a
 * quote from rewriting the frontmatter it lands in. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** Render a SKILL.md. `name` is the slug: a listing whose name differs from its
 * folder is confusing on every surface that shows both. */
export function renderSkillFile(slug: string, description: string, body: string): string {
  const trimmed = body.trim();
  return (
    ["---", `name: ${yamlString(slug)}`, `description: ${yamlString(description)}`, "---", ""].join(
      "\n",
    ) + `${trimmed === "" ? placeholderBody(slug) : trimmed}\n`
  );
}

function placeholderBody(slug: string): string {
  return [
    `# ${slug}`,
    "",
    "Describe what the agent should do when this skill applies — the steps, the",
    "tools to reach for, and anything it must not do.",
  ].join("\n");
}

/**
 * Every skill in the vault, name-ordered, with the budget already applied.
 *
 * The order is a function of the SLUG alone, never of manifest order, so which
 * skills survive an over-budget folder is stable across devices and across
 * boots.
 */
export async function listVaultSkills(vault: UserVault): Promise<SkillInfo[]> {
  const raw: RawSkill[] = [];
  for (const entry of vault.list()) {
    const slug = slugOfSkillPath(entry.path);
    if (slug === null) continue;
    let description = "";
    try {
      const { properties } = splitFrontmatter(await vault.readText(entry.path));
      const declared = properties["description"];
      if (typeof declared === "string") description = declared;
    } catch {
      // A skill whose file cannot be read still LISTS, with no description: the
      // user needs to see the folder that is broken, not a listing that quietly
      // omits it.
    }
    const file = vault.lookup(entry.path);
    raw.push({
      slug,
      path: entry.path,
      description,
      updatedAt: file === null ? null : file.updatedAt,
    });
  }
  raw.sort((a, b) => (a.slug === b.slug ? 0 : a.slug < b.slug ? -1 : 1));
  return applyBudget(raw);
}

/** Just the skills the prompt receives — name, clamped description, path. */
export function promptableSkills(skills: readonly SkillInfo[]): SkillInfo[] {
  return skills.filter((skill) => skill.budget.kind !== "not-loaded");
}

/** The slug a `skills/<slug>/SKILL.md` path names, or `null` for anything else
 * under the folder (a README, a nested asset, a stray note). */
function slugOfSkillPath(path: string): string | null {
  const segments = path.split("/");
  if (segments.length !== 3) return null;
  if (segments[0] !== SKILLS_DIR || segments[2] !== SKILL_FILE) return null;
  const slug = segments[1] ?? "";
  return SKILL_SLUG.test(slug) ? slug : null;
}

/**
 * Bound the prompt cost of the set.
 *
 * What the bound sheds is DESCRIPTION CHARACTERS, not skills: a skill the model
 * knows by name alone is still invocable, a skill missing from the listing is
 * not. Every entry gets an equal share of the total and is clipped only if it
 * exceeds its share, so short descriptions survive intact and only the longest
 * are cut. The count ceiling is the one thing that can keep a skill out of the
 * prompt entirely, and it is a backstop against a pathological folder rather
 * than a routine trim.
 */
function applyBudget(raw: readonly RawSkill[]): SkillInfo[] {
  const loadedCount = Math.min(raw.length, MAX_SKILLS);
  const share =
    loadedCount === 0
      ? MAX_SKILL_DESCRIPTION_CHARS
      : Math.min(
          MAX_SKILL_DESCRIPTION_CHARS,
          Math.floor(MAX_TOTAL_SKILL_DESCRIPTION_CHARS / loadedCount),
        );
  return raw.map((skill, index): SkillInfo => {
    const budget = skillBudget(skill.description.length, index, share);
    return {
      name: skill.slug,
      description: budget.kind === "loaded" ? skill.description : clip(skill.description, share),
      scope: "user",
      filePath: skill.path,
      source: "added",
      updatedAt: skill.updatedAt,
      budget,
    };
  });
}

function skillBudget(length: number, index: number, share: number): SkillBudgetState {
  if (index >= MAX_SKILLS) return { kind: "not-loaded", reason: "skill-count" };
  if (length <= share) return { kind: "loaded" };
  return { kind: "description-trimmed", promptChars: share, originalChars: length };
}

/** Clip to `limit`, the last character an ellipsis so a clipped description
 * reads as clipped to the model. */
function clip(description: string, limit: number): string {
  if (description.length <= limit) return description;
  if (limit <= 1) return "";
  return `${description.slice(0, limit - 1)}…`;
}
