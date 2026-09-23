// A plain `.ts` file: it reads the renderer sources off disk, and under jsdom
// `import.meta.url` is not a file URL.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rendererSources } from "./renderer-sources";

const rendererDir = fileURLToPath(new URL("..", import.meta.url));

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

const unlabelledIconButtons = (): string[] =>
  rendererSources(rendererDir).flatMap((file) =>
    unlabelledLines(readFileSync(file, "utf-8")).map(
      (line) => `${path.relative(rendererDir, file)}:${String(line)}`,
    ),
  );

describe("icon-only buttons", () => {
  it("every icon-size Button names what it does, which is also its tooltip", () => {
    expect(
      unlabelledIconButtons(),
      "An icon-size <Button> with no aria-label (or title) has no accessible name and no tooltip — the Button renders its label as both. Add an aria-label to:",
    ).toEqual([]);
  });

  it("reads an arrow in an attribute as part of the tag", () => {
    expect(unlabelledLines('<Button onClick={() => x()} size="icon-compact">')).toEqual([1]);
    expect(unlabelledLines('<Button onClick={() => x()} size="icon" aria-label="Close">')).toEqual(
      [],
    );
  });

  it("finds the buttons at all", () => {
    const seen = rendererSources(rendererDir).flatMap((file) =>
      iconButtonTags(readFileSync(file, "utf-8")),
    ).length;
    expect(seen).toBeGreaterThan(5);
  });
});
