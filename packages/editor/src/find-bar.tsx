// ⌘G search-in-note: a small floating find bar over the editor, highlighting
// every case-insensitive match with a TEXT-level decoration (the tag-chip
// pattern — each range carries the plugin-key flag so the keyed leaf claims
// it) and a distinct tint on the active match. Enter/⇧Enter (and ⌘G/⌘⇧G from
// the document) cycle with scroll-into-view; Esc closes and returns the
// caret. Editor-local: state is a module store because `decorate` runs
// outside React, and the whole surface unmounts with the editor.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import {
  isHotkey,
  NodeApi,
  PathApi,
  TextApi,
  type DecoratedRange,
  type Path,
  type SlateEditor,
} from "platejs";
import { PlateLeaf, createPlatePlugin, useEditorRef, type PlateLeafProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

type MatchLocation = { path: Path; offset: number };

type FindBarState = {
  open: boolean;
  query: string;
  active: MatchLocation | null;
};

let state: FindBarState = { active: null, open: false, query: "" };
const listeners = new Set<() => void>();

function setState(next: Partial<FindBarState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFindBarState(): FindBarState {
  return state;
}

/** Every match location, in document order — the cycle order. */
export function collectFindMatches(editor: SlateEditor, query: string): MatchLocation[] {
  if (query === "") return [];
  const needle = query.toLowerCase();
  const matches: MatchLocation[] = [];
  for (const [node, path] of editor.api.nodes({ at: [], match: (n) => TextApi.isText(n) })) {
    const haystack = NodeApi.string(node).toLowerCase();
    let from = 0;
    for (;;) {
      const index = haystack.indexOf(needle, from);
      if (index === -1) break;
      matches.push({ offset: index, path: [...path] });
      from = index + needle.length;
    }
  }
  return matches;
}

export function openFindBar(editor: SlateEditor): void {
  const matches = collectFindMatches(editor, state.query);
  setState({ active: matches[0] ?? null, open: true });
}

function closeFindBar(editor: SlateEditor): void {
  setState({ active: null, open: false });
  editor.tf.focus();
}

function sameLocation(a: MatchLocation, b: MatchLocation): boolean {
  return a.offset === b.offset && PathApi.equals(a.path, b.path);
}

function scrollToMatch(editor: SlateEditor, match: MatchLocation, length: number): void {
  try {
    const domRange = editor.api.toDOMRange({
      anchor: { offset: match.offset, path: match.path },
      focus: { offset: match.offset + length, path: match.path },
    });
    const container = domRange?.startContainer;
    const target = container instanceof Element ? container : (container?.parentElement ?? null);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    // A stale location after an edit — the next cycle recomputes.
  }
}

export function cycleFindMatch(editor: SlateEditor, direction: 1 | -1): void {
  const matches = collectFindMatches(editor, state.query);
  if (matches.length === 0) {
    setState({ active: null });
    return;
  }
  const current =
    state.active === null
      ? -1
      : matches.findIndex((match) => state.active !== null && sameLocation(match, state.active));
  const next =
    current === -1
      ? direction === 1
        ? 0
        : matches.length - 1
      : (current + direction + matches.length) % matches.length;
  const active = matches[next];
  if (active === undefined) return;
  setState({ active });
  scrollToMatch(editor, active, state.query.length);
}

export function setFindQuery(editor: SlateEditor, query: string): void {
  const matches = collectFindMatches(editor, query);
  setState({ active: matches[0] ?? null, query });
}

function FindMatchLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf
      {...props}
      as="span"
      className={cn(
        "rounded-[2px]",
        props.leaf.findActive === true
          ? "bg-orange-400/60 text-foreground"
          : "bg-yellow-300/40 dark:bg-yellow-500/25",
      )}
    >
      {props.children}
    </PlateLeaf>
  );
}

function FindBar() {
  const editor = useEditorRef();
  const snap = useSyncExternalStore(subscribe, getFindBarState);
  const inputRef = useRef<HTMLInputElement>(null);

  // Decorations read the module store, so a store change must force Plate to
  // re-run decorate — nothing in the document changed.
  useEffect(() => {
    editor.api.redecorate();
  }, [editor, snap.open, snap.query, snap.active]);

  useEffect(() => {
    if (snap.open) inputRef.current?.focus();
  }, [snap.open]);

  if (!snap.open) return null;

  const matches = collectFindMatches(editor, snap.query);
  const activeIndex =
    snap.active === null
      ? -1
      : matches.findIndex((match) => snap.active !== null && sameLocation(match, snap.active));

  return (
    <div className="fixed top-16 right-6 z-40 flex items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 shadow-md print:hidden">
      <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        aria-label="Find in note"
        placeholder="Find in note"
        value={snap.query}
        onChange={(event) => {
          setFindQuery(editor, event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeFindBar(editor);
            return;
          }
          if (event.key === "Enter" || isHotkey("mod+g", event) || isHotkey("mod+shift+g", event)) {
            event.preventDefault();
            cycleFindMatch(editor, event.shiftKey ? -1 : 1);
          }
        }}
        className="w-40 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
      />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {matches.length === 0 ? "0/0" : `${activeIndex + 1}/${matches.length}`}
      </span>
      <button
        type="button"
        aria-label="Close find bar"
        onClick={() => {
          closeFindBar(editor);
        }}
        className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
      >
        <XIcon />
      </button>
    </div>
  );
}

export const FindBarKit = [
  createPlatePlugin({
    key: "findMatch",
    node: { isLeaf: true },
    decorate: ({ entry: [node, path] }) => {
      if (!state.open || state.query === "") return undefined;
      if (!TextApi.isText(node)) return undefined;
      const needle = state.query.toLowerCase();
      const haystack = node.text.toLowerCase();
      if (!haystack.includes(needle)) return undefined;
      const ranges: DecoratedRange[] = [];
      let from = 0;
      for (;;) {
        const index = haystack.indexOf(needle, from);
        if (index === -1) break;
        const active =
          state.active !== null &&
          state.active.offset === index &&
          PathApi.equals(state.active.path, path);
        const range: DecoratedRange & { findMatch: true; findActive?: true } = {
          anchor: { offset: index, path },
          findMatch: true,
          focus: { offset: index + needle.length, path },
        };
        if (active) range.findActive = true;
        ranges.push(range);
        from = index + needle.length;
      }
      return ranges.length > 0 ? ranges : undefined;
    },
  }).withComponent(FindMatchLeaf),
  createPlatePlugin({
    key: "findBar",
    render: { afterEditable: () => <FindBar /> },
  }).extend(() => ({
    handlers: {
      onKeyDown: ({ editor, event }) => {
        if (!isHotkey("mod+g", event) && !isHotkey("mod+shift+g", event)) return;
        event.preventDefault();
        if (!state.open) {
          openFindBar(editor);
          return;
        }
        cycleFindMatch(editor, isHotkey("mod+shift+g", event) ? -1 : 1);
      },
    },
  })),
];
