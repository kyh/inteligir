import { useEffect, useRef } from "react";
import {
  ChevronRight as ChevronRightIcon,
  SwitchHorizontal01 as ReplaceIcon,
  SearchMd as SearchIcon,
  XClose as XIcon,
} from "@untitledui/icons";
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
  useEditorReadOnly,
  useEditorRef,
  useEditorSelector,
  usePluginOption,
} from "platejs/react";
import type { PlateLeafProps } from "platejs/react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { findTextOffsets } from "@repo/editor/headless/knowledge/text-matches";
import type { TextMatchOptions } from "@repo/editor/headless/knowledge/text-matches";
import { Popover, PopoverContent } from "@repo/ui/components/popover";
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";
import { isImeComposing } from "@repo/ui/lib/ime";
import { platformShortcutModifier, spellHotkey } from "@repo/ui/lib/hotkey-spelling";

import { editorShortcutFor } from "@repo/editor/editor-shortcuts";
import type { EditorShortcut } from "@repo/editor/editor-shortcuts";
import { reveal } from "@repo/editor/scroll-reveal";

export type FindBarShortcutAction = "find-next" | "find-previous" | "open-replace" | "replace-all";

const REPLACE_ALL_SHORTCUT: EditorShortcut<FindBarShortcutAction> = {
  action: "replace-all",
  hotkey: "mod+enter",
  label: "Replace all",
};

export const FIND_BAR_SHORTCUTS: readonly EditorShortcut<FindBarShortcutAction>[] = [
  { action: "find-next", hotkey: "mod+g", label: "Next match" },
  { action: "find-previous", hotkey: "mod+shift+g", label: "Previous match" },
  { action: "open-replace", hotkey: "mod+alt+f", label: "Find and replace" },
  REPLACE_ALL_SHORTCUT,
];

const FIELD_MATCHING: TextMatchOptions = { caseSensitive: false, wholeWord: false };

const OPTION_CHIPS: readonly { readonly option: keyof TextMatchOptions; readonly label: string }[] =
  [
    { label: "Match case", option: "caseSensitive" },
    { label: "Whole word", option: "wholeWord" },
  ];

interface FindSearch {
  query: string;
  options: TextMatchOptions;
}

interface FindBarOptions {
  open: boolean;
  search: FindSearch;
  active: RangeRef | null;
  replace: string;
  replaceOpen: boolean;
}

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

const anchorStore = createStore<HTMLElement | null>()(() => null);

export const setFindBarAnchor = (element: HTMLElement | null) => {
  anchorStore.setState(element, true);
};

export const getFindBarState = (editor: SlateEditor) => editor.getOptions(FindBarPlugin);

const setFindBar = (editor: SlateEditor, next: Partial<FindBarOptions>) => {
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

const trackMatch = (editor: SlateEditor, match: TRange | undefined) =>
  match === undefined ? null : editor.api.rangeRef(match, { affinity: "inward" });

const leafMatches = (text: string, path: Path, search: FindSearch) =>
  findTextOffsets(text, search.query, search.options).map(({ offset, length }) => ({
    anchor: { offset, path },
    focus: { offset: offset + length, path },
  }));

const searchMatches = (editor: SlateEditor, search: FindSearch) => {
  if (search.query === "") {
    return [] satisfies TRange[];
  }

  const matches: TRange[] = [];

  for (const [node, path] of editor.api.nodes({ at: [], match: (n) => TextApi.isText(n) })) {
    matches.push(...leafMatches(NodeApi.string(node), path, search));
  }

  return matches;
};

const activeIndexIn = (matches: readonly TRange[], active: TRange | null) =>
  active === null ? -1 : matches.findIndex((match) => RangeApi.equals(match, active));

const resumeIndex = (matches: readonly TRange[], from: Point | null) => {
  if (from === null) {
    return 0;
  }

  const index = matches.findIndex((match) => !PointApi.isBefore(match.anchor, from));

  return index === -1 ? 0 : index;
};

const scrollToMatch = (editor: SlateEditor, match: TRange) => {
  try {
    const domRange = editor.api.toDOMRange(match);
    const container = domRange?.startContainer;
    const target = container instanceof Element ? container : (container?.parentElement ?? null);

    if (target !== null) {
      reveal(target, "center");
    }

    return true;
  } catch {
    return false;
  }
};

const activate = (editor: SlateEditor, match: TRange | undefined) => {
  setFindBar(editor, { active: trackMatch(editor, match) });

  if (match !== undefined) {
    scrollToMatch(editor, match);
  }
};

export const openFindBar = (editor: SlateEditor, options?: { replace?: boolean }) => {
  const state = getFindBarState(editor);
  const [first] = searchMatches(editor, state.search);
  setFindBar(editor, {
    active: trackMatch(editor, first),
    open: true,
    replaceOpen: options?.replace ?? state.replaceOpen,
  });
};

const hideFindBar = (editor: SlateEditor) => {
  setFindBar(editor, { active: null, open: false });
};

const closeFindBar = (editor: SlateEditor) => {
  hideFindBar(editor);
  editor.tf.focus();
};

const wrap = (index: number, length: number) => (index + length) % length;

export const cycleFindMatch = (editor: SlateEditor, direction: 1 | -1) => {
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

export const setFindQuery = (editor: SlateEditor, query: string) => {
  const search: FindSearch = { options: FIELD_MATCHING, query };
  const [first] = searchMatches(editor, search);
  setFindBar(editor, { active: trackMatch(editor, first), search });
};

export const jumpToFindMatch = (
  editor: SlateEditor,
  query: string,
  ordinal: number,
  options: TextMatchOptions = FIELD_MATCHING,
) => {
  const search: FindSearch = { options, query };
  const matches = searchMatches(editor, search);
  const match = matches[Math.min(ordinal, matches.length - 1)];
  setFindBar(editor, { active: trackMatch(editor, match), open: true, search });

  if (match !== undefined) {
    scrollToMatch(editor, match);
  }
};

export const setReplaceText = (editor: SlateEditor, replace: string) => {
  setFindBar(editor, { replace });
};

export const replaceActiveMatch = (editor: SlateEditor) => {
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

export const replaceAllMatches = (editor: SlateEditor) => {
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
  index: number;
}

const sameCounter = (a: FindCounter, b: FindCounter) => a.count === b.count && a.index === b.index;

const OpenFindBar = () => {
  const editor = useEditorRef();
  const search = usePluginOption(FindBarPlugin, "search");
  const shownChips = OPTION_CHIPS.filter(({ option }) => search.options[option]);
  const active = usePluginOption(FindBarPlugin, "active");
  const replace = usePluginOption(FindBarPlugin, "replace");
  const replaceOffered = !useEditorReadOnly();
  const replaceOpen = usePluginOption(FindBarPlugin, "replaceOpen") && replaceOffered;
  const anchor = useStore(anchorStore);
  const inputRef = useRef<HTMLInputElement>(null);

  const counter = useEditorSelector(
    (current) => {
      const matches = searchMatches(current, search);

      return {
        count: matches.length,
        index: activeIndexIn(matches, active?.current ?? null),
      } satisfies FindCounter;
    },
    [search, active],
    { equalityFn: sameCounter },
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const canReplace = counter.count > 0;

  const onEscape = (event: React.KeyboardEvent) => {
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
        {replaceOffered ? (
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
              <ChevronRightIcon
                className={cn("transition-transform", replaceOpen && "rotate-90")}
              />
            </button>
          </Tooltip>
        ) : null}
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          aria-label="Find"
          placeholder="Find…"
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
        {shownChips.map(({ label, option }) => (
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
            content={`${REPLACE_ALL_SHORTCUT.label} (${spellHotkey(REPLACE_ALL_SHORTCUT.hotkey, platformShortcutModifier())})`}
          >
            <button
              type="button"
              aria-label={REPLACE_ALL_SHORTCUT.label}
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
        className="w-auto gap-1 rounded-md p-0 px-2 py-1 print:hidden"
        initialFocus={inputRef}
      >
        {body}
      </PopoverContent>
    </Popover>
  );
};

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
