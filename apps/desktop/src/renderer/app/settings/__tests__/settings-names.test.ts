// A plain `.ts` file: it reads the settings sources off disk, and under jsdom
// `import.meta.url` is not a file URL.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const settingsDir = fileURLToPath(new URL("..", import.meta.url));

const NAME_PATTERNS = [
  /<SectionHeading>(?<name>[^<{]+)<[/]SectionHeading>/gu,
  /<Row label="(?<name>[^"]+)"/gu,
] as const;

const BUTTON_PATTERN = /<Button[^>]*>\s*(?<name>[A-Za-z][^<{]*?)\s*<[/]Button>/gu;

const sources = (): { file: string; text: string }[] =>
  readdirSync(settingsDir)
    .filter((name) => name.endsWith(".tsx"))
    .map((file) => ({ file, text: readFileSync(path.join(settingsDir, file), "utf-8") }));

// A set per file: one file spelling "Sign out" twice is two branches of one conditional.
const namesByFile = (patterns: readonly RegExp[]): { file: string; names: Set<string> }[] =>
  sources().map(({ file, text }) => ({
    file,
    names: new Set(
      patterns
        .flatMap((pattern) => [...text.matchAll(pattern)])
        .map((match) => match.groups?.name?.trim() ?? "")
        .filter((label) => label.length > 0),
    ),
  }));

const nameCount = (patterns: readonly RegExp[]): number =>
  namesByFile(patterns).reduce((total, entry) => total + entry.names.size, 0);

const sharedAcrossFiles = (patterns: readonly RegExp[]): string[] => {
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
};

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
