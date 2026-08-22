import type { WikiTargetWire } from "@repo/server-contract/knowledge";
import { describe, expect, it } from "vitest";
import { activeMentionAt, filterMentionTargets, MENTION_MAX_ROWS } from "../mention-combobox";

describe("activeMentionAt", () => {
  it("opens on a word-boundary @ and carries the typed query", () => {
    expect(activeMentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMentionAt("see @roa", 8)).toEqual({ start: 4, query: "roa" });
  });

  it("does not open mid-word — an email address stays text", () => {
    expect(activeMentionAt("kyh@example", 11)).toBeNull();
  });

  it("closes when whitespace ends the query or the caret leaves it", () => {
    expect(activeMentionAt("@roadmap done", 13)).toBeNull();
    expect(activeMentionAt("@roa hello", 3)).toEqual({ start: 0, query: "ro" });
    expect(activeMentionAt("plain text", 5)).toBeNull();
  });
});

const target = (path: string, title: string, aliases?: string[]): WikiTargetWire => {
  const row: WikiTargetWire = { path, title, type: "doc" };
  if (aliases !== undefined) row.aliases = aliases;
  return row;
};

describe("filterMentionTargets", () => {
  it("matches path, title, or alias case-insensitively; assets never list", () => {
    const targets: WikiTargetWire[] = [
      target("notes/roadmap.md", "Roadmap"),
      target("notes/retro.md", "Retrospective", ["Retro"]),
      { path: "assets/roadmap.png", title: "roadmap.png", type: "asset" },
    ];
    expect(filterMentionTargets(targets, "ROAD", new Set()).map((t) => t.path)).toEqual([
      "notes/roadmap.md",
    ]);
    expect(filterMentionTargets(targets, "retro", new Set()).map((t) => t.path)).toEqual([
      "notes/retro.md",
    ]);
  });

  it("excludes already-attached paths and caps the rows", () => {
    const many = Array.from({ length: MENTION_MAX_ROWS + 3 }, (_, i) =>
      target(`n/${String(i)}.md`, `Note ${String(i)}`),
    );
    expect(filterMentionTargets(many, "", new Set(["n/0.md"]))).toHaveLength(MENTION_MAX_ROWS);
    expect(
      filterMentionTargets(many, "", new Set(["n/0.md"])).some((t) => t.path === "n/0.md"),
    ).toBe(false);
  });
});
