// A potion-style table-of-contents rail pinned to the right edge: a column of
// dashes (one per heading, indented by depth, the active one filled) that
// expands into a clickable outline on hover. Built directly off the editor's
// heading nodes — no @platejs/toc, so it stays decoupled from Plate's scroll-ref
// (our scroll container is the workspace <main>, not a PlateContainer).

import { useEffect, useRef, useState } from "react";
import { ElementApi, KEYS, NodeApi, type Path, type TElement } from "platejs";
import { useEditorRef, useEditorSelector, type PlateEditor } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

type HeadingItem = { id: string; path: Path; depth: number; title: string };

const HEADING_DEPTH = new Map<string, number>([
  [KEYS.h1, 1],
  [KEYS.h2, 2],
  [KEYS.h3, 3],
]);

// Clearance for the sticky header so a scrolled-to heading isn't tucked under it.
const HEADER_OFFSET = 64;

const SCROLL_DURATION_MS = 200;

// `behavior: "smooth"` is ignored by both scrollIntoView and scrollTo on this
// scroller, so the offset is tweened by hand: a short rAF ease-out to the
// target, leaving room for the sticky header. Module scope, not a closure in
// the component: the tween is a DOM animation driven by a click, and reading
// the clock is not something a render may do.
function tweenScrollTo(scroller: Element, el: HTMLElement): void {
  const from = scroller.scrollTop;
  const to =
    el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + from - HEADER_OFFSET;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / SCROLL_DURATION_MS);
    const eased = 1 - (1 - t) ** 3; // easeOutCubic
    scroller.scrollTop = from + (to - from) * eased;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function collectHeadings(editor: PlateEditor): HeadingItem[] {
  const out: HeadingItem[] = [];
  for (const [node, path] of editor.api.nodes<TElement>({
    at: [],
    match: (n) => ElementApi.isElement(n) && HEADING_DEPTH.has(n.type),
  })) {
    const title = NodeApi.string(node).trim();
    if (title) {
      out.push({ id: path.join("."), path, depth: HEADING_DEPTH.get(node.type) ?? 1, title });
    }
  }
  return out;
}

/** The DOM element one outline row targets, resolved through the row's own
 *  NODE rather than by position among the editable's `<h*>`s: that DOM also
 *  holds headings the outline skips (an empty one, mid-creation) and headings
 *  it never listed (a transclusion's static render), so "the i-th heading
 *  element" is the wrong element as soon as either exists. Null when the path
 *  went stale under an edit — scroll nowhere rather than somewhere wrong. */
export function headingElement(editor: PlateEditor, heading: HeadingItem): HTMLElement | null {
  const entry = editor.api.node<TElement>(heading.path);
  if (entry === undefined) return null;
  const [node] = entry;
  if (!ElementApi.isElement(node) || !HEADING_DEPTH.has(node.type)) return null;
  return editor.api.toDOMNode(node) ?? null;
}

/** How many dashes the collapsed rail draws at once. */
export const TOC_RAIL_CAP = 20;

/** The outline slice the collapsed rail shows. The cap keeps a long doc's
 *  rail a glanceable minimap, and the window slides just far enough that the
 *  ACTIVE row is always inside it — cut at a fixed index instead, every
 *  heading past the cap highlights nothing. A stale index (the doc shrank
 *  under it) clamps rather than sliding the window off the end. */
export function railWindow(count: number, activeIndex: number) {
  const active = Math.max(0, Math.min(activeIndex, count - 1));
  const start = Math.max(0, active - TOC_RAIL_CAP + 1);
  return { start, end: start + TOC_RAIL_CAP };
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
  // against this scroller as a custom root. closest() from the TOC's own node
  // finds the stamped scroller it actually sits in, never a document-wide
  // first match.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = rootRef.current?.closest("[data-editor-scroller]");
    if (!scroller || headings.length === 0) return;
    const onScroll = () => {
      const scannerY = scroller.getBoundingClientRect().top + HEADER_OFFSET + 8;
      let active = 0;
      headings.forEach((heading, i) => {
        const el = headingElement(editor, heading);
        if (el !== null && el.getBoundingClientRect().top <= scannerY) active = i;
      });
      setActiveIndex(active);
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [headings, editor]);

  if (headings.length === 0) return null;

  const scrollTo = (index: number) => {
    const heading = headings[index];
    const el = heading === undefined ? null : headingElement(editor, heading);
    const scroller = rootRef.current?.closest("[data-editor-scroller]");
    if (el !== null && scroller) tweenScrollTo(scroller, el);
    setActiveIndex(index);
  };

  const rail = railWindow(headings.length, activeIndex);

  return (
    <div
      ref={rootRef}
      className="pointer-events-none fixed top-1/2 right-2 z-40 -translate-y-1/2 print:hidden"
    >
      <div className="group pointer-events-auto flex flex-col items-end py-2">
        <div className="flex flex-col items-end gap-2 pr-2 transition-opacity duration-300 group-hover:opacity-0">
          {headings.slice(rail.start, rail.end).map((h, offset) => (
            <div
              key={h.id}
              className={cn(
                "h-0.5 rounded-full transition-colors",
                rail.start + offset === activeIndex ? "bg-foreground" : "bg-muted-foreground/30",
              )}
              style={{ width: `${16 - 4 * (h.depth - 1)}px` }}
            />
          ))}
        </div>
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
