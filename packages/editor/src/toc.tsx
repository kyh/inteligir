import { useEffect, useRef, useState } from "react";
import { ElementApi, KEYS, NodeApi } from "platejs";
import type { Path, SlateEditor, TElement } from "platejs";
import { createPlatePlugin, useEditorRef, useEditorSelector } from "platejs/react";

import { cn } from "@repo/ui/lib/cn";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";

import { reveal } from "@repo/editor/scroll-reveal";
import { shownText } from "@repo/editor/shown-text";

export interface HeadingItem {
  id: string;
  path: Path;
  depth: number;
  title: string;
}

const HEADING_DEPTH = new Map<string, number>([
  [KEYS.h1, 1],
  [KEYS.h2, 2],
  [KEYS.h3, 3],
]);

const HEADER_OFFSET = 64;

interface BlockHeading {
  relative: Path;
  depth: number;
  title: string;
}

const headingsByBlock = new WeakMap<TElement, readonly BlockHeading[]>();

const blockHeadings = (editor: SlateEditor, block: TElement) => {
  const cached = headingsByBlock.get(block);

  if (cached !== undefined) {
    return cached;
  }

  const found: BlockHeading[] = [];

  for (const [node, relative] of NodeApi.nodes(block, {
    pass: ([n]) =>
      ElementApi.isElement(n) && (editor.api.isVoid(n) || editor.api.isElementReadOnly(n)),
  })) {
    const depth = ElementApi.isElement(node) ? HEADING_DEPTH.get(node.type) : undefined;
    const title = depth === undefined ? "" : shownText(node).trim();

    if (depth !== undefined && title) {
      found.push({ depth, relative, title });
    }
  }

  headingsByBlock.set(block, found);

  return found;
};

export const collectHeadings = (editor: SlateEditor) =>
  editor.children.flatMap((block, index) =>
    blockHeadings(editor, block).map(({ depth, relative, title }) => {
      const path = [index, ...relative];

      return { depth, id: path.join("."), path, title };
    }),
  );

export const headingElement = (editor: SlateEditor, heading: HeadingItem) => {
  const entry = editor.api.node<TElement>(heading.path);

  if (entry === undefined) {
    return null;
  }

  const [node] = entry;

  if (!ElementApi.isElement(node) || !HEADING_DEPTH.has(node.type)) {
    return null;
  }

  return editor.api.toDOMNode(node) ?? null;
};

export const TOC_RAIL_CAP = 20;

export const railWindow = (count: number, activeIndex: number) => {
  const active = Math.max(0, Math.min(activeIndex, count - 1));
  const start = Math.max(0, active - TOC_RAIL_CAP + 1);

  return { end: start + TOC_RAIL_CAP, start };
};

const sameHeadings = (a: readonly HeadingItem[], b: readonly HeadingItem[]) => {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((h, i) => {
    const other = b[i];

    return (
      other !== undefined && h.id === other.id && h.depth === other.depth && h.title === other.title
    );
  });
};

const TOC_MIN_HEADINGS = 3;

const RUN = "[data-slate-chunk]";

const lastAtOrAbove = (boxes: readonly Element[], y: number) => {
  let low = 0;
  let high = boxes.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const box = boxes[mid];

    if (box !== undefined && box.getBoundingClientRect().top <= y) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
};

export const activeHeadingAt = (
  editor: SlateEditor,
  headings: readonly HeadingItem[],
  scroller: Element,
) => {
  const scannerY = scroller.getBoundingClientRect().top + HEADER_OFFSET + 8;
  const editable = editor.api.toDOMNode(editor);
  const runs = editable === undefined ? [] : [...editable.querySelectorAll(`:scope > ${RUN}`)];
  const runOf = new Map(runs.map((run, index) => [run, index]));
  const scannerRun = lastAtOrAbove(runs, scannerY);

  const above = (index: number) => {
    const heading = headings[index];
    const el = heading === undefined ? null : headingElement(editor, heading);

    if (el === null) {
      return true;
    }

    const run = el.closest(RUN);
    const at = run === null ? undefined : runOf.get(run);

    if (at !== undefined && at !== scannerRun) {
      return at < scannerRun;
    }

    return el.getBoundingClientRect().top <= scannerY;
  };

  let low = 0;
  let high = headings.length - 1;
  let active = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (above(mid)) {
      active = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return active;
};

const TableOfContents = () => {
  const editor = useEditorRef();

  const headings = useEditorSelector(() => collectHeadings(editor), [], {
    equalityFn: sameHeadings,
  });

  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = rootRef.current?.closest("[data-editor-scroller]");

    if (!scroller || headings.length === 0) {
      return;
    }

    let frame: number | null = null;

    const spy = () => {
      frame = null;
      setActiveIndex(activeHeadingAt(editor, headings, scroller));
    };

    const onScroll = () => {
      // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- the React Compiler cannot compile `??=` yet (react/todo), so this component would go uncompiled
      if (frame === null) {
        frame = requestAnimationFrame(spy);
      }
    };

    spy();
    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      scroller.removeEventListener("scroll", onScroll);

      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [headings, editor]);

  if (headings.length < TOC_MIN_HEADINGS) {
    return null;
  }

  const scrollTo = (index: number) => {
    const heading = headings[index];
    const el = heading === undefined ? null : headingElement(editor, heading);

    if (el !== null) {
      reveal(el, { top: HEADER_OFFSET });
    }

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
          className={cn(
            "absolute top-0 right-0 max-h-96 w-56 translate-x-2 overflow-auto rounded-2xl p-2 text-popover-foreground opacity-0 transition-all duration-300 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100",
            surfaceClasses(3),
          )}
        >
          {headings.map((h, i) => (
            <button
              key={h.id}
              type="button"
              onClick={() => {
                scrollTo(i);
              }}
              style={{ paddingLeft: `${8 + 12 * (h.depth - 1)}px` }}
              className={cn(
                "block w-full truncate rounded-md py-1 pr-2 text-left text-body transition-colors hover:bg-accent",
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
};

export const TocKit = [
  createPlatePlugin({
    key: "tableOfContents",
    render: { afterContainer: () => <TableOfContents /> },
  }),
];
