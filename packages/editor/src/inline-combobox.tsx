// Base UI's virtual focus keeps DOM focus on the input, so keyboard navigation
// never fights the editor. The value is plain synchronous state, never deferred:
// a transition between keystroke and controlled input reorders fast typing.

import * as React from "react";
import { Combobox } from "@base-ui/react/combobox";
import { filterWords } from "@platejs/combobox";
import { useHTMLInputCursorState } from "@platejs/combobox/react";
import { Hotkeys } from "platejs";
import type { TElement } from "platejs";
import { useComposedRef, useEditorRef, useSelected } from "platejs/react";

import { cn } from "@repo/ui/lib/cn";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";

import {
  absorbRacedComboboxText,
  cancelComboboxInput,
  commitComboboxInput,
  racedComboboxText,
  reconcileInsertionCaret,
} from "@repo/editor/combobox-input";
import type { ComboboxCancelCause } from "@repo/editor/combobox-input";
import { matchesHotkey } from "@repo/editor/editor-shortcuts";
import { ownsPicker } from "@repo/editor/live/picker-owner";
import { undoStackSizes } from "@repo/editor/live/yjs-binding";

interface FilterItem {
  value: string;
  group?: string | undefined;
  keywords?: string[] | undefined;
  label?: string | undefined;
}
type FilterFn = (item: FilterItem, search: string) => boolean;

interface InlineComboboxContextValue {
  commit: () => void;
  filter: FilterFn | false;
  inputProps: {
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  };
  inputRef: React.RefObject<HTMLInputElement | null>;
  registerVisibleItem: () => () => void;
  setHasEmpty: (hasEmpty: boolean) => void;
  trigger: string;
  value: string;
  visibleCount: number;
}

const InlineComboboxContext = React.createContext<InlineComboboxContextValue | null>(null);

const useInlineComboboxContext = (): InlineComboboxContextValue => {
  const ctx = React.useContext(InlineComboboxContext);
  if (!ctx) {
    throw new Error("InlineCombobox parts must be used inside <InlineCombobox>.");
  }
  return ctx;
};

const defaultFilter: FilterFn = ({ group, keywords = [], label, value }, search) => {
  const terms = [value, ...keywords, group, label].filter((k): k is string => Boolean(k));
  return [...new Set(terms)].some((keyword) => filterWords(keyword, search));
};

// Typing `suffix` after words closes the picker on them: `words` reads the text typed before it,
// and a blank answer leaves the suffix typed into the query.
interface ComboboxCloser {
  readonly suffix: string;
  readonly words: (typed: string) => string;
  readonly pick: (words: string) => void;
}

interface InlineComboboxProps {
  children: React.ReactNode;
  element: TElement;
  trigger: string;
  filter?: FilterFn | false;
  value?: string;
  setValue?: (value: string) => void;
  closeOn?: ComboboxCloser;
}

const OwnedCombobox = ({
  children,
  closeOn,
  element,
  filter = defaultFilter,
  setValue: setValueProp,
  trigger,
  value: valueProp,
}: InlineComboboxProps) => {
  const editor = useEditorRef();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cursorState = useHTMLInputCursorState(inputRef);

  const [valueState, setValueState] = React.useState("");
  const hasValueProp = valueProp !== undefined;
  const value = hasValueProp ? valueProp : valueState;

  const setValue = (newValue: string) => {
    setValueProp?.(newValue);
    if (!hasValueProp) {
      setValueState(newValue);
    }
  };

  const valueRef = React.useRef(value);
  React.useLayoutEffect(() => {
    valueRef.current = hasValueProp ? valueProp : valueState;
  }, [hasValueProp, valueProp, valueState]);

  // every cause after the first commit/cancel is a no-op: a second restore duplicates the trigger text
  const closedRef = React.useRef(false);

  const cancel = React.useCallback(
    (cause: ComboboxCancelCause) => {
      if (closedRef.current) {
        return;
      }
      closedRef.current = true;
      cancelComboboxInput(editor, element, {
        cause,
        restoreText: trigger + valueRef.current,
      });
      editor.tf.focus();
    },
    [editor, element, trigger],
  );

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

  const onInputValueChange = (nextValue: string) => {
    if (closeOn !== undefined && nextValue.endsWith(closeOn.suffix)) {
      const words = closeOn.words(nextValue.slice(0, -closeOn.suffix.length));
      if (words !== "") {
        commit();
        closeOn.pick(words);
        return;
      }
    }
    const input = inputRef.current;
    if (input && document.activeElement === input) {
      const fixed = reconcileInsertionCaret(valueRef.current, nextValue, input.selectionStart);
      if (fixed !== null) {
        input.setSelectionRange(fixed, fixed);
      }
    }
    setValue(nextValue);
  };

  const selected = useSelected();
  const previousSelected = React.useRef(selected);
  React.useEffect(() => {
    if (previousSelected.current && !selected) {
      cancel("deselect");
    }
    previousSelected.current = selected;
  }, [selected, cancel]);

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

  // items self-filter to null and register when visible, so open state and the Empty row share one count
  const [visibleCount, setVisibleCount] = React.useState(0);
  const registerVisibleItem = () => {
    setVisibleCount((count) => count + 1);
    return () => {
      setVisibleCount((count) => count - 1);
    };
  };
  const [hasEmpty, setHasEmpty] = React.useState(false);

  const open = visibleCount > 0 || hasEmpty;

  const contextValue: InlineComboboxContextValue = {
    commit,
    filter,
    inputProps: { onKeyDown },
    inputRef,
    registerVisibleItem,
    setHasEmpty,
    trigger,
    value,
    visibleCount,
  };

  // no onOpenChange: open is derived, and Base UI's escape/outside-click close requests route through cancel
  return (
    <span contentEditable={false}>
      <Combobox.Root
        autoHighlight
        filter={null}
        inputValue={value}
        modal={false}
        onInputValueChange={onInputValueChange}
        open={open}
      >
        <InlineComboboxContext value={contextValue}>{children}</InlineComboboxContext>
      </Combobox.Root>
    </span>
  );
};

// Another device's open picker draws as its trigger alone: its query is that device's, and an input
// here would take the caret into it.
const InlineCombobox = (props: InlineComboboxProps) => {
  const editor = useEditorRef();
  return ownsPicker(editor, props.element) ? (
    <OwnedCombobox {...props} />
  ) : (
    <span contentEditable={false}>{props.trigger}</span>
  );
};

const InlineComboboxInput = ({
  className,
  ref: refProp,
  placeholder,
}: {
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
  placeholder?: string;
}) => {
  const { inputProps, inputRef: contextRef, trigger, value } = useInlineComboboxContext();
  const ref = useComposedRef(refProp, contextRef);

  return (
    <>
      {trigger}
      <span className="relative min-h-[1lh]">
        <span aria-hidden="true" className="invisible overflow-hidden text-nowrap">
          {(value || placeholder) ?? "​"}
        </span>
        <Combobox.Input
          className={cn("absolute top-0 left-0 size-full bg-transparent outline-hidden", className)}
          {...inputProps}
          ref={ref}
          placeholder={placeholder}
        />
      </span>
    </>
  );
};

const ITEM_BASE =
  "relative mx-1 flex select-none items-center rounded-md px-2 py-1 text-body text-foreground outline-hidden transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";
const ITEM_INTERACTIVE =
  "cursor-pointer hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

const InlineComboboxContent = ({
  className,
  variant = "default",
  children,
}: {
  className?: string;
  variant?: "default" | "slash";
  children: React.ReactNode;
}) => (
  // keepMounted keeps closed popups' items registered so the derived open state can flip true.
  // Popup motion only, no per-item beat: the list remounts its children on every keystroke.
  <Combobox.Portal keepMounted>
    <Combobox.Positioner align="start" className="z-50" side="bottom" sideOffset={4}>
      <Combobox.Popup
        className={cn(
          "bloom-popup max-h-[40vh] min-w-[180px] max-w-[calc(100vw-24px)] origin-[var(--transform-origin)] overflow-y-auto rounded-lg text-popover-foreground",
          surfaceClasses(3),
          variant === "slash" && "w-[320px]",
          className,
        )}
      >
        <Combobox.List>{children}</Combobox.List>
      </Combobox.Popup>
    </Combobox.Positioner>
  </Combobox.Portal>
);

const InlineComboboxItem = ({
  className,
  group,
  keywords,
  label,
  onClick,
  value,
  children,
}: {
  className?: string;
  group?: string | undefined;
  keywords?: string[] | undefined;
  label?: string | undefined;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  value: string;
  children: React.ReactNode;
}) => {
  const { commit, filter, registerVisibleItem, value: search } = useInlineComboboxContext();

  const visible = filter === false || filter({ group, keywords, label, value }, search);

  React.useEffect(() => {
    if (visible) {
      return registerVisibleItem();
    }
  }, [visible, registerVisibleItem]);

  if (!visible) {
    return null;
  }

  // Base UI dispatches a click for Enter on the highlighted item, so onClick covers the keyboard path
  return (
    <Combobox.Item
      className={cn(ITEM_BASE, ITEM_INTERACTIVE, className)}
      onClick={(event) => {
        commit();
        onClick?.(event);
      }}
      value={value}
    >
      {children}
    </Combobox.Item>
  );
};

const InlineComboboxEmpty = ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => {
  const { setHasEmpty, visibleCount } = useInlineComboboxContext();

  React.useEffect(() => {
    setHasEmpty(true);
    return () => {
      setHasEmpty(false);
    };
  }, [setHasEmpty]);

  if (visibleCount > 0) {
    return null;
  }

  return <div className={cn(ITEM_BASE, "my-1.5 text-muted-foreground", className)}>{children}</div>;
};

const InlineComboboxGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof Combobox.Group>) => (
  <Combobox.Group
    className={cn("hidden py-1.5 not-last:border-b [&:has([role=option])]:block", className)}
    {...props}
  />
);

const InlineComboboxGroupLabel = ({
  className,
  ...props
}: React.ComponentProps<typeof Combobox.GroupLabel>) => (
  <Combobox.GroupLabel
    className={cn("mt-1.5 mb-2 px-3 text-caption font-medium text-muted-foreground", className)}
    {...props}
  />
);

export {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
};
