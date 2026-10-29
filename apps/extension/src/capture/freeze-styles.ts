// a page's styles as the browser holds them, for "Keep a copy of the page": rules a script inserted
// through the CSSOM never reach a <style>'s text, and a constructed sheet has no element at all, so
// a copy built from the markup alone would lose them. Each readable sheet's rules replace its own
// element, in place so the cascade keeps its order; a cross-origin sheet the page cannot read is
// left as its <link>, for the Mac to fetch.

// a sheet @imported inside another is inlined to this depth, past which its @import is kept
const IMPORT_DEPTH_MAX = 8;

const URL_TOKEN = /url\(\s*(?<quote>["']?)(?<target>[^"')]*)\k<quote>\s*\)/gu;

// a linked sheet's relative urls resolve against the sheet, but inlined they would resolve
// against the page, so each is written whole
export const absolutizeCssUrls = (css: string, base: string | null): string => {
  if (base === null) {
    return css;
  }
  return css.replaceAll(URL_TOKEN, (match, _quote: string, target: string) => {
    if (target === "" || target.startsWith("data:") || target.startsWith("#")) {
      return match;
    }
    try {
      return `url(${JSON.stringify(new URL(target, base).href)})`;
    } catch {
      return match;
    }
  });
};

// null when the sheet is another origin's, whose rules the page may not read
const readableRules = (sheet: CSSStyleSheet): CSSRuleList | null => {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
};

const sheetText = (sheet: CSSStyleSheet, depth: number): string | null => {
  const rules = readableRules(sheet);
  if (rules === null) {
    return null;
  }
  const parts: string[] = [];
  for (const rule of rules) {
    if (rule instanceof CSSImportRule && rule.styleSheet !== null && depth < IMPORT_DEPTH_MAX) {
      const imported = sheetText(rule.styleSheet, depth + 1);
      if (imported !== null) {
        const media = rule.media.mediaText;
        parts.push(media === "" ? imported : `@media ${media} {\n${imported}\n}`);
        continue;
      }
    }
    parts.push(rule.cssText);
  }
  return absolutizeCssUrls(parts.join("\n"), sheet.href);
};

const styleElement = (doc: Document, css: string, media: string): HTMLStyleElement => {
  const style = doc.createElement("style");
  if (media !== "") {
    style.setAttribute("media", media);
  }
  style.textContent = css;
  return style;
};

// `source` is the live page, `clone` its documentElement cloned; the two trees match node for node
// until the clone is changed, so the n-th style or link in one is the n-th in the other
export const freezeStyles = (source: Document, clone: Element): void => {
  const owners = [...source.querySelectorAll("style, link")];
  const cloned = [...clone.querySelectorAll("style, link")];
  const doc = clone.ownerDocument;
  for (const sheet of source.styleSheets) {
    const owner = sheet.ownerNode;
    if (!(owner instanceof Element)) {
      continue;
    }
    const index = owners.indexOf(owner);
    const target = cloned[index];
    const css = sheetText(sheet, 0);
    if (index === -1 || target === undefined || css === null) {
      continue;
    }
    target.replaceWith(styleElement(doc, css, sheet.media.mediaText));
  }
  // a constructed sheet applies after every sheet of the document's own
  const adopted = source.adoptedStyleSheets
    .map((sheet) => sheetText(sheet, 0))
    .filter((css) => css !== null);
  if (adopted.length > 0) {
    const head = clone.querySelector("head") ?? clone;
    head.append(styleElement(doc, adopted.join("\n"), ""));
  }
};
