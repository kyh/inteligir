// A fold is view state: its heading's block id, kept per item id in localStorage. An id holds none
// of the note's words, which that storage must not, since it sits outside the phone's wipe and
// inside its backup; a fold never touches bytes or history. What a fold hides is derived once per
// document change in a provider, a per-block backward walk being quadratic under keystrokes, and
// addressed by block id: Plate re-renders a block only when its own node changes, so the Slate path
// it last rendered with is stale after an insert above it.

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { TElement } from "platejs";
import { createPlatePlugin, useEditorRef, useEditorSelector } from "platejs/react";
import type { RenderNodeWrapper } from "platejs/react";
import { ChevronDownIcon } from "lucide-react";
import { z } from "zod";
import { useStore } from "zustand";
import { persist } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import { createStore } from "zustand/vanilla";

import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";

import { blockId } from "@repo/editor/node-props";
import { useOpenItemId } from "@repo/editor/open-item";

const STORAGE_KEY = "inteligir.collapsed-headings";

const HEADING_RANK = new Map<string, number>([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
]);

// item id → the block ids of its folded headings
type Folds = Readonly<Record<string, readonly string[]>>;

const STORED_FOLDS = z.record(z.string(), z.array(z.string()));

const foldsStore = createStore<Folds>()(
  persist(() => ({}), {
    merge: (stored) => STORED_FOLDS.safeParse(stored).data ?? {},
    name: STORAGE_KEY,
  }),
);

// persist writes the whole record from memory, so memory follows every other tab's write, or a
// fold here would drop the folds that tab stored.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      void foldsStore.persist.rehydrate();
    }
  });
}

const headingIds = (children: readonly TElement[]): ReadonlySet<string> =>
  new Set(
    children.flatMap((child) => {
      const id = blockId(child);
      return HEADING_RANK.has(child.type) && id !== undefined ? [id] : [];
    }),
  );

// A toggle keeps only the headings the note still holds, so a deleted heading's fold goes with it.
const toggleFold = (itemId: string, headingId: string, children: readonly TElement[]): void => {
  const held = headingIds(children);
  foldsStore.setState(({ [itemId]: folded = [], ...others }) => {
    const flipped = folded.includes(headingId)
      ? folded.filter((id) => id !== headingId)
      : [...folded, headingId];
    const kept = flipped.filter((id) => held.has(id));
    return kept.length === 0 ? others : { ...others, [itemId]: kept };
  }, true);
};

// every item's folds go: the account they belong to left this device
export const forgetHeadingFolds = (): void => {
  foldsStore.setState({}, true);
};

const NO_FOLDS: readonly string[] = [];

interface Derived {
  itemId: string;
  folded: readonly string[];
  hidden: ReadonlySet<string>;
}

const derive = (
  children: readonly TElement[],
  itemId: string,
  folded: readonly string[],
): Derived => {
  const hidden = new Set<string>();
  const stack: number[] = [];
  for (const child of children) {
    const id = blockId(child);
    const rank = HEADING_RANK.get(child.type);
    if (rank !== undefined) {
      while (stack.length > 0 && (stack.at(-1) ?? 0) >= rank) {
        stack.pop();
      }
    }
    if (id === undefined) {
      continue;
    }
    if (stack.length > 0) {
      hidden.add(id);
    }
    if (rank !== undefined && folded.includes(id)) {
      stack.push(rank);
    }
  }
  return { folded, hidden, itemId };
};

// Every change re-derives, so this is what keeps typing in a paragraph from re-rendering every
// block: the context moves only when a fold or its reach does.
const sameDerived = (a: Derived | null, b: Derived | null): boolean => {
  if (a === null || b === null) {
    return a === b;
  }
  return a.itemId === b.itemId && a.folded === b.folded && shallow(a.hidden, b.hidden);
};

const DerivedContext = createContext<Derived | null>(null);

const CollapseProvider = ({ children }: { children: ReactNode }) => {
  // subscribed once here rather than per block, so the fold set and every chevron name the same item
  const itemId = useOpenItemId();
  const folded = useStore(foldsStore, (folds) =>
    itemId === null ? NO_FOLDS : (folds[itemId] ?? NO_FOLDS),
  );
  const derived = useEditorSelector(
    (editor) => (itemId === null ? null : derive(editor.children, itemId, folded)),
    [itemId, folded],
    { equalityFn: sameDerived },
  );
  return <DerivedContext value={derived}>{children}</DerivedContext>;
};

const CollapsibleBlock = ({
  id,
  isHeading,
  children,
}: {
  id: string;
  isHeading: boolean;
  children: ReactNode;
}) => {
  const editor = useEditorRef();
  const derived = useContext(DerivedContext);
  const isHidden = derived?.hidden.has(id) === true;

  if (derived === null || !isHeading) {
    return <div className={cn(isHidden && "hidden")}>{children}</div>;
  }
  const { itemId } = derived;
  const isCollapsed = derived.folded.includes(id);
  return (
    <div className={cn("group/heading relative", isHidden && "hidden")}>
      <Tooltip content={isCollapsed ? "Expand section" : "Collapse section"}>
        <button
          type="button"
          contentEditable={false}
          aria-label={isCollapsed ? "Expand section" : "Collapse section"}
          aria-expanded={!isCollapsed}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            toggleFold(itemId, id, editor.children);
          }}
          className={cn(
            "absolute top-1/2 -left-6 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-transform select-none hover:bg-accent [&_svg]:size-3.5",
            isCollapsed ? "-rotate-90 opacity-100" : "opacity-0 group-hover/heading:opacity-100",
          )}
        >
          <ChevronDownIcon />
        </button>
      </Tooltip>
      {children}
    </div>
  );
};

// NodeIdPlugin gives every live block an id; only a test editor, where Plate turns the plugin
// off, has blocks without one, and those take no part in folding.
const CollapseWrapper: RenderNodeWrapper = ({ element, path }) => {
  const id = blockId(element);
  if (path.length !== 1 || id === undefined) {
    return;
  }
  const isHeading = HEADING_RANK.has(element.type);
  return function CollapsibleBlockWrapper({ children }) {
    return (
      <CollapsibleBlock id={id} isHeading={isHeading}>
        {children}
      </CollapsibleBlock>
    );
  };
};

export const HeadingCollapseKit = [
  createPlatePlugin({
    key: "headingCollapse",
    render: {
      aboveEditable: ({ children }) => <CollapseProvider>{children}</CollapseProvider>,
      aboveNodes: CollapseWrapper,
    },
  }),
];
