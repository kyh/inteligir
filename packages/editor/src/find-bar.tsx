import { useEffect, useRef, useSyncExternalStore } from "react";
import { ChevronRightIcon, ReplaceIcon, SearchIcon, XIcon } from "lucide-react";
import {
  isHotkey,
  NodeApi,
  PathApi,
  TextApi,
  type DecoratedRange,
  type Path,
  type SlateEditor,
  type TRange,
} from "platejs";
import { PlateLeaf, createPlatePlugin, useEditorRef, type PlateLeafProps } from "platejs/react";

import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";

import { editorShortcutFor, type EditorShortcut } from "@repo/editor/editor-shortcuts";

export type FindBarShortcutAction = "find-next" | "find-previous" | "open-replace";

// ⌘F itself is the shell's row: global-shortcuts.ts opens the bar from the window listener
export const FIND_BAR_SHORTCUTS: readonly EditorShortcut<FindBarShortcutAction>[] = [
  { hotkey: "mod+g", action: "find-next", label: "Next match" },
  { hotkey: "mod+shift+g", action: "find-previous", label: "Previous match" },
  { hotkey: "mod+alt+f", action: "open-replace", label: "Find and replace in the note" },
];

type MatchLocation = { path: Path; offset: number };

type FindBarState = {
  open: boolean;
  query: string;
  active: MatchLocation | null;
  replace: string;
  replaceOpen: boolean;
};

let state: FindBarState = { active: null, open: false, query: "", replace: "", replaceOpen: false };
const listeners = new Set<() => void>();

// A module store because decorate runs outside React; decorations read it rather than the
// document, so a change to what they read must also redecorate. The replace field is not
// something they read, so typing into it never re-walks every text leaf.
function setState(editor: SlateEditor, next: Partial<FindBarState>): void {
  const previous = state;
  state = { ...state, ...next };
  if (
    state.open !== previous.open ||
    state.query !== previous.query ||
    state.active !== previous.active
  ) {
    editor.api.redecorate();
  }
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

export function openFindBar(editor: SlateEditor, options?: { replace?: boolean }): void {
  const matches = collectFindMatches(editor, state.query);
  setState(editor, {
    active: matches[0] ?? null,
    open: true,
    replaceOpen: options?.replace ?? state.replaceOpen,
  });
}

function closeFindBar(editor: SlateEditor): void {
  setState(editor, { active: null, open: false });
  editor.tf.focus();
}

function sameLocation(a: MatchLocation, b: MatchLocation): boolean {
  return a.offset === b.offset && PathApi.equals(a.path, b.path);
}

function activeIndexIn(matches: readonly MatchLocation[]): number {
  return state.active === null
    ? -1
    : matches.findIndex((match) => state.active !== null && sameLocation(match, state.active));
}

function matchRange(match: MatchLocation, length: number): TRange {
  return {
    anchor: { offset: match.offset, path: match.path },
    focus: { offset: match.offset + length, path: match.path },
  };
}

function scrollToMatch(editor: SlateEditor, match: MatchLocation, length: number): void {
  try {
    const domRange = editor.api.toDOMRange(matchRange(match, length));
    const container = domRange?.startContainer;
    const target = container instanceof Element ? container : (container?.parentElement ?? null);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    // stale location after an edit
  }
}

export function cycleFindMatch(editor: SlateEditor, direction: 1 | -1): void {
  const matches = collectFindMatches(editor, state.query);
  if (matches.length === 0) {
    setState(editor, { active: null });
    return;
  }
  const current = activeIndexIn(matches);
  const next =
    current === -1
      ? direction === 1
        ? 0
        : matches.length - 1
      : (current + direction + matches.length) % matches.length;
  const active = matches[next];
  if (active === undefined) return;
  setState(editor, { active });
  scrollToMatch(editor, active, state.query.length);
}

export function setFindQuery(editor: SlateEditor, query: string): void {
  const matches = collectFindMatches(editor, query);
  setState(editor, { active: matches[0] ?? null, query });
}

// lands on the nth match in document order; a doc with fewer lands on its last
export function jumpToFindMatch(editor: SlateEditor, query: string, ordinal: number): void {
  const matches = collectFindMatches(editor, query);
  const active = matches[Math.min(ordinal, matches.length - 1)] ?? null;
  setState(editor, { active, open: true, query });
  if (active !== null) scrollToMatch(editor, active, query.length);
}

export function setReplaceText(editor: SlateEditor, replace: string): void {
  setState(editor, { replace });
}

// the active match, then the one that takes its index, so Enter walks the doc
export function replaceActiveMatch(editor: SlateEditor): void {
  const matches = collectFindMatches(editor, state.query);
  const index = Math.max(0, activeIndexIn(matches));
  const target = matches[index];
  if (target === undefined) return;
  editor.tf.insertText(state.replace, { at: matchRange(target, state.query.length) });
  const remaining = collectFindMatches(editor, state.query);
  const active = remaining[Math.min(index, remaining.length - 1)] ?? null;
  setState(editor, { active });
  if (active !== null) scrollToMatch(editor, active, state.query.length);
}

// last to first, so no rewrite moves an offset still to be rewritten
export function replaceAllMatches(editor: SlateEditor): number {
  const matches = collectFindMatches(editor, state.query);
  editor.tf.withoutNormalizing(() => {
    for (const match of matches.toReversed()) {
      editor.tf.insertText(state.replace, { at: matchRange(match, state.query.length) });
    }
  });
  setState(editor, { active: null });
  return matches.length;
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

const BAR_BUTTON_CLASS =
  "shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5";

function FindBar() {
  const editor = useEditorRef();
  const snap = useSyncExternalStore(subscribe, getFindBarState);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (snap.open) inputRef.current?.focus();
  }, [snap.open]);

  if (!snap.open) return null;

  const matches = collectFindMatches(editor, snap.query);
  const activeIndex = activeIndexIn(matches);
  const canReplace = matches.length > 0;

  const onEscape = (event: React.KeyboardEvent): boolean => {
    if (event.key !== "Escape") return false;
    event.preventDefault();
    closeFindBar(editor);
    return true;
  };

  // absolute, not fixed: inside the note column, never over the panel beside it
  return (
    <div className="absolute top-16 right-6 z-40 flex flex-col gap-1 rounded-md border border-border bg-popover px-2 py-1 shadow-md print:hidden">
      <div className="flex items-center gap-1.5">
        <Tooltip content="Toggle replace">
          <button
            type="button"
            aria-label="Toggle replace"
            aria-expanded={snap.replaceOpen}
            onClick={() => {
              setState(editor, { replaceOpen: !snap.replaceOpen });
            }}
            className={BAR_BUTTON_CLASS}
          >
            <ChevronRightIcon
              className={cn("transition-transform", snap.replaceOpen && "rotate-90")}
            />
          </button>
        </Tooltip>
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
            if (onEscape(event)) return;
            const row = editorShortcutFor(FIND_BAR_SHORTCUTS, event);
            if (
              event.key === "Enter" ||
              row?.action === "find-next" ||
              row?.action === "find-previous"
            ) {
              event.preventDefault();
              cycleFindMatch(editor, event.shiftKey ? -1 : 1);
            }
          }}
          className="w-40 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {matches.length === 0 ? "0/0" : `${activeIndex + 1}/${matches.length}`}
        </span>
        <Tooltip content="Close find bar">
          <button
            type="button"
            aria-label="Close find bar"
            onClick={() => {
              closeFindBar(editor);
            }}
            className={BAR_BUTTON_CLASS}
          >
            <XIcon />
          </button>
        </Tooltip>
      </div>
      {snap.replaceOpen ? (
        <div className="flex items-center gap-1.5 pl-6">
          <ReplaceIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            aria-label="Replace with"
            placeholder="Replace with"
            value={snap.replace}
            onChange={(event) => {
              setReplaceText(editor, event.target.value);
            }}
            onKeyDown={(event) => {
              if (onEscape(event)) return;
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (isHotkey("mod+enter", event)) {
                replaceAllMatches(editor);
              } else {
                replaceActiveMatch(editor);
              }
            }}
            className="w-40 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <Tooltip content="Replace (Enter)">
            <button
              type="button"
              aria-label="Replace"
              disabled={!canReplace}
              onClick={() => {
                replaceActiveMatch(editor);
              }}
              className={cn(BAR_BUTTON_CLASS, "px-1 text-xs")}
            >
              Replace
            </button>
          </Tooltip>
          <Tooltip content="Replace all (⌘Enter)">
            <button
              type="button"
              aria-label="Replace all"
              disabled={!canReplace}
              onClick={() => {
                replaceAllMatches(editor);
              }}
              className={cn(BAR_BUTTON_CLASS, "px-1 text-xs")}
            >
              All
            </button>
          </Tooltip>
        </div>
      ) : null}
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
        const row = editorShortcutFor(FIND_BAR_SHORTCUTS, event);
        if (row === null) return;
        event.preventDefault();
        if (row.action === "open-replace") {
          openFindBar(editor, { replace: true });
          return;
        }
        if (!state.open) {
          openFindBar(editor);
          return;
        }
        cycleFindMatch(editor, row.action === "find-previous" ? -1 : 1);
      },
    },
  })),
];
