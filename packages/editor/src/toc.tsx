// A potion-style table-of-contents rail pinned to the right edge: a column of
// dashes (one per heading, indented by depth, the active one filled) that
// expands into a clickable outline on hover. Built directly off the editor's
// heading nodes — no @platejs/toc, so it stays decoupled from Plate's scroll-ref
// (our scroll container is the workspace <main>, not a PlateContainer).

import { useEffect, useState } from "react";
import { KEYS, NodeApi, type TElement } from "platejs";
import { useEditorRef, useEditorSelector } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

type HeadingItem = { id: string; depth: number; title: string };

const HEADING_DEPTH: Record<string, number> = { [KEYS.h1]: 1, [KEYS.h2]: 2, [KEYS.h3]: 3 };

// Clearance for the sticky header so a scrolled-to heading isn't tucked under it.
const HEADER_OFFSET = 64;

function collectHeadings(editor: ReturnType<typeof useEditorRef>): HeadingItem[] {
  const out: HeadingItem[] = [];
  for (const [node, path] of editor.api.nodes<TElement>({
    at: [],
    match: (n) => "type" in n && typeof n.type === "string" && n.type in HEADING_DEPTH,
  })) {
    const title = NodeApi.string(node).trim();
    if (title) out.push({ id: path.join("."), depth: HEADING_DEPTH[node.type] ?? 1, title });
  }
  return out;
}

// The heading elements in this editor's live editable, in document order —
// the same order as collectHeadings, so index i lines up. Excludes the
// page-title <h1>, which lives outside the Slate editable (hence the scope
// to the editor's own DOM node rather than a bare h1/h2/h3 query).
function editorHeadingEls(editor: ReturnType<typeof useEditorRef>): HTMLElement[] {
  const root = editor.api.toDOMNode(editor);
  return root ? [...root.querySelectorAll<HTMLElement>("h1, h2, h3")] : [];
}

// collectHeadings walks the whole document and returns a FRESH array, and
// useEditorSelector's default equality is `===` — so without this the outline
// re-renders and the scrollspy Effect below tears down and re-adds its scroll
// listener (plus a layout read per heading) on every keystroke and every caret
// move. Compare structurally instead. `title` is part of the comparison on
// purpose: typing inside a heading changes no id or depth, but the outline
// still has to show the new text.
function sameHeadings(a: readonly HeadingItem[], b: readonly HeadingItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((h, i) => {
    const other = b[i];
    return (
      other !== undefined && h.id === other.id && h.depth === other.depth && h.title === other.title
    );
  });
}

export function TableOfContents() {
  const editor = useEditorRef();
  // useEditorSelector recomputes when the editor changes; read the outer editor
  // ref inside so the helper keeps its concrete PlateEditor type. The structural
  // equalityFn is load-bearing — see sameHeadings.
  const headings = useEditorSelector(() => collectHeadings(editor), [], {
    equalityFn: sameHeadings,
  });
  const [activeIndex, setActiveIndex] = useState(0);

  // Scrollspy: the last heading scrolled above the header line is "active". A
  // scroll listener rather than an IntersectionObserver, which never fires
  // against this scroller as a custom root.
  useEffect(() => {
    const scroller = document.querySelector("main");
    if (!scroller || headings.length === 0) return;
    const onScroll = () => {
      const scannerY = scroller.getBoundingClientRect().top + HEADER_OFFSET + 8;
      let active = 0;
      editorHeadingEls(editor).forEach((el, i) => {
        if (el.getBoundingClientRect().top <= scannerY) active = i;
      });
      setActiveIndex(active);
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [headings, editor]);

  if (headings.length === 0) return null;

  // `behavior: "smooth"` is ignored by both scrollIntoView and scrollTo on this
  // scroller, so the offset is tweened by hand: a short rAF ease-out to the
  // target, leaving room for the sticky header.
  const scrollTo = (index: number) => {
    const el = editorHeadingEls(editor)[index];
    const scroller = document.querySelector("main");
    if (el && scroller) {
      const from = scroller.scrollTop;
      const to =
        el.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        from -
        HEADER_OFFSET;
      const start = performance.now();
      const DURATION = 200;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION);
        const eased = 1 - (1 - t) ** 3; // easeOutCubic
        scroller.scrollTop = from + (to - from) * eased;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    setActiveIndex(index);
  };

  return (
    <div className="pointer-events-none fixed top-1/2 right-2 z-40 -translate-y-1/2">
      <div className="group pointer-events-auto flex flex-col items-end py-2">
        {/* Collapsed: dash ticks, one per heading, capped so a long doc's
            rail stays a glanceable minimap (fade out on hover). */}
        <div className="flex flex-col items-end gap-2 pr-2 transition-opacity duration-300 group-hover:opacity-0">
          {headings.slice(0, 20).map((h, i) => (
            <div
              key={h.id}
              className={cn(
                "h-0.5 rounded-full transition-colors",
                i === activeIndex ? "bg-foreground" : "bg-muted-foreground/30",
              )}
              style={{ width: `${16 - 4 * (h.depth - 1)}px` }}
            />
          ))}
        </div>
        {/* Expanded: the full outline, revealed on hover. max-h-96 keeps the
            panel clear of the bottom composer and the delegation dock. */}
        <nav
          aria-label="Table of contents"
          className="absolute top-0 right-0 max-h-96 w-56 translate-x-2 overflow-auto rounded-2xl border border-border bg-popover p-2 text-popover-foreground opacity-0 shadow-surface-4 transition-all duration-300 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100"
        >
          {headings.map((h, i) => (
            <button
              key={h.id}
              type="button"
              onClick={() => scrollTo(i)}
              style={{ paddingLeft: `${8 + 12 * (h.depth - 1)}px` }}
              className={cn(
                "block w-full truncate rounded-md py-1 pr-2 text-left text-xs transition-colors hover:bg-accent",
                i === activeIndex ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {h.title}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
