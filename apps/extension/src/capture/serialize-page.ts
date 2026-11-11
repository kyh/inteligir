// the page as the person sees it, for the extension to read: the rendered DOM cloned, never the
// markup the server first sent, since a page built by script has nothing in that. The clone
// carries no script but structured data, nothing typed into the page or prefilled by its server
// (no form value or choice, no rich text box's words), each image at the source the browser chose,
// and a base so its relative links resolve where the page did. The page is read by the service
// worker, over this clone; nothing is read here.

// types alone: zod has no place in the script injected into every saved page, so the worker
// hands it the caps
import type { CaptureOptions, CapturedPage } from "./captured-page";

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

// a box a person types rich text into (a mail being written, a message, a comment) is part of the
// DOM a clone copies, so it is emptied, as an editor that names itself a textbox is
const EDITABLE = '[contenteditable]:not([contenteditable="false" i]), [role="textbox"]';

// what a person typed lives in properties a clone never copies; a value or a choice the markup
// prefilled (a saved address, a ticked box, a chosen country) is dropped too, and every rich text
// box emptied, so no field's content leaves the page. An option's own value is the page's list of
// choices, and stays
const dropFormValues = (clone: Element): void => {
  for (const input of clone.querySelectorAll("input")) {
    if (!LABELLED_INPUT_TYPES.has(input.getAttribute("type")?.trim().toLowerCase() ?? "")) {
      input.removeAttribute("value");
    }
    input.removeAttribute("checked");
  }
  for (const option of clone.querySelectorAll("option")) {
    option.removeAttribute("selected");
  }
  for (const textarea of clone.querySelectorAll("textarea")) {
    textarea.textContent = "";
  }
  for (const editable of clone.querySelectorAll(EDITABLE)) {
    editable.replaceChildren();
  }
};

// the image the browser chose from a srcset or a <picture>, or loaded in place of a lazy
// placeholder, as the clone's one source; the two trees match node for node, so the n-th image of
// one is the n-th of the other
const pinImages = (source: Document, clone: Element): void => {
  const live = [...source.querySelectorAll("img")];
  const cloned = [...clone.querySelectorAll("img")];
  for (const [index, image] of live.entries()) {
    const target = cloned[index];
    if (target !== undefined && image.currentSrc !== "") {
      target.setAttribute("src", image.currentSrc);
      target.removeAttribute("srcset");
      target.removeAttribute("sizes");
    }
  }
  for (const candidate of clone.querySelectorAll("picture > source")) {
    candidate.remove();
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

export const serializePage = (source: Document, options: CaptureOptions): CapturedPage => {
  const cloneNode = source.documentElement.cloneNode(true);
  const clone = cloneNode instanceof Element ? cloneNode : null;
  let html: string | null = null;
  if (clone !== null) {
    // the pass that maps the live tree onto the clone runs before anything leaves the clone
    pinImages(source, clone);
    dropScripts(clone);
    dropFormValues(clone);
    setBase(clone, source.baseURI);
    const serialized = `<!doctype html>\n${clone.outerHTML}`;
    html = serialized.length > options.htmlMaxChars ? null : serialized;
  }
  return {
    html,
    title: source.title.trim().slice(0, options.titleMaxChars),
    url: source.URL,
  };
};
