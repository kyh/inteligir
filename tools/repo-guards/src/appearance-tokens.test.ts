// a token written under one name and read under another compiles, lints and renders; the dial just
// does nothing.

import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, sourceOf, styleFiles, workspaceSourceFiles, workspaces } from "./repo";

const DIALS = "apps/desktop/src/renderer/app/appearance-options.ts";

const DEFAULTS = "apps/desktop/src/renderer/styles/globals.css";

const MEASURE = "--editor-width";

// the phone's editor page is a second host: it imports the editor's sheet, never the desktop's
// defaults, so it writes a value of its own for every token that sheet reads
const PHONE_PAGE = "apps/mobile-editor/src/styles/globals.css";

const EDITOR_SHEET = "packages/editor/src/styles.css";

// iOS zooms into a field whose text is smaller, and the page pins the scale at 1
const PHONE_MIN_SIZE_PX = 16;

// this file names the tokens it polices, so the walk skips it.
const SELF = path.relative(REPO_ROOT, import.meta.filename);

interface TokenRead {
  readonly file: string;
  readonly token: string;
  readonly fallback: string | null;
}

// the fallback is taken by balancing parens: a fallback is itself usually a var().
const readsIn = (file: string, text: string): TokenRead[] => {
  const found: TokenRead[] = [];
  for (const match of text.matchAll(/var\(\s*(?<token>--editor-[a-z-]+)/gu)) {
    const token = match.groups?.token ?? "";
    let depth = 1;
    let index = (match.index ?? 0) + match[0].length;
    let comma = -1;
    while (index < text.length && depth > 0) {
      const char = text[index];
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      } else if (char === "," && depth === 1 && comma === -1) {
        comma = index;
      }
      index += 1;
    }
    found.push({
      fallback: comma === -1 ? null : text.slice(comma + 1, index - 1).trim(),
      file,
      token,
    });
  }
  return found;
};

const written = new Set(
  [...sourceOf(DIALS).matchAll(/\bdial\(\s*"(?<token>--editor-[a-z-]+)"/gu)].map(
    (match) => match.groups?.token ?? "",
  ),
);

const declarationsIn = (file: string): Map<string, string> =>
  new Map(
    [...sourceOf(file).matchAll(/(?<token>--editor-[a-z-]+)\s*:\s*(?<value>[^;]+);/gu)].map(
      (match) => [match.groups?.token ?? "", (match.groups?.value ?? "").trim()],
    ),
  );

const declared = declarationsIn(DEFAULTS);

const phoneWrites = declarationsIn(PHONE_PAGE);

const reads = workspaces()
  .flatMap((workspace) => [...workspaceSourceFiles(workspace), ...styleFiles(workspace)])
  .filter((file) => file !== SELF)
  .flatMap((file) => readsIn(file, sourceOf(file)));
const readTokens = new Set(reads.map((entry) => entry.token));

describe("the appearance funnel's tokens", () => {
  it("finds the funnel at all", () => {
    expect(written.size, `no dial() row in ${DIALS}`).toBeGreaterThan(0);
    expect(declared.size, `no --editor-* declaration in ${DEFAULTS}`).toBeGreaterThan(0);
    expect(reads.length, "no var(--editor-*) read anywhere in the repo").toBeGreaterThan(0);
  });

  it("writes only tokens the document reads", () => {
    expect(
      [...written].filter((token) => !readTokens.has(token)).toSorted(),
      `${DIALS} publishes a token nothing reads — the dial that sets it changes nothing on screen`,
    ).toEqual([]);
  });

  it("reads only tokens the stylesheet declares", () => {
    expect(
      reads
        .filter((entry) => !declared.has(entry.token))
        .map((entry) => `${entry.file}: ${entry.token}`)
        .toSorted(),
      `${DEFAULTS} declares no such token, so the read resolves to nothing and the dial behind it is invisible`,
    ).toEqual([]);
  });

  it("declares only tokens the document reads", () => {
    expect(
      [...declared.keys()].filter((token) => !readTokens.has(token)).toSorted(),
      `${DEFAULTS} declares a token nothing reads`,
    ).toEqual([]);
  });

  it("leaves the measure without a fallback anywhere", () => {
    expect(
      reads
        .filter((entry) => entry.token === MEASURE && entry.fallback !== null)
        .map((entry) => entry.file)
        .toSorted(),
      `${MEASURE} carries a fallback: columns that must line up would be reading two values under one name`,
    ).toEqual([]);
  });

  it("spells every fallback exactly as the stylesheet's default", () => {
    expect(
      reads
        .filter((entry) => entry.fallback !== null && entry.fallback !== declared.get(entry.token))
        .map(
          (entry) =>
            `${entry.file}: var(${entry.token}, ${entry.fallback ?? ""}) vs ${declared.get(entry.token) ?? ""}`,
        )
        .toSorted(),
      `a fallback is a second spelling of a default: match ${DEFAULTS} exactly, or carry no fallback`,
    ).toEqual([]);
  });
});

describe("the phone page's own dials", () => {
  const sheetReads = new Set(
    readsIn(EDITOR_SHEET, sourceOf(EDITOR_SHEET)).map((entry) => entry.token),
  );

  it("finds the page's writes and the sheet's reads at all", () => {
    expect(phoneWrites.size, `no --editor-* declaration in ${PHONE_PAGE}`).toBeGreaterThan(0);
    expect(sheetReads.size, `no var(--editor-*) read in ${EDITOR_SHEET}`).toBeGreaterThan(0);
  });

  it("writes a value for every token the editor's sheet reads", () => {
    expect(
      [...sheetReads].filter((token) => !phoneWrites.has(token)).toSorted(),
      `${PHONE_PAGE} imports ${EDITOR_SHEET} but not ${DEFAULTS}, so a token it does not write reads as nothing on the phone`,
    ).toEqual([]);
  });

  it("writes only tokens the document reads", () => {
    expect(
      [...phoneWrites.keys()].filter((token) => !readTokens.has(token)).toSorted(),
      `${PHONE_PAGE} writes a token nothing reads`,
    ).toEqual([]);
  });

  it(`keeps the note's text at ${String(PHONE_MIN_SIZE_PX)}px or more`, () => {
    const size = /^(?<px>\d+(?:\.\d+)?)px$/u.exec(phoneWrites.get("--editor-size") ?? "");
    expect(
      Number(size?.groups?.px ?? 0),
      `${PHONE_PAGE} must set --editor-size in px, at ${String(PHONE_MIN_SIZE_PX)} or more: iOS zooms into a field whose text is smaller`,
    ).toBeGreaterThanOrEqual(PHONE_MIN_SIZE_PX);
  });
});
