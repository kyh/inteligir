// A plain `.ts` file: it reads the settings sources off disk, and under jsdom
// `import.meta.url` is not a file URL.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const settingsDir = fileURLToPath(new URL("..", import.meta.url));

const NAME_PATTERNS = [
  /<SectionHeading>([^<{]+)<[/]SectionHeading>/gu,
  /<Row label="([^"]+)"/gu,
] as const;

const BUTTON_PATTERN = /<Button[^>]*>\s*([A-Za-z][^<{]*?)\s*<[/]Button>/gu;

function sources(): Array<{ file: string; text: string }> {
  return readdirSync(settingsDir)
    .filter((name) => name.endsWith(".tsx"))
    .map((file) => ({ file, text: readFileSync(join(settingsDir, file), "utf8") }));
}

// A set per file: one file spelling "Unpair" twice is two branches of one conditional.
function namesByFile(patterns: readonly RegExp[]): Array<{ file: string; names: Set<string> }> {
  return sources().map(({ file, text }) => ({
    file,
    names: new Set(
      patterns
        .flatMap((pattern) => [...text.matchAll(pattern)])
        .map((match) => match[1]?.trim() ?? "")
        .filter((label) => label.length > 0),
    ),
  }));
}

function nameCount(patterns: readonly RegExp[]): number {
  return namesByFile(patterns).reduce((total, entry) => total + entry.names.size, 0);
}

function sharedAcrossFiles(patterns: readonly RegExp[]): string[] {
  const owners = new Map<string, Set<string>>();
  for (const { file, names } of namesByFile(patterns)) {
    for (const name of names) {
      const files = owners.get(name) ?? new Set<string>();
      files.add(file);
      owners.set(name, files);
    }
  }
  return [...owners]
    .filter(([, files]) => files.size > 1)
    .map(([name]) => name)
    .toSorted();
}

describe("the settings dialog names each thing once", () => {
  it("finds the names at all", () => {
    expect(nameCount(NAME_PATTERNS)).toBeGreaterThan(5);
    expect(nameCount([BUTTON_PATTERN])).toBeGreaterThan(2);
  });

  it("gives no two sections the same name", () => {
    expect(
      sharedAcrossFiles(NAME_PATTERNS),
      "two sections of Settings answer to one name; a reader cannot tell them apart",
    ).toEqual([]);
  });

  it("gives no two sections' buttons the same label", () => {
    expect(
      sharedAcrossFiles([BUTTON_PATTERN]),
      "two buttons in Settings read identically and do different things; say what each one moves",
    ).toEqual([]);
  });
});
