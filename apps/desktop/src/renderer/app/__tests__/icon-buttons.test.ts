// A plain `.ts` file: it reads the renderer sources off disk, and under jsdom
// `import.meta.url` is not a file URL.

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rendererSources } from "./renderer-sources";

const rendererDir = fileURLToPath(new URL("..", import.meta.url));

// an opening tag: `<Button` through its closing `>`, attributes included
const BUTTON_TAG = /<Button\b[^>]*?>/gsu;

function unlabelledIconButtons(): string[] {
  const findings: string[] = [];
  for (const file of rendererSources(rendererDir)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(BUTTON_TAG)) {
      const tag = match[0];
      if (!/size="icon(?:-compact)?"/u.test(tag)) continue;
      if (/\baria-label=|\btitle=/u.test(tag)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      findings.push(`${relative(rendererDir, file)}:${String(line)}`);
    }
  }
  return findings;
}

describe("icon-only buttons", () => {
  it("every icon-size Button names what it does, which is also its tooltip", () => {
    expect(
      unlabelledIconButtons(),
      "An icon-size <Button> with no aria-label (or title) has no accessible name and no tooltip — the Button renders its label as both. Add an aria-label to:",
    ).toEqual([]);
  });

  it("finds the buttons at all", () => {
    let seen = 0;
    for (const file of rendererSources(rendererDir)) {
      for (const match of readFileSync(file, "utf8").matchAll(BUTTON_TAG)) {
        if (/size="icon(?:-compact)?"/u.test(match[0])) seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(5);
  });
});
