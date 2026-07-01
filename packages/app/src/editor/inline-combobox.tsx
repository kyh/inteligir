// Inline combobox for the slash menu — adapted from Potion's Plate-UI component
// (registry/ui/inline-combobox.tsx), built on @platejs/combobox + Ariakit. The
// Yjs "is creator" gate is removed (single-user, local vault) and the code is
// reshaped to our lint rules (no any / non-null assertion / type assertion).

import * as Ariakit from "@ariakit/react";
import { filterWords } from "@platejs/combobox";
import {
  type UseComboboxInputResult,
  useComboboxInput,
  useHTMLInputCursorState,
} from "@platejs/combobox/react";
import type { Point, TElement } from "platejs";
import { useComposedRef, useEditorRef } from "platejs/react";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

type FilterItem = {
  value: string;
  group?: string | undefined;
  keywords?: string[] | undefined;
  label?: string | undefined;
};
type FilterFn = (item: FilterItem, search: string) => boolean;

type InlineComboboxContextValue = {
  filter: FilterFn | false;
  inputProps: UseComboboxInputResult["props"];
  inputRef: React.RefObject<HTMLInputElement | null>;
  removeInput: UseComboboxInputResult["removeInput"];
  showTrigger: boolean;
  trigger: string;
  setHasEmpty: (hasEmpty: boolean) => void;
};

const InlineComboboxContext = React.createContext<InlineComboboxContextValue | null>(null);

function useInlineComboboxContext(): InlineComboboxContextValue {
  const ctx = React.useContext(InlineComboboxContext);
  if (!ctx) throw new Error("InlineCombobox parts must be used inside <InlineCombobox>.");
  return ctx;
}

function useComboboxStore(): Ariakit.ComboboxStore {
  const store = Ariakit.useComboboxContext();
  if (!store) throw new Error("Combobox store is missing.");
  return store;
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

  const insertPoint = React.useRef<Point | null>(null);

  React.useEffect(() => {
    const path = editor.api.findPath(element);
    if (!path) return;
    const point = editor.api.before(path);
    if (!point) return;
    const pointRef = editor.api.pointRef(point);
    insertPoint.current = pointRef.current;
    return () => {
      pointRef.unref();
    };
  }, [editor, element]);

  const { props: inputProps, removeInput } = useComboboxInput({
    cancelInputOnBlur: false,
    cursorState,
    autoFocus: true,
    ref: inputRef,
    onCancelInput: (cause) => {
      if (cause !== "backspace") {
        const at = insertPoint.current;
        editor.tf.insertText(trigger + value, at ? { at } : {});
      }
      if (cause === "arrowLeft" || cause === "arrowRight") {
        editor.tf.move({ distance: 1, reverse: cause === "arrowLeft" });
      }
    },
  });

  const [hasEmpty, setHasEmpty] = React.useState(false);

  const contextValue = React.useMemo<InlineComboboxContextValue>(
    () => ({ filter, inputProps, inputRef, removeInput, setHasEmpty, showTrigger, trigger }),
    [trigger, showTrigger, filter, inputProps, removeInput],
  );

  const store = Ariakit.useComboboxStore({
    setValue: (newValue) => React.startTransition(() => setValue(newValue)),
  });
  const items = store.useState("items");

  return (
    <span contentEditable={false}>
      <Ariakit.ComboboxProvider
        open={(items.length > 0 || hasEmpty) && (!hideWhenNoValue || value.length > 0)}
        store={store}
      >
        <InlineComboboxContext.Provider value={contextValue}>
          {children}
        </InlineComboboxContext.Provider>
      </Ariakit.ComboboxProvider>
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
  const { inputProps, inputRef: contextRef, showTrigger, trigger } = useInlineComboboxContext();
  const store = useComboboxStore();
  const value = store.useState("value");
  const ref = useComposedRef(refProp, contextRef);

  return (
    <>
      {showTrigger && trigger}
      <span className="relative min-h-[1lh]">
        <span aria-hidden="true" className="invisible overflow-hidden text-nowrap">
          {value || placeholder || "​"}
        </span>
        <Ariakit.Combobox
          autoSelect
          className={cn("absolute top-0 left-0 size-full bg-transparent outline-hidden", className)}
          value={value}
          {...inputProps}
          ref={ref}
          placeholder={placeholder}
        />
      </span>
    </>
  );
}

const ITEM_BASE =
  "relative mx-1 flex select-none items-center rounded-sm px-2 py-1 text-sm text-foreground outline-hidden transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";
const ITEM_INTERACTIVE =
  "cursor-pointer hover:bg-accent hover:text-accent-foreground data-[active-item=true]:bg-accent data-[active-item=true]:text-accent-foreground";

function InlineComboboxContent({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof Ariakit.ComboboxPopover> & { variant?: "default" | "slash" }) {
  return (
    <Ariakit.Portal>
      <Ariakit.ComboboxPopover
        className={cn(
          "z-50 mt-1 h-full max-h-[40vh] min-w-[180px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
          variant === "slash" && "w-[320px]",
          className,
        )}
        {...props}
      >
        {props.children}
      </Ariakit.ComboboxPopover>
    </Ariakit.Portal>
  );
}

function InlineComboboxItem({
  className,
  focusEditor = true,
  group,
  keywords,
  label,
  onClick,
  ...props
}: {
  focusEditor?: boolean | undefined;
  group?: string | undefined;
  keywords?: string[] | undefined;
  label?: string | undefined;
} & Ariakit.ComboboxItemProps &
  Required<Pick<Ariakit.ComboboxItemProps, "value">>) {
  const { value } = props;
  const { filter, removeInput } = useInlineComboboxContext();
  const store = useComboboxStore();
  const search = filter && store.useState("value");

  const visible = React.useMemo(
    () => !filter || filter({ group, keywords, label, value }, search || ""),
    [filter, group, keywords, value, label, search],
  );

  if (!visible) return null;

  return (
    <Ariakit.ComboboxItem
      className={cn(ITEM_BASE, ITEM_INTERACTIVE, className)}
      onClick={(event) => {
        removeInput(focusEditor);
        onClick?.(event);
      }}
      {...props}
    />
  );
}

function InlineComboboxEmpty({ children, className }: React.HTMLAttributes<HTMLDivElement>) {
  const { setHasEmpty } = useInlineComboboxContext();
  const store = useComboboxStore();
  const items = store.useState("items");

  React.useEffect(() => {
    setHasEmpty(true);
    return () => setHasEmpty(false);
  }, [setHasEmpty]);

  if (items.length > 0) return null;

  return <div className={cn(ITEM_BASE, "my-1.5 text-muted-foreground", className)}>{children}</div>;
}

function InlineComboboxGroup({
  className,
  ...props
}: React.ComponentProps<typeof Ariakit.ComboboxGroup>) {
  return (
    <Ariakit.ComboboxGroup
      className={cn("hidden py-1.5 not-last:border-b [&:has([role=option])]:block", className)}
      {...props}
    />
  );
}

function InlineComboboxGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof Ariakit.ComboboxGroupLabel>) {
  return (
    <Ariakit.ComboboxGroupLabel
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
