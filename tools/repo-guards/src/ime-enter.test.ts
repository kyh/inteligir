// an Enter inside an IME composition commits a candidate, so a handler that reads it as "commit
// the field" submits half a word in Japanese or Chinese. every handler forgets this the same way,
// and no test types through a composition, so the check is held by file.

import { describe, expect, it } from "vitest";

import { sourceOf, workspaceFiles, workspaces } from "./repo";

const IME_HELPER = "@repo/ui/lib/ime";

// where a keydown handler over a text field lives. .ts too: a Plate plugin's handler can sit in a
// kit file with no markup
const HANDLER_ROOTS = ["packages/ui/src/", "packages/editor/src/", "apps/desktop/src/renderer/"];

// a key compared to Enter either way round, a switch arm on it, or a hotkey table row naming it
const TESTS_ENTER =
  /\.key\s*[!=]==?\s*["']Enter["']|["']Enter["']\s*[!=]==?\s*\w+\.key|case\s+["']Enter["']|["'](?:[a-z]+\+)*enter["']/u;

const IMPORTS_HELPER =
  /import\s*\{[^}]*\bisImeComposing\b[^}]*\}\s*from\s*["']@repo\/ui\/lib\/ime["']/u;

// a key that never reaches a text field has no composition to wait out
const NOT_A_TEXT_FIELD = new Map<string, string>([
  [
    "packages/ui/src/ai/diff-table.tsx",
    "Enter on a focused DiffRow toggles the row: a table row takes no text, so no composition runs there",
  ],
]);

const handlerFiles = workspaces()
  .flatMap((workspace) => workspaceFiles(workspace).shipped)
  .filter((file) => HANDLER_ROOTS.some((root) => file.startsWith(root)) && /\.tsx?$/u.test(file))
  .toSorted();

const testsEnter = (file: string): boolean => TESTS_ENTER.test(sourceOf(file));

const importsHelper = (file: string): boolean => IMPORTS_HELPER.test(sourceOf(file));

describe("an Enter handler waits out an IME composition", () => {
  it("finds handlers under every root", () => {
    for (const root of HANDLER_ROOTS) {
      expect(
        handlerFiles.some((file) => file.startsWith(root) && testsEnter(file)),
        `no Enter handler under ${root}: the guard would pass over a tree it no longer reads`,
      ).toBe(true);
    }
  });

  it("checks isImeComposing wherever a key is tested against Enter", () => {
    const offenders = handlerFiles.filter(
      (file) => testsEnter(file) && !importsHelper(file) && !NOT_A_TEXT_FIELD.has(file),
    );
    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `ENTER HANDLED WITHOUT THE COMPOSITION CHECK\n${offenders.map((file) => `  ${file}`).join("\n")}\n` +
            `  rule: a keydown that acts on Enter first asks isImeComposing (${IME_HELPER}), since the Enter that commits an IME candidate is not the user's Enter\n` +
            `  fix: return early on isImeComposing(event); a key that never reaches a text field is a NOT_A_TEXT_FIELD row with its reason`,
    ).toEqual([]);
  });

  it("keeps no allowance its file no longer needs", () => {
    const stale = [...NOT_A_TEXT_FIELD.keys()].filter(
      (file) => !handlerFiles.includes(file) || !testsEnter(file) || importsHelper(file),
    );
    expect(
      stale,
      `NOT_A_TEXT_FIELD rows that no longer hold: ${stale.join(", ")}\n` +
        `  rule: a row excuses a file that tests Enter without the check; one that is gone, no longer tests Enter or now checks is a stale excuse\n` +
        `  fix: delete the row`,
    ).toEqual([]);
  });
});
