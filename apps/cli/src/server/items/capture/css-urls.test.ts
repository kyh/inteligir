import { describe, expect, it } from "vitest";

import { resolveWebUrl } from "@repo/page-reader/web-url";

import { cssImports, cssReferences, rewriteCss } from "./css-urls";
import type { CopyResourceKind, CssReference } from "./css-urls";

const BASE = "https://example.test/css/site.css";

// the readings as the patterns this module once used, which backtracked quadratically on a hostile
// sheet: kept here only as the oracle the linear scanner must agree with on small texts
const ORACLE_URL = /url\(\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^)'"\s]*))\s*\)/giu;
const ORACLE_IMPORT =
  /@import\s+(?:url\(\s*(?:"(?<urlDouble>[^"]*)"|'(?<urlSingle>[^']*)'|(?<urlBare>[^)'"\s]*))\s*\)|"(?<double>[^"]*)"|'(?<single>[^']*)')[^;]*;?/giu;
const ORACLE_FONT_FACE = /@font-face\s*\{[^}]*\}/giu;

const tokenOf = (groups: Record<string, string | undefined> | undefined): string =>
  groups?.double ?? groups?.single ?? groups?.bare ?? "";
const importOf = (groups: Record<string, string | undefined> | undefined): string =>
  groups?.urlDouble ??
  groups?.urlSingle ??
  groups?.urlBare ??
  groups?.double ??
  groups?.single ??
  "";

const oracleReferences = (css: string, base: string): CssReference[] => {
  const withoutImports = css.replaceAll(ORACLE_IMPORT, "");
  const fonts = [...withoutImports.matchAll(ORACLE_FONT_FACE)].map((match): [number, number] => [
    match.index,
    match.index + match[0].length,
  ]);
  const found = new Map<string, CopyResourceKind>();
  for (const match of withoutImports.matchAll(ORACLE_URL)) {
    const url = resolveWebUrl(tokenOf(match.groups), base);
    if (url === null) {
      continue;
    }
    const inFont = fonts.some(([start, end]) => match.index >= start && match.index < end);
    if (!found.has(url) || inFont) {
      found.set(url, inFont ? "font" : "image");
    }
  }
  return [...found].map(([url, kind]) => ({ kind, url }));
};

const oracleImports = (css: string, base: string): string[] =>
  [...css.matchAll(ORACLE_IMPORT)]
    .map((match) => resolveWebUrl(importOf(match.groups), base))
    .filter((url): url is string => url !== null);

const oracleReplace = (
  text: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => string,
): string => {
  let out = "";
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    out += text.slice(at, match.index) + replace(match);
    at = match.index + match[0].length;
  }
  return out + text.slice(at);
};

const oracleRewrite = (
  css: string,
  base: string,
  inline: (url: string) => string | null,
  imported: (url: string) => string | null,
): string => {
  const withImports = oracleReplace(css, ORACLE_IMPORT, (match) => {
    const url = resolveWebUrl(importOf(match.groups), base);
    return url === null ? "" : `\n${imported(url) ?? ""}\n`;
  });
  return oracleReplace(withImports, ORACLE_URL, (match) => {
    if (/^\s*data:/iu.test(tokenOf(match.groups))) {
      return match[0];
    }
    const url = resolveWebUrl(tokenOf(match.groups), base);
    const data = url === null ? null : inline(url);
    return data === null ? "none" : `url("${data}")`;
  });
};

// the pieces a hostile or a real sheet is made of, so a random text hits every branch
const PIECES = [
  "url(",
  "URL(",
  ")",
  '"',
  "'",
  " ",
  "\t",
  "\n",
  "a.png",
  "/f.woff2",
  "data:x",
  "#frag",
  "@import",
  "@IMPORT ",
  "@font-face",
  "@Font-Face ",
  "{",
  "}",
  ";",
  "x",
  "ftp:1",
  "b c",
];

// a small deterministic generator, so a failure names a text that fails again
const seeded = (seed: number) => {
  let state = seed;
  return (bound: number): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % bound;
  };
};

const randomSheet = (next: (bound: number) => number): string =>
  Array.from({ length: 1 + next(24) }, () => PIECES[next(PIECES.length)] ?? "").join("");

const inline = (url: string): string | null => (url.endsWith(".png") ? `data:${url}` : null);
const imported = (url: string): string | null => (url.includes("a.png") ? "h1{}" : null);

// a megabyte, the most one stylesheet the copy reads may hold
const MiB = 1024 * 1024;
const sized = (unit: string): string => unit.repeat(Math.ceil(MiB / unit.length));

// a quadratic reading takes minutes on a megabyte; a linear one a few milliseconds
const LINEAR_BUDGET_MS = 1500;

const timed = (run: () => void): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

describe("css urls", () => {
  it("reads url(), @import and @font-face as the patterns did, on thousands of random texts", () => {
    const next = seeded(7);
    for (let round = 0; round < 4000; round += 1) {
      const css = randomSheet(next);
      expect(cssReferences(css, BASE), css).toEqual(oracleReferences(css, BASE));
      expect(cssImports(css, BASE), css).toEqual(oracleImports(css, BASE));
      expect(rewriteCss(css, BASE, inline, imported), css).toEqual(
        oracleRewrite(css, BASE, inline, imported),
      );
    }
  });

  it("names a font's file as a font and a background's as an image", () => {
    const css =
      "@font-face { font-family: X; src: url(/f.woff2) } body { background: url('/p.png') }" +
      ' @import url("/print.css"); @import "/more.css";';
    expect(cssReferences(css, BASE)).toEqual([
      { kind: "font", url: "https://example.test/f.woff2" },
      { kind: "image", url: "https://example.test/p.png" },
    ]);
    expect(cssImports(css, BASE)).toEqual([
      "https://example.test/print.css",
      "https://example.test/more.css",
    ]);
  });

  it.each([
    ["url( repeated", sized("url(")],
    ["url( before a megabyte of spaces", `url(${sized(" ")}`],
    ['url(" repeated', sized('url("')],
    ["url(' then url( repeated", `url('${sized("url(")}`],
    ["url(x before a megabyte of spaces", `${sized("url(")}${sized(" ")}x`],
    ["@font-face{ repeated", sized("@font-face{")],
    ["@font-face before a megabyte of spaces", `@font-face${sized(" ")}`],
    ["@import url( before a megabyte of spaces", `@import url(${sized(" ")}`],
    ["@import url( repeated", sized("@import url(")],
    ['@import " repeated', sized('@import "')],
    ["@import before a megabyte of spaces", `@import${sized(" ")}`],
    ["font blocks among urls", `${sized("@font-face{}").slice(0, MiB / 2)}${sized("url(a)")}`],
  ])("reads a hostile megabyte (%s) in one pass", (_name, css) => {
    const took = timed(() => {
      cssReferences(css, BASE);
      cssImports(css, BASE);
      rewriteCss(css, BASE, inline, imported);
    });
    expect(took).toBeLessThan(LINEAR_BUDGET_MS);
  });
});
