// built off the editor's heading nodes, not @platejs/toc: the scroll container is the
// workspace <main>, not a PlateContainer.

import { useEffect, useRef, useState } from "react";
import { ElementApi, KEYS, NodeApi, type Path, type SlateEditor, type TElement } from "platejs";
import { useEditorRef, useEditorSelector } from "platejs/react";

import { cn } from "cn";

export type HeadingItem = { id: string; path: Path; depth: number; title: string };

const HEADING_DEPTH = new Map<string, number>([
  [KEYS.h1, 1],
  [KEYS.h2, 2],
  [KEYS.h3, 3],
]);

const HEADER_OFFSET = 64;

const SCROLL_DURATION_MS = 200;

// `behavior: "smooth"` is ignored by scrollIntoView and scrollTo on this scroller.
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

export function collectHeadings(editor: SlateEditor): HeadingItem[] {
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

// resolved through the row's own node, not by index among the editable's `<h*>`s: that dom
// also holds headings the outline skips (empty ones) and never listed (a transclusion's).
export function headingElement(editor: SlateEditor, heading: HeadingItem): HTMLElement | null {
  const entry = editor.api.node<TElement>(heading.path);
  if (entry === undefined) return null;
  const [node] = entry;
  if (!ElementApi.isElement(node) || !HEADING_DEPTH.has(node.type)) return null;
  return editor.api.toDOMNode(node) ?? null;
}

// the palette's jump: the rail's own scroll, and the caret at the heading so typing continues
// there once the dialog hands focus back; no focus() here, like the find bar's jump, so a
// jsdom mount does not arm slate-react's deferred DOM-selection sync.
export function goToHeading(editor: SlateEditor, heading: HeadingItem): boolean {
  const el = headingElement(editor, heading);
  if (el === null) return false;
  const scroller = el.closest("[data-editor-scroller]");
  if (scroller !== null) tweenScrollTo(scroller, el);
  const start = editor.api.start(heading.path);
  if (start !== undefined) editor.tf.select(start);
  return true;
}

export const TOC_RAIL_CAP = 20;

// the window slides so the active row is always inside it; cut at a fixed index, every heading
// past the cap would highlight nothing.
export function railWindow(count: number, activeIndex: number) {
  const active = Math.max(0, Math.min(activeIndex, count - 1));
  const start = Math.max(0, active - TOC_RAIL_CAP + 1);
  return { start, end: start + TOC_RAIL_CAP };
}

// collectHeadings returns a fresh array and useEditorSelector's default equality is `===`, so
// without this the scrollspy effect re-arms on every keystroke. `title` is compared on purpose:
// typing inside a heading changes no id or depth.
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
  const headings = useEditorSelector(() => collectHeadings(editor), [], {
    equalityFn: sameHeadings,
  });
  const [activeIndex, setActiveIndex] = useState(0);

  // a scroll listener rather than an IntersectionObserver, which never fires against this
  // scroller as a custom root.
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
      className="pointer-events-none absolute top-1/2 right-2 z-40 -translate-y-1/2 print:hidden"
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
