// the urls a stylesheet names, read and rewritten as plain text: the main thread reads them to know
// what a page copy must fetch, and the fill worker rewrites them to the data it was handed. A
// stylesheet is the page's and so hostile: nothing here evaluates it, a url that does not resolve to
// http or https is dropped, and an `@import` is inlined one level deep at most. The main thread
// reads up to 3 MiB of it, so every reading is one forward pass: no pattern that backtracks, and no
// stretch of the text scanned again for a later start (`url(url(url(…` and `url(` before a megabyte
// of spaces are linear too).

export type CopyResourceKind = "image" | "font";

export interface CssReference {
  url: string;
  kind: CopyResourceKind;
}

// one match of a reading: where it starts and ends, and the address it names ("" when none)
interface CssMatch {
  index: number;
  end: number;
  raw: string;
}

const SPACE = /\s/u;
const URL_OPEN = /url\(/iuy;
const BARE_STOP = new Set([")", "'", '"']);
const isBare = (char: string): boolean => !BARE_STOP.has(char) && !SPACE.test(char);
const isSpace = (char: string): boolean => SPACE.test(char);

// the reads a scan makes, each remembered so a later start never scans the same stretch again:
// the next of a character from a position, and where a run of spaces or of a bare url ends
const textReader = (text: string) => {
  const found = new Map<string, { from: number; at: number }>();
  const runs = new Map<"space" | "bare", { from: number; end: number }>();
  const runEnd = (kind: "space" | "bare", from: number): number => {
    const known = runs.get(kind);
    if (known !== undefined && from >= known.from && from <= known.end) {
      return known.end;
    }
    const inRun = kind === "space" ? isSpace : isBare;
    let end = from;
    while (end < text.length && inRun(text.charAt(end))) {
      end += 1;
    }
    // an empty run cost nothing to read, and remembering it would forget the long one a later
    // start inside the same bare url still needs (`url(url(…` before a megabyte of spaces)
    if (end > from) {
      runs.set(kind, { end, from });
    }
    return end;
  };
  const indexOf = (char: string, from: number): number => {
    const known = found.get(char);
    if (known !== undefined && from >= known.from && (known.at === -1 || from <= known.at)) {
      return known.at;
    }
    const at = text.indexOf(char, from);
    found.set(char, { at, from });
    return at;
  };
  // `url(` at `start`: `url(x)`, `url('x')` or `url("x")`, spaces allowed inside the parentheses;
  // an escaped quote inside is the page's problem and reads as part of it
  const urlAt = (start: number): CssMatch | null => {
    const open = runEnd("space", start + 4);
    const quote = text.charAt(open);
    let from = open;
    let to: number;
    let after: number;
    if (quote === '"' || quote === "'") {
      from = open + 1;
      to = indexOf(quote, from);
      if (to === -1) {
        return null;
      }
      after = to + 1;
    } else {
      to = runEnd("bare", open);
      after = to;
    }
    const close = runEnd("space", after);
    return text.charAt(close) === ")"
      ? { end: close + 1, index: start, raw: text.slice(from, to) }
      : null;
  };
  const opensUrl = (at: number): boolean => {
    URL_OPEN.lastIndex = at;
    return URL_OPEN.test(text);
  };
  // `@import` at `start`, then spaces, then a url() or a quoted address, through its `;`
  const importAt = (start: number): CssMatch | null => {
    const at = runEnd("space", start + 7);
    if (at === start + 7) {
      return null;
    }
    let raw: string;
    let after: number;
    const quote = text.charAt(at);
    if (quote === '"' || quote === "'") {
      const to = indexOf(quote, at + 1);
      if (to === -1) {
        return null;
      }
      raw = text.slice(at + 1, to);
      after = to + 1;
    } else if (opensUrl(at)) {
      const token = urlAt(at);
      if (token === null) {
        return null;
      }
      ({ raw } = token);
      after = token.end;
    } else {
      return null;
    }
    const semicolon = indexOf(";", after);
    return { end: semicolon === -1 ? text.length : semicolon + 1, index: start, raw };
  };
  // `@font-face` at `start`, then spaces, then its block through the first `}`
  const fontFaceAt = (start: number): CssMatch | null => {
    const open = runEnd("space", start + 10);
    if (text.charAt(open) !== "{") {
      return null;
    }
    const close = indexOf("}", open + 1);
    return close === -1 ? null : { end: close + 1, index: start, raw: "" };
  };
  return { fontFaceAt, importAt, urlAt };
};

type Reading = "url" | "import" | "font-face";

const STARTS: Record<Reading, string> = {
  "font-face": "@font-face",
  import: "@import",
  url: "url\\(",
};

// every match of one reading, in order and never overlapping: after a match the next start is
// looked for past its end, and after a start that does not match, from the next character
const matchesOf = (text: string, reading: Reading): CssMatch[] => {
  const reader = textReader(text);
  const readers: Record<Reading, (start: number) => CssMatch | null> = {
    "font-face": reader.fontFaceAt,
    import: reader.importAt,
    url: reader.urlAt,
  };
  const at = readers[reading];
  const start = new RegExp(STARTS[reading], "giu");
  const matches: CssMatch[] = [];
  for (let found = start.exec(text); found !== null; found = start.exec(text)) {
    const match = at(found.index);
    if (match === null) {
      start.lastIndex = found.index + 1;
    } else {
      matches.push(match);
      start.lastIndex = match.end;
    }
  }
  return matches;
};

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

// each match replaced by what `replace` answers for it, the text between kept
const replaceMatches = (
  text: string,
  matches: readonly CssMatch[],
  replace: (match: CssMatch) => string,
): string => {
  const parts: string[] = [];
  let at = 0;
  for (const match of matches) {
    parts.push(text.slice(at, match.index), replace(match));
    at = match.end;
  }
  parts.push(text.slice(at));
  return parts.join("");
};

// every url() the text names, each as the kind of file it loads, with the imports left out
export const cssReferences = (css: string, base: string): CssReference[] => {
  const withoutImports = replaceMatches(css, matchesOf(css, "import"), () => "");
  const fonts = matchesOf(withoutImports, "font-face");
  const found = new Map<string, CopyResourceKind>();
  // both lists run in order of position, so one walk pairs each url with the block it is in
  let font = 0;
  for (const match of matchesOf(withoutImports, "url")) {
    const url = resolveWebUrl(match.raw, base);
    if (url === null) {
      continue;
    }
    while (font < fonts.length && (fonts[font]?.end ?? 0) <= match.index) {
      font += 1;
    }
    const block = fonts[font];
    const inFont = block !== undefined && match.index >= block.index;
    if (!found.has(url) || inFont) {
      found.set(url, inFont ? "font" : "image");
    }
  }
  return [...found].map(([url, kind]) => ({ kind, url }));
};

// the stylesheets an @import names, in order
export const cssImports = (css: string, base: string): string[] =>
  matchesOf(css, "import")
    .map((match) => resolveWebUrl(match.raw, base))
    .filter((url): url is string => url !== null);

// every url() pointed at what `inline` answers for it, or replaced by `none` when it answers
// null; an import is replaced by `imported`'s text for it, or dropped
export const rewriteCss = (
  css: string,
  base: string,
  inline: (url: string) => string | null,
  imported: (url: string) => string | null = () => null,
): string => {
  const withImports = replaceMatches(css, matchesOf(css, "import"), (match) => {
    const url = resolveWebUrl(match.raw, base);
    return url === null ? "" : `\n${imported(url) ?? ""}\n`;
  });
  return replaceMatches(withImports, matchesOf(withImports, "url"), (match) => {
    // data the copy already holds stays as it is
    if (/^\s*data:/iu.test(match.raw)) {
      return withImports.slice(match.index, match.end);
    }
    const url = resolveWebUrl(match.raw, base);
    const data = url === null ? null : inline(url);
    return data === null ? "none" : `url("${data}")`;
  });
};
