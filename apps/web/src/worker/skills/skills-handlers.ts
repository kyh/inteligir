// ---------------------------------------------------------------------------
// Skills' two Bridge handlers, over the vault (see ./vault-skills for why the
// vault and not the container's filesystem).
//
// `createSkill` is AUTHORING, not file management: it writes one valid SKILL.md
// at a path the host computes from a slug it derived. The name never reaches a
// path, and an existing skill is never overwritten — a scaffold that clobbered
// someone's work would be a data-loss bug wearing a create button.
// ---------------------------------------------------------------------------

import type { HandlerRegistrar } from "../host/handler-registry";
import type { UserVault } from "../host/vault/user-vault";
import { listVaultSkills, renderSkillFile, skillPath, toSkillSlug } from "./vault-skills";

export function registerSkillsHandlers(handle: HandlerRegistrar, vault: UserVault): void {
  handle("listSkills", async () => ({ skills: await listVaultSkills(vault) }));

  handle("createSkill", async ({ name, description, instructions }) => {
    const slug = toSkillSlug(name);
    if (slug === null) {
      throw new Error(`"${name}" has no letters or digits to make a skill name from.`);
    }
    const path = skillPath(slug);
    const existing = vault.lookup(path);
    if (existing !== null && existing.state === "live") {
      throw new Error(`A skill called "${slug}" already exists.`);
    }
    // Conditional on the version the check above saw, so a second client
    // creating the same slug in between is REFUSED rather than overwritten. A
    // tombstone's version is passed through on purpose: a skill the user
    // deleted is a name they may reuse, and the write resurrects that row.
    const written = await vault.writeText(
      path,
      renderSkillFile(slug, description, instructions),
      existing?.version ?? 0,
    );
    if (!written.ok) throw new Error(`A skill called "${slug}" already exists.`);

    const skills = await listVaultSkills(vault);
    const skill = skills.find((candidate) => candidate.name === slug);
    if (skill === undefined) throw new Error(`The skill "${slug}" could not be read back.`);
    return { skill, skills };
  });
}
