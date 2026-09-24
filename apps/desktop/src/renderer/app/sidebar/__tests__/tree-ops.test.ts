import { describe, expect, it } from "vitest";

import { planMove } from "../tree-ops";
import { withAncestorsExpanded } from "../tree-state";

describe("where a move may land", () => {
  it("names the destination path under the folder", () => {
    expect(planMove("a/x.md", "b")).toEqual({ ok: true, to: "b/x.md" });
    expect(planMove("a/x.md", "")).toEqual({ ok: true, to: "x.md" });
    expect(planMove("a", "b/c")).toEqual({ ok: true, to: "b/c/a" });
  });

  it("refuses a folder dropped on itself or inside itself", () => {
    expect(planMove("a", "a")).toEqual({ ok: false, reason: "self" });
    expect(planMove("a", "a/b")).toEqual({ ok: false, reason: "descendant" });
  });

  it("refuses the folder the entry is already in", () => {
    expect(planMove("a/x.md", "a")).toEqual({ ok: false, reason: "same-parent" });
    expect(planMove("x.md", "")).toEqual({ ok: false, reason: "same-parent" });
  });

  it("is not fooled by a folder whose name is a prefix", () => {
    expect(planMove("a", "ab").ok).toBe(true);
  });
});

describe("a reveal from the breadcrumb", () => {
  it("opens every folder above the entry and selects it", () => {
    expect([...withAncestorsExpanded(new Set(), "notes/daily/2026-08-16.md")]).toEqual([
      "notes",
      "notes/daily",
    ]);
  });

  it("opens a folder it names, so its own children show", () => {
    const expanded = new Set(withAncestorsExpanded(new Set(), "notes/daily"));
    expanded.add("notes/daily");
    expect([...expanded]).toEqual(["notes", "notes/daily"]);
  });
});
