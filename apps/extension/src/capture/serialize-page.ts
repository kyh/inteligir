import type { CapturedPage } from "./captured-page";

export const CAPTURE_HTML_MAX_CHARS = 2 * 1024 * 1024;

const KEPT_SCRIPT_TYPE = "application/ld+json";
const LABELLED_INPUT_TYPES = new Set(["button", "image", "reset", "submit"]);

const dropScripts = (clone: Element) => {
  for (const script of clone.querySelectorAll("script")) {
    if (script.getAttribute("type")?.trim().toLowerCase() !== KEPT_SCRIPT_TYPE) {
      script.remove();
    }
  }
};

const EDITABLE = '[contenteditable]:not([contenteditable="false" i]), [role="textbox"]';

const dropFormValues = (clone: Element) => {
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

const pinImages = (source: Document, clone: Element) => {
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

const setBase = (clone: Element, baseUri: string) => {
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

export const serializePage = (source: Document) => {
  const cloneNode = source.documentElement.cloneNode(true);
  const clone = cloneNode instanceof Element ? cloneNode : null;
  let html: string | null = null;

  if (clone !== null) {
    pinImages(source, clone);
    dropScripts(clone);
    dropFormValues(clone);
    setBase(clone, source.baseURI);
    const serialized = `<!doctype html>\n${clone.outerHTML}`;
    html = serialized.length > CAPTURE_HTML_MAX_CHARS ? null : serialized;
  }

  return { html, title: source.title, url: source.URL } satisfies CapturedPage;
};
