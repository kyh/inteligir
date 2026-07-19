import { describe, expect, it } from "vitest";

import { applyTemplate, isTemplatePath } from "../daily-notes";

describe("applyTemplate", () => {
  it("substitutes both placeholders", () => {
    expect(applyTemplate("# {{title}}\n\n{{date}}", { title: "Standup", date: "2026-07-09" })).toBe(
      "# Standup\n\n2026-07-09",
    );
  });

  it("passes text with no placeholders through byte-for-byte", () => {
    const raw = "---\ntitle: Fixed\n---\n\n# Heading\n\nBody with { braces } and $$ math $$.\n";
    expect(applyTemplate(raw, { title: "X", date: "2026-01-01" })).toBe(raw);
  });

  it("replaces every occurrence", () => {
    expect(applyTemplate("{{date}} {{date}} {{title}} {{title}}", { title: "a", date: "b" })).toBe(
      "b b a a",
    );
  });

  it("substitutes placeholders inside frontmatter, leaving surrounding bytes intact", () => {
    const template =
      "---\ncreated: {{date}}\ntitle: {{title}}\ntags:\n  - daily\n---\n\n# {{title}}\n";
    expect(applyTemplate(template, { title: "2026-07-09", date: "2026-07-09" })).toBe(
      "---\ncreated: 2026-07-09\ntitle: 2026-07-09\ntags:\n  - daily\n---\n\n# 2026-07-09\n",
    );
  });

  it("does not re-scan a substituted value", () => {
    // A title containing the date token must stay literal, not re-expand.
    expect(applyTemplate("{{title}}", { title: "{{date}}", date: "2026-07-09" })).toBe("{{date}}");
  });
});

describe("isTemplatePath", () => {
  it("matches markdown under templates/", () => {
    expect(isTemplatePath("templates/meeting.md")).toBe(true);
    expect(isTemplatePath("templates/nested/x.md")).toBe(true);
  });
  it("rejects non-templates and non-markdown", () => {
    expect(isTemplatePath("notes/x.md")).toBe(false);
    expect(isTemplatePath("templates/logo.png")).toBe(false);
    expect(isTemplatePath("templatesx/y.md")).toBe(false);
  });
});
