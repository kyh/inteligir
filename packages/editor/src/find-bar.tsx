import { useEffect, useRef, useSyncExternalStore } from "react";
import { ChevronRightIcon, ReplaceIcon, SearchIcon, XIcon } from "lucide-react";
import { NodeApi, PointApi, RangeApi, TextApi } from "platejs";
import type {
  DecoratedRange,
  Path,
  PluginConfig,
  Point,
  RangeRef,
  SlateEditor,
  TRange,
} from "platejs";
import {
  PlateLeaf,
  createPlatePlugin,
  createTPlatePlugin,
  useEditorRef,
  useEditorSelector,
  usePluginOption,
} from "platejs/react";
import type { PlateLeafProps } from "platejs/react";

import { findTextOffsets } from "@repo/notes/knowledge/text-matches";
import type { TextMatchOptions } from "@repo/notes/knowledge/text-matches";
import { Popover, PopoverContent } from "@repo/ui/components/popover";
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { platformShortcutModifier, spellHotkey } from "@repo/ui/lib/hotkey-spelling";

import { editorShortcutFor } from "@repo/editor/editor-shortcuts";
import type { EditorShortcut } from "@repo/editor/editor-shortcuts";

export type FindBarShortcutAction = "find-next" | "find-previous" | "open-replace" | "replace-all";

// the replace field's chord alone: in the note, ⌘Enter is not the bar's to take
const REPLACE_ALL_SHORTCUT: EditorShortcut<FindBarShortcutAction> = {
  action: "replace-all",
  hotkey: "mod+enter",
  label: "Replace all (from the replace field)",
};

// ⌘F itself is the shell's row: global-shortcuts.ts opens the bar from the window listener
export const FIND_BAR_SHORTCUTS: readonly EditorShortcut<FindBarShortcutAction>[] = [
  { action: "find-next", hotkey: "mod+g", label: "Next match" },
  { action: "find-previous", hotkey: "mod+shift+g", label: "Previous match" },
  { action: "open-replace", hotkey: "mod+alt+f", label: "Find and replace in the note" },
  REPLACE_ALL_SHORTCUT,
];

// the bar's own field has no toggles: any case, anywhere in a word
const FIELD_MATCHING: TextMatchOptions = { caseSensitive: false, wholeWord: false };

// A jump's options are drawn, since the count answers to them and the field alone would not say
// so; a chip only drops them, because the bar has no toggle to set one.
const OPTION_CHIPS: readonly { readonly option: keyof TextMatchOptions; readonly label: string }[] =
  [
    { label: "Match case", option: "caseSensitive" },
    { label: "Whole word", option: "wholeWord" },
  ];

// A jump from the vault search brings that search's options with its query, so the bar lights
// the matches the palette listed and the ordinal counts among them; typing a query drops them.
interface FindSearch {
  query: string;
  options: TextMatchOptions;
}

interface FindBarOptions {
  open: boolean;
  search: FindSearch;
  // a ref, so the match follows the edits around it and an edit that takes it is noticed
  active: RangeRef | null;
  replace: string;
  replaceOpen: boolean;
}

// Plugin options rather than a module store: each note's editor keeps its own bar, so a match
// never names a path in the note that replaced it.
const FindBarPlugin = createTPlatePlugin<PluginConfig<"findBar", FindBarOptions>>({
  key: "findBar",
  options: {
    active: null,
    open: false,
    replace: "",
    replaceOpen: false,
    search: { options: FIELD_MATCHING, query: "" },
  },
});

// The element the bar hangs under, registered by whatever surface draws the Find button; the
// editor never reaches the shell, so the shell hands it the anchor. Null while no such button is
// on screen (zen hides it), and the bar falls back to the note column's corner.
let anchorEl: HTMLElement | null = null;
const anchorListeners = new Set<() => void>();

export const setFindBarAnchor = (element: HTMLElement | null): void => {
  anchorEl = element;
  for (const listener of anchorListeners) {
    listener();
  }
};

const subscribeAnchor = (listener: () => void): (() => void) => {
  anchorListeners.add(listener);
  return () => {
    anchorListeners.delete(listener);
  };
};

const getFindBarAnchor = (): HTMLElement | null => anchorEl;

export const getFindBarState = (editor: SlateEditor): FindBarOptions =>
  editor.getOptions(FindBarPlugin);

// Decorations read the open flag, the search and the active match rather than the document, so
// a change to one of them must redecorate. The replace field is not among them, so typing into
// it never re-walks every text leaf.
const setFindBar = (editor: SlateEditor, next: Partial<FindBarOptions>): void => {
  const previous = getFindBarState(editor);
  editor.setOptions(FindBarPlugin, next);
  const current = getFindBarState(editor);
  if (current.active !== previous.active) {
    previous.active?.unref();
  }
  if (
    current.open !== previous.open ||
    current.search !== previous.search ||
    current.active !== previous.active
  ) {
    editor.api.redecorate();
  }
};

// inward, so text typed at either edge stays outside the match and text typed inside it joins
const trackMatch = (editor: SlateEditor, match: TRange | undefined): RangeRef | null =>
  match === undefined ? null : editor.api.rangeRef(match, { affinity: "inward" });

const leafMatches = (text: string, path: Path, search: FindSearch): TRange[] =>
  findTextOffsets(text, search.query, search.options).map(({ offset, length }) => ({
    anchor: { offset, path },
    focus: { offset: offset + length, path },
  }));

const searchMatches = (editor: SlateEditor, search: FindSearch): TRange[] => {
  if (search.query === "") {
    return [];
  }
  const matches: TRange[] = [];
  for (const [node, path] of editor.api.nodes({ at: [], match: (n) => TextApi.isText(n) })) {
    matches.push(...leafMatches(NodeApi.string(node), path, search));
  }
  return matches;
};

export const collectFindMatches = (editor: SlateEditor, query: string): TRange[] =>
  searchMatches(editor, { options: FIELD_MATCHING, query });

const activeIndexIn = (matches: readonly TRange[], active: TRange | null): number =>
  active === null ? -1 : matches.findIndex((match) => RangeApi.equals(match, active));

// where a walk picks up when there is no active match to step from: the first match at or after
// the point, else the first in the note
const resumeIndex = (matches: readonly TRange[], from: Point | null): number => {
  if (from === null) {
    return 0;
  }
  const index = matches.findIndex((match) => !PointApi.isBefore(match.anchor, from));
  return index === -1 ? 0 : index;
};

const scrollToMatch = (editor: SlateEditor, match: TRange): void => {
  try {
    const domRange = editor.api.toDOMRange(match);
    const container = domRange?.startContainer;
    const target = container instanceof Element ? container : (container?.parentElement ?? null);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    // a leaf the view has not drawn has no DOM range
  }
};

const activate = (editor: SlateEditor, match: TRange | undefined): void => {
  setFindBar(editor, { active: trackMatch(editor, match) });
  if (match !== undefined) {
    scrollToMatch(editor, match);
  }
};

export const openFindBar = (editor: SlateEditor, options?: { replace?: boolean }): void => {
  const state = getFindBarState(editor);
  const [first] = searchMatches(editor, state.search);
  setFindBar(editor, {
    active: trackMatch(editor, first),
    open: true,
    replaceOpen: options?.replace ?? state.replaceOpen,
  });
};

// leaves focus where it is, for a surface drawn over the note: moving it to the editor would
// close a non-modal popup holding it, since those close on focus-out
export const hideFindBar = (editor: SlateEditor): void => {
  setFindBar(editor, { active: null, open: false });
};

const closeFindBar = (editor: SlateEditor): void => {
  hideFindBar(editor);
  editor.tf.focus();
};

const wrap = (index: number, length: number): number => (index + length) % length;

export const cycleFindMatch = (editor: SlateEditor, direction: 1 | -1): void => {
  const { active, search } = getFindBarState(editor);
  const matches = searchMatches(editor, search);
  if (matches.length === 0) {
    setFindBar(editor, { active: null });
    return;
  }
  const from = active?.current ?? null;
  const current = activeIndexIn(matches, from);
  let next = wrap(current + direction, matches.length);
  if (current === -1) {
    const resume = resumeIndex(matches, from?.anchor ?? null);
    next = direction === 1 ? resume : wrap(resume - 1, matches.length);
  }
  activate(editor, matches[next]);
};

export const setFindQuery = (editor: SlateEditor, query: string): void => {
  const search: FindSearch = { options: FIELD_MATCHING, query };
  const [first] = searchMatches(editor, search);
  setFindBar(editor, { active: trackMatch(editor, first), search });
};

// lands on the nth match in document order; a doc with fewer lands on its last
export const jumpToFindMatch = (
  editor: SlateEditor,
  query: string,
  ordinal: number,
  options: TextMatchOptions = FIELD_MATCHING,
): void => {
  const search: FindSearch = { options, query };
  const matches = searchMatches(editor, search);
  const match = matches[Math.min(ordinal, matches.length - 1)];
  setFindBar(editor, { active: trackMatch(editor, match), open: true, search });
  if (match !== undefined) {
    scrollToMatch(editor, match);
  }
};

export const setReplaceText = (editor: SlateEditor, replace: string): void => {
  setFindBar(editor, { replace });
};

// The active match, then the next one after what was written, so Enter walks the doc and never
// rewrites its own replacement. An active match an edit took is not replaced: the press lands on
// the next match, and the next press replaces what the user can now see.
export const replaceActiveMatch = (editor: SlateEditor): void => {
  const { active, replace, search } = getFindBarState(editor);
  const matches = searchMatches(editor, search);
  const from = active?.current ?? null;
  const target = matches[activeIndexIn(matches, from)];
  if (target === undefined) {
    activate(editor, matches[resumeIndex(matches, from?.anchor ?? null)]);
    return;
  }
  const written = editor.api.pointRef(target.focus, { affinity: "forward" });
  editor.tf.insertText(replace, { at: target });
  const after = written.unref();
  const remaining = searchMatches(editor, search);
  activate(editor, remaining[resumeIndex(remaining, after)]);
};

// last to first, so no rewrite moves an offset still to be rewritten
export const replaceAllMatches = (editor: SlateEditor): number => {
  const { replace, search } = getFindBarState(editor);
  const matches = searchMatches(editor, search);
  editor.tf.withoutNormalizing(() => {
    for (const match of matches.toReversed()) {
      editor.tf.insertText(replace, { at: match });
    }
  });
  setFindBar(editor, { active: null });
  return matches.length;
};

const FindMatchLeaf = (props: PlateLeafProps) => (
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

const BAR_BUTTON_CLASS =
  "shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5";

interface FindCounter {
  count: number;
  // -1 while no match is active
  index: number;
}

const sameCounter = (a: FindCounter, b: FindCounter): boolean =>
  a.count === b.count && a.index === b.index;

const OpenFindBar = () => {
  const editor = useEditorRef();
  const search = usePluginOption(FindBarPlugin, "search");
  const active = usePluginOption(FindBarPlugin, "active");
  const replace = usePluginOption(FindBarPlugin, "replace");
  const replaceOpen = usePluginOption(FindBarPlugin, "replaceOpen");
  const anchor = useSyncExternalStore(subscribeAnchor, getFindBarAnchor);
  const inputRef = useRef<HTMLInputElement>(null);
  // an edit moves the count and the active match without touching the options
  const counter = useEditorSelector(
    (current): FindCounter => {
      const matches = searchMatches(current, search);
      return { count: matches.length, index: activeIndexIn(matches, active?.current ?? null) };
    },
    [search, active],
    { equalityFn: sameCounter },
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const canReplace = counter.count > 0;

  const onEscape = (event: React.KeyboardEvent): boolean => {
    if (event.key !== "Escape") {
      return false;
    }
    event.preventDefault();
    closeFindBar(editor);
    return true;
  };

  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <Tooltip content="Toggle replace">
          <button
            type="button"
            aria-label="Toggle replace"
            aria-expanded={replaceOpen}
            onClick={() => {
              setFindBar(editor, { replaceOpen: !replaceOpen });
            }}
            className={BAR_BUTTON_CLASS}
          >
            <ChevronRightIcon className={cn("transition-transform", replaceOpen && "rotate-90")} />
          </button>
        </Tooltip>
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          aria-label="Find in note"
          placeholder="Find in note"
          value={search.query}
          onChange={(event) => {
            setFindQuery(editor, event.target.value);
          }}
          onKeyDown={(event) => {
            if (isImeComposing(event)) {
              return;
            }
            if (onEscape(event)) {
              return;
            }
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
          className="w-40 bg-transparent text-subtitle outline-none placeholder:text-muted-foreground/60"
        />
        {OPTION_CHIPS.filter(({ option }) => search.options[option]).map(({ label, option }) => (
          <Tooltip key={option} content="Match any case, anywhere in a word">
            <button
              type="button"
              onClick={() => {
                setFindQuery(editor, search.query);
              }}
              className="shrink-0 rounded-sm bg-accent px-1 text-caption text-accent-foreground hover:bg-accent/70"
            >
              {label}
            </button>
          </Tooltip>
        ))}
        <span className="shrink-0 text-body tabular-nums text-muted-foreground">
          {counter.count === 0 ? "0/0" : `${counter.index + 1}/${counter.count}`}
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
      {replaceOpen ? (
        <div className="flex items-center gap-1.5 pl-6">
          <ReplaceIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            aria-label="Replace with"
            placeholder="Replace with"
            value={replace}
            onChange={(event) => {
              setReplaceText(editor, event.target.value);
            }}
            onKeyDown={(event) => {
              if (isImeComposing(event)) {
                return;
              }
              if (onEscape(event)) {
                return;
              }
              if (editorShortcutFor(FIND_BAR_SHORTCUTS, event)?.action === "replace-all") {
                event.preventDefault();
                replaceAllMatches(editor);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                replaceActiveMatch(editor);
              }
            }}
            className="w-40 bg-transparent text-subtitle outline-none placeholder:text-muted-foreground/60"
          />
          <Tooltip content="Replace (Enter)">
            <button
              type="button"
              aria-label="Replace"
              disabled={!canReplace}
              onClick={() => {
                replaceActiveMatch(editor);
              }}
              className={cn(BAR_BUTTON_CLASS, "px-1 text-body")}
            >
              Replace
            </button>
          </Tooltip>
          <Tooltip
            content={`Replace all (${spellHotkey(REPLACE_ALL_SHORTCUT.hotkey, platformShortcutModifier())})`}
          >
            <button
              type="button"
              aria-label="Replace all"
              disabled={!canReplace}
              onClick={() => {
                replaceAllMatches(editor);
              }}
              className={cn(BAR_BUTTON_CLASS, "px-1 text-body")}
            >
              All
            </button>
          </Tooltip>
        </div>
      ) : null}
    </>
  );

  // The bar hangs under the Find button when a surface has one, and falls back to the note
  // column's corner when none is on screen (zen). Absolute, not fixed: inside the note column,
  // never over the panel beside it.
  if (anchor === null) {
    return (
      <div
        className={cn(
          "absolute top-16 right-6 z-40 flex flex-col gap-1 rounded-md px-2 py-1 print:hidden",
          surfaceClasses(3),
        )}
      >
        {body}
      </div>
    );
  }
  return (
    <Popover
      open
      onOpenChange={(next) => {
        if (!next) {
          closeFindBar(editor);
        }
      }}
    >
      <PopoverContent
        anchor={anchor}
        align="end"
        side="bottom"
        sideOffset={6}
        // the bar sizes to its fields, and it is chrome over the note: not the popover's own card
        className="w-auto gap-1 rounded-md p-0 px-2 py-1 print:hidden"
        // the editor keeps the caret; the input takes focus from the effect above
        initialFocus={inputRef}
      >
        {body}
      </PopoverContent>
    </Popover>
  );
};

// mounted only while open, so a closed bar costs a keystroke no walk of the note
const FindBar = () => {
  const open = usePluginOption(FindBarPlugin, "open");
  return open ? <OpenFindBar /> : null;
};

export const FindBarKit = [
  createPlatePlugin({
    decorate: ({ editor, entry: [node, path] }) => {
      const { active, open, search } = getFindBarState(editor);
      if (!open || !TextApi.isText(node)) {
        return;
      }
      const current = active?.current ?? null;
      const ranges = leafMatches(node.text, path, search).map((match) => {
        const range: DecoratedRange & { findMatch: true; findActive?: true } = {
          ...match,
          findMatch: true,
        };
        if (current !== null && RangeApi.equals(match, current)) {
          range.findActive = true;
        }
        return range;
      });
      return ranges.length > 0 ? ranges : undefined;
    },
    key: "findMatch",
    node: { isLeaf: true },
  }).withComponent(FindMatchLeaf),
  FindBarPlugin.extend({
    handlers: {
      onKeyDown: ({ editor, event }) => {
        const row = editorShortcutFor(FIND_BAR_SHORTCUTS, event);
        if (row === null || row.action === "replace-all") {
          return;
        }
        event.preventDefault();
        if (row.action === "open-replace") {
          openFindBar(editor, { replace: true });
          return;
        }
        if (!getFindBarState(editor).open) {
          openFindBar(editor);
          return;
        }
        cycleFindMatch(editor, row.action === "find-previous" ? -1 : 1);
      },
    },
    render: { afterEditable: () => <FindBar /> },
  }),
];
