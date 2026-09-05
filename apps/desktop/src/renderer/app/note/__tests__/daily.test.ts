import { describe, expect, it } from "vitest";
import { dailyNoteFromTemplate, dailyNotePath, dailyNoteTemplate } from "../daily";

const NOW = new Date(2026, 8, 5, 9, 7);

describe("the daily note", () => {
  it("lives under notes/daily by its date, and the built-in shape is the date heading", () => {
    expect(dailyNotePath(NOW)).toBe("notes/daily/2026-09-05.md");
    expect(dailyNoteTemplate(NOW)).toBe("# 2026-09-05\n\n");
  });

  it("takes the vault's template with the day as its title and no inherited id", () => {
    expect(
      dailyNoteFromTemplate("---\nid: tmpl\ntags: [daily]\n---\n# {{title}}\n\n{{time}}\n", NOW),
    ).toBe("---\ntags: [daily]\n---\n# 2026-09-05\n\n09:07\n");
  });
});
