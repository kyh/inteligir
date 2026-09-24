// A stored key read outside the table is a preference with no row: its own parse, its own
// fallback, and a reader and a writer free to disagree on its bytes.

import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, sourceOf, workspaceSourceFiles, workspaces } from "./repo";

const TABLE = "apps/desktop/src/renderer/app/prefs.ts";

const KEYED_ACCESS =
  /\b(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem)\s*\(/u;

// every row is `pref("<key>", …)` or `unsetPref("<key>", …)`, so the key set is read off the table
const ROW_KEY = /\b(?:pref|unsetPref)\(\s*"(?<key>[^"]+)"/gu;

const ELSEWHERE = new Map<string, string>([
  [
    "apps/desktop/src/renderer/app/__tests__/prefs.test.ts",
    "pins the keys and bytes a window's storage already holds, so it spells them rather than reading them off the table",
  ],
  [
    "apps/web/src/components/theme-provider.tsx",
    "the marketing site is another program on another origin, with its own theme key; the shell's table is not its storage",
  ],
  [
    "packages/editor/src/heading-collapse.tsx",
    "the editor's own per-note fold state: @repo/editor is hosted by the shell and cannot reach its table",
  ],
  [
    "packages/ui/src/lib/theme.tsx",
    "the pre-paint script an SSR page inlines, which reads whatever key its caller hands it before any module has loaded",
  ],
]);

// this file names the table it polices, so the walk skips it.
const SELF = path.relative(REPO_ROOT, import.meta.filename);

const rowKeys = [...sourceOf(TABLE).matchAll(ROW_KEY)].map((match) => match.groups?.key ?? "");

const files = workspaces()
  .flatMap((workspace) => workspaceSourceFiles(workspace))
  .filter((file) => file !== SELF && file !== TABLE);

const spelledKeys = (source: string): string[] =>
  rowKeys.filter((key) =>
    ['"', "'", "`"].some((quote) => source.includes(`${quote}${key}${quote}`)),
  );

const RULE = `what the window remembers across a reload is a row in ${TABLE}, read and written through readPref / writePref / usePref`;

describe("the page's preferences", () => {
  it("finds the table at all", () => {
    expect(rowKeys.length, `no pref() or unsetPref() row in ${TABLE}`).toBeGreaterThan(0);
    expect(
      KEYED_ACCESS.test(sourceOf(TABLE)),
      `${TABLE} no longer reads storage by key, so this sweep would find no second reader either — teach it the new shape`,
    ).toBe(true);
  });

  it("reads and writes storage by key only in the table", () => {
    const violations = files
      .filter((file) => !ELSEWHERE.has(file) && KEYED_ACCESS.test(sourceOf(file)))
      .map(
        (file) =>
          `SECOND STORE  ${file}\n` +
          `  rule: ${RULE}; a key read anywhere else carries its own parse and fallback\n` +
          `  fix: add a row to PREFS, or an ELSEWHERE row in tools/repo-guards/src/page-prefs.test.ts saying why this storage is not the shell's`,
      );
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("spells each row's key only in the table", () => {
    const violations = files
      .filter((file) => !ELSEWHERE.has(file))
      .flatMap((file) =>
        spelledKeys(sourceOf(file)).map(
          (key) =>
            `SECOND SPELLING  ${file}\n` +
            `  found: "${key}"\n` +
            `  rule: ${RULE}; a second spelling of its key reads the same bytes past the row's decode\n` +
            `  fix: go through the row (PREFS.<name>.key where a key itself is needed)`,
        ),
      );
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("has no stale ELSEWHERE row", () => {
    const stale = [...ELSEWHERE]
      .filter(([file]) => {
        const source = sourceOf(file);
        return !KEYED_ACCESS.test(source) && spelledKeys(source).length === 0;
      })
      .map(
        ([file, why]) =>
          `STALE EXCEPTION  ${file}\n` +
          `  it no longer reads storage by key, so the reason it carried is spent\n` +
          `  the reason was: ${why}\n` +
          `  fix: delete the row from ELSEWHERE in tools/repo-guards/src/page-prefs.test.ts`,
      );
    expect(stale, `\n${stale.join("\n\n")}\n`).toEqual([]);
  });
});
