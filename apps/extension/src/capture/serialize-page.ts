// the page as the person sees it, for the Mac to read: the rendered DOM cloned, never the markup
// the server first sent, since a page built by script has nothing in that. The clone carries no
// script but structured data, no typed form value, each image at the source the browser chose,
// and a base so its relative links resolve where the page did. The Mac extracts the article; the
// page is never read here.

// types alone: the wire's schemas are zod, which the script injected into every saved page has no
// use for, so the worker hands it the cap
import type { CapturedPageWire } from "@repo/contract/browser/browser-wire";
import { freezeStyles } from "./freeze-styles";

export interface CaptureOptions {
  // "Keep a copy of the page": the styles are frozen into the clone, for a copy that looks right
  keepCopy: boolean;
  // CAPTURE_HTML_MAX_CHARS, past which the Mac reads the page from its url instead
  htmlMaxChars: number;
}

// the wire's caps (@repo/contract/browser/browser-wire)
const TITLE_MAX_CHARS = 2000;
const SELECTION_MAX_CHARS = 20_000;

// structured data describes the page (its author, its date) and runs nothing
const KEPT_SCRIPT_TYPE = "application/ld+json";
// an input whose value is its label, never something typed
const LABELLED_INPUT_TYPES = new Set(["button", "image", "reset", "submit"]);

const dropScripts = (clone: Element): void => {
  for (const script of clone.querySelectorAll("script")) {
    if (script.getAttribute("type")?.trim().toLowerCase() !== KEPT_SCRIPT_TYPE) {
      script.remove();
    }
  }
};

// what a person typed lives in properties a clone never copies; a value the markup prefilled is
// dropped too, so no field's content leaves the page
const dropFormValues = (clone: Element): void => {
  for (const input of clone.querySelectorAll("input")) {
    if (!LABELLED_INPUT_TYPES.has(input.getAttribute("type")?.trim().toLowerCase() ?? "")) {
      input.removeAttribute("value");
    }
  }
  for (const textarea of clone.querySelectorAll("textarea")) {
    textarea.textContent = "";
  }
};

// the image the browser chose from a srcset, or loaded in place of a lazy placeholder; the two
// trees match node for node, so the n-th image of one is the n-th of the other
const pinImages = (source: Document, clone: Element): void => {
  const live = [...source.querySelectorAll("img")];
  const cloned = [...clone.querySelectorAll("img")];
  for (const [index, image] of live.entries()) {
    const target = cloned[index];
    if (target !== undefined && image.currentSrc !== "") {
      target.setAttribute("src", image.currentSrc);
    }
  }
};

const setBase = (clone: Element, baseUri: string): void => {
  for (const base of clone.querySelectorAll("base")) {
    base.remove();
  }
  const base = clone.ownerDocument.createElement("base");
  base.setAttribute("href", baseUri);
  const head = clone.querySelector("head");
  if (head === null) {
    clone.prepend(base);
  } else {
    head.prepend(base);
  }
};

const selectionOf = (selection: Selection | null): CapturedPageWire["selection"] => {
  const text = (selection?.toString() ?? "").trim();
  return text === "" ? null : { text: text.slice(0, SELECTION_MAX_CHARS) };
};

export const serializePage = (
  source: Document,
  selection: Selection | null,
  options: CaptureOptions,
): CapturedPageWire => {
  const cloneNode = source.documentElement.cloneNode(true);
  const clone = cloneNode instanceof Element ? cloneNode : null;
  let html: string | null = null;
  if (clone !== null) {
    // each pass that maps the live tree onto the clone runs before anything leaves the clone
    if (options.keepCopy) {
      freezeStyles(source, clone);
    }
    pinImages(source, clone);
    dropScripts(clone);
    dropFormValues(clone);
    setBase(clone, source.baseURI);
    const serialized = `<!doctype html>\n${clone.outerHTML}`;
    html = serialized.length > options.htmlMaxChars ? null : serialized;
  }
  return {
    html,
    selection: selectionOf(selection),
    title: source.title.trim().slice(0, TITLE_MAX_CHARS),
    url: source.URL,
  };
};
