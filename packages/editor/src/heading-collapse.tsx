// Collapsible headings: a chevron on h1–h3 folds the section below it (every
// following top-level block until the next heading of the same or higher
// rank). Collapse is VIEW state — keyed `level:text:ordinal` per note path,
// persisted to localStorage — and never touches bytes or history, the same
// contract tab switching states.
//
// The hidden set is derived ONCE per render pass in a provider above the
// editable (a per-block backward walk would be quadratic under keystrokes):
// one forward walk over root children with a stack of collapsed ranks.

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { NodeApi, type TElement } from "platejs";
import {
  createPlatePlugin,
  useEditorRef,
  type PlateElementProps,
  type RenderNodeWrapper,
} from "platejs/react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";

const STORAGE_KEY = "inteligir.collapsed-headings";

const HEADING_RANK: Record<string, number> = { h1: 1, h2: 2, h3: 3 };

// ---- Store (module singleton; the editor mounts one note at a time) --------

let scope = "";
let collapsed = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  for (const listener of listeners) listener();
}

function readStorage(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeStorage(): void {
  try {
    const all = readStorage();
    if (collapsed.size === 0) delete all[scope];
    else all[scope] = [...collapsed];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or unavailable — collapse state degrades to session-only.
  }
}

/** Point the store at a note. Called by the editor host on open. */
export function setHeadingCollapseScope(path: string): void {
  if (path === scope) return;
  scope = path;
  collapsed = new Set(readStorage()[path] ?? []);
  emit();
}

function toggleCollapsed(key: string): void {
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  writeStorage();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---- Derivation ------------------------------------------------------------

type Derived = {
  /** Top-level indices hidden under some collapsed heading. */
  hidden: Set<number>;
  /** index → collapse key, for blocks that are collapsible headings. */
  keys: Map<number, string>;
};

/** `version` is unused by the walk — it exists so the memo key carries the
 * store's clock (the collapsed set is module state the linter cannot see). */
function deriveAt(children: readonly TElement[], version: number): Derived {
  void version;
  return derive(children);
}

function derive(children: readonly TElement[]): Derived {
  const hidden = new Set<number>();
  const keys = new Map<number, string>();
  const ordinals = new Map<string, number>();
  // Ranks of collapsed headings currently covering the walk.
  const stack: number[] = [];
  for (const [index, child] of children.entries()) {
    const rank = typeof child.type === "string" ? HEADING_RANK[child.type] : undefined;
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
    if (collapsed.has(key)) stack.push(rank);
  }
  return { hidden, keys };
}

const DerivedContext = createContext<Derived>({ hidden: new Set(), keys: new Map() });

function CollapseProvider({ children }: { children: React.ReactNode }) {
  const editor = useEditorRef();
  const storeVersion = useSyncExternalStore(subscribe, () => version);
  // children identity tracks edits; the store clock tracks collapse toggles.
  const derived = useMemo(
    () => deriveAt(editor.children, storeVersion),
    [editor.children, storeVersion],
  );
  return <DerivedContext.Provider value={derived}>{children}</DerivedContext.Provider>;
}

// ---- Render wrapper --------------------------------------------------------

function CollapsibleBlock(props: PlateElementProps) {
  const derived = useContext(DerivedContext);
  const index = props.path?.at(0) ?? -1;
  const key = derived.keys.get(index);
  const isHidden = derived.hidden.has(index);
  const isCollapsed = key !== undefined && collapsed.has(key);

  if (key === undefined) {
    return <div className={cn(isHidden && "hidden")}>{props.children}</div>;
  }
  return (
    <div className={cn("group/heading relative", isHidden && "hidden")}>
      <button
        type="button"
        contentEditable={false}
        aria-label={isCollapsed ? "Expand section" : "Collapse section"}
        aria-expanded={!isCollapsed}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          toggleCollapsed(key);
        }}
        className={cn(
          "absolute top-1/2 -left-6 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-transform select-none hover:bg-accent [&_svg]:size-3.5",
          isCollapsed ? "-rotate-90 opacity-100" : "opacity-0 group-hover/heading:opacity-100",
        )}
      >
        <ChevronDownIcon />
      </button>
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
