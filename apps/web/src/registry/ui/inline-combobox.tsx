'use client';

import { filterWords } from '@platejs/combobox';
import {
  type UseComboboxInputResult,
  useComboboxInput,
  useHTMLInputCursorState,
} from '@platejs/combobox/react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { Point, TElement } from 'platejs';
import { useComposedRef, useEditorRef } from 'platejs/react';
import type { HTMLAttributes, ReactNode, RefObject } from 'react';
import React, { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Ariakit } from './menu';

type FilterFn = (
  item: { value: string; group?: string; keywords?: string[]; label?: string },
  search: string
) => boolean;

type InlineComboboxContextValue = {
  filter: FilterFn | false;
  inputProps: UseComboboxInputResult['props'];
  inputRef: RefObject<HTMLInputElement | null>;
  removeInput: UseComboboxInputResult['removeInput'];
  showTrigger: boolean;
  trigger: string;
  setHasEmpty: (hasEmpty: boolean) => void;
};

const InlineComboboxContext = React.createContext<InlineComboboxContextValue>(
  null as any
);

const defaultFilter: FilterFn = (
  { group, keywords = [], label, value },
  search
) => {
  const uniqueTerms = new Set(
    [value, ...keywords, group, label].filter(Boolean)
  );

  return Array.from(uniqueTerms).some((keyword) =>
    filterWords(keyword!, search)
  );
};

type InlineComboboxProps = {
  children: ReactNode;
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

  const [valueState, setValueState] = React.useState('');
  const hasValueProp = valueProp !== undefined;
  const value = hasValueProp ? valueProp : valueState;

  // Check if current user is the creator of this element (for Yjs collaboration)
  const isCreator = React.useMemo(() => {
    const elementUserId = (element as any).userId;
    const currentUserId = editor.meta.userId;

    // If no userId (backwards compatibility or non-Yjs), allow
    if (!elementUserId) return true;

    return elementUserId === currentUserId;
  }, [editor, element]);

  const setValue = React.useCallback(
    (newValue: string) => {
      setValueProp?.(newValue);

      if (!hasValueProp) {
        setValueState(newValue);
      }
    },
    [setValueProp, hasValueProp]
  );

  const insertPoint = React.useRef<Point | null>(null);

  useEffect(() => {
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
    autoFocus: isCreator,
    ref: inputRef,
    onCancelInput: (cause) => {
      if (cause !== 'backspace') {
        editor.tf.insertText(trigger + value, {
          at: insertPoint?.current ?? undefined,
        });
      }
      if (cause === 'arrowLeft' || cause === 'arrowRight') {
        editor.tf.move({
          distance: 1,
          reverse: cause === 'arrowLeft',
        });
      }
    },
  });

  const [hasEmpty, setHasEmpty] = React.useState(false);

  const contextValue: InlineComboboxContextValue = React.useMemo(
    () => ({
      filter,
      inputProps,
      inputRef,
      removeInput,
      setHasEmpty,
      showTrigger,
      trigger,
    }),
    [
      trigger,
      showTrigger,
      filter,
      inputRef,
      inputProps,
      removeInput,
      setHasEmpty,
    ]
  );

  const store = Ariakit.useComboboxStore({
    setValue: (newValue) => React.startTransition(() => setValue(newValue)),
  });

  const items = store.useState('items');

  // useEffect(() => {
  //   if (!store.getState().activeId) {
  //     store.setActiveId(store.first());
  //   }
  // }, [items, store]);

  return (
    <span contentEditable={false}>
      <Ariakit.ComboboxProvider
        open={
          isCreator &&
          (items.length > 0 || hasEmpty) &&
          (!hideWhenNoValue || value.length > 0)
        }
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
  ...props
}: React.ComponentProps<'input'>) {
  const {
    inputProps,
    inputRef: contextRef,
    showTrigger,
    trigger,
  } = React.useContext(InlineComboboxContext);

  const store = Ariakit.useComboboxContext()!;
  const value = store.useState('value');

  const ref = useComposedRef(refProp, contextRef);

  return (
    <>
      {showTrigger && trigger}

      <span className="relative min-h-[1lh]">
        <span
          aria-hidden="true"
          className="invisible overflow-hidden text-nowrap"
        >
          {value || props.placeholder || '\u200B'}
        </span>

        <Ariakit.Combobox
          autoSelect
          className={cn(
            'absolute top-0 left-0 size-full bg-transparent outline-hidden',
            className
          )}
          ref={ref}
          value={value}
          {...inputProps}
          {...props}
        />
      </span>
    </>
  );
}

const comboboxVariants = cva(
  'z-500 mt-1 h-full max-h-[40vh] min-w-[180px] max-w-[calc(100vw-24px)] animate-popover overflow-y-auto rounded-lg bg-popover shadow-floating',
  {
    defaultVariants: {
      variant: 'default',
    },
    variants: {
      variant: {
        default: '',
        emoji: 'max-h-[270px] w-[408px]',
        mention: 'w-[300px]',
        slash: 'w-[320px]',
      },
    },
  }
);

const comboboxItemVariants = cva(
  'relative mx-1 flex select-none items-center rounded-sm px-2 py-1 text-foreground text-sm outline-hidden transition-bg-ease [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    defaultVariants: {
      interactive: true,
    },
    variants: {
      interactive: {
        false: '',
        true: 'cursor-pointer hover:bg-accent hover:text-accent-foreground data-[active-item=true]:bg-accent data-[active-item=true]:text-accent-foreground',
      },
    },
  }
);

function InlineComboboxContent({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof Ariakit.ComboboxPopover> &
  VariantProps<typeof comboboxVariants>) {
  return (
    <Ariakit.Portal>
      <Ariakit.ComboboxPopover
        className={cn(comboboxVariants({ variant }), className)}
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
  focusEditor?: boolean;
  group?: string;
  keywords?: string[];
  label?: string;
} & Ariakit.ComboboxItemProps &
  Required<Pick<Ariakit.ComboboxItemProps, 'value'>>) {
  const { value } = props;

  const { filter, removeInput } = React.useContext(InlineComboboxContext);

  const store = Ariakit.useComboboxContext()!;

  const search = filter && store.useState('value');

  const visible = React.useMemo(
    () =>
      !filter || filter({ group, keywords, label, value }, search as string),
    [filter, group, keywords, value, label, search]
  );

  if (!visible) return null;

  return (
    <Ariakit.ComboboxItem
      className={cn(comboboxItemVariants(), className)}
      onClick={(event) => {
        removeInput(focusEditor);
        onClick?.(event);
      }}
      {...props}
    />
  );
}

function InlineComboboxEmpty({
  children,
  className,
}: HTMLAttributes<HTMLDivElement>) {
  const { setHasEmpty } = React.useContext(InlineComboboxContext);
  const store = Ariakit.useComboboxContext()!;
  const items = store.useState('items');

  useEffect(() => {
    setHasEmpty(true);

    return () => {
      setHasEmpty(false);
    };
  }, [setHasEmpty]);

  if (items.length > 0) return null;

  return (
    <div
      className={cn(
        comboboxItemVariants({ interactive: false }),
        'my-1.5 text-muted-foreground',
        className
      )}
    >
      {children}
    </div>
  );
}

function InlineComboboxGroup({
  className,
  ...props
}: React.ComponentProps<typeof Ariakit.ComboboxGroup>) {
  return (
    <Ariakit.ComboboxGroup
      className={cn(
        'hidden not-last:border-b py-1.5 [&:has([role=option])]:block',
        className
      )}
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
      className={cn(
        'mt-1.5 mb-2 px-3 font-medium text-muted-foreground text-xs',
        className
      )}
      {...props}
    />
  );
}

const InlineComboboxRow = Ariakit.ComboboxRow;

export {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
  InlineComboboxRow,
};
