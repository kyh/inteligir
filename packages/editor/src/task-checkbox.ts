import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { checkboxMarkerAt } from "@repo/notes/knowledge/source-lines";
import { foldableSyntaxFacet } from "./vendor/prosemark/lib/fold/core";

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
];
