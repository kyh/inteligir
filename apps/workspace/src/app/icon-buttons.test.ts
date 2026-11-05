// A plain `.ts` file: it reads the page's sources off disk, and under jsdom
// `import.meta.url` is not a file URL.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pageSources } from "./test-support/page-sources";

const pageDir = import.meta.dirname;

// an opening tag: `<Button` through its closing `>`, attributes included; `=>` is taken whole so an
// arrow in an attribute cannot end the tag early.
const BUTTON_TAG = /<Button\b(?:=>|[^>])*?>/gsu;
const ICON_SIZE = /size="icon(?:-compact)?"/u;
const NAMED = /\baria-label=|\btitle=/u;

const iconButtonTags = (source: string): RegExpExecArray[] =>
  [...source.matchAll(BUTTON_TAG)].filter(([tag]) => ICON_SIZE.test(tag));

const unlabelledLines = (source: string): number[] =>
  iconButtonTags(source)
    .filter(([tag]) => !NAMED.test(tag))
    .map((match) => source.slice(0, match.index).split("\n").length);

// a Tooltip whose trigger is an icon-size Button: the Button draws its own from its label, so the
// pair shows two
const WRAPPED_ICON_BUTTON = /<Tooltip\b[^>]*>\s*<Button\b(?:=>|[^>])*?size="icon(?:-compact)?"/gsu;

const wrappedLines = (source: string): number[] =>
  [...source.matchAll(WRAPPED_ICON_BUTTON)].map(
    (match) => source.slice(0, match.index).split("\n").length,
  );

const unlabelledIconButtons = (): string[] =>
  pageSources(pageDir).flatMap((file) =>
    unlabelledLines(readFileSync(file, "utf-8")).map(
      (line) => `${path.relative(pageDir, file)}:${String(line)}`,
    ),
  );

describe("icon-only buttons", () => {
  it("every icon-size Button names what it does, which is also its tooltip", () => {
    expect(
      unlabelledIconButtons(),
      "An icon-size <Button> with no aria-label (or title) has no accessible name and no tooltip — the Button renders its label as both. Add an aria-label to:",
    ).toEqual([]);
  });

  it("draw their own tooltip, so no Tooltip wraps one", () => {
    const wrapped = pageSources(pageDir).flatMap((file) =>
      wrappedLines(readFileSync(file, "utf-8")).map(
        (line) => `${path.relative(pageDir, file)}:${String(line)}`,
      ),
    );
    expect(
      wrapped,
      "An icon-size <Button> shows its aria-label as its tooltip; a <Tooltip> around it shows a second. Drop the wrapper at:",
    ).toEqual([]);
    expect(
      wrappedLines(
        '<Tooltip content="Search">\n  <Button size="icon-compact" aria-label="Search">',
      ),
    ).toEqual([1]);
  });

  it("reads an arrow in an attribute as part of the tag", () => {
    expect(unlabelledLines('<Button onClick={() => x()} size="icon-compact">')).toEqual([1]);
    expect(unlabelledLines('<Button onClick={() => x()} size="icon" aria-label="Close">')).toEqual(
      [],
    );
  });

  it("finds the buttons at all", () => {
    const seen = pageSources(pageDir).flatMap((file) =>
      iconButtonTags(readFileSync(file, "utf-8")),
    ).length;
    expect(seen).toBeGreaterThan(5);
  });
});
