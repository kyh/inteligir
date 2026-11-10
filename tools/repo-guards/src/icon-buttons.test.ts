// An icon-size Button says nothing on its face, so @repo/ui's Button draws its aria-label (or
// title) as both its accessible name and its tooltip (packages/ui/src/components/button.tsx).
// One with no label has neither; one a <Tooltip> wraps shows two at once. The rule is every
// bundle's, the gallery's demos included, since a demo is the pattern the next screen copies.

import { describe, expect, it } from "vitest";

import { readTextFile, workspaceFiles, workspaces } from "./repo";

// an opening tag: `<Button` through its closing `>`, attributes included; `=>` is taken whole so an
// arrow in an attribute cannot end the tag early.
const BUTTON_TAG = /<Button\b(?:=>|[^>])*?>/gsu;
const ICON_SIZE = /size="icon(?:-compact)?"/u;
const NAMED = /\baria-label=|\btitle=/u;
// a label it reads as its text, which draws no tooltip (the dialog's Close, whose tooltip would
// open on the dialog's first focus and take its first Escape): an sr-only span before its close
const NAMED_BY_TEXT = /^(?:(?!<\/Button>).)*className="sr-only"/su;

// a Tooltip whose trigger is an icon-size Button
const WRAPPED_ICON_BUTTON = /<Tooltip\b[^>]*>\s*<Button\b(?:=>|[^>])*?size="icon(?:-compact)?"/gsu;

const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;

const iconButtonTags = (source: string): RegExpExecArray[] =>
  [...source.matchAll(BUTTON_TAG)].filter(([tag]) => ICON_SIZE.test(tag));

const namedByText = (source: string, match: RegExpExecArray): boolean =>
  !match[0].endsWith("/>") && NAMED_BY_TEXT.test(source.slice(match.index + match[0].length));

const unlabelledLines = (source: string): number[] =>
  iconButtonTags(source)
    .filter((match) => !NAMED.test(match[0]) && !namedByText(source, match))
    .map((match) => lineOf(source, match.index));

const wrappedLines = (source: string): number[] =>
  [...source.matchAll(WRAPPED_ICON_BUTTON)].map((match) => lineOf(source, match.index));

// read whole, not through sourceOf, whose dropped comment lines would shift every line it names
const drawn = workspaces()
  .flatMap((workspace) => workspaceFiles(workspace).shipped)
  .filter((file) => file.endsWith(".tsx"))
  .toSorted()
  .map((file) => ({ file, source: readTextFile(file) }));

const offenders = (lines: (source: string) => number[]): string[] =>
  drawn.flatMap(({ file, source }) => lines(source).map((line) => `${file}:${String(line)}`));

describe("icon-only buttons", () => {
  it("every icon-size Button names what it does, which is also its tooltip", () => {
    expect(
      offenders(unlabelledLines),
      "An icon-size <Button> with no aria-label (or title) has no accessible name and no tooltip — the Button renders its label as both. Add an aria-label to:",
    ).toStrictEqual([]);
  });

  it("draw their own tooltip, so no Tooltip wraps one", () => {
    expect(
      offenders(wrappedLines),
      "An icon-size <Button> shows its aria-label as its tooltip; a <Tooltip> around it shows a second. Drop the wrapper at:",
    ).toStrictEqual([]);
  });

  it("reads the shapes it refuses and the ones it allows", () => {
    expect(
      wrappedLines(
        '<Tooltip content="Search">\n  <Button size="icon-compact" aria-label="Search">',
      ),
    ).toStrictEqual([1]);
    expect(wrappedLines('<Tooltip content="New folder">\n  <SidebarGroupAction>')).toStrictEqual(
      [],
    );
    expect(unlabelledLines('<Button onClick={() => x()} size="icon-compact">')).toStrictEqual([1]);
    expect(
      unlabelledLines('<Button onClick={() => x()} size="icon" aria-label="Close">'),
    ).toStrictEqual([]);
    expect(
      unlabelledLines(
        '<Button size="icon-compact">\n  <XIcon />\n  <span className="sr-only">Close</span>\n</Button>',
      ),
    ).toStrictEqual([]);
    expect(
      unlabelledLines(
        '<Button size="icon">\n  <XIcon />\n</Button>\n<Button>\n  <span className="sr-only">x</span>\n</Button>',
      ),
    ).toStrictEqual([1]);
    expect(
      unlabelledLines(
        '<Button size="icon" />\n<Button>\n  <span className="sr-only">x</span>\n</Button>',
      ),
    ).toStrictEqual([1]);
  });

  it("finds the buttons in every bundle that draws one, the gallery included", () => {
    const seen = new Set(
      drawn
        .filter(({ source }) => iconButtonTags(source).length > 0)
        .map(({ file }) => file.split("/").slice(0, 2).join("/")),
    );
    for (const bundle of ["apps/web", "packages/editor", "packages/ui", "tools/ui-gallery"]) {
      expect(
        seen,
        `no icon-size Button under ${bundle}: the guard reads a tree it no longer finds`,
      ).toContain(bundle);
    }
  });
});
