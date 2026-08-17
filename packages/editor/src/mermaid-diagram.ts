// Mermaid fences: ```mermaid renders as a diagram.
//
// `beautiful-mermaid` (MIT) rather than `mermaid` itself, on three counts: it
// renders SYNCHRONOUSLY to an SVG string, it needs no DOM to do it, and it is
// small enough to be worth loading. Upstream `mermaid` 11 is not a fallback
// this file quietly adds later — it is megabytes of d3/dagre/cytoscape, it
// renders asynchronously into a container it owns, and it injects its own
// stylesheet. A diagram type beautiful-mermaid does not know therefore falls
// back to the FENCE'S OWN SOURCE plus the parse error, which is what a plain
// text editor would have shown anyway.
//
// Two caches, both module-level and both keyed by the fence's source text,
// because they are about a RENDERER's answer for a string rather than about
// any document: the SVG so a second mount is synchronous, and the measured
// height so `estimatedHeight` is truthful before it is.
//
// The renderer is lazily imported — a note with no diagrams must not pay for
// it — which makes exactly the FIRST fence of a session async. That one is
// what the placeholder and the measure nudge exist for; every fence after it
// renders in `toDOM` with no reflow.
//
// The SVG is sanitized before `innerHTML`. Node labels come from the note, so
// this is user text reaching a markup parser — the one place in the editor
// where that is true.

import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { foldableSyntaxFacet } from "./vendor/prosemark/lib/fold/core";

/** Colors as CSS custom properties, so one rendered SVG is correct in both
 *  themes and the caches never need a theme key. */
const RENDER_OPTIONS = {
  bg: "transparent",
  fg: "var(--editor-fg)",
  line: "var(--pm-muted-color)",
  accent: "var(--pm-link-color)",
  muted: "var(--pm-muted-color)",
  surface: "var(--pm-code-background-color)",
  border: "var(--pm-blockquote-vertical-line-background-color)",
  transparent: true,
  font: "inherit",
} as const;

type SvgResult = { svg: string } | { failed: string };

const rendered = new Map<string, SvgResult>();
const measuredHeights = new Map<string, number>();

type Renderer = (source: string) => SvgResult;

/** Set once the lazy chunk lands; every fence after that renders in `toDOM`. */
let renderer: Renderer | null = null;
let loading: Promise<Renderer> | null = null;

async function loadRenderer(): Promise<Renderer> {
  // Both halves ride the same chunk: DOMPurify is only ever needed to clean
  // what this renderer produced, and neither belongs in the main bundle.
  const [mermaid, purify] = await Promise.all([import("beautiful-mermaid"), import("dompurify")]);
  const sanitize = purify.default;
  return (source) => {
    try {
      return {
        svg: sanitize.sanitize(mermaid.renderMermaidSVG(source, RENDER_OPTIONS), {
          USE_PROFILES: { svg: true, svgFilters: true },
        }),
      };
    } catch (error) {
      return { failed: error instanceof Error ? error.message : String(error) };
    }
  };
}

function renderNow(source: string): SvgResult | null {
  const cached = rendered.get(source);
  if (cached !== undefined) return cached;
  if (renderer === null) return null;
  const result = renderer(source);
  rendered.set(source, result);
  return result;
}

/** The fence's own text, monospaced — the placeholder while the renderer
 *  loads, and the permanent answer when it refuses the diagram. */
function sourceBlock(source: string, reason: string | null): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = reason === null ? "cm-mermaid-pending" : "cm-mermaid-error";
  const literal = document.createElement("pre");
  literal.className = "cm-mermaid-source";
  literal.textContent = source;
  wrapper.append(literal);
  if (reason !== null) {
    const message = document.createElement("div");
    message.className = "cm-mermaid-error-message";
    message.textContent = reason;
    wrapper.append(message);
  }
  return wrapper;
}

class MermaidWidget extends WidgetType {
  private detached = false;

  constructor(readonly source: string) {
    super();
  }

  override eq(other: MermaidWidget): boolean {
    return other.source === this.source;
  }

  override get estimatedHeight(): number {
    return measuredHeights.get(this.source) ?? -1;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.className = "cm-mermaid";
    const ready = renderNow(this.source);
    if (ready !== null) {
      this.paint(host, ready);
      return host;
    }
    host.append(sourceBlock(this.source, null));
    loading ??= loadRenderer();
    void loading.then((loaded) => {
      renderer = loaded;
      if (this.detached) return undefined;
      const result = renderNow(this.source);
      if (result === null) return undefined;
      this.paint(host, result);
      const height = host.getBoundingClientRect().height;
      if (height > 0) measuredHeights.set(this.source, height);
      view.requestMeasure();
      return undefined;
    });
    return host;
  }

  private paint(host: HTMLElement, result: SvgResult): void {
    if ("failed" in result) {
      host.replaceChildren(sourceBlock(this.source, result.failed));
      return;
    }
    // Sanitized above, at the one point where note text reaches a markup
    // parser; nothing else in this module writes markup.
    host.innerHTML = result.svg;
  }

  override destroy(): void {
    this.detached = true;
  }

  // A click places the caret, which reveals the fence's source.
  override ignoreEvent(): boolean {
    return false;
  }
}

const mermaidTheme = EditorView.theme({
  ".cm-mermaid": {
    display: "block",
    padding: "0.5em 0",
    textAlign: "center",
  },
  ".cm-mermaid svg": {
    maxWidth: "100%",
    height: "auto",
  },
  ".cm-mermaid-source": {
    margin: "0",
    textAlign: "start",
    whiteSpace: "pre-wrap",
    fontFamily: "var(--pm-code-font)",
    fontSize: "0.85em",
    color: "var(--pm-muted-color)",
  },
  ".cm-mermaid-error .cm-mermaid-source": {
    color: "var(--editor-fg)",
  },
  ".cm-mermaid-error-message": {
    marginTop: "0.3em",
    textAlign: "start",
    fontSize: "0.75em",
    color: "var(--pm-syntax-invalid)",
  },
});

export const mermaidExtension: Extension = [
  foldableSyntaxFacet.of({
    nodePath: "FencedCode",
    buildDecorations: (state, node) => {
      const info = node.node.getChild("CodeInfo");
      if (info === null) return undefined;
      if (state.doc.sliceString(info.from, info.to).trim().toLowerCase() !== "mermaid") {
        return undefined;
      }
      const body = node.node.getChild("CodeText");
      const source = body === null ? "" : state.doc.sliceString(body.from, body.to);
      // The fence's LINES, so the widget replaces the whole block and the
      // opening and closing ``` go with it. A caret inside reveals the fence,
      // where the ordinary code-block chrome takes over.
      return Decoration.replace({ widget: new MermaidWidget(source), block: true }).range(
        state.doc.lineAt(node.from).from,
        state.doc.lineAt(node.to).to,
      );
    },
  }),
  mermaidTheme,
];
