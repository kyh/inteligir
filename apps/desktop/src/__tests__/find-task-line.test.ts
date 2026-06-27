import { describe, expect, it } from "vitest";

import { findTaskLine } from "@/main/delegation/find-task-line";

const DOC = [
  "# Project",
  "",
  "## This week",
  "",
  "- [ ] book the flight",
  "- [x] already done",
  "- [ ] email the team",
  "",
  "## Backlog",
  "",
  "- [ ] book the flight", // duplicate text in another section
].join("\n");

describe("findTaskLine", () => {
  it("finds an unchecked task by text", () => {
    const m = findTaskLine(DOC, "email the team");
    expect(m).not.toBeNull();
    expect(m?.lineText).toBe("- [ ] email the team");
    expect(m?.heading).toBe("This week");
  });

  it("returns the first unchecked match (not a checked one)", () => {
    const m = findTaskLine(DOC, "book the flight");
    expect(m?.lineIndex).toBe(4); // the one under "This week", not Backlog
    expect(m?.heading).toBe("This week");
  });

  it("ignores already-checked tasks", () => {
    expect(findTaskLine(DOC, "already done")).toBeNull();
  });

  it("returns null when the text is absent", () => {
    expect(findTaskLine(DOC, "nonexistent task")).toBeNull();
  });

  it("captures the section the task lives in", () => {
    const m = findTaskLine(DOC, "email the team");
    expect(m?.section).toContain("## This week");
    expect(m?.section).toContain("- [ ] book the flight");
    expect(m?.section).not.toContain("## Backlog");
  });

  it("trims whitespace when matching", () => {
    expect(findTaskLine("- [ ]   spaced  ", "spaced")).not.toBeNull();
  });

  it("handles a task with no heading above it", () => {
    const m = findTaskLine("- [ ] lonely task\n", "lonely task");
    expect(m?.heading).toBeNull();
  });

  it("matches asterisk bullets too", () => {
    expect(findTaskLine("* [ ] star task", "star task")).not.toBeNull();
  });

  it("matches plus bullets (GFM allows -, *, +)", () => {
    expect(findTaskLine("+ [ ] plus task", "plus task")).not.toBeNull();
  });

  it("matches across CRLF / CR line endings (Windows-authored files)", () => {
    expect(findTaskLine("# H\r\n\r\n- [ ] crlf task\r\n", "crlf task")).not.toBeNull();
    expect(findTaskLine("- [ ] cr task\r", "cr task")).not.toBeNull();
  });

  it("prefers the duplicate occurrence under the requested heading", () => {
    const m = findTaskLine(DOC, "book the flight", "Backlog");
    expect(m?.heading).toBe("Backlog");
    expect(m?.lineIndex).toBe(10); // the Backlog one, not the This week one (line 4)
  });

  it("falls back to the first text match when none sit under that heading", () => {
    const m = findTaskLine(DOC, "book the flight", "No Such Section");
    expect(m?.heading).toBe("This week");
  });

  it("matches a task whose raw line carries inline markdown", () => {
    expect(findTaskLine("- [ ] **buy** milk", "buy milk")).not.toBeNull();
    expect(findTaskLine("- [ ] call `api`", "call api")).not.toBeNull();
    expect(findTaskLine("- [ ] read [docs](https://x)", "read docs")).not.toBeNull();
  });

  it("unwraps paired emphasis in headings but keeps lone/intraword markers", () => {
    expect(findTaskLine("## **Q3** plan\n\n- [ ] a", "a")?.heading).toBe("Q3 plan");
    expect(findTaskLine("## C* notes\n\n- [ ] a", "a")?.heading).toBe("C* notes");
    // snake_case underscores are not emphasis → preserved (no over-strip).
    expect(findTaskLine("## update_user_record\n\n- [ ] a", "a")?.heading).toBe(
      "update_user_record",
    );
  });
});
