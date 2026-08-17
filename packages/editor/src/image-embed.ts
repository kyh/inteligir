// Image embeds: `![alt](src "title")` renders the picture in place.
//
// TWO problems, and the second is the one that shapes the design.
//
// WHERE the bytes are. `src` is a note's text, not a URL — a relative path is
// VAULT-relative, and only the host knows how a vault path becomes something a
// browser can fetch. So the resolver is injected through a facet and this
// module never learns what a vault is. What it does own is the refusal: a
// scheme outside `ALLOWED_SCHEMES` never reaches an `<img>`, because
// `javascript:` and `file:` in a note are exactly what a synced vault can
// carry.
//
// WHEN the height is known. An image's height arrives with its bytes, which is
// after layout — so a viewport full of them settles one by one and the scroll
// position walks down the document under the reader. The fix is a module-level
// measured-height cache keyed by RESOLVED URL: `estimatedHeight` answers from
// it before the widget mounts, and the `<img>` reserves that height until the
// real bytes replace it. Module scope is right here precisely because the
// cache is about the BROWSER's rendering of a URL rather than about any one
// document — two editors showing the same image measure it once — and it holds
// numbers, never content.

import { Facet, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { foldableSyntaxFacet } from "./vendor/prosemark/lib/fold/core";

/**
 * Turns an image `src` from a note into something the browser can fetch, or
 * null when this host cannot serve it. Vault-relative paths arrive with no
 * scheme; the host decides what they mean.
 */
export type AssetResolver = (src: string) => string | null;

export const assetResolver = Facet.define<AssetResolver>();

// Everything a note may point an <img> at. `blob:` is absent deliberately: a
// note's text cannot name a live blob URL, so a `blob:` src is either stale or
// somebody else's handle.
const ALLOWED_SCHEMES = new Set(["http:", "https:", "data:"]);

const SCHEME = /^[a-z][\d+\-.a-z]*:/i;

/** Heights measured for a URL, in CSS pixels. See the header. */
const measuredHeights = new Map<string, number>();

/** A fetchable URL, or the reason this src is not one. */
type Resolved = { url: string } | { refused: string };

/**
 * A src with no scheme is a vault path and goes to the injected resolver; one
 * with a scheme is taken as written, if the scheme is allowed. Resolved at
 * DECORATION-BUILD time, where the facet is readable — `estimatedHeight` is
 * asked before `toDOM`, so the widget has to arrive already knowing its URL.
 */
function resolveSrc(state: EditorState, src: string): Resolved {
  const trimmed = src.trim();
  if (trimmed === "") return { refused: "this embed names no image" };
  const scheme = SCHEME.exec(trimmed);
  if (scheme === null) {
    for (const resolver of state.facet(assetResolver)) {
      const url = resolver(trimmed);
      if (url !== null) return { url };
    }
    return { refused: `nothing here can resolve ${trimmed}` };
  }
  if (!ALLOWED_SCHEMES.has(scheme[0].toLowerCase())) {
    return { refused: `${scheme[0]} images are not loaded` };
  }
  return { url: trimmed };
}

function failure(host: HTMLElement, source: string, reason: string): void {
  host.replaceChildren();
  host.classList.add("cm-image-error");
  const literal = document.createElement("code");
  literal.className = "cm-image-error-source";
  literal.textContent = source;
  const message = document.createElement("span");
  message.className = "cm-image-error-message";
  message.textContent = reason;
  host.append(literal, message);
}

class ImageWidget extends WidgetType {
  /** Flipped when CodeMirror drops this widget's DOM, so a load that lands
   *  afterwards does not ask a view that has moved on to measure. */
  private detached = false;

  constructor(
    /** The embed's own bytes. Identity, with `block`: alt, src and therefore
     * the resolved URL all derive from them, and the resolver facet is fixed
     * for the editor's lifetime. */
    readonly source: string,
    readonly alt: string,
    readonly resolved: Resolved,
    readonly block: boolean,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return other.source === this.source && other.block === this.block;
  }

  /** What a previous load of this URL measured, so the line is already the
   *  right height when the widget mounts. -1 is CodeMirror's "no idea". */
  override get estimatedHeight(): number {
    if (!("url" in this.resolved)) return -1;
    return measuredHeights.get(this.resolved.url) ?? -1;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = document.createElement(this.block ? "div" : "span");
    host.className = this.block ? "cm-image cm-image-block" : "cm-image cm-image-inline";
    if (!("url" in this.resolved)) {
      failure(host, this.source, this.resolved.refused);
      return host;
    }
    const url = this.resolved.url;

    const image = document.createElement("img");
    image.className = "cm-image-img";
    image.alt = this.alt;
    // Reserve what this URL measured last time, so the document does not grow
    // under the reader when the bytes land; cleared on load, where the image's
    // own aspect ratio takes over.
    const reserved = measuredHeights.get(url);
    if (reserved !== undefined) image.style.height = `${reserved}px`;
    image.addEventListener("load", () => {
      image.style.height = "";
      if (this.detached) return;
      const height = image.getBoundingClientRect().height;
      if (height > 0) measuredHeights.set(url, height);
      view.requestMeasure();
    });
    image.addEventListener("error", () => {
      // Never a gap, and never a silent broken-image glyph: the embed's own
      // bytes come back with the reason — which for a remote URL is usually
      // the page's own image-src policy.
      failure(host, this.source, `could not load ${url}`);
    });
    image.src = url;
    host.append(image);
    return host;
  }

  override destroy(): void {
    this.detached = true;
  }

  // A click places the caret, which reveals the source — same as every other
  // folded construct.
  override ignoreEvent(): boolean {
    return false;
  }
}

const imageTheme = EditorView.theme({
  ".cm-image-img": {
    maxWidth: "100%",
    borderRadius: "6px",
  },
  ".cm-image-block": {
    display: "block",
    textAlign: "center",
  },
  ".cm-image-inline .cm-image-img": {
    verticalAlign: "text-bottom",
  },
  ".cm-image-error": {
    color: "var(--pm-syntax-invalid)",
  },
  ".cm-image-error-source": {
    fontFamily: "var(--pm-code-font)",
    fontSize: "0.85em",
  },
  ".cm-image-error-message": {
    marginInlineStart: "0.6em",
    fontSize: "0.75em",
    opacity: "0.8",
  },
});

const ALT_TEXT = /^!\[([^\]]*)]/;

export const imageEmbedExtension: Extension = [
  foldableSyntaxFacet.of({
    nodePath: "Image",
    buildDecorations: (state, node) => {
      // The URL comes from the TREE, so a reference-style `![alt][id]` — which
      // has no URL child — keeps its bytes instead of rendering an embed this
      // module cannot resolve.
      const url = node.node.getChild("URL");
      if (url === null) return undefined;
      const source = state.doc.sliceString(node.from, node.to);
      const line = state.doc.lineAt(node.from);
      const block = node.from === line.from && node.to === line.to;
      return Decoration.replace({
        widget: new ImageWidget(
          source,
          ALT_TEXT.exec(source)?.[1] ?? "",
          resolveSrc(state, state.doc.sliceString(url.from, url.to)),
          block,
        ),
        block,
      }).range(node.from, node.to);
    },
  }),
  imageTheme,
];
