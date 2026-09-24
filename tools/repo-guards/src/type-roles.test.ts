// a role says what a line IS; a raw size says only how big, and two scales in one window read as
// a slash menu at 14px beside a palette at 12. a scale held by convention alone drifts.

import { describe, expect, it } from "vitest";

import { sourceOf, workspaceFiles, workspaces } from "./repo";
import { AWAITING_CONSUMER } from "./ui-package";

const ROLES_DECLARED = "packages/ui/src/styles/globals.css";

// where chrome is drawn. A file held in AWAITING_CONSUMER keeps its own sizes until a surface
// draws it.
const CHROME_ROOTS = [
  "apps/desktop/src/renderer/",
  "packages/editor/src/",
  "packages/ui/src/components/",
  "packages/ui/src/ai/",
];

// Tailwind's own ladder and any px or rem literal. An em literal is allowed: it follows the note's
// size dial, which is how the prose sizes anything it draws inline.
const RAW_SIZE = /(?<![\w-])text-(?:xs|sm|base|lg|[2-9]?xl|\[\d*\.?\d+(?:px|rem)\])(?![\w-])/gu;

interface ProseSize {
  readonly sizes: readonly string[];
  readonly reason: string;
}

// the note is not chrome, so a fixed size drawn as part of it is a row here; a row names the
// literals it permits, so a new raw size in the same file still fails.
const PROSE_SIZES = new Map<string, ProseSize>([
  [
    "packages/editor/src/editor-column.tsx",
    {
      reason:
        "the note's title is the note's own name in the note's own font, above its prose; it is not a line of chrome and no role is a page title's size",
      sizes: ["text-[28px]"],
    },
  ],
]);

const chromeFiles = workspaces()
  .flatMap((workspace) => workspaceFiles(workspace).shipped)
  .filter(
    (file) => CHROME_ROOTS.some((root) => file.startsWith(root)) && !AWAITING_CONSUMER.has(file),
  )
  .toSorted();

const rawSizesIn = (file: string): string[] =>
  [...new Set([...sourceOf(file).matchAll(RAW_SIZE)].map((match) => match[0]))].toSorted();

describe("the chrome's type roles", () => {
  it("finds chrome under every root", () => {
    for (const root of CHROME_ROOTS) {
      expect(
        chromeFiles.some((file) => file.startsWith(root)),
        `no shipped source under ${root}: the guard would pass over a tree it no longer reads`,
      ).toBe(true);
    }
  });

  it("draws chrome in the five roles alone", () => {
    const offenders = chromeFiles.flatMap((file) => {
      const permitted = new Set(PROSE_SIZES.get(file)?.sizes);
      return rawSizesIn(file)
        .filter((size) => !permitted.has(size))
        .map((size) => `${file}: ${size}`);
    });
    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `RAW TYPE SIZES IN THE CHROME\n${offenders.map((line) => `  ${line}`).join("\n")}\n` +
            `  rule: chrome speaks text-caption | body | subtitle | title | display (${ROLES_DECLARED}); a raw size beside them is a second scale\n` +
            `  fix: name the role the line is; inside the note's prose, size in em so the size dial reaches it, or add a PROSE_SIZES row with its reason`,
    ).toEqual([]);
  });

  it("keeps no prose row its file no longer needs", () => {
    const stale = [...PROSE_SIZES].flatMap(([file, row]) => {
      const found = chromeFiles.includes(file) ? new Set(rawSizesIn(file)) : new Set<string>();
      return row.sizes.filter((size) => !found.has(size)).map((size) => `${file}: ${size}`);
    });
    expect(
      stale,
      `a PROSE_SIZES row permits a size its file no longer draws: drop it, or a raw size can return there unasked`,
    ).toEqual([]);
  });
});
