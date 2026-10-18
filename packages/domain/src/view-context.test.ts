import { describe, expect, it } from "vitest";
import { ACTION_PRESET_LABELS, actionPresetSchema } from "./action-preset";
import type { ActionPreset } from "./action-preset";
import { libraryScopeSchema } from "./library-scope";
import type { LibraryScope } from "./library-scope";
import { LIBRARY_SELECTION_MAX, viewContextSchema } from "./view-context";

const LIBRARY = {
  paths: ["Unsorted/a.md"],
  scope: { kind: "all" },
  selected: 1,
  surface: "library",
} as const;

describe("a view context", () => {
  it("is a doc or the library", () => {
    expect(
      viewContextSchema.safeParse({ resource: "a.md", revision: "c".repeat(64), surface: "doc" })
        .success,
    ).toBe(true);
    expect(viewContextSchema.safeParse(LIBRARY).success).toBe(true);
    expect(viewContextSchema.safeParse({ ...LIBRARY, surface: "graph" }).success).toBe(false);
  });

  it("names at most LIBRARY_SELECTION_MAX selected paths, and may say more were selected", () => {
    const paths = Array.from({ length: LIBRARY_SELECTION_MAX }, (_, n) => `Unsorted/${n}.md`);
    expect(viewContextSchema.safeParse({ ...LIBRARY, paths, selected: 5000 }).success).toBe(true);
    expect(
      viewContextSchema.safeParse({ ...LIBRARY, paths: [...paths, "one.md"], selected: 5000 })
        .success,
    ).toBe(false);
  });

  it("carries a library scope in its one spelling", () => {
    const scopes: LibraryScope[] = [
      { kind: "all" },
      { kind: "unsorted" },
      { kind: "folder", path: "Reading" },
      { kind: "tag", tag: "design" },
      { kind: "deleted" },
    ];
    for (const scope of scopes) {
      expect(libraryScopeSchema.parse(scope)).toEqual(scope);
    }
    expect(libraryScopeSchema.safeParse({ kind: "folder", path: "" }).success).toBe(false);
  });

  it("never names Deleted as a library context's scope, since nothing there is a library item", () => {
    expect(viewContextSchema.safeParse({ ...LIBRARY, scope: { kind: "deleted" } }).success).toBe(
      false,
    );
    expect(viewContextSchema.safeParse({ ...LIBRARY, scope: { kind: "unsorted" } }).success).toBe(
      true,
    );
  });
});

describe("an action preset", () => {
  it("has a label for every preset, which is what an empty send stores", () => {
    const presets: readonly ActionPreset[] = actionPresetSchema.options;
    for (const preset of presets) {
      expect(ACTION_PRESET_LABELS[preset].trim()).not.toBe("");
    }
    expect(ACTION_PRESET_LABELS["tidy-library"]).toBe("Tidy my library");
  });
});
