// Collapse is view state kept per item id in localStorage, each fold by a hash of its
// `level:text:ordinal`, since that storage sits outside the phone's wipe and inside its backup;
// it never touches bytes or history. What a fold hides is derived once per document
// change in a provider, a per-block backward walk being quadratic under keystrokes, and
// addressed by block id: Plate re-renders a block only when its own node changes, so the
// Slate path it last rendered with is stale after an insert above it.

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { NodeApi } from "platejs";
import type { TElement } from "platejs";
import { createPlatePlugin, useEditorSelector } from "platejs/react";
import type { RenderNodeWrapper } from "platejs/react";
import { ChevronDownIcon } from "lucide-react";
import { z } from "zod";
import { useStore } from "zustand";
import { shallow } from "zustand/shallow";
import { createStore } from "zustand/vanilla";

import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";

import { blockId } from "@repo/editor/node-props";
import { useOpenItemId } from "@repo/editor/open-item";
import { contentHash } from "@repo/contract/library/block-hash";

const STORAGE_KEY = "inteligir.collapsed-headings";

const HEADING_RANK = new Map<string, number>([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
]);

// A toggle replaces a note's set rather than mutating it, so the set is itself the snapshot a
// subscriber compares.
const foldsStore = createStore<ReadonlyMap<string, ReadonlySet<string>>>()(() => new Map());

// A note's stored folds, read on first ask and kept beside the store rather than written into it:
// the first ask is a render's selector, and setting state there would notify mid-render.
const restored = new Map<string, ReadonlySet<string>>();

// decoded per item, so one unreadable entry cannot discard every other item's folds
const STORED_NOTES = z.record(z.string(), z.unknown());
const STORED_KEYS = z.array(z.string());

const readStorage = (): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return out;
    }
    const notes = STORED_NOTES.safeParse(JSON.parse(raw));
    if (!notes.success) {
      return out;
    }
    for (const [itemId, value] of Object.entries(notes.data)) {
      const keys = STORED_KEYS.safeParse(value);
      if (keys.success) {
        out.set(itemId, keys.data);
      }
    }
  } catch {
    // storage unavailable
  }
  return out;
};

// Re-read before writing: the record holds every item, and a write from this map alone drops the items never opened.
const writeStorage = (itemId: string, keys: ReadonlySet<string>): void => {
  try {
    const all = readStorage();
    if (keys.size === 0) {
      all.delete(itemId);
    } else {
      all.set(itemId, [...keys]);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(all)));
  } catch {
    // storage full or unavailable
  }
};

const foldsFor = (
  folds: ReadonlyMap<string, ReadonlySet<string>>,
  itemId: string,
): ReadonlySet<string> => {
  const known = folds.get(itemId) ?? restored.get(itemId);
  if (known !== undefined) {
    return known;
  }
  const stored = new Set(readStorage().get(itemId));
  restored.set(itemId, stored);
  return stored;
};

/** @internal */
export const headingCollapseKeys = (itemId: string): ReadonlySet<string> =>
  foldsFor(foldsStore.getState(), itemId);

/** @internal */
export const toggleHeadingCollapse = (itemId: string, key: string): void => {
  const keys = new Set(headingCollapseKeys(itemId));
  if (keys.has(key)) {
    keys.delete(key);
  } else {
    keys.add(key);
  }
  writeStorage(itemId, keys);
  foldsStore.setState((folds) => new Map(folds).set(itemId, keys), true);
};

// every item's folds go: the account they belong to left this device. Storage first: a mounted
// editor reads it again the moment the store moves
export const forgetHeadingFolds = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable
  }
  restored.clear();
  foldsStore.setState(new Map(), true);
};

const NO_FOLDS: ReadonlySet<string> = new Set();

interface Derived {
  itemId: string;
  folded: ReadonlySet<string>;
  // block id → that heading's fold key
  keys: ReadonlyMap<string, string>;
  hidden: ReadonlySet<string>;
}

const derive = (
  children: readonly TElement[],
  itemId: string,
  folded: ReadonlySet<string>,
): Derived => {
  const hidden = new Set<string>();
  const keys = new Map<string, string>();
  const ordinals = new Map<string, number>();
  const stack: number[] = [];
  for (const child of children) {
    const id = blockId(child);
    const rank = HEADING_RANK.get(child.type);
    if (rank === undefined) {
      if (stack.length > 0 && id !== undefined) {
        hidden.add(id);
      }
      continue;
    }
    while (stack.length > 0 && (stack.at(-1) ?? 0) >= rank) {
      stack.pop();
    }
    if (stack.length > 0 && id !== undefined) {
      hidden.add(id);
    }
    const text = NodeApi.string(child);
    const base = `${String(rank)}:${text}`;
    const ordinal = ordinals.get(base) ?? 0;
    ordinals.set(base, ordinal + 1);
    const key = contentHash(`${base}:${String(ordinal)}`);
    if (id !== undefined) {
      keys.set(id, key);
    }
    if (folded.has(key)) {
      stack.push(rank);
    }
  }
  return { folded, hidden, keys, itemId };
};

// Every change re-derives, so this is what keeps typing in a paragraph from re-rendering every
// block: the context moves only when a fold's reach or a heading's key does.
const sameDerived = (a: Derived | null, b: Derived | null): boolean => {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.itemId === b.itemId &&
    a.folded === b.folded &&
    shallow(a.hidden, b.hidden) &&
    shallow(a.keys, b.keys)
  );
};

const DerivedContext = createContext<Derived | null>(null);

const CollapseProvider = ({ children }: { children: ReactNode }) => {
  // subscribed once here rather than per block, so the fold set and every chevron name the same item
  const itemId = useOpenItemId();
  const folded = useStore(foldsStore, (folds) =>
    itemId === null ? NO_FOLDS : foldsFor(folds, itemId),
  );
  const derived = useEditorSelector(
    (editor) => (itemId === null ? null : derive(editor.children, itemId, folded)),
    [itemId, folded],
    { equalityFn: sameDerived },
  );
  return <DerivedContext value={derived}>{children}</DerivedContext>;
};

const CollapsibleBlock = ({ id, children }: { id: string; children: ReactNode }) => {
  const derived = useContext(DerivedContext);
  const isHidden = derived?.hidden.has(id) === true;
  const key = derived?.keys.get(id);

  if (derived === null || key === undefined) {
    return <div className={cn(isHidden && "hidden")}>{children}</div>;
  }
  const { itemId } = derived;
  const isCollapsed = derived.folded.has(key);
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
            toggleHeadingCollapse(itemId, key);
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
  return function CollapsibleBlockWrapper({ children }) {
    return <CollapsibleBlock id={id}>{children}</CollapsibleBlock>;
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
