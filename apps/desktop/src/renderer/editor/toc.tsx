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

// The heading elements in the live editable, in document order — the same order
// as collectHeadings, so index i lines up. Excludes the page-title <h1>, which
// lives outside the Slate editable.
function editorHeadingEls(): HTMLElement[] {
  const root = document.querySelector("[data-slate-editor]");
  return root ? [...root.querySelectorAll<HTMLElement>("h1, h2, h3")] : [];
}

export function TableOfContents() {
  const editor = useEditorRef();
  // useEditorSelector recomputes when the editor changes; read the outer editor
  // ref inside so the helper keeps its concrete PlateEditor type.
  const headings = useEditorSelector(() => collectHeadings(editor), []);
  const [activeIndex, setActiveIndex] = useState(0);

  // Scrollspy: the last heading scrolled above the header line is "active". A
  // scroll listener on the workspace scroller (IntersectionObserver never fires
  // with a custom root in this Electron renderer).
  useEffect(() => {
    const scroller = document.querySelector("main");
    if (!scroller || headings.length === 0) return;
    const onScroll = () => {
      const scannerY = scroller.getBoundingClientRect().top + HEADER_OFFSET + 8;
      let active = 0;
      editorHeadingEls().forEach((el, i) => {
        if (el.getBoundingClientRect().top <= scannerY) active = i;
      });
      setActiveIndex(active);
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [headings]);

  if (headings.length < 2) return null;

  // Smooth scrolling is a no-op in this Electron renderer (both scrollIntoView
  // and scrollTo ignore `behavior: "smooth"`), so compute the target offset and
  // jump instantly, leaving room for the sticky header.
  const scrollTo = (index: number) => {
    const el = editorHeadingEls()[index];
    const scroller = document.querySelector("main");
    if (el && scroller) {
      const top =
        el.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        HEADER_OFFSET;
      scroller.scrollTo({ top });
    }
    setActiveIndex(index);
  };

  return (
    <div className="pointer-events-none fixed top-1/2 right-2 z-30 hidden -translate-y-1/2 lg:block">
      <div className="group pointer-events-auto flex flex-col items-end py-2">
        {/* Collapsed: dash ticks, one per heading (fade out on hover). */}
        <div className="flex flex-col items-end gap-2 pr-2 transition-opacity duration-200 group-hover:opacity-0">
          {headings.map((h, i) => (
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
        {/* Expanded: the outline, revealed on hover. */}
        <nav
          aria-label="Table of contents"
          className="absolute top-0 right-0 max-h-[70vh] w-56 translate-x-2 overflow-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground opacity-0 shadow-md transition-all duration-200 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100"
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
