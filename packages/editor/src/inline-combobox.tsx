// The picker a trigger opens in the text, over Base UI's Autocomplete as the palette is built: its
// rows are data handed to the root, which narrows them by the query, drops a group left empty,
// lights the first and says when none is left. Base UI's virtual focus keeps DOM focus on the
// input, so keyboard navigation never fights the editor. The query is plain synchronous state,
// never deferred: a transition between keystroke and controlled input reorders fast typing.

import * as React from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { filterWords } from "@platejs/combobox";
import { useHTMLInputCursorState } from "@platejs/combobox/react";
import { Hotkeys } from "platejs";
import type { TElement } from "platejs";
import { useEditorRef, useSelected } from "platejs/react";
import type { PlateEditor } from "platejs/react";

import { cn } from "@repo/ui/lib/cn";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";

import {
  absorbRacedComboboxText,
  cancelComboboxInput,
  commitComboboxInput,
  ownsPicker,
  racedComboboxText,
  reconcileInsertionCaret,
} from "@repo/editor/headless/combobox-input";
import type { ComboboxCancelCause } from "@repo/editor/headless/combobox-input";
import { matchesHotkey } from "@repo/editor/editor-shortcuts";
import { undoStackSizes } from "@repo/editor/item/yjs-binding";

// a row a picker lists, unique in it by `value`, and what picking it writes
export interface PickerRow {
  readonly value: string;
  readonly onSelect: (editor: PlateEditor) => void;
}

// rows under their heading; a picker of one list hands one group with none
interface PickerGroup<Row extends PickerRow> {
  readonly group?: string | undefined;
  readonly items: readonly Row[];
}

// whether a row's words answer the query, word by word, as Plate's pickers match
export const matchesWords = (words: readonly (string | undefined)[], query: string): boolean =>
  words.some((word) => word !== undefined && filterWords(word, query));

// Typing `suffix` after words closes the picker on them: `words` reads the text typed before it,
// and a blank answer leaves the suffix typed into the query.
interface ComboboxCloser {
  readonly suffix: string;
  readonly words: (typed: string) => string;
  readonly pick: (words: string) => void;
}

interface InlineComboboxProps<Row extends PickerRow> {
  readonly element: TElement;
  readonly trigger: string;
  readonly groups: readonly PickerGroup<Row>[];
  // narrows the rows by the query, or null where they are already what the query found
  readonly filter: ((row: Row, query: string) => boolean) | null;
  // what the popup says while no row is left
  readonly empty: React.ReactNode;
  // a row's body
  readonly children: (row: Row) => React.ReactNode;
  // the query, where the caller ranks its rows by it
  readonly query?: { readonly value: string; readonly onChange: (value: string) => void };
  readonly closeOn?: ComboboxCloser;
  readonly variant?: "default" | "slash";
}

const ITEM_BASE =
  "relative mx-1 flex select-none items-center rounded-md px-2 py-1 text-body text-foreground outline-hidden transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";
const ITEM_INTERACTIVE =
  "cursor-pointer hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

const OwnedCombobox = <Row extends PickerRow>({
  children,
  closeOn,
  element,
  empty,
  filter,
  groups,
  query: queryProp,
  trigger,
  variant = "default",
}: InlineComboboxProps<Row>) => {
  const editor = useEditorRef();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cursorState = useHTMLInputCursorState(inputRef);

  const [ownQuery, setOwnQuery] = React.useState("");
  const query = queryProp?.value ?? ownQuery;
  const setQuery = queryProp?.onChange ?? setOwnQuery;

  // every cause after the first commit/cancel is a no-op: a second restore duplicates the trigger text
  const closedRef = React.useRef(false);

  const cancel = (cause: ComboboxCancelCause) => {
    if (closedRef.current) {
      return;
    }
    closedRef.current = true;
    cancelComboboxInput(editor, element, { cause, restoreText: trigger + query });
    editor.tf.focus();
  };

  const commit = () => {
    if (closedRef.current) {
      return;
    }
    closedRef.current = true;
    commitComboboxInput(editor, element, true);
  };

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keystrokes that beat the input's focus land in the element's hidden text child
  // (PickerRaceKit). Each batch is cleared from Slate and typed into the input as the browser types,
  // since Base UI narrows and highlights only on the input's own change: a query set from here
  // would leave Enter no row to pick.
  const raced = racedComboboxText(element);
  React.useEffect(() => {
    const input = inputRef.current;
    if (closedRef.current || raced.length === 0 || input === null) {
      return;
    }
    const absorbed = absorbRacedComboboxText(editor, element);
    if (absorbed.length === 0) {
      return;
    }
    input.focus();
    // oxlint-disable-next-line typescript/no-deprecated -- the one way to type into an input as the browser does, its input event and undo step included
    input.ownerDocument.execCommand("insertText", false, absorbed);
  }, [raced, editor, element]);

  const onValueChange = (next: string, details: Autocomplete.Root.ChangeEventDetails) => {
    // a picked row writes itself; it never becomes the query
    if (details.reason === "item-press") {
      return;
    }
    if (closeOn !== undefined && next.endsWith(closeOn.suffix)) {
      const words = closeOn.words(next.slice(0, -closeOn.suffix.length));
      if (words !== "") {
        commit();
        closeOn.pick(words);
        return;
      }
    }
    const input = inputRef.current;
    if (input && document.activeElement === input) {
      const fixed = reconcileInsertionCaret(query, next, input.selectionStart);
      if (fixed !== null) {
        input.setSelectionRange(fixed, fixed);
      }
    }
    setQuery(next);
  };

  const onDeselect = React.useEffectEvent(() => {
    cancel("deselect");
  });
  const selected = useSelected();
  const previousSelected = React.useRef(selected);
  React.useEffect(() => {
    if (previousSelected.current && !selected) {
      onDeselect();
    }
    previousSelected.current = selected;
  }, [selected]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (matchesHotkey("escape", event)) {
      event.preventDefault();
      cancel("escape");
      return;
    }
    if (cursorState.atStart && matchesHotkey("backspace", event)) {
      event.preventDefault();
      cancel("backspace");
      return;
    }
    if (cursorState.atStart && matchesHotkey("arrowleft", event)) {
      event.preventDefault();
      cancel("arrowLeft");
      return;
    }
    if (cursorState.atEnd && matchesHotkey("arrowright", event)) {
      event.preventDefault();
      cancel("arrowRight");
      return;
    }
    const { undos, redos } = undoStackSizes(editor);
    const isUndo = Hotkeys.isUndo(event) && undos > 0;
    const isRedo = Hotkeys.isRedo(event) && redos > 0;
    if (isUndo || isRedo) {
      event.preventDefault();
      if (isUndo) {
        editor.undo();
      } else {
        editor.redo();
      }
      editor.tf.focus();
    }
  };

  // Base UI runs an item's click for Enter on the lit row too, so this is the keyboard's pick
  const pick = (row: Row) => {
    commit();
    row.onSelect(editor);
  };

  // Open for as long as the picker stands in the text: Base UI's escape and outside-press close
  // requests go unheard, since its keys and a deselect close it through `cancel`. Popup motion
  // only, no per-row beat: a row narrowed away and back mounts afresh as one types.
  return (
    <span contentEditable={false}>
      <Autocomplete.Root
        autoHighlight
        filter={filter}
        items={groups}
        onValueChange={onValueChange}
        open
        value={query}
      >
        {trigger}
        <span className="relative min-h-[1lh]">
          <span aria-hidden="true" className="invisible overflow-hidden text-nowrap">
            {query || "​"}
          </span>
          <Autocomplete.Input
            className="absolute top-0 left-0 size-full bg-transparent outline-hidden"
            onKeyDown={onKeyDown}
            ref={inputRef}
          />
        </span>
        <Autocomplete.Portal>
          <Autocomplete.Positioner align="start" className="z-50" side="bottom" sideOffset={4}>
            <Autocomplete.Popup
              className={cn(
                "bloom-popup max-h-[40vh] min-w-[180px] max-w-[calc(100vw-24px)] origin-[var(--transform-origin)] overflow-y-auto rounded-lg text-popover-foreground",
                surfaceClasses(3),
                variant === "slash" && "w-[320px]",
              )}
            >
              <Autocomplete.Empty>
                <div className={cn(ITEM_BASE, "my-1.5 text-muted-foreground")}>{empty}</div>
              </Autocomplete.Empty>
              <Autocomplete.List>
                {(group: PickerGroup<Row>) => (
                  <Autocomplete.Group
                    key={group.group ?? ""}
                    className="py-1.5 not-last:border-b"
                    items={group.items}
                  >
                    {group.group === undefined ? null : (
                      <Autocomplete.GroupLabel className="mt-1.5 mb-2 px-3 text-caption font-medium text-muted-foreground">
                        {group.group}
                      </Autocomplete.GroupLabel>
                    )}
                    <Autocomplete.Collection>
                      {(row: Row) => (
                        <Autocomplete.Item
                          key={row.value}
                          className={cn(ITEM_BASE, ITEM_INTERACTIVE)}
                          onClick={() => {
                            pick(row);
                          }}
                          value={row}
                        >
                          {children(row)}
                        </Autocomplete.Item>
                      )}
                    </Autocomplete.Collection>
                  </Autocomplete.Group>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </span>
  );
};

// Another device's open picker draws as its trigger alone: its query is that device's, and an input
// here would take the caret into it.
export const InlineCombobox = <Row extends PickerRow>(props: InlineComboboxProps<Row>) => {
  const editor = useEditorRef();
  return ownsPicker(editor, props.element) ? (
    <OwnedCombobox {...props} />
  ) : (
    <span contentEditable={false}>{props.trigger}</span>
  );
};
