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
  racedComboboxText,
  reconcileInsertionCaret,
} from "@repo/editor/headless/combobox-input";
import type { ComboboxCancelCause } from "@repo/editor/headless/combobox-input";
import { matchesHotkey } from "@repo/editor/editor-shortcuts";

export interface PickerRow {
  readonly value: string;
  readonly onSelect: (editor: PlateEditor) => void;
}

interface PickerGroup<Row extends PickerRow> {
  readonly group?: string | undefined;
  readonly items: readonly Row[];
}

export const matchesWords = (words: readonly (string | undefined)[], query: string) =>
  words.some((word) => word !== undefined && filterWords(word, query));

interface ComboboxCloser {
  readonly suffix: string;
  readonly words: (typed: string) => string;
  readonly pick: (words: string) => void;
}

interface InlineComboboxProps<Row extends PickerRow> {
  readonly element: TElement;
  readonly trigger: string;
  readonly groups: readonly PickerGroup<Row>[];
  readonly filter: ((row: Row, query: string) => boolean) | null;
  readonly empty: React.ReactNode;
  readonly children: (row: Row) => React.ReactNode;
  readonly query?: { readonly value: string; readonly onChange: (value: string) => void };
  readonly closeOn?: ComboboxCloser;
  readonly variant?: "default" | "slash";
}

const ITEM_BASE =
  "relative mx-1 flex select-none items-center rounded-md px-2 py-1 text-body text-foreground outline-hidden transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

const ITEM_INTERACTIVE =
  "cursor-pointer hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

export const InlineCombobox = <Row extends PickerRow>({
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

    const { undos, redos } = editor.history;
    const isUndo = Hotkeys.isUndo(event) && undos.length > 0;
    const isRedo = Hotkeys.isRedo(event) && redos.length > 0;

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

  const pick = (row: Row) => {
    commit();
    row.onSelect(editor);
  };

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
