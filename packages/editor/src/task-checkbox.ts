import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { checkboxMarkerAt } from "@repo/notes/knowledge/source-lines";
import { foldableSyntaxFacet } from "./vendor/prosemark/lib/fold/core";

// The tick is drawn rather than tinted. A native checkbox answers only to
// `accent-color`, which leaves the platform's own control underneath: a
// saturated system blue and, in dark mode, a white box — the loudest thing on
// a page of desaturated zinc, and the one element that ignored the theme.
//
// The mark has to be a literal colour (a data URI cannot read a custom
// property), so it is a TOKEN, one per palette: the fill is the page's ink, so
// the tick is the page's ground.
const tick = (stroke: string): string =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M3.75 8.5 6.75 11.5 12.25 4.75' stroke='${stroke}' stroke-width='2.25' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;

const checkboxLightTokens: Record<string, string> = {
  "--editor-checkbox-line": "oklch(80% 0.008 260)",
  "--editor-checkbox-line-hover": "oklch(68% 0.012 260)",
  "--editor-checkbox-on": "oklch(44% 0.014 260)",
  "--editor-checkbox-tick": tick("%23ffffff"),
};

const checkboxDarkTokens: Record<string, string> = {
  "--editor-checkbox-line": "oklch(42% 0.012 260)",
  "--editor-checkbox-line-hover": "oklch(56% 0.016 260)",
  "--editor-checkbox-on": "oklch(80% 0.008 260)",
  "--editor-checkbox-tick": tick("%2318181b"),
};

// Light base, dark under the stamped `data-theme` — see the note in
// editor-theme.ts for why a media query cannot carry it.
const taskCheckboxTheme = EditorView.theme({
  "&": checkboxLightTokens,
  ':root[data-theme="dark"] &': checkboxDarkTokens,

  ".cm-task-checkbox": {
    appearance: "none",
    width: "1em",
    height: "1em",
    margin: "0 0.15em 0 0",
    verticalAlign: "-0.13em",
    cursor: "pointer",
    borderRadius: "0.3em",
    border: "1.5px solid var(--editor-checkbox-line)",
    backgroundColor: "transparent",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
    backgroundSize: "0.85em",
    transition: "background-color 120ms ease-out, border-color 120ms ease-out",
  },
  ".cm-task-checkbox:hover": {
    borderColor: "var(--editor-checkbox-line-hover)",
  },
  ".cm-task-checkbox:checked": {
    backgroundColor: "var(--editor-checkbox-on)",
    borderColor: "var(--editor-checkbox-on)",
    backgroundImage: "var(--editor-checkbox-tick)",
  },
  ".cm-task-checkbox:focus-visible": {
    outline: "2px solid var(--editor-accent, var(--editor-accent-fallback))",
    outlineOffset: "1px",
  },
});

class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement("input");
    element.type = "checkbox";
    element.className = "cm-task-checkbox";
    element.checked = this.checked;
    element.setAttribute("aria-label", "Toggle task");
    return element;
  }

  override ignoreEvent(_event: Event): boolean {
    // The editor-level handlers below own every event on the checkbox.
    return false;
  }
}

// TaskMarker -> Task -> ListItem; the replace range starts at the ListMark so
// the whole `- [x]` prefix renders as one checkbox.
const taskReplaceRange = (node: SyntaxNodeRef): { from: number; to: number } => {
  const listItem = node.node.parent?.parent;
  const listMark = listItem?.getChild("ListMark");
  return { from: listMark ? listMark.from : node.from, to: node.to };
};

const isTaskCheckbox = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement && target.classList.contains("cm-task-checkbox");

const toggleTaskAt = (view: EditorView, target: HTMLElement): boolean => {
  const pos = view.posAtDOM(target);
  const line = view.state.doc.lineAt(pos);
  // @repo/notes owns the one checkbox grammar; locating the state char through
  // it keeps this toggle in lockstep with the ordinals the projection counts.
  const marker = checkboxMarkerAt(line.text);
  if (marker === null) return false;
  const stateFrom = line.from + marker.checkboxIndex;
  view.dispatch({
    changes: {
      from: stateFrom,
      to: stateFrom + 1,
      insert: marker.checked ? " " : "x",
    },
    userEvent: "input.toggle-checkbox",
  });
  return true;
};

/**
 * Interactive task checkboxes: the `- [x]` prefix folds to a real
 * `<input type="checkbox">`; clicking it rewrites exactly one character in the
 * buffer (click, never mousedown — dragging off the box cancels; the checkbox
 * itself re-renders from the new document, so DOM state can never diverge).
 */
export const taskCheckboxExtension: Extension = [
  foldableSyntaxFacet.of({
    nodePath: "ListItem/Task/TaskMarker",
    buildDecorations: (state, node) => {
      const range = taskReplaceRange(node);
      const checked = state.doc.sliceString(node.from + 1, node.to - 1).toLowerCase() === "x";
      return Decoration.replace({
        widget: new TaskCheckboxWidget(checked),
      }).range(range.from, range.to);
    },
    unfoldZone: (_state, node) => taskReplaceRange(node),
  }),
  EditorView.domEventHandlers({
    // Swallow mousedown so the click cannot first move the caret into the
    // marker range, which would unfold the checkbox mid-click.
    mousedown: (event) => isTaskCheckbox(event.target),
    click: (event, view) => {
      if (!isTaskCheckbox(event.target)) return false;
      const toggled = toggleTaskAt(view, event.target);
      if (toggled) event.preventDefault();
      return toggled;
    },
  }),
  taskCheckboxTheme,
];
