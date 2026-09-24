// a px literal beside the five roles is a sixth size no one chose, and it drifts a notch off the
// rows a role draws next to it. Only a held ai/ file keeps its own sizes, until a surface draws it.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, sourceOf } from "./repo";
import { AWAITING_CONSUMER, componentRoots, UI_DIR } from "./ui-package";

const TYPE_SCALE_CSS = `${UI_DIR}/src/styles/globals.css`;

const PX_SIZE = /text-\[\d+(?:\.\d+)?px\]/gu;

const SOURCE_FILE = /\.tsx?$/u;

const roleLadder = (): string[] =>
  [...sourceOf(TYPE_SCALE_CSS).matchAll(/--text-(?<role>[a-z]+):\s*(?<px>\d+)px;/gu)].map(
    (match) => `text-${match.groups?.role ?? ""} ${match.groups?.px ?? ""}px`,
  );

// the component roots, top level only, as the orphan guard reads them: a suite under __tests__ may
// spell a literal to assert against it
const sweptFiles = (): string[] =>
  componentRoots().flatMap((root) => {
    const dir = path.join(REPO_ROOT, UI_DIR, "src", root.dir);
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && SOURCE_FILE.test(entry.name))
      .map((entry) => `${UI_DIR}/src/${root.dir}/${entry.name}`);
  });

const pxSizesIn = (file: string): string[] =>
  sourceOf(file)
    .split("\n")
    .flatMap((line, index) =>
      [...line.matchAll(PX_SIZE)].map((match) => `  ${file}:${String(index + 1)} — ${match[0]}`),
    );

describe("@repo/ui draws the type roles", () => {
  it("finds the role ladder", () => {
    expect(
      roleLadder().length,
      `no --text-<role>: <n>px declaration in ${TYPE_SCALE_CSS}`,
    ).toBeGreaterThan(0);
  });

  it("spells no text-[Npx] outside a held ai/ file", () => {
    const literals = sweptFiles()
      .filter((file) => !AWAITING_CONSUMER.has(file))
      .flatMap((file) => pxSizesIn(file));
    expect(
      literals,
      `@repo/ui sizes its text with the five roles (${roleLadder().join(", ")}), declared in\n` +
        `${TYPE_SCALE_CSS}. Name the role the line IS: 13px is subtitle, 12 and 12.5px are\n` +
        `body, 10.5 to 11.5px are caption. Only a file in AWAITING_CONSUMER\n` +
        `(tools/repo-guards/src/ui-package.ts) keeps its own sizes:\n${literals.join("\n")}`,
    ).toEqual([]);
  });
});
