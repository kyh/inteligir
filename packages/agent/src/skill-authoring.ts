// ---------------------------------------------------------------------------
// Writing a new skill into `<agentDir>/skills`.
//
// A skill's folder name is attacker-adjacent input: it comes from a text field
// and names a directory the agent's system prompt will later read from. So the
// name never reaches the filesystem — a SLUG derived from it does, through a
// character class that cannot express a separator or a `..`, checked again
// against the resolved parent. Both halves are here, pure and testable,
// because path confinement asserted in a unit test is worth more than path
// confinement asserted in a code comment.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

/** Agent Skills spec: lowercase alphanumerics and single interior hyphens. */
const SKILL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_CHARS = 64;

export type NewSkill = {
  /** Display name as typed; slugified before it touches disk. */
  name: string;
  description: string;
  /** SKILL.md body. Empty gets a placeholder. */
  instructions: string;
};

export type WrittenSkill = {
  /** The folder name, which is also the name the agent invokes. */
  slug: string;
  filePath: string;
};

/**
 * Fold a display name down to a skill folder name, or null when nothing
 * usable survives. Every character outside `[a-z0-9]` becomes a separator, so
 * `.`, `/`, `\` and every unicode lookalike are gone before a path is built
 * from the result.
 */
export function toSkillSlug(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/, "");
  return SKILL_SLUG.test(slug) ? slug : null;
}

/** YAML double-quoted scalars are JSON strings, so quoting through
 * JSON.stringify is what stops a description containing `:`, a newline or a
 * quote from rewriting the frontmatter it lands in. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** Render a SKILL.md. `name` is the slug: pi falls back to the folder name
 * only when frontmatter has none, and a listing whose name differs from the
 * folder is confusing on both surfaces. */
export function renderSkillFile(skill: {
  slug: string;
  description: string;
  body: string;
}): string {
  const body = skill.body.trim();
  const front = [
    "---",
    `name: ${yamlString(skill.slug)}`,
    `description: ${yamlString(skill.description)}`,
    "---",
    "",
  ].join("\n");
  return `${front}${body.length > 0 ? body : placeholderBody(skill.slug)}\n`;
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
 * Write a new skill folder under `skillsDir`. Throws (never overwrites) when
 * the name yields no slug or the folder is taken; `wx` closes the gap between
 * the existence check and the write.
 */
export function writeNewSkill(skillsDir: string, skill: NewSkill): WrittenSkill {
  const slug = toSkillSlug(skill.name);
  if (slug === null) {
    throw new Error(`"${skill.name}" has no letters or digits to name a skill folder.`);
  }
  const root = path.resolve(skillsDir);
  const dir = path.resolve(root, slug);
  if (path.dirname(dir) !== root) {
    throw new Error("Refusing to write a skill outside the skills folder.");
  }
  if (fs.existsSync(dir)) {
    throw new Error(`A skill named "${slug}" already exists.`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  fs.writeFileSync(
    filePath,
    renderSkillFile({ slug, description: skill.description, body: skill.instructions }),
    { flag: "wx" },
  );
  return { slug, filePath };
}
