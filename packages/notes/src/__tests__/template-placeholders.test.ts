import { describe, expect, it } from "vitest";
import { removeFrontmatterId } from "../markdown/frontmatter";
import {
  DAILY_TEMPLATE_PATH,
  expandTemplate,
  isTemplatePath,
  TEMPLATES_FOLDER,
} from "../templates/placeholders";

const NOW = new Date(2026, 8, 5, 9, 7);
const CONTEXT = { now: NOW, title: "Weekly Review" };

describe("the three placeholders", () => {
  it("expand to the local date, the local time and the title", () => {
    expect(expandTemplate("{{date}} {{time}} {{title}}", CONTEXT)).toBe(
      "2026-09-05 09:07 Weekly Review",
    );
  });

  it("leave every formula pill byte-exact, whatever its source spells", () => {
    const template = "{{2+2|4|id=a}} {{date|today}} {{ date }} {{DATE}} {{title|x}} {{when}}";
    expect(expandTemplate(template, CONTEXT)).toBe(template);
  });

  it("expand inside a fence too: the expansion is textual, before any parser", () => {
    expect(expandTemplate("```\n{{date}}\n```\n", CONTEXT)).toBe("```\n2026-09-05\n```\n");
  });
});

describe("what counts as a template", () => {
  it("is a doc under the templates folder", () => {
    expect(TEMPLATES_FOLDER).toBe("templates");
    expect(isTemplatePath(DAILY_TEMPLATE_PATH)).toBe(true);
    expect(isTemplatePath("templates/meeting.md")).toBe(true);
    expect(isTemplatePath("templates/logo.png")).toBe(false);
    expect(isTemplatePath("notes/templates/meeting.md")).toBe(false);
    expect(isTemplatePath("templates")).toBe(false);
  });
});

describe("a note minted from a template", () => {
  it("drops the template's id and keeps every other key byte-exact", () => {
    expect(removeFrontmatterId("---\nid: abc\ntags: [a, b]\n---\n# Hi\n")).toBe(
      "---\ntags: [a, b]\n---\n# Hi\n",
    );
  });

  it("drops the block when id was its only key, and leaves a note without one alone", () => {
    expect(removeFrontmatterId("---\nid: abc\n---\n# Hi\n")).toBe("# Hi\n");
    expect(removeFrontmatterId("---\ntags: [a]\n---\n# Hi\n")).toBe("---\ntags: [a]\n---\n# Hi\n");
    expect(removeFrontmatterId("# Hi\n")).toBe("# Hi\n");
  });
});
