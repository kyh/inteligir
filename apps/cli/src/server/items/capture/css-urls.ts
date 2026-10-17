// the urls a stylesheet names, read and rewritten as plain text: the main thread reads them to know
// what a page copy must fetch, and the fill worker rewrites them to the data it was handed. A
// stylesheet is the page's and so hostile: nothing here evaluates it, a url that does not resolve to
// http or https is dropped, and an `@import` is inlined one level deep at most.

export type CopyResourceKind = "image" | "font";

export interface CssReference {
  url: string;
  kind: CopyResourceKind;
}

// url(x), url('x'), url("x"); an escaped quote inside is the page's problem and reads as part of it
const URL_TOKEN = /url\(\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^)'"\s]*))\s*\)/giu;
const IMPORT_RULE =
  /@import\s+(?:url\(\s*(?:"(?<urlDouble>[^"]*)"|'(?<urlSingle>[^']*)'|(?<urlBare>[^)'"\s]*))\s*\)|"(?<double>[^"]*)"|'(?<single>[^']*)')[^;]*;?/giu;
const FONT_FACE = /@font-face\s*\{[^}]*\}/giu;

export const resolveWebUrl = (raw: string, base: string): string | null => {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.startsWith("#") || /^data:/iu.test(trimmed)) {
    return null;
  }
  try {
    const url = new URL(trimmed, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

const tokenUrl = (groups: Record<string, string | undefined> | undefined): string =>
  groups?.double ?? groups?.single ?? groups?.bare ?? "";

// the ranges of the text inside an @font-face block
const fontFaceRanges = (css: string): [number, number][] =>
  [...css.matchAll(FONT_FACE)].map((match) => [match.index, match.index + match[0].length]);

// every url() the text names, each as the kind of file it loads, with the imports left out
export const cssReferences = (css: string, base: string): CssReference[] => {
  const withoutImports = css.replaceAll(IMPORT_RULE, "");
  const fonts = fontFaceRanges(withoutImports);
  const found = new Map<string, CopyResourceKind>();
  for (const match of withoutImports.matchAll(URL_TOKEN)) {
    const url = resolveWebUrl(tokenUrl(match.groups), base);
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

// the stylesheets an @import names, in order
export const cssImports = (css: string, base: string): string[] =>
  [...css.matchAll(IMPORT_RULE)]
    .map((match) => {
      const groups = match.groups ?? {};
      return resolveWebUrl(
        groups.urlDouble ??
          groups.urlSingle ??
          groups.urlBare ??
          groups.double ??
          groups.single ??
          "",
        base,
      );
    })
    .filter((url): url is string => url !== null);

const importUrl = (groups: Record<string, string | undefined> | undefined): string =>
  groups?.urlDouble ??
  groups?.urlSingle ??
  groups?.urlBare ??
  groups?.double ??
  groups?.single ??
  "";

// each match of `pattern` replaced by what `replace` answers for it, the text between kept
const replaceMatches = (
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

// every url() pointed at what `inline` answers for it, or replaced by `none` when it answers
// null; an import is replaced by `imported`'s text for it, or dropped
export const rewriteCss = (
  css: string,
  base: string,
  inline: (url: string) => string | null,
  imported: (url: string) => string | null = () => null,
): string => {
  const withImports = replaceMatches(css, IMPORT_RULE, (match) => {
    const url = resolveWebUrl(importUrl(match.groups), base);
    return url === null ? "" : `\n${imported(url) ?? ""}\n`;
  });
  return replaceMatches(withImports, URL_TOKEN, (match) => {
    // data the copy already holds stays as it is
    if (/^\s*data:/iu.test(tokenUrl(match.groups))) {
      return match[0];
    }
    const url = resolveWebUrl(tokenUrl(match.groups), base);
    const data = url === null ? null : inline(url);
    return data === null ? "none" : `url("${data}")`;
  });
};
