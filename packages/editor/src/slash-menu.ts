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
// AND THAT PARAGRAPH MUST HANG OFF THE DOCUMENT. Inside a blockquote or a
// list item the same question passes while the ANSWER stops being safe: a
// multi-line snippet's continuation lines carry no `> ` and no indent, so the
// construct opens inside the container and closes outside it. Making that
// work means prefixing every continuation line with the enclosing context,
// which is a per-context byte transform that would need its own round-trip
// pins; until it has them the honest v1 rule is that `/` in a container is a
// literal slash. Stated here because it is a REFUSAL a reader will otherwise
// read as an oversight.
//
// THE TREE IS ASKED ONCE, AND MADE TO ANSWER. Lezer parses incrementally under
// a time budget, so on a large document the region under a freshly moved caret
// may not be parsed yet — and a trigger computed only from the slash keystroke
// gets no second chance. So the slash keystroke (only that one) forces the
// parse up to itself before asking, the same `syntaxTreeAvailable` question
// force-parse-healer.ts asks before it heals, and declines if the budget runs
// out rather than guessing.
//
// WHAT THE MENU IS ABOUT IS THE `/query` THE USER IS TYPING, and nothing else
// may redefine it. A caret move, a paste, an external write merging in: each
// closes the menu rather than re-reading a query from wherever the caret now
// sits, because that range is the one `applyItem` DELETES — a caret walked
// rightwards over existing prose would otherwise make the user's own bytes
// the query and take them with the insert.
//
// THE VOCABULARY IS THE HOST'S. This module owns the trigger, the filter, the
// rendering and the one transaction; it knows nothing about what an item
// inserts or who a handoff reaches. Same split `DelegationAffordanceConfig`
// uses, for the same reason: the constructs are markdown, the seams are the
// app's.

import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
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

/** How long the slash keystroke may spend making the parser catch up to it.
 *  One hitch on one keystroke, never per keystroke — the alternative is a
 *  menu that silently never opens on a large document. */
const TRIGGER_PARSE_BUDGET_MS = 50;

/**
 * True when a block-level construct could begin at `pos`: the tree must say a
 * `Paragraph` starts exactly there AND hang it off the document rather than
 * off a blockquote or a list item (see the header for why a container is
 * refused rather than supported).
 *
 * Forces the parse up to `pos` when the tree has not reached it, and declines
 * when it cannot — an unparsed region has no answer, and inventing one is how
 * a slash inside a fence opens a menu.
 */
export function opensSlashMenuAt(state: EditorState, pos: number): boolean {
  const upto = Math.min(state.doc.length, pos + 1);
  const tree = syntaxTreeAvailable(state, upto)
    ? syntaxTree(state)
    : ensureSyntaxTree(state, upto, TRIGGER_PARSE_BUDGET_MS);
  if (tree === null) {
    return false;
  }
  const node = tree.resolveInner(pos, 1);
  return node.name === "Paragraph" && node.from === pos && node.parent?.name === "Document";
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
  // A transaction that moves the caret without editing the document is not a
  // query edit, and re-reading the query from the new caret would redefine the
  // range applyItem deletes — walk right over `Heading` and the menu would
  // "insert" by eating the H. An effect-only transaction (a host pushing chip
  // or proposal state) touches neither and is passed through untouched.
  if (!tr.docChanged) {
    return tr.selection === undefined ? value : null;
  }
  // Only the user's own typing and deleting are the query. A paste, an
  // external write merging in, a programmatic rewrite: each is somebody else's
  // bytes arriving between the slash and the caret.
  if (!tr.isUserEvent("input.type") && !tr.isUserEvent("delete")) {
    return null;
  }
  const from = tr.changes.mapPos(value.from, -1, MapMode.TrackDel);
  const caret = tr.state.selection.main;
  // Backspacing past the `/` deletes it or puts the caret behind it; either
  // way there is no query left for the menu to be about.
  if (from === null || !caret.empty || caret.head <= from) {
    return null;
  }
  // The anchor is a slash or it is nothing: an edit elsewhere that shifted the
  // buffer under a stale offset must refuse rather than name a new range.
  if (tr.state.doc.sliceString(from, from + 1) !== "/") {
    return null;
  }
  const query = tr.state.doc.sliceString(from + 1, caret.head);
  if (from === value.from && query === value.query) {
    return value;
  }
  return narrow(value.all, query, from);
}

/** What the `/query` leaves behind, and therefore what has to separate the
 *  insertion from it. Three cases because the buffer already supplies a
 *  newline in one of them and not in the other. */
export type SlashRemainder =
  /** The block ends where the query does. */
  | "none"
  /** Text sits after the query on its own line. */
  | "same-line"
  /** The block runs on, but onto a following line. */
  | "later-line";

/**
 * The bytes to insert, given what the `/query` leaves behind.
 *
 * A ONE-LINE snippet is a line PREFIX and wants the remainder: `/head` typed
 * at the start of `tail` becomes `# tail`, which is the transform-the-block
 * behaviour a slash menu is expected to have. A MULTI-LINE snippet is the
 * opposite — its last line closes the construct, so trailing prose glued to
 * it is inside the construct rather than after it. `` ```tail `` is not a
 * closing fence (an info string is opener-only), so the fence never closes and
 * the rest of the document becomes code; a table row and a math paragraph
 * swallow the remainder the same way, one line lower down.
 *
 * So a multi-line snippet gets a BLANK LINE between it and the remainder. Not
 * a single newline: a table continues across consecutive non-blank lines and a
 * `$$` paragraph continues the same way, so only a blank line ends them. How
 * MANY newlines that takes depends on where the remainder is — one on a later
 * line already has this line's own terminator in front of it, one on the same
 * line has nothing. Derived from the snippet rather than declared per item,
 * because an item that forgot to declare it corrupts a document silently, and
 * exported so a host can prove its own vocabulary against the rule instead of
 * restating it.
 */
export function slashInsertionFor(text: string, remainder: SlashRemainder): string {
  if (remainder === "none" || !text.includes("\n")) {
    return text;
  }
  const body = text.replace(/\n*$/u, "");
  return remainder === "same-line" ? `${body}\n\n` : `${body}\n`;
}

/**
 * Where the block the `/query` sits in ENDS — the paragraph's end, not the
 * line's. A paragraph runs across every line up to a blank one, so a menu
 * opened on the first line of a two-line paragraph has a remainder the caret's
 * own line knows nothing about, and a table inserted there absorbs the second
 * line as another row. Falls back to the line when the tree cannot answer,
 * which is the same direction the trigger fails in: never claim there is no
 * remainder when the question could not be asked.
 */
function blockEndAt(state: EditorState, pos: number): number {
  const node = syntaxTree(state).resolveInner(pos, 1);
  const lineEnd = state.doc.lineAt(pos).to;
  return node.name === "Paragraph" && node.from <= pos ? Math.max(node.to, lineEnd) : lineEnd;
}

function applyItem(view: EditorView, menu: SlashMenuState, item: SlashItem): void {
  const from = menu.from;
  const to = from + 1 + menu.query.length;
  const line = view.state.doc.lineAt(from);
  const remainder: SlashRemainder =
    to < line.to ? "same-line" : to < blockEndAt(view.state, from) ? "later-line" : "none";
  const insert =
    item.action.kind === "insert" ? slashInsertionFor(item.action.text, remainder) : "";
  const caret = item.action.kind === "insert" ? (item.action.caret ?? insert.length) : 0;
  // ONE transaction, so a single undo takes the construct AND the `/query`
  // that asked for it — BEST EFFORT, not a guarantee: CodeMirror's history
  // joins on the `input.type.` prefix AND on `time - prevTime < 500ms`, so a
  // pause longer than that mid-menu leaves the typing and this apply as two
  // undo steps. Pinned as a known limit rather than papered over.
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

// Closing needs a TRANSACTION, and clicking out of the editor dispatches none:
// without this the menu stays on screen over an unfocused editor, and a later
// refocus + Enter applies a row the user armed minutes ago. `focusChangeEffect`
// is CodeMirror's own seam for exactly this — the alternative, a `blur` DOM
// handler, is what drag-freeze.ts uses for a window-level concern this is not.
const closeOnBlur = EditorView.focusChangeEffect.of((state, focusing) =>
  focusing || currentMenu(state) === null ? null : closeSlashMenu.of(null),
);

export function slashMenuExtension(config: SlashMenuConfig): Extension {
  return [
    slashVocabulary.of(config.items),
    slashMenuField,
    slashKeymap,
    closeOnBlur,
    slashMenuTheme,
  ];
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
