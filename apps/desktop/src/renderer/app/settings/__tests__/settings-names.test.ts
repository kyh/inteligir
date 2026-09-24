// A plain `.ts` file: it reads the settings sources off disk, and under jsdom
// `import.meta.url` is not a file URL.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const settingsDir = fileURLToPath(new URL("..", import.meta.url));

type NameReader = (text: string) => string[];

const SECTION_PATTERNS = [
  /<SectionHeading>(?<name>[^<{]+)<[/]SectionHeading>/gu,
  /<Row label="(?<name>[^"]+)"/gu,
] as const;

const sectionNames: NameReader = (text) =>
  SECTION_PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)]).map(
    (match) => match.groups?.name ?? "",
  );

// An inline handler's `=>` is never the end of the tag, even when backtracking asks it to be.
const BUTTON_PATTERN = /<Button\b(?:=>|=(?!>)|[^=>])*(?<![/])>(?<label>[\s\S]*?)<[/]Button>/gu;
const EXPRESSION = /\{[^{}]*\}/gu;
const ELEMENT = /<[^>]*>/gu;
// a label is capitalized: the lowercase literals in a label's expression are its conditions
const LABEL_LITERAL = /"(?<text>[A-Z][^"]*)"/gu;

// A label is its text plus every literal its expressions can show, so both halves of
// `{connected ? "Reconnect" : "Connect"}` are names.
const buttonNames: NameReader = (text) =>
  [...text.matchAll(BUTTON_PATTERN)].flatMap((match) => {
    const label = match.groups?.label ?? "";
    const literals = [...label.matchAll(EXPRESSION)].flatMap(([expression]) =>
      [...expression.matchAll(LABEL_LITERAL)].map((literal) => literal.groups?.text ?? ""),
    );
    return [label.replaceAll(EXPRESSION, " ").replaceAll(ELEMENT, " "), ...literals];
  });

const sources = (): { file: string; text: string }[] =>
  readdirSync(settingsDir)
    .filter((name) => name.endsWith(".tsx"))
    .map((file) => ({ file, text: readFileSync(path.join(settingsDir, file), "utf-8") }));

// A set per file: one file spelling "Sign out" twice is two branches of one conditional.
const namesByFile = (read: NameReader): { file: string; names: Set<string> }[] =>
  sources().map(({ file, text }) => ({
    file,
    names: new Set(
      read(text)
        .map((name) => name.replaceAll(/\s+/gu, " ").trim())
        .filter((name) => name.length > 0),
    ),
  }));

const nameCount = (read: NameReader): number =>
  namesByFile(read).reduce((total, entry) => total + entry.names.size, 0);

const sharedAcrossFiles = (read: NameReader): string[] => {
  const owners = new Map<string, Set<string>>();
  for (const { file, names } of namesByFile(read)) {
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

describe("the button reader", () => {
  it("reads a label behind an inline handler, and every label an expression can show", () => {
    const source = `
      <Button onClick={() => { go(); }}>Remove</Button>
      <Button disabled={busy}>{state === "needs-auth" ? "Connect" : "Reconnect"}</Button>
      <Button onClick={back}><ArrowLeftIcon />Notes</Button>
      <Button aria-label="Close" onClick={() => close()} />
      <Button>Sync now</Button>
    `;
    expect(
      buttonNames(source)
        .map((name) => name.trim())
        .filter(Boolean),
    ).toEqual(["Remove", "Connect", "Reconnect", "Notes", "Sync now"]);
  });
});

describe("the settings dialog names each thing once", () => {
  it("finds the names at all", () => {
    expect(nameCount(sectionNames)).toBeGreaterThan(5);
    expect(nameCount(buttonNames)).toBeGreaterThan(10);
  });

  it("gives no two sections the same name", () => {
    expect(
      sharedAcrossFiles(sectionNames),
      "two sections of Settings answer to one name; a reader cannot tell them apart",
    ).toEqual([]);
  });

  it("gives no two sections' buttons the same label", () => {
    expect(
      sharedAcrossFiles(buttonNames),
      "two buttons in Settings read identically and do different things; say what each one moves",
    ).toEqual([]);
  });
});
