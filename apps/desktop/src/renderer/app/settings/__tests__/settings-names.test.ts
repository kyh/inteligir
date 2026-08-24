// ---------------------------------------------------------------------------
// ONE DIALOG, ONE NAME PER THING — and one name per BUTTON above all.
//
// The Vault section owns a row labelled "Sync" whose "Sync now" button pushes
// FILES to a git remote. Cloud sync arrived as a section also titled "Sync",
// with a button also labelled "Sync now", moving THREADS to an account. Two
// identical buttons, two different destinations, no way for a reader to tell
// which is which — and nothing noticed, because each file read perfectly well
// on its own.
//
// So the invariant spans the FILES rather than living in one, and it is
// derived: the labels are read out of the sources, not listed here. A third
// section borrowing a name fails this.
//
// Its own file, and a plain `.ts` one, because it reads the settings modules
// off disk — the surface suites beside it run under jsdom, where
// `import.meta.url` is not a file URL.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const settingsDir = fileURLToPath(new URL("..", import.meta.url));

/** What a section calls itself, and what a row calls its value — the two ways
 *  this dialog names a thing. */
const NAME_PATTERNS = [
  /<SectionHeading>([^<{]+)<[/]SectionHeading>/gu,
  /<Row label="([^"]+)"/gu,
] as const;

/** The visible text of a button with a literal label. Buttons whose label is
 *  an expression are skipped: this walk reads source, and a name it cannot see
 *  is one it must not guess at. */
const BUTTON_PATTERN = /<Button[^>]*>\s*([A-Za-z][^<{]*?)\s*<[/]Button>/gu;

function sources(): Array<{ file: string; text: string }> {
  return readdirSync(settingsDir)
    .filter((name) => name.endsWith(".tsx"))
    .map((file) => ({ file, text: readFileSync(join(settingsDir, file), "utf8") }));
}

/** Every name a file uses, as a SET — a file that spells one label twice is
 *  spelling it in two branches of the same conditional (the paired and revoked
 *  states each offer "Unpair"), which a reader sees one of at a time and a
 *  designer sees both of at once. */
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

/** Names claimed by MORE THAN ONE file — the class that bit: two sections in
 *  two modules, each reading fine alone, colliding only on screen. */
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
    // A walk that matched nothing would satisfy both assertions below.
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
