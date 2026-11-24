import { describe, expect, it } from "vitest";

import { CONNECTOR_SKILLS, connectorSkillCatalog } from "./connector-skills";

const sha256 = async (text: string) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );

  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

const LINKED = /\]\((?<path>references\/[^)]+)\)/gu;

describe("the connector's skills", () => {
  it("lists each skill by its SKILL.md, with every file's digest and size", async () => {
    const catalog = await connectorSkillCatalog();

    expect(catalog.map(({ uri }) => uri)).toStrictEqual(
      CONNECTOR_SKILLS.map(({ name }) => `skill://${name}/SKILL.md`),
    );

    for (const skill of CONNECTOR_SKILLS) {
      const entry = catalog.find(({ uri }) => uri === `skill://${skill.name}/SKILL.md`);

      expect(entry?.frontmatter).toStrictEqual({
        description: skill.description,
        name: skill.name,
      });

      for (const file of skill.files) {
        const listed = entry?.resources.find(
          ({ uri }) => uri === `skill://${skill.name}/${file.path}`,
        );

        expect(listed?.digest).toBe(await sha256(file.text));
        expect(listed?.size).toBe(new TextEncoder().encode(file.text).byteLength);
      }
    }
  });

  it("opens SKILL.md with the frontmatter it lists, and links only files it serves", () => {
    for (const skill of CONNECTOR_SKILLS) {
      const [main] = skill.files;

      expect(main?.path).toBe("SKILL.md");
      expect(main?.text.startsWith(`---\nname: ${skill.name}\ndescription: `)).toBe(true);

      const served = new Set(skill.files.map(({ path }) => path));
      const linked = [...(main?.text.matchAll(LINKED) ?? [])].map((match) => match.groups?.path);

      expect(linked.length).toBeGreaterThan(0);

      for (const path of linked) {
        expect(served).toContain(path);
      }
    }
  });
});
