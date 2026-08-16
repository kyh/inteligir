import { describe, expect, it } from "vitest";

import { periodicNotePath } from "@repo/notes/daily-path";

import {
  CADENCE_ORDER,
  CADENCES,
  DAILY_FOLDER_KEY,
  DAILY_FORMAT_KEY,
  DEFAULT_DAILY_FOLDER,
  DEFAULT_DAILY_FORMAT,
  applyTemplate,
  isTemplatePath,
} from "../daily-notes";

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

describe("cadence table", () => {
  it("pins the daily ui-state key STRINGS (renaming resets user config)", () => {
    // Not a tautology: these literals address rows in the persisted ui-state
    // that shipped users already have. A refactor that "tidies" them into
    // `notes.daily.folder` silently drops every configured daily note.
    expect(DAILY_FOLDER_KEY).toBe("notes.dailyFolder");
    expect(DAILY_FORMAT_KEY).toBe("notes.dailyFilenameFormat");
    expect(DEFAULT_DAILY_FOLDER).toBe("journal");
    expect(DEFAULT_DAILY_FORMAT).toBe("YYYY-MM-DD");
    // The table must REUSE them, never restate them.
    expect(CADENCES.daily.folderKey).toBe(DAILY_FOLDER_KEY);
    expect(CADENCES.daily.formatKey).toBe(DAILY_FORMAT_KEY);
  });

  it("covers every cadence exactly once, in display order", () => {
    expect([...CADENCE_ORDER].toSorted()).toEqual(Object.keys(CADENCES).toSorted());
    expect(new Set(CADENCE_ORDER).size).toBe(CADENCE_ORDER.length);
  });

  it("keeps each config self-describing and collision-free", () => {
    const keys = new Set<string>();
    const templates = new Set<string>();
    for (const cadence of CADENCE_ORDER) {
      const config = CADENCES[cadence];
      // The discriminant must agree with the slot it's filed under.
      expect(config.cadence).toBe(cadence);
      // Two cadences sharing a ui-state key would silently alias their config.
      for (const key of [config.folderKey, config.formatKey]) {
        expect(keys.has(key), `${key} is used twice`).toBe(false);
        keys.add(key);
      }
      expect(isTemplatePath(config.templatePath)).toBe(true);
      expect(templates.has(config.templatePath), config.templatePath).toBe(false);
      templates.add(config.templatePath);
    }
  });

  it("gives each cadence's default format a distinct path for the same day", () => {
    // 2021-01-01 is the interesting day: a Friday in ISO week 2020-W53, so the
    // weekly note files under the PREVIOUS year. Three cadences, three notes,
    // no collision.
    const day = new Date(2021, 0, 1);
    const paths = CADENCE_ORDER.map((cadence) => {
      const config = CADENCES[cadence];
      return periodicNotePath(config.defaultFolder, config.defaultFormat, day);
    });
    expect(paths).toEqual([
      "journal/2021-01-01.md",
      "journal/weekly/2020-W53.md",
      "journal/monthly/2021-01.md",
    ]);
    expect(new Set(paths).size).toBe(paths.length);
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
