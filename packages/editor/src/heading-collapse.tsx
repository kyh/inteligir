// Collapse is view state keyed `level:text:ordinal` per note path in localStorage;
// it never touches bytes or history. What a fold hides is derived once per document
// change in a provider, a per-block backward walk being quadratic under keystrokes, and
// addressed by block id: Plate re-renders a block only when its own node changes, so the
// `path` it last rendered with is stale after an insert above it.

import { createContext, useContext, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { NodeApi } from "platejs";
import type { TElement } from "platejs";
import { createPlatePlugin, useEditorSelector } from "platejs/react";
import type { RenderNodeWrapper } from "platejs/react";
import { ChevronDownIcon } from "lucide-react";
import { z } from "zod";

import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";

import { blockId } from "@repo/editor/node-props";
import { useOpenNotePath } from "@repo/editor/note/open-note-context";

const STORAGE_KEY = "inteligir.collapsed-headings";

const HEADING_RANK = new Map<string, number>([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
]);

// A toggle replaces a note's set rather than mutating it, so the set is itself the snapshot a
// subscriber compares.
const folds = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

// decoded per note, so one unreadable entry cannot discard every other note's folds
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
    for (const [path, value] of Object.entries(notes.data)) {
      const keys = STORED_KEYS.safeParse(value);
      if (keys.success) {
        out.set(path, keys.data);
      }
    }
  } catch {
    // storage unavailable
  }
  return out;
};

// Re-read before writing: the record holds every note, and a write from this map alone drops the notes never opened.
const writeStorage = (path: string, keys: ReadonlySet<string>): void => {
  try {
    const all = readStorage();
    if (keys.size === 0) {
      all.delete(path);
    } else {
      all.set(path, [...keys]);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(all)));
  } catch {
    // storage full or unavailable
  }
};

const foldsFor = (path: string): ReadonlySet<string> => {
  const known = folds.get(path);
  if (known !== undefined) {
    return known;
  }
  const restored = new Set(readStorage().get(path));
  folds.set(path, restored);
  return restored;
};

export const headingCollapseKeys = (path: string): ReadonlySet<string> => foldsFor(path);

export const toggleHeadingCollapse = (path: string, key: string): void => {
  const keys = new Set(foldsFor(path));
  if (keys.has(key)) {
    keys.delete(key);
  } else {
    keys.add(key);
  }
  folds.set(path, keys);
  writeStorage(path, keys);
  emit();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const NO_FOLDS: ReadonlySet<string> = new Set();

interface Derived {
  path: string;
  folded: ReadonlySet<string>;
  // block id → that heading's fold key
  keys: ReadonlyMap<string, string>;
  hidden: ReadonlySet<string>;
}

const derive = (
  children: readonly TElement[],
  path: string,
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
    const key = `${base}:${String(ordinal)}`;
    if (id !== undefined) {
      keys.set(id, key);
    }
    if (folded.has(key)) {
      stack.push(rank);
    }
  }
  return { folded, hidden, keys, path };
};

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) {
    return false;
  }
  for (const id of a) {
    if (!b.has(id)) {
      return false;
    }
  }
  return true;
};

const sameKeys = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean => {
  if (a.size !== b.size) {
    return false;
  }
  for (const [id, key] of a) {
    if (b.get(id) !== key) {
      return false;
    }
  }
  return true;
};

// Every change re-derives, so this is what keeps typing in a paragraph from re-rendering every
// block: the context moves only when a fold's reach or a heading's key does.
const sameDerived = (a: Derived | null, b: Derived | null): boolean => {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.path === b.path &&
    a.folded === b.folded &&
    sameIds(a.hidden, b.hidden) &&
    sameKeys(a.keys, b.keys)
  );
};

const DerivedContext = createContext<Derived | null>(null);

const CollapseProvider = ({ children }: { children: ReactNode }) => {
  // subscribed once here rather than per block, so the fold set and every chevron name the same file
  const path = useOpenNotePath();
  const folded = useSyncExternalStore(subscribe, () => (path === null ? NO_FOLDS : foldsFor(path)));
  const derived = useEditorSelector(
    (editor) => (path === null ? null : derive(editor.children, path, folded)),
    [path, folded],
    { equalityFn: sameDerived },
  );
  return <DerivedContext.Provider value={derived}>{children}</DerivedContext.Provider>;
};

const CollapsibleBlock = ({ id, children }: { id: string; children: ReactNode }) => {
  const derived = useContext(DerivedContext);
  const isHidden = derived?.hidden.has(id) === true;
  const key = derived?.keys.get(id);

  if (derived === null || key === undefined) {
    return <div className={cn(isHidden && "hidden")}>{children}</div>;
  }
  const { path } = derived;
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
            toggleHeadingCollapse(path, key);
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
