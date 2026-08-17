// ---------------------------------------------------------------------------
// One theme carrier: `:root[data-theme="…"]`, never a media query.
//
// `EditorView.theme` compiles through style-mod, which substitutes `&` with
// the ENCLOSING selector — and inside an at-rule that is the at-rule's own
// text. So `@media (prefers-color-scheme: dark) { ":root:not(…) &": tokens }`
// compiles to `.cm-theme :root:not(…) @media (prefers-color-scheme: dark) {…}`:
// a selector that matches nothing, in a stylesheet the browser accepts without
// complaint. Nothing types it, nothing renders differently in a test that
// stamps `data-theme` itself, and the only symptom is a light palette on a
// dark page — which is exactly how it survived a review.
//
// So the guard is a read of this package's own source. It is not a style rule:
// a media query inside a CM theme spec is DEAD CODE, and the fix is always to
// resolve the theme in the host and stamp `data-theme`.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The vendored ProseMark tree lives under upstream's rules, not the house's.
const VENDOR_DIR = path.join(SOURCE_DIR, "vendor");

function houseSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === VENDOR_DIR) continue;
      houseSources(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("the editor's theme carrier", () => {
  const sources = houseSources(SOURCE_DIR);

  it("reads this package's own house sources", () => {
    // A walk that found nothing would pass the assertion below for the wrong
    // reason; editor-theme.ts is the file the rule is really about.
    expect(sources.some((file) => file.endsWith("editor-theme.ts"))).toBe(true);
  });

  it("carries dark mode on data-theme, never on prefers-color-scheme", () => {
    const violations: string[] = [];
    for (const file of sources) {
      if (!fs.readFileSync(file, "utf8").includes('"@media (prefers-color-scheme')) continue;
      violations.push(
        `DEAD MEDIA QUERY  ${path.relative(SOURCE_DIR, file)}\n` +
          `  rule: a CM theme spec cannot carry a prefers-color-scheme block — style-mod substitutes '&' with the at-rule text, so the rule compiles to a selector that matches nothing\n` +
          `  fix: define the dark tokens under ':root[data-theme="dark"] &' and let the host stamp the resolved theme`,
      );
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });
});
