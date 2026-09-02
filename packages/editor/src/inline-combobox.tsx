// Base UI's virtual focus keeps DOM focus on the input, so keyboard navigation
// never fights the editor. The value is plain synchronous state, never deferred:
// a transition between keystroke and controlled input reorders fast typing.

import * as React from "react";
import { Combobox } from "@base-ui/react/combobox";
import { filterWords } from "@platejs/combobox";
import { useHTMLInputCursorState } from "@platejs/combobox/react";
import { Hotkeys, isHotkey, type TElement } from "platejs";
import { useComposedRef, useEditorRef, useSelected } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

import {
  absorbRacedComboboxText,
  cancelComboboxInput,
  commitComboboxInput,
  racedComboboxText,
  reconcileInsertionCaret,
  type ComboboxCancelCause,
} from "@repo/editor/combobox-input";

type FilterItem = {
  value: string;
  group?: string | undefined;
  keywords?: string[] | undefined;
  label?: string | undefined;
};
export type FilterFn = (item: FilterItem, search: string) => boolean;

type InlineComboboxContextValue = {
  commit: (focusEditor: boolean) => void;
  filter: FilterFn | false;
  inputProps: {
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  };
  inputRef: React.RefObject<HTMLInputElement | null>;
  registerVisibleItem: () => () => void;
  setHasEmpty: (hasEmpty: boolean) => void;
  showTrigger: boolean;
  trigger: string;
  value: string;
  visibleCount: number;
};

const InlineComboboxContext = React.createContext<InlineComboboxContextValue | null>(null);

function useInlineComboboxContext(): InlineComboboxContextValue {
  const ctx = React.useContext(InlineComboboxContext);
  if (!ctx) throw new Error("InlineCombobox parts must be used inside <InlineCombobox>.");
  return ctx;
}

const defaultFilter: FilterFn = ({ group, keywords = [], label, value }, search) => {
  const terms = [value, ...keywords, group, label].filter((k): k is string => Boolean(k));
  return Array.from(new Set(terms)).some((keyword) => filterWords(keyword, search));
};

type InlineComboboxProps = {
  children: React.ReactNode;
  element: TElement;
  trigger: string;
  filter?: FilterFn | false;
  hideWhenNoValue?: boolean;
  showTrigger?: boolean;
  value?: string;
  setValue?: (value: string) => void;
};

function InlineCombobox({
  children,
  element,
  filter = defaultFilter,
  hideWhenNoValue = false,
  setValue: setValueProp,
  showTrigger = true,
  trigger,
  value: valueProp,
}: InlineComboboxProps) {
  const editor = useEditorRef();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cursorState = useHTMLInputCursorState(inputRef);

  const [valueState, setValueState] = React.useState("");
  const hasValueProp = valueProp !== undefined;
  const value = hasValueProp ? valueProp : valueState;

  const setValue = React.useCallback(
    (newValue: string) => {
      setValueProp?.(newValue);
      if (!hasValueProp) setValueState(newValue);
    },
    [setValueProp, hasValueProp],
  );

  const valueRef = React.useRef(value);
  React.useLayoutEffect(() => {
    valueRef.current = hasValueProp ? valueProp : valueState;
  }, [hasValueProp, valueProp, valueState]);

  // every cause after the first commit/cancel is a no-op: a second restore duplicates the trigger text
  const closedRef = React.useRef(false);

  const cancel = React.useCallback(
    (cause: ComboboxCancelCause) => {
      if (closedRef.current) return;
      closedRef.current = true;
      cancelComboboxInput(editor, element, {
        cause,
        restoreText: trigger + valueRef.current,
      });
      editor.tf.focus();
    },
    [editor, element, trigger],
  );

  const commit = React.useCallback(
    (focusEditor: boolean) => {
      if (closedRef.current) return;
      closedRef.current = true;
      commitComboboxInput(editor, element, focusEditor);
    },
    [editor, element],
  );

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keystrokes that beat the input's focus land in the element's hidden text
  // child; each batch is spliced at the input caret, cleared from Slate and focus retaken.
  const raced = racedComboboxText(element);
  const pendingCaretRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (closedRef.current || raced.length === 0) return;
    const absorbed = absorbRacedComboboxText(editor, element);
    if (absorbed.length === 0) return;
    const input = inputRef.current;
    const current = valueRef.current;
    const caret = input?.selectionStart ?? current.length;
    setValue(current.slice(0, caret) + absorbed + current.slice(caret));
    pendingCaretRef.current = caret + absorbed.length;
    input?.focus();
  }, [raced, editor, element, setValue]);
  React.useLayoutEffect(() => {
    const pos = pendingCaretRef.current;
    if (pos === null) return;
    pendingCaretRef.current = null;
    inputRef.current?.setSelectionRange(pos, pos);
  });

  const onInputValueChange = React.useCallback(
    (nextValue: string) => {
      const input = inputRef.current;
      if (input && document.activeElement === input) {
        const fixed = reconcileInsertionCaret(valueRef.current, nextValue, input.selectionStart);
        if (fixed !== null) input.setSelectionRange(fixed, fixed);
      }
      setValue(nextValue);
    },
    [setValue],
  );

  const selected = useSelected();
  const previousSelected = React.useRef(selected);
  React.useEffect(() => {
    if (previousSelected.current && !selected) cancel("deselect");
    previousSelected.current = selected;
  }, [selected, cancel]);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (isHotkey("escape", event)) {
        event.preventDefault();
        cancel("escape");
        return;
      }
      if (cursorState.atStart && isHotkey("backspace", event)) {
        event.preventDefault();
        cancel("backspace");
        return;
      }
      if (cursorState.atStart && isHotkey("arrowleft", event)) {
        event.preventDefault();
        cancel("arrowLeft");
        return;
      }
      if (cursorState.atEnd && isHotkey("arrowright", event)) {
        event.preventDefault();
        cancel("arrowRight");
        return;
      }
      const isUndo = Hotkeys.isUndo(event) && editor.history.undos.length > 0;
      const isRedo = Hotkeys.isRedo(event) && editor.history.redos.length > 0;
      if (isUndo || isRedo) {
        event.preventDefault();
        if (isUndo) editor.undo();
        else editor.redo();
        editor.tf.focus();
      }
    },
    [cancel, cursorState.atStart, cursorState.atEnd, editor],
  );

  const inputProps = React.useMemo(() => ({ onKeyDown }), [onKeyDown]);

  // items self-filter to null and register when visible, so open state and the Empty row share one count
  const [visibleCount, setVisibleCount] = React.useState(0);
  const registerVisibleItem = React.useCallback(() => {
    setVisibleCount((count) => count + 1);
    return () => setVisibleCount((count) => count - 1);
  }, []);
  const [hasEmpty, setHasEmpty] = React.useState(false);

  const open = (visibleCount > 0 || hasEmpty) && (!hideWhenNoValue || value.length > 0);

  const contextValue = React.useMemo<InlineComboboxContextValue>(
    () => ({
      commit,
      filter,
      inputProps,
      inputRef,
      registerVisibleItem,
      setHasEmpty,
      showTrigger,
      trigger,
      value,
      visibleCount,
    }),
    [commit, filter, inputProps, registerVisibleItem, showTrigger, trigger, value, visibleCount],
  );

  // onOpenChange is a no-op: open is derived, and Base UI's escape/outside-click close requests route through cancel
  return (
    <span contentEditable={false}>
      <Combobox.Root
        autoHighlight
        filter={null}
        inputValue={value}
        modal={false}
        onInputValueChange={onInputValueChange}
        onOpenChange={() => undefined}
        open={open}
      >
        <InlineComboboxContext value={contextValue}>{children}</InlineComboboxContext>
      </Combobox.Root>
    </span>
  );
}

function InlineComboboxInput({
  className,
  ref: refProp,
  placeholder,
}: {
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
  placeholder?: string;
}) {
  const {
    inputProps,
    inputRef: contextRef,
    showTrigger,
    trigger,
    value,
  } = useInlineComboboxContext();
  const ref = useComposedRef(refProp, contextRef);

  return (
    <>
      {showTrigger && trigger}
      <span className="relative min-h-[1lh]">
        <span aria-hidden="true" className="invisible overflow-hidden text-nowrap">
          {value || placeholder || "​"}
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
}

const ITEM_BASE =
  "relative mx-1 flex select-none items-center rounded-md px-2 py-1 text-sm text-foreground outline-hidden transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";
const ITEM_INTERACTIVE =
  "cursor-pointer hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

function InlineComboboxContent({
  className,
  variant = "default",
  children,
}: {
  className?: string;
  variant?: "default" | "slash";
  children: React.ReactNode;
}) {
  // keepMounted keeps closed popups' items registered so the derived open state can flip true.
  // Popup motion only, no per-item beat: the list remounts its children on every keystroke.
  return (
    <Combobox.Portal keepMounted>
      <Combobox.Positioner align="start" className="z-50" side="bottom" sideOffset={4}>
        <Combobox.Popup
          className={cn(
            "bloom-popup max-h-[40vh] min-w-[180px] max-w-[calc(100vw-24px)] origin-[var(--transform-origin)] overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-surface-4",
            variant === "slash" && "w-[320px]",
            className,
          )}
        >
          <Combobox.List>{children}</Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  );
}

function InlineComboboxItem({
  className,
  focusEditor = true,
  group,
  keywords,
  label,
  onClick,
  value,
  children,
}: {
  className?: string;
  focusEditor?: boolean | undefined;
  group?: string | undefined;
  keywords?: string[] | undefined;
  label?: string | undefined;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  value: string;
  children: React.ReactNode;
}) {
  const { commit, filter, registerVisibleItem, value: search } = useInlineComboboxContext();

  const visible = React.useMemo(
    () => !filter || filter({ group, keywords, label, value }, search),
    [filter, group, keywords, value, label, search],
  );

  React.useEffect(() => {
    if (visible) return registerVisibleItem();
    return undefined;
  }, [visible, registerVisibleItem]);

  if (!visible) return null;

  // Base UI dispatches a click for Enter on the highlighted item, so onClick covers the keyboard path
  return (
    <Combobox.Item
      className={cn(ITEM_BASE, ITEM_INTERACTIVE, className)}
      onClick={(event) => {
        commit(focusEditor);
        onClick?.(event);
      }}
      value={value}
    >
      {children}
    </Combobox.Item>
  );
}

function InlineComboboxEmpty({ children, className }: React.HTMLAttributes<HTMLDivElement>) {
  const { setHasEmpty, visibleCount } = useInlineComboboxContext();

  React.useEffect(() => {
    setHasEmpty(true);
    return () => setHasEmpty(false);
  }, [setHasEmpty]);

  if (visibleCount > 0) return null;

  return <div className={cn(ITEM_BASE, "my-1.5 text-muted-foreground", className)}>{children}</div>;
}

function InlineComboboxGroup({ className, ...props }: React.ComponentProps<typeof Combobox.Group>) {
  return (
    <Combobox.Group
      className={cn("hidden py-1.5 not-last:border-b [&:has([role=option])]:block", className)}
      {...props}
    />
  );
}

function InlineComboboxGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof Combobox.GroupLabel>) {
  return (
    <Combobox.GroupLabel
      className={cn("mt-1.5 mb-2 px-3 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
};
