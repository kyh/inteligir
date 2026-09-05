// Collapse is view state keyed `level:text:ordinal` per note path in localStorage;
// it never touches bytes or history. The hidden set is derived once per render in
// a provider: a per-block backward walk is quadratic under keystrokes.

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { NodeApi, type TElement } from "platejs";
import {
  createPlatePlugin,
  useEditorRef,
  type PlateElementProps,
  type RenderNodeWrapper,
} from "platejs/react";
import { ChevronDownIcon } from "lucide-react";
import { z } from "zod";

import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";

import { useOpenNotePath } from "@repo/editor/note/open-note-context";

const STORAGE_KEY = "inteligir.collapsed-headings";

const HEADING_RANK = new Map<string, number>([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
]);

const folds = new Map<string, Set<string>>();
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  for (const listener of listeners) listener();
}

// decoded per note, so one unreadable entry cannot discard every other note's folds
const STORED_NOTES = z.record(z.string(), z.unknown());
const STORED_KEYS = z.array(z.string());

function readStorage(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return out;
    const notes = STORED_NOTES.safeParse(JSON.parse(raw));
    if (!notes.success) return out;
    for (const [path, value] of Object.entries(notes.data)) {
      const keys = STORED_KEYS.safeParse(value);
      if (keys.success) out.set(path, keys.data);
    }
  } catch {
    // storage unavailable
  }
  return out;
}

// Re-read before writing: the record holds every note, and a write from this map alone drops the notes never opened.
function writeStorage(path: string, keys: ReadonlySet<string>): void {
  try {
    const all = readStorage();
    if (keys.size === 0) all.delete(path);
    else all.set(path, [...keys]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(all)));
  } catch {
    // storage full or unavailable
  }
}

function foldsFor(path: string): Set<string> {
  const known = folds.get(path);
  if (known !== undefined) return known;
  const restored = new Set(readStorage().get(path) ?? []);
  folds.set(path, restored);
  return restored;
}

export function headingCollapseKeys(path: string): ReadonlySet<string> {
  return foldsFor(path);
}

export function toggleHeadingCollapse(path: string, key: string): void {
  const keys = foldsFor(path);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  writeStorage(path, keys);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type Derived = {
  path: string | null;
  hidden: Set<number>;
  keys: Map<number, string>;
  folded: ReadonlySet<string>;
};

const NOTHING_FOLDED: Derived = {
  path: null,
  hidden: new Set(),
  keys: new Map(),
  folded: new Set(),
};

// `version` only makes the memo key carry the store's clock; the fold sets are module state the linter cannot see.
function deriveAt(children: readonly TElement[], path: string, version: number): Derived {
  void version;
  return derive(children, path);
}

function derive(children: readonly TElement[], path: string): Derived {
  const folded = headingCollapseKeys(path);
  const hidden = new Set<number>();
  const keys = new Map<number, string>();
  const ordinals = new Map<string, number>();
  const stack: number[] = [];
  for (const [index, child] of children.entries()) {
    const rank = HEADING_RANK.get(child.type);
    if (rank === undefined) {
      if (stack.length > 0) hidden.add(index);
      continue;
    }
    while (stack.length > 0 && (stack.at(-1) ?? 0) >= rank) stack.pop();
    if (stack.length > 0) hidden.add(index);
    const text = NodeApi.string(child);
    const base = `${String(rank)}:${text}`;
    const ordinal = ordinals.get(base) ?? 0;
    ordinals.set(base, ordinal + 1);
    const key = `${base}:${String(ordinal)}`;
    keys.set(index, key);
    if (folded.has(key)) stack.push(rank);
  }
  return { path, hidden, keys, folded };
}

const DerivedContext = createContext<Derived>(NOTHING_FOLDED);

function CollapseProvider({ children }: { children: React.ReactNode }) {
  const editor = useEditorRef();
  // subscribed once here rather than per block, so the fold set and every chevron name the same file
  const path = useOpenNotePath();
  const storeVersion = useSyncExternalStore(subscribe, () => version);
  const derived = useMemo(
    () => (path === null ? NOTHING_FOLDED : deriveAt(editor.children, path, storeVersion)),
    [editor.children, path, storeVersion],
  );
  return <DerivedContext.Provider value={derived}>{children}</DerivedContext.Provider>;
}

function CollapsibleBlock(props: PlateElementProps) {
  const derived = useContext(DerivedContext);
  const index = props.path?.at(0) ?? -1;
  const key = derived.keys.get(index);
  const isHidden = derived.hidden.has(index);
  const path = derived.path;

  if (key === undefined || path === null) {
    return <div className={cn(isHidden && "hidden")}>{props.children}</div>;
  }
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
      {props.children}
    </div>
  );
}

const CollapseWrapper: RenderNodeWrapper = ({ path }) => {
  if (path.length !== 1) return undefined;
  return (props) => <CollapsibleBlock {...props} />;
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
