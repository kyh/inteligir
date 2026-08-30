// ---------------------------------------------------------------------------
// ONE FUNNEL, ONE SET OF NAMES.
//
// Settings → Appearance publishes CSS custom properties on <html> and the
// document reads them out of other packages' stylesheets and class strings.
// Nothing checks the two halves against each other: a token written under one
// name and read under another compiles, lints, renders — and the dial does
// nothing.
//
// So the lockstep is asserted over the SOURCES, and every name and value it
// compares is read out of them. The readers are not listed here either: the
// walk finds every `var(--editor-…)` in the repo, so a new file joins the
// invariant by existing. That walk spans every workspace and both file kinds a
// token can appear in, so it sits with the repo-wide guards rather than beside
// either half of the funnel.
// ---------------------------------------------------------------------------

import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, sourceOf, styleFiles, workspaceSourceFiles, workspaces } from "./repo";

/** The ONE module that writes an appearance token. */
const SETTER = "apps/desktop/src/renderer/app/appearance.tsx";

/** The ONE stylesheet that declares each token's default — what a dial sitting
 *  on its default option clears back to. */
const DEFAULTS = "apps/desktop/src/renderer/styles/globals.css";

/** The measure three columns line up on: the page title, the document and the
 *  composer sit in different stacking contexts, so they agree only by naming
 *  one value. */
const MEASURE = "--editor-width";

/** This file names the tokens it polices, in regexes and failure messages. */
const SELF = path.relative(REPO_ROOT, import.meta.filename);

interface TokenRead {
  readonly file: string;
  readonly token: string;
  readonly fallback: string | null;
}

/** `var(--editor-x)` and `var(--editor-x, <fallback>)`. The fallback is taken
 *  by balancing parens rather than by regex, because a fallback is itself
 *  usually a `var()`. */
function readsIn(file: string, text: string): TokenRead[] {
  const found: TokenRead[] = [];
  for (const match of text.matchAll(/var\(\s*(--editor-[a-z-]+)/gu)) {
    const token = match[1] ?? "";
    let depth = 1;
    let index = (match.index ?? 0) + match[0].length;
    let comma = -1;
    while (index < text.length && depth > 0) {
      const char = text[index];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 1 && comma === -1) comma = index;
      index += 1;
    }
    found.push({
      file,
      token,
      fallback: comma === -1 ? null : text.slice(comma + 1, index - 1).trim(),
    });
  }
  return found;
}

const written = new Set(
  [...sourceOf(SETTER).matchAll(/setToken\([^,]+,\s*"(--editor-[a-z-]+)"/gu)].map(
    (match) => match[1] ?? "",
  ),
);

const declared = new Map(
  [...sourceOf(DEFAULTS).matchAll(/(--editor-[a-z-]+)\s*:\s*([^;]+);/gu)].map((match) => [
    match[1] ?? "",
    (match[2] ?? "").trim(),
  ]),
);

const reads = workspaces()
  .flatMap((workspace) => workspaceSourceFiles(workspace).concat(styleFiles(workspace)))
  .filter((file) => file !== SELF)
  .flatMap((file) => readsIn(file, sourceOf(file)));
const readTokens = new Set(reads.map((entry) => entry.token));

describe("the appearance funnel's tokens", () => {
  it("finds the funnel at all", () => {
    // A walk that matched nothing would satisfy every assertion below.
    expect(written.size, `no setToken() call in ${SETTER}`).toBeGreaterThan(0);
    expect(declared.size, `no --editor-* declaration in ${DEFAULTS}`).toBeGreaterThan(0);
    expect(reads.length, "no var(--editor-*) read anywhere in the repo").toBeGreaterThan(0);
  });

  it("writes only tokens the document reads", () => {
    expect(
      [...written].filter((token) => !readTokens.has(token)).toSorted(),
      `${SETTER} publishes a token nothing reads — the dial that sets it changes nothing on screen`,
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
