// The caret's own menu: `/` where a block could legally start opens a list of
// the constructs this editor renders, narrowed by whatever is typed after the
// slash, and picking one is a single transaction that takes the `/query` with
// it.
//
// THE TRIGGER IS PARSED, NEVER MATCHED. A `/` is only an opening when the
// syntax tree says a Paragraph BEGINS at it — the same reading the delegation
// marker takes off the tree the editor already maintains. That one question
// answers every case a character match gets wrong: inside a fence the node is
// CodeText, inside frontmatter it is the YAML block, in a URL it is the
// Autolink, mid-word the Paragraph started earlier, and on a line lazily
// continuing the paragraph above it the Paragraph started on the line above.
// All decline, and none of them needed a rule of its own.
//
// THE VOCABULARY IS THE HOST'S. This module owns the trigger, the filter, the
// rendering and the one transaction; it knows nothing about what an item
// inserts or who a handoff reaches. Same split `DelegationAffordanceConfig`
// uses, for the same reason: the constructs are markdown, the seams are the
// app's.

import { syntaxTree } from "@codemirror/language";
import {
  Facet,
  MapMode,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  showTooltip,
  type Command,
  type Tooltip,
  type TooltipView,
} from "@codemirror/view";

/** The line the caret sits on once a handoff item has taken its `/query`
 *  away. Carries the same `{from,to,text}` shape the selection affordance
 *  hands its callbacks, so a host routing both into one seam needs no adapter
 *  between them. */
export interface SlashBlock {
  from: number;
  to: number;
  text: string;
}

/** What picking an item does. Both members are applied by the SAME
 *  transaction, which is what keeps the `/query` and the result one undo. */
export type SlashItemAction =
  /** Put `text` where the `/query` was. `caret` is an offset INTO `text`;
   *  absent leaves the caret at its end. */
  | { kind: "insert"; text: string; caret?: number }
  /** Take the `/query` away and hand the host the line it left behind. */
  | { kind: "handoff"; run: (block: SlashBlock) => void };

export interface SlashItem {
  /** Stable within one vocabulary; the row's DOM marker and what a test
   *  names. */
  id: string;
  label: string;
  /** The markdown the row produces, shown dimmed beside the label. */
  hint?: string;
  /** What a user types for a construct its label does not spell — "h1" for
   *  Heading 1, "hr" for a divider. */
  keywords?: readonly string[];
  action: SlashItemAction;
}

export interface SlashMenuConfig {
  /** Read once, when the menu OPENS — a getter because the extension set is
   *  fixed at mount while what an item does (and says it does) follows a
   *  setting that is not. */
  items: () => readonly SlashItem[];
}

/**
 * Prefix match over the label and the item's own keywords, case-folded.
 * Deliberately not fuzzy: a fixed list this size is read rather than searched,
 * and the palette's matcher is tuned for note titles.
 */
export function matchesSlashQuery(item: SlashItem, query: string): boolean {
  if (query === "") {
    return true;
  }
  const needle = query.toLowerCase();
  return (
    item.label.toLowerCase().startsWith(needle) ||
    (item.keywords ?? []).some((word) => word.toLowerCase().startsWith(needle))
  );
}

/** True when a block-level construct could begin at `pos` — the whole
 *  legality question, asked of the tree rather than of the character. */
export function opensSlashMenuAt(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, 1);
  return node.name === "Paragraph" && node.from === pos;
}

interface SlashMenuState {
  /** Where the `/` is. */
  from: number;
  /** The text between the `/` and the caret. */
  query: string;
  /** The vocabulary this menu opened over, kept so a keystroke re-filters
   *  without asking the host again mid-menu. */
  all: readonly SlashItem[];
  /** What `query` matched, in the vocabulary's own order. */
  items: readonly SlashItem[];
  selected: number;
}

const slashVocabulary = Facet.define<() => readonly SlashItem[]>();

const closeSlashMenu = StateEffect.define();
/** Move the highlighted row by ±1, wrapping. */
const moveSlashSelection = StateEffect.define<number>();

interface ChangeSpan {
  fromA: number;
  toA: number;
  fromB: number;
  inserted: string;
}

/**
 * Where a `/` this transaction TYPED opened a menu, and what it opened with.
 *
 * `input.type` specifically — a PASTE is `input.paste` and carries a slash the
 * user already had, an external replace carries no user event at all, and
 * neither is someone reaching for a menu.
 *
 * The insertion is allowed to be LONGER than the slash, because CodeMirror
 * reads typing off DOM mutations and coalesces a fast burst into one change:
 * requiring exactly one character would make the menu a function of how
 * quickly someone types. What IS required is that the slash begins the
 * insertion, that the insertion begins a block, and that the caret sits at
 * its end — so whatever else the burst carried is the query's first letters.
 */
function typedSlashAt(tr: Transaction): { from: number; query: string } | null {
  if (!tr.docChanged || !tr.isUserEvent("input.type")) {
    return null;
  }
  const spans: ChangeSpan[] = [];
  tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    spans.push({ fromA, toA, fromB, inserted: inserted.toString() });
  });
  const only = spans.length === 1 ? spans[0] : undefined;
  if (only === undefined || only.fromA !== only.toA || !only.inserted.startsWith("/")) {
    return null;
  }
  const caret = tr.state.selection.main;
  if (!caret.empty || caret.head !== only.fromB + only.inserted.length) {
    return null;
  }
  if (!opensSlashMenuAt(tr.state, only.fromB)) {
    return null;
  }
  return { from: only.fromB, query: only.inserted.slice(1) };
}

function narrow(all: readonly SlashItem[], query: string, from: number): SlashMenuState | null {
  // Whitespace ends it: a block's name is one word, and what follows a space
  // is prose being written rather than a filter being typed. Nothing matching
  // says the same thing, so the menu gets out of the way rather than hanging
  // over a slash the user meant literally.
  if (/\s/u.test(query)) {
    return null;
  }
  const items = all.filter((item) => matchesSlashQuery(item, query));
  return items.length === 0 ? null : { from, query, all, items, selected: 0 };
}

function nextState(value: SlashMenuState, tr: Transaction): SlashMenuState | null {
  for (const effect of tr.effects) {
    if (effect.is(moveSlashSelection)) {
      const count = value.items.length;
      return { ...value, selected: (value.selected + effect.value + count) % count };
    }
  }
  const from = tr.changes.mapPos(value.from, -1, MapMode.TrackDel);
  const caret = tr.state.selection.main;
  // Backspacing past the `/` deletes it or puts the caret behind it; either
  // way there is no query left for the menu to be about.
  if (from === null || !caret.empty || caret.head <= from) {
    return null;
  }
  const query = tr.state.doc.sliceString(from + 1, caret.head);
  if (from === value.from && query === value.query) {
    return value;
  }
  return narrow(value.all, query, from);
}

function applyItem(view: EditorView, menu: SlashMenuState, item: SlashItem): void {
  const from = menu.from;
  const to = from + 1 + menu.query.length;
  const insert = item.action.kind === "insert" ? item.action.text : "";
  const caret = item.action.kind === "insert" ? (item.action.caret ?? insert.length) : 0;
  // ONE transaction, so a single undo takes the construct AND the `/query`
  // that asked for it. The `input.type.` prefix is what CodeMirror's history
  // joins on, which folds this into the group the query was typed in.
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + caret },
    effects: closeSlashMenu.of(null),
    userEvent: "input.type.slash",
    scrollIntoView: true,
  });
  if (item.action.kind === "handoff") {
    const line = view.state.doc.lineAt(from);
    item.action.run({ from: line.from, to: line.to, text: line.text });
  }
  view.focus();
}

class SlashMenuView implements TooltipView {
  readonly dom: HTMLElement;
  private rendered: SlashMenuState | null = null;

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-slash-menu";
    this.dom.setAttribute("role", "listbox");
    this.dom.setAttribute("aria-label", "Insert a block");
    this.sync();
  }

  update(): void {
    this.sync();
  }

  private sync(): void {
    const menu = currentMenu(this.view.state);
    if (menu === null || menu === this.rendered) {
      return;
    }
    const sameRows =
      this.rendered !== null &&
      this.rendered.items.length === menu.items.length &&
      this.rendered.items.every((item, index) => item === menu.items[index]);
    if (!sameRows) {
      this.dom.replaceChildren(...menu.items.map((item) => this.row(item)));
    }
    for (const [index, row] of [...this.dom.children].entries()) {
      row.setAttribute("aria-selected", String(index === menu.selected));
      row.classList.toggle("cm-slash-row-active", index === menu.selected);
      if (index === menu.selected) {
        row.scrollIntoView({ block: "nearest" });
      }
    }
    this.rendered = menu;
  }

  private row(item: SlashItem): HTMLElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "cm-slash-row";
    row.dataset.slashItem = item.id;
    row.setAttribute("role", "option");
    const label = document.createElement("span");
    label.className = "cm-slash-label";
    label.textContent = item.label;
    row.append(label);
    if (item.hint !== undefined) {
      const hint = document.createElement("span");
      hint.className = "cm-slash-hint";
      hint.textContent = item.hint;
      row.append(hint);
    }
    // mousedown would move the caret out of the query before click fires.
    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("click", (event) => {
      event.preventDefault();
      const menu = currentMenu(this.view.state);
      if (menu !== null) {
        applyItem(this.view, menu, item);
      }
    });
    return row;
  }
}

// One `create` for the life of the extension: CodeMirror reuses a tooltip's
// view only when the spec's `create` is the same function, and a fresh arrow
// per state would rebuild the whole list on every keystroke.
const createSlashMenuView = (view: EditorView): TooltipView => new SlashMenuView(view);

function tooltipFor(menu: SlashMenuState | null): Tooltip | null {
  return menu === null
    ? null
    : { pos: menu.from, above: false, arrow: false, create: createSlashMenuView };
}

const slashMenuField = StateField.define<SlashMenuState | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(closeSlashMenu)) {
        return null;
      }
    }
    if (value !== null) {
      return nextState(value, tr);
    }
    const opened = typedSlashAt(tr);
    if (opened === null) {
      return null;
    }
    const vocabulary = tr.state.facet(slashVocabulary).flatMap((source) => source());
    return narrow(vocabulary, opened.query, opened.from);
  },
  provide: (field) => showTooltip.from(field, tooltipFor),
});

function currentMenu(state: EditorState): SlashMenuState | null {
  return state.field(slashMenuField, false) ?? null;
}

const move =
  (by: number): Command =>
  (view) => {
    if (currentMenu(view.state) === null) {
      return false;
    }
    view.dispatch({ effects: moveSlashSelection.of(by) });
    return true;
  };

const accept: Command = (view) => {
  const menu = currentMenu(view.state);
  const item = menu?.items[menu.selected];
  if (menu === null || item === undefined) {
    return false;
  }
  applyItem(view, menu, item);
  return true;
};

/** Escape closes and leaves the literal text — the user typed those bytes. */
const dismiss: Command = (view) => {
  if (currentMenu(view.state) === null) {
    return false;
  }
  view.dispatch({ effects: closeSlashMenu.of(null) });
  return true;
};

const slashKeymap = Prec.highest(
  keymap.of([
    { key: "ArrowDown", run: move(1) },
    { key: "ArrowUp", run: move(-1) },
    { key: "Enter", run: accept },
    { key: "Escape", run: dismiss },
  ]),
);

export function slashMenuExtension(config: SlashMenuConfig): Extension {
  return [slashVocabulary.of(config.items), slashMenuField, slashKeymap, slashMenuTheme];
}

// The panel IS the tooltip element — CodeMirror adds `cm-tooltip` to whatever
// dom a `create` returns — so there is no wrapper to style separately, and the
// class is named twice to outrank the base theme's own `.cm-tooltip` chrome
// (a light `#f5f5f5` box that ignores this editor's palette entirely).
const slashMenuTheme = EditorView.theme({
  ".cm-slash-menu.cm-tooltip": {
    display: "flex",
    flexDirection: "column",
    maxHeight: "16em",
    minWidth: "14em",
    overflowY: "auto",
    padding: "3px",
    border: "1px solid var(--chip-border, oklch(88% 0.01 260))",
    borderRadius: "8px",
    background: "var(--pm-code-background-color)",
    color: "var(--editor-fg)",
    boxShadow: "0 4px 14px oklch(0% 0 0 / 0.12)",
  },
  ".cm-slash-row": {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "1.5em",
    border: "none",
    background: "none",
    borderRadius: "5px",
    padding: "0.25em 0.6em",
    font: "inherit",
    fontSize: "0.85em",
    color: "var(--editor-fg)",
    textAlign: "left",
    cursor: "pointer",
  },
  ".cm-slash-row-active, .cm-slash-row:hover": {
    background: "var(--pm-code-btn-background-color)",
  },
  ".cm-slash-hint": {
    color: "var(--pm-muted-color)",
    fontFamily: "var(--pm-mono-font, monospace)",
    fontSize: "0.85em",
  },
});
