// ---------------------------------------------------------------------------
// Authoring a skill writes a directory named from a text field, and that
// directory's contents get read into every turn's system prompt. Two things
// are pinned here: the name can never address a path outside the skills
// folder, and the frontmatter can never be rewritten by its own values.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { renderSkillFile, toSkillSlug, writeNewSkill } from "../skill-authoring";

const tmpDirs: string[] = [];

function makeSkillsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-authoring-"));
  tmpDirs.push(dir);
  return path.join(dir, "skills");
}

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("toSkillSlug", () => {
  it("folds a display name to a spec-shaped folder name", () => {
    expect(toSkillSlug("Summarize Note")).toBe("summarize-note");
    expect(toSkillSlug("  Weekly   Review!  ")).toBe("weekly-review");
    expect(toSkillSlug("PDF→Markdown")).toBe("pdf-markdown");
  });

  it("dissolves every character a path could be built from", () => {
    for (const hostile of [
      "../../../etc/passwd",
      "a/../../b",
      "C:\\Windows\\System32",
      "~/.ssh/id_rsa",
      ".hidden",
    ]) {
      const slug = toSkillSlug(hostile);
      expect(slug).not.toBeNull();
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("returns null when nothing usable survives", () => {
    expect(toSkillSlug("")).toBeNull();
    expect(toSkillSlug("   ")).toBeNull();
    expect(toSkillSlug("///")).toBeNull();
    expect(toSkillSlug("..")).toBeNull();
    expect(toSkillSlug("…")).toBeNull();
  });
});

describe("renderSkillFile", () => {
  it("quotes frontmatter values so they cannot rewrite the frontmatter", () => {
    const file = renderSkillFile({
      slug: "hostile",
      description: 'Ends here"\n---\nname: other\ndescription: injected\n---\n',
      body: "steps",
    });
    const frontmatter = file.split("---\n")[1] ?? "";

    expect(frontmatter.split("\n").filter((line) => line.startsWith("name:"))).toHaveLength(1);
    expect(frontmatter).not.toContain("injected\n");
    expect(file.endsWith("steps\n")).toBe(true);
  });

  it("writes a placeholder body when there are no instructions yet", () => {
    expect(renderSkillFile({ slug: "empty", description: "d", body: "   " })).toContain("# empty");
  });
});

describe("writeNewSkill", () => {
  it("writes SKILL.md inside the skills folder and reports where", () => {
    const skillsDir = makeSkillsDir();
    fs.mkdirSync(skillsDir, { recursive: true });

    const written = writeNewSkill(skillsDir, {
      name: "Weekly Review",
      description: "Draft the weekly review.",
      instructions: "Read this week's daily notes, then draft the review.",
    });

    expect(written.slug).toBe("weekly-review");
    expect(written.filePath).toBe(path.join(skillsDir, "weekly-review", "SKILL.md"));
    expect(fs.readFileSync(written.filePath, "utf8")).toContain('name: "weekly-review"');
  });

  it("keeps a traversal-shaped name inside the skills folder", () => {
    const skillsDir = makeSkillsDir();
    fs.mkdirSync(skillsDir, { recursive: true });

    const written = writeNewSkill(skillsDir, {
      name: "../../escape",
      description: "d",
      instructions: "",
    });
    expect(path.dirname(path.dirname(written.filePath))).toBe(skillsDir);
  });

  it("refuses a name with nothing to slugify", () => {
    const skillsDir = makeSkillsDir();
    fs.mkdirSync(skillsDir, { recursive: true });
    expect(() =>
      writeNewSkill(skillsDir, { name: "///", description: "d", instructions: "" }),
    ).toThrow(/no letters or digits/);
  });

  it("never overwrites an existing skill", () => {
    const skillsDir = makeSkillsDir();
    fs.mkdirSync(skillsDir, { recursive: true });
    const input = { name: "Notes Triage", description: "d", instructions: "original" };
    writeNewSkill(skillsDir, input);

    expect(() => writeNewSkill(skillsDir, { ...input, instructions: "replacement" })).toThrow(
      /already exists/,
    );
    expect(fs.readFileSync(path.join(skillsDir, "notes-triage", "SKILL.md"), "utf8")).toContain(
      "original",
    );
  });
});
