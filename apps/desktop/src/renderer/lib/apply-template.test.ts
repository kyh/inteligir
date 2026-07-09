import { describe, expect, it } from "vitest";

import {
  applyTemplate,
  dailyNotePath,
  formatDatePattern,
  formatIsoDate,
  isTemplatePath,
  titleFromPath,
} from "@renderer/lib/apply-template";

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

describe("date formatting", () => {
  it("zero-pads iso date components (local time)", () => {
    // Local-time constructor: month index 0 = January, day 5.
    expect(formatIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatIsoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("expands YYYY/MM/DD tokens in a pattern", () => {
    const date = new Date(2026, 6, 9); // 2026-07-09
    expect(formatDatePattern("YYYY-MM-DD", date)).toBe("2026-07-09");
    expect(formatDatePattern("YYYY/MM/DD", date)).toBe("2026/07/09");
    expect(formatDatePattern("Daily MM.DD.YYYY", date)).toBe("Daily 07.09.2026");
  });
});

describe("dailyNotePath", () => {
  const date = new Date(2026, 6, 9);
  it("joins folder and formatted filename", () => {
    expect(dailyNotePath("journal", "YYYY-MM-DD", date)).toBe("journal/2026-07-09.md");
  });
  it("strips surrounding slashes from the folder", () => {
    expect(dailyNotePath("/journal/", "YYYY-MM-DD", date)).toBe("journal/2026-07-09.md");
  });
  it("puts the note at the root when the folder is blank", () => {
    expect(dailyNotePath("", "YYYY-MM-DD", date)).toBe("2026-07-09.md");
  });
});

describe("titleFromPath", () => {
  it("strips folder and extension", () => {
    expect(titleFromPath("journal/2026-07-09.md")).toBe("2026-07-09");
    expect(titleFromPath("meeting-notes.md")).toBe("meeting-notes");
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
