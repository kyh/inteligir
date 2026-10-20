// "Keep a copy of the page": one html file with nothing in it that runs or loads. The plan names
// what the copy needs (stylesheets, the best source of each picture, what inline styles name), the
// server fetches those through the guard, and the build inlines them as data and sanitizes the
// rest: no script, frame, object, embed, applet or base, no meta refresh, no `on*` handler, no
// `javascript:`, no srcdoc and no form action; every link keeps its text and loses its href, the
// address moved to its title; and a meta policy (`default-src 'none'`) refuses whatever is left.

import { parsePage } from "@repo/page-reader/linkedom-page";
import { resolveWebUrl } from "@repo/page-reader/web-url";

import { cssImports, cssReferences, rewriteCss } from "../css-urls";
import type { CssReference } from "../css-urls";
import type { CopyFile } from "../fill-protocol";

const COPY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";

// the widest source a copy keeps of a responsive picture: a reading width, not a retina one
const SRCSET_MAX_WIDTH = 1600;
const PLAN_MAX_IMAGES = 200;

const REMOVED = [
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "base",
  "portal",
  "template",
  'meta[http-equiv="refresh" i]',
  'meta[http-equiv="content-security-policy" i]',
  "meta[charset]",
  'meta[http-equiv="content-type" i]',
].join(", ");

// attributes that name an address the copy would load or leave by
const URL_ATTRIBUTES = new Set([
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "imagesrcset",
  "longdesc",
  "manifest",
  "ping",
  "poster",
  "src",
  "srcset",
  "xlink:href",
]);

interface SrcsetCandidate {
  url: string;
  width: number;
}

const srcsetCandidates = (srcset: string, base: string): SrcsetCandidate[] =>
  srcset
    .split(/,\s+/u)
    .map((entry) => entry.trim().split(/\s+/u))
    .flatMap(([raw = "", descriptor = "1x"]) => {
      const url = resolveWebUrl(raw, base);
      if (url === null) {
        return [];
      }
      const width = /^(?<w>\d+)w$/u.exec(descriptor)?.groups?.w;
      const density = /^(?<x>[\d.]+)x$/u.exec(descriptor)?.groups?.x;
      return [{ url, width: width === undefined ? Number(density ?? 1) * 800 : Number(width) }];
    });

// the widest candidate at or under the reading width, else the narrowest over it
const bestOf = (candidates: readonly SrcsetCandidate[]): string | null => {
  const [within] = candidates
    .filter((candidate) => candidate.width <= SRCSET_MAX_WIDTH)
    .toSorted((a, b) => b.width - a.width);
  const [over] = candidates
    .filter((candidate) => candidate.width > SRCSET_MAX_WIDTH)
    .toSorted((a, b) => a.width - b.width);
  return within?.url ?? over?.url ?? null;
};

const pictureSource = (image: Element, base: string): string | null => {
  const parent = image.parentElement;
  const sources =
    parent?.nodeName === "PICTURE" ? [...parent.querySelectorAll("source[srcset]")] : [];
  const candidates = [
    ...sources.map((source) => source.getAttribute("srcset") ?? ""),
    image.getAttribute("srcset") ?? "",
  ].flatMap((srcset) => srcsetCandidates(srcset, base));
  return bestOf(candidates) ?? resolveWebUrl(image.getAttribute("src") ?? "", base);
};

const baseOf = (document: Document, pageUrl: string): string =>
  resolveWebUrl(document.querySelector("base[href]")?.getAttribute("href") ?? "", pageUrl) ??
  pageUrl;

export interface CopyPlan {
  stylesheets: string[];
  styleImports: string[];
  styleRefs: CssReference[];
  images: string[];
}

export const planCopy = (html: string, pageUrl: string): CopyPlan => {
  const document = parsePage(html);
  const base = baseOf(document, pageUrl);
  const stylesheets = [...document.querySelectorAll('link[rel~="stylesheet" i][href]')]
    .map((link) => resolveWebUrl(link.getAttribute("href") ?? "", base))
    .filter((url): url is string => url !== null);
  const inlineCss = [
    ...[...document.querySelectorAll("style")].map((style) => style.textContent ?? ""),
    ...[...document.querySelectorAll("[style]")].map(
      (element) => element.getAttribute("style") ?? "",
    ),
  ];
  const images = [
    ...[...document.querySelectorAll("img")].map((image) => pictureSource(image, base)),
    ...[...document.querySelectorAll("video[poster]")].map((video) =>
      resolveWebUrl(video.getAttribute("poster") ?? "", base),
    ),
  ].filter((url): url is string => url !== null);
  return {
    images: [...new Set(images)].slice(0, PLAN_MAX_IMAGES),
    styleImports: [...new Set(inlineCss.flatMap((css) => cssImports(css, base)))],
    styleRefs: inlineCss.flatMap((css) => cssReferences(css, base)),
    stylesheets: [...new Set(stylesheets)],
  };
};

// a scheme that runs when followed, however a page hides it in whitespace and control characters
const SCRIPT_SCHEME = /^(?:javascript|vbscript|data:text\/html)/iu;
const isScriptUrl = (value: string): boolean =>
  SCRIPT_SCHEME.test(value.replaceAll(/[\s\p{Cc}]+/gu, ""));

// a comment's text with nothing that could close it early
const commentSafe = (text: string): string =>
  text.replaceAll("--", "%2D%2D").replaceAll(">", "%3E");

interface Inliner {
  dataFor: (url: string) => string | null;
  cssFor: (url: string) => string | null;
}

const removeActive = (document: Document): void => {
  for (const element of document.querySelectorAll(REMOVED)) {
    element.remove();
  }
  for (const noscript of document.querySelectorAll("noscript")) {
    noscript.replaceWith(...noscript.childNodes);
  }
};

// every <style> rewritten to the copy's data, then every stylesheet link turned into one
const inlineStyles = (document: Document, base: string, inliner: Inliner): void => {
  for (const style of document.querySelectorAll("style")) {
    style.textContent = rewriteCss(style.textContent ?? "", base, inliner.dataFor, inliner.cssFor);
  }
  for (const link of document.querySelectorAll("link")) {
    const href = resolveWebUrl(link.getAttribute("href") ?? "", base);
    const isSheet = /\bstylesheet\b/iu.test(link.getAttribute("rel") ?? "");
    const css = isSheet && href !== null ? inliner.cssFor(href) : null;
    if (css === null) {
      link.remove();
      continue;
    }
    const style = document.createElement("style");
    style.textContent = css;
    link.replaceWith(style);
  }
};

// a picture the copy holds points at its data; one it could not fetch becomes its alt text
const inlinePictures = (document: Document, base: string, inliner: Inliner): void => {
  for (const image of document.querySelectorAll("img")) {
    const source = pictureSource(image, base);
    const data = source === null ? null : inliner.dataFor(source);
    if (data === null) {
      image.replaceWith(document.createTextNode(image.getAttribute("alt") ?? ""));
      continue;
    }
    image.setAttribute("src", data);
    for (const name of ["srcset", "sizes", "loading"]) {
      image.removeAttribute(name);
    }
  }
  // a picture's sources were read above; a video's or an audio's would load from the page
  for (const source of document.querySelectorAll("source, track")) {
    source.remove();
  }
  for (const video of document.querySelectorAll("video[poster]")) {
    const poster = resolveWebUrl(video.getAttribute("poster") ?? "", base);
    const data = poster === null ? null : inliner.dataFor(poster);
    if (data === null) {
      video.removeAttribute("poster");
    } else {
      video.setAttribute("poster", data);
    }
  }
};

// a link keeps its text and moves its address to the title, so a click inside the frame goes
// nowhere and a hover still says where it went
const disarmLinks = (document: Document, base: string): void => {
  for (const element of document.querySelectorAll("a[href], area[href]")) {
    const href = resolveWebUrl(element.getAttribute("href") ?? "", base);
    element.removeAttribute("href");
    if (href !== null) {
      element.setAttribute("title", href);
    }
  }
};

const isKeptAddress = (value: string): boolean => /^\s*(?:data:|#)/iu.test(value);

const stripAttributes = (document: Document, base: string, inliner: Inliner): void => {
  for (const element of document.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      const lower = name.toLowerCase();
      const value = element.getAttribute(name) ?? "";
      if (lower.startsWith("on") || lower === "srcdoc" || isScriptUrl(value)) {
        element.removeAttribute(name);
      } else if (lower === "style") {
        element.setAttribute(name, rewriteCss(value, base, inliner.dataFor));
      } else if (URL_ATTRIBUTES.has(lower) && !isKeptAddress(value)) {
        // whatever still names an address outside the copy points nowhere; the policy refuses it too
        element.removeAttribute(name);
      }
    }
  }
};

const headOf = (document: Document): Element => {
  const existing = document.querySelector("head");
  if (existing !== null) {
    return existing;
  }
  const head = document.createElement("head");
  document.documentElement.prepend(head);
  return head;
};

const serialize = (job: {
  html: string;
  url: string;
  savedOn: string;
  inliner: Inliner;
}): string => {
  const document = parsePage(job.html);
  const base = baseOf(document, job.url);
  removeActive(document);
  inlineStyles(document, base, job.inliner);
  inlinePictures(document, base, job.inliner);
  disarmLinks(document, base);
  stripAttributes(document, base, job.inliner);
  const policy = document.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", COPY_POLICY);
  const charset = document.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  headOf(document).prepend(charset, policy);
  const header = `<!-- Saved by inteligir from ${commentSafe(job.url)} on ${commentSafe(job.savedOn)} -->`;
  return `<!DOCTYPE html>\n${header}\n${document.documentElement.outerHTML}\n`;
};

export type CopyBuild = { kind: "copy"; html: string } | { kind: "copy-too-big" };

const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

// a picture inlines as base64, a third larger than its bytes
const INLINED_GROWTH = 1.3;

export interface CopyBuildJob {
  html: string;
  url: string;
  savedOn: string;
  files: readonly CopyFile[];
  stylesheets: readonly { url: string; css: string }[];
  maxBytes: number;
}

// over the cap, fonts go first, then the largest pictures (each replaced by its alt text)
export const buildCopy = (job: CopyBuildJob): CopyBuild => {
  const dropped = new Set<string>();
  const files = new Map(job.files.map((file) => [file.url, file]));
  const sheets = new Map(job.stylesheets.map((sheet) => [sheet.url, sheet.css]));
  const dataFor = (url: string): string | null =>
    dropped.has(url) ? null : (files.get(url)?.dataUri ?? null);
  // an imported sheet's own imports are not followed: one level deep
  const importedFor = (url: string): string | null => {
    const css = sheets.get(url);
    return css === undefined ? null : rewriteCss(css, url, dataFor);
  };
  const cssFor = (url: string): string | null => {
    const css = sheets.get(url);
    return css === undefined ? null : rewriteCss(css, url, dataFor, importedFor);
  };
  const attempt = (): string =>
    serialize({ html: job.html, inliner: { cssFor, dataFor }, savedOn: job.savedOn, url: job.url });

  let html = attempt();
  if (byteLength(html) <= job.maxBytes) {
    return { html, kind: "copy" };
  }
  for (const file of job.files) {
    if (file.kind === "font") {
      dropped.add(file.url);
    }
  }
  html = attempt();
  const pictures = job.files
    .filter((file) => file.kind === "image")
    .toSorted((a, b) => b.bytes - a.bytes);
  let saved = 0;
  for (const picture of pictures) {
    const over = byteLength(html) - job.maxBytes;
    if (over <= 0) {
      return { html, kind: "copy" };
    }
    dropped.add(picture.url);
    saved += picture.bytes * INLINED_GROWTH;
    if (saved >= over) {
      html = attempt();
      saved = 0;
    }
  }
  html = attempt();
  return byteLength(html) <= job.maxBytes ? { html, kind: "copy" } : { kind: "copy-too-big" };
};
