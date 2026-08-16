// The AI menu's canned command sets — potion parity: a bare caret offers the
// generate set, selected text offers the edit set (plus Translate's language
// page). Guards the scope partition so a menu refactor can't silently strand
// an action in neither set.

import { describe, expect, it } from "vitest";

import { CANNED_ACTIONS, TRANSLATE_LANGUAGES } from "@repo/editor/ai/ai-prompts";

const ids = (scope: "cursor" | "selection") =>
  CANNED_ACTIONS.filter((a) => a.scope === scope).map((a) => a.id);

describe("CANNED_ACTIONS", () => {
  it("every action carries a label, keywords, and a scope", () => {
    for (const action of CANNED_ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.keywords.length).toBeGreaterThan(0);
      expect(["cursor", "selection"]).toContain(action.scope);
    }
  });

  it("splits into potion's cursor and selection command sets", () => {
    expect(ids("cursor")).toEqual(["continue", "summarize", "explain"]);
    expect(ids("selection")).toEqual(["improve", "longer", "shorter", "grammar", "simplify"]);
  });

  it("cursor actions generate; selection actions edit", () => {
    for (const action of CANNED_ACTIONS) {
      expect(action.intent).toBe(action.scope === "cursor" ? "generate" : "edit");
    }
  });
});

describe("TRANSLATE_LANGUAGES", () => {
  it("offers a non-empty, duplicate-free language list", () => {
    expect(TRANSLATE_LANGUAGES.length).toBeGreaterThan(0);
    expect(new Set(TRANSLATE_LANGUAGES).size).toBe(TRANSLATE_LANGUAGES.length);
  });
});
