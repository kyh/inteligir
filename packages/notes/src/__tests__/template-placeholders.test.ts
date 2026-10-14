import type { Root } from "mdast";
import { describe, expect, it } from "vitest";
import { frontmatterYaml, parseProperties, removeFrontmatterId } from "../markdown/frontmatter";
import { parseMdast } from "../markdown/parse";
import { DAILY_TEMPLATE_PATH, isTemplatePath, TEMPLATES_FOLDER } from "../templates/folders";
import { expandTemplate } from "../templates/placeholders";

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

  it("expand the date and the time inside a fence too: they are fixed ISO strings", () => {
    expect(expandTemplate("```\n{{date}}\n```\n", CONTEXT)).toBe("```\n2026-09-05\n```\n");
  });
});

// a file name may spell markdown and yaml syntax; Finder's may spell anything
const TITLE = "Ideas {wip `draft` *Q1*";
const titled = (template: string, title = TITLE): string =>
  expandTemplate(template, { now: NOW, title });

const firstBlockTexts = (root: Root): string[] => {
  const [first] = root.children;
  if (first === undefined || !("children" in first)) {
    return [];
  }
  return first.children.map((child) => (child.type === "text" ? child.value : child.type));
};

const properties = (template: string, title = TITLE) =>
  parseProperties(frontmatterYaml(titled(template, title)) ?? "");
const text = (value: string) => ({
  kind: "valid",
  properties: [{ key: "title", type: "text", value }],
});

describe("the title, spelled for where it lands", () => {
  it("is escaped in a heading, so it reads back as exactly the title", () => {
    const expanded = titled("# {{title}}\n");
    expect(expanded).toBe("# Ideas {wip \\`draft\\` \\*Q1\\*\n");
    expect(firstBlockTexts(parseMdast(expanded).root)).toEqual([TITLE]);
  });

  it("is escaped for the construct around it and the characters beside it", () => {
    expect(titled("{{title}}\n", "- draft")).toBe("\\- draft\n");
    expect(titled("Seen with {{title}}\n", "- draft")).toBe("Seen with - draft\n");
    expect(titled("# {{title}}\n", "Notes #")).toBe("# Notes \\#\n");
    expect(titled("| a |\n| - |\n| {{title}} |\n", "a|b")).toBe("| a |\n| - |\n| a\\|b |\n");
    expect(titled("[{{title}}](x.md)\n", "a]b")).toBe("[a\\]b](x.md)\n");
  });

  it.each([
    ["a formula pill", "x {{a}} y", "# x \\{{a}} y\n"],
    ["a date chip", "Meet @2026-01-01", "# Meet \\@2026-01-01\n"],
  ])("is escaped where it would spell %s, so it reads back as text", (_name, title, md) => {
    const expanded = titled("# {{title}}\n", title);
    expect(expanded).toBe(md);
    expect(firstBlockTexts(parseMdast(expanded).root)).toEqual([title]);
  });

  it("is left alone when nothing in it is syntax", () => {
    expect(titled("# {{title}}\n", "Weekly Review: 1:1, v2.0 & Mike's notes")).toBe(
      "# Weekly Review: 1:1, v2.0 & Mike's notes\n",
    );
  });

  it("stays as written where the bytes are literal or have a grammar of their own", () => {
    expect(titled("```\n{{title}}\n```\n")).toBe(`\`\`\`\n${TITLE}\n\`\`\`\n`);
    expect(titled("`{{title}}`\n", "a*b*")).toBe("`a*b*`\n");
    expect(titled("$$\n{{title}}\n$$\n")).toBe(`$$\n${TITLE}\n$$\n`);
    expect(titled("[[{{title}}]]\n", "a*b*")).toBe("[[a*b*]]\n");
  });

  it("stays a valid scalar of exactly the title in the frontmatter", () => {
    expect(properties("---\ntitle: {{title}}\n---\n")).toEqual(text(TITLE));
    expect(properties('---\ntitle: "{{title}}"\n---\n', 'Say "hi"')).toEqual(text('Say "hi"'));
    expect(properties("---\ntitle: '{{title}}'\n---\n", "Mike's")).toEqual(text("Mike's"));
    expect(properties("---\ntitle: {{title}}\n---\n", "2026")).toEqual(text("2026"));
    expect(properties("---\ntitle: {{title}}\n---\n", "a: b #c")).toEqual(text("a: b #c"));
    expect(properties("---\naliases: [{{title}}]\n---\n")).toEqual({
      kind: "valid",
      properties: [{ key: "aliases", type: "tags", value: [TITLE] }],
    });
  });

  it("keeps every other byte of the frontmatter, and a plain title plain", () => {
    expect(
      titled("---\nid: abc # mine\ntitle: {{title}}\nwhen: {{date}}\n---\n", "Weekly Review"),
    ).toBe("---\nid: abc # mine\ntitle: Weekly Review\nwhen: 2026-09-05\n---\n");
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
