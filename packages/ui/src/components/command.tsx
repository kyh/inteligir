"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

// Fluid's command menu: one field over every action, type / arrow / Enter. The field keeps DOM
// focus the whole time and points at the highlighted row through aria-activedescendant, so the
// list needs no primitive of its own — the one thing a primitive would add, the modal shell, is
// the repo's own Dialog. The highlight is the proximity pill every other popup here draws, moved
// by the pointer through `useProximityHover` and by the arrows through `setActiveIndex`.
//
// Rows are children, not data: each page of the palette already owns its own filtering and its
// own row shapes, and a data array would be a second answer to what a row is. A row therefore
// does not answer for its own position — the list reads document order, the same `syncRows`
// shape `dropdown-menu.tsx` and `sidebar-menu.tsx` use.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ComponentProps,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react";
import { animate, useReducedMotion } from "framer-motion";
import { SearchIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/cn";
import { ProximityOverlays } from "@repo/ui/hooks/proximity-overlays";
import { useProximityHover } from "@repo/ui/hooks/use-proximity-hover";
import type { ItemRect } from "@repo/ui/hooks/use-proximity-hover";
import { radiusMap } from "@repo/ui/lib/radius-context";
import { spring } from "@repo/ui/lib/springs";
import { useSize } from "@repo/ui/lib/size-context";
import { useIsoLayoutEffect } from "@repo/ui/lib/use-iso-layout-effect";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@repo/ui/components/dialog";

// popups keep the smaller radii whatever the app is shaped: pill rows inside a square panel
// distort the concentric fit of the hover fill.
const radius = radiusMap.rounded;

// the store's null snapshot, spelled once so no reader needs an assertion for it
const NO_ROW: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Caps — a chord as one box per key. The chord arrives already spelled for the
// keyboard in use (`@repo/editor/hotkey-spelling`), so this only cuts it up:
// "Ctrl+Shift+P" on its joiner, "⌘⇧P" on its symbols.
// ---------------------------------------------------------------------------

const MODIFIER_GLYPHS = "⌘⌃⌥⇧";

export const shortcutCaps = (chord: string): string[] => {
  if (chord.includes("+")) {
    return chord.split("+").filter((part) => part !== "");
  }
  const caps: string[] = [];
  let rest = chord;
  while (rest !== "" && MODIFIER_GLYPHS.includes(rest.charAt(0))) {
    caps.push(rest.charAt(0));
    rest = rest.slice(1);
  }
  if (rest !== "") {
    caps.push(rest);
  }
  return caps;
};

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

// what a row is, read at the moment it is picked rather than when it registered
interface RowMeta {
  disabled: boolean;
  onSelect?: (() => void) | undefined;
}

// The highlighted row as a store: only the row it left, the row it reached, the field and the
// footer re-render as the pill travels, never the whole list.
interface HighlightStore {
  get: () => HTMLElement | null;
  subscribe: (listener: () => void) => () => void;
}

interface CommandContextValue {
  listId: string;
  // A row hands the list its element and a ref to its own data; only the list can read the
  // document order of rows that mount and unmount independently of each other.
  registerRow: (element: HTMLElement, meta: RefObject<RowMeta>) => () => void;
  rowCount: number;
  highlight: HighlightStore;
  select: (element: HTMLElement) => void;
  move: (to: 1 | -1 | "first" | "last") => void;
  close: () => void;
  // the list hands the root its node, which is both the scroller and the rows' offsetParent
  setListNode: (node: HTMLDivElement | null) => void;
}

const CommandContext = createContext<CommandContextValue | null>(null);

const useCommand = (): CommandContextValue => {
  const ctx = useContext(CommandContext);
  if (!ctx) {
    throw new Error("Command compound components must be inside <CommandDialog>");
  }
  return ctx;
};

// What the list's fill reads: its own context, so the pill travelling re-renders the list alone.
interface CommandFillValue {
  rect: ItemRect | null;
  session: number;
  onMouseEnter: () => void;
  onMouseMove: (event: ReactMouseEvent) => void;
  onMouseLeave: () => void;
}

const CommandFillContext = createContext<CommandFillValue | null>(null);

// ---------------------------------------------------------------------------
// CommandDialog — the modal shell, and the root that owns the registry
// ---------------------------------------------------------------------------

interface CommandDialogProps extends Omit<
  ComponentProps<typeof Dialog>,
  "children" | "onOpenChange"
> {
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  className?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

const CommandDialog = ({
  title,
  description,
  children,
  className,
  initialFocus,
  onOpenChange,
  ...props
}: CommandDialogProps) => {
  const listId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);

  const { activeIndex, setActiveIndex, itemRects, isMeasured, session, handlers, registerItem } =
    useProximityHover(listRef);

  const rowsRef = useRef<Set<HTMLElement>>(new Set());
  const metaRef = useRef<Map<HTMLElement, RefObject<RowMeta>>>(new Map());
  const registeredCountRef = useRef(0);
  const [orderedRows, setOrderedRows] = useState<HTMLElement[]>([]);
  // the same rows, readable from a handler that must not re-subscribe when they change
  const orderedRef = useRef<HTMLElement[]>([]);
  useIsoLayoutEffect(() => {
    orderedRef.current = orderedRows;
  }, [orderedRows]);

  const syncRows = useCallback(() => {
    const list = listRef.current;
    const sorted =
      list === null
        ? []
        : [...list.querySelectorAll<HTMLElement>("[data-command-item]")].filter((el) =>
            rowsRef.current.has(el),
          );
    setOrderedRows((previous) =>
      previous.length === sorted.length && previous.every((el, i) => el === sorted[i])
        ? previous
        : sorted,
    );
    for (const [i, el] of sorted.entries()) {
      registerItem(i, el);
    }
    for (let i = sorted.length; i < registeredCountRef.current; i += 1) {
      registerItem(i, null);
    }
    registeredCountRef.current = sorted.length;
  }, [registerItem]);

  const registerRow = useCallback(
    (element: HTMLElement, meta: RefObject<RowMeta>) => {
      rowsRef.current.add(element);
      metaRef.current.set(element, meta);
      syncRows();
      return () => {
        rowsRef.current.delete(element);
        metaRef.current.delete(element);
        syncRows();
      };
    },
    [syncRows],
  );

  // the highlight as an element, published right after each commit
  const activeElRef = useRef<HTMLElement | null>(null);
  const listenersRef = useRef(new Set<() => void>());
  const highlight = useMemo<HighlightStore>(
    () => ({
      get: () => activeElRef.current,
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [],
  );
  const activeEl = activeIndex === null ? null : (orderedRows.at(activeIndex) ?? null);
  useIsoLayoutEffect(() => {
    activeElRef.current = activeEl;
    for (const listener of listenersRef.current) {
      listener();
    }
  }, [activeEl]);

  // The list is its own scroller, so a keyboard move scrolls it here, the moment the move is
  // decided: a move onto the row already highlighted (↓ in a one-row list, a query that keeps
  // row 0) must still scroll, and an effect on the index would miss it. Offsets, not rects: a
  // row's offsetParent is the list itself, so the number is its place in the scroll content
  // whatever transform an ancestor carries. Never scrollIntoView, which scrolls the page too.
  const reduceMotion = useReducedMotion() ?? false;
  const scrollAnimationRef = useRef<{ stop: () => void } | null>(null);
  const scrollToRow = useCallback(
    (index: number, mode: "center" | "top") => {
      const list = listRef.current;
      if (list === null) {
        return;
      }
      scrollAnimationRef.current?.stop();
      scrollAnimationRef.current = null;
      if (mode === "top" || index === 0) {
        list.scrollTop = 0;
        return;
      }
      const row = orderedRef.current.at(index);
      if (row === undefined) {
        return;
      }
      const target = Math.max(
        0,
        Math.min(
          row.offsetTop + row.offsetHeight / 2 - list.clientHeight / 2,
          list.scrollHeight - list.clientHeight,
        ),
      );
      if (reduceMotion) {
        list.scrollTop = target;
        return;
      }
      scrollAnimationRef.current = animate(list.scrollTop, target, {
        ...spring.fast,
        onUpdate: (value) => {
          list.scrollTop = value;
        },
      });
    },
    [reduceMotion],
  );
  useEffect(() => () => scrollAnimationRef.current?.stop(), []);

  const isDisabled = useCallback(
    (element: HTMLElement) => metaRef.current.get(element)?.current.disabled === true,
    [],
  );

  // The first enabled row is highlighted whenever the row set changes, so Enter always has a
  // target and it follows the query as the rows filter down.
  useEffect(() => {
    const first = orderedRows.findIndex((el) => !isDisabled(el));
    setActiveIndex(first === -1 ? null : first);
    scrollToRow(0, "top");
  }, [orderedRows, isDisabled, setActiveIndex, scrollToRow]);

  const move = useCallback(
    (to: 1 | -1 | "first" | "last") => {
      const enabled: number[] = [];
      for (const [index, el] of orderedRef.current.entries()) {
        if (!isDisabled(el)) {
          enabled.push(index);
        }
      }
      const first = enabled.at(0);
      const last = enabled.at(-1);
      if (first === undefined || last === undefined) {
        return;
      }
      let next = first;
      if (to === "last") {
        next = last;
      } else if (to === 1 || to === -1) {
        const { current } = activeElRef;
        const position =
          current === null ? -1 : enabled.indexOf(orderedRef.current.indexOf(current));
        if (position === -1) {
          next = to === 1 ? first : last;
        } else {
          // wraps at both ends: the list is the whole keyboard space, there is no field to stop at
          next = enabled.at((position + to + enabled.length) % enabled.length) ?? first;
        }
      }
      setActiveIndex(next);
      scrollToRow(next, "center");
    },
    [isDisabled, setActiveIndex, scrollToRow],
  );

  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const select = useCallback((element: HTMLElement) => {
    const meta = metaRef.current.get(element)?.current;
    if (meta === undefined || meta.disabled) {
      return;
    }
    meta.onSelect?.();
  }, []);

  const setListNode = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (node !== null) {
        // the rows that registered before the list had a node have no document order yet
        syncRows();
      }
    },
    [syncRows],
  );

  const ctx = useMemo<CommandContextValue>(
    () => ({
      close,
      highlight,
      listId,
      move,
      registerRow,
      rowCount: orderedRows.length,
      select,
      setListNode,
    }),
    [close, highlight, listId, move, registerRow, orderedRows.length, select, setListNode],
  );

  // The pointer leaving the list keeps the highlight where it was: Enter still has a target, and
  // the fill stays on the row the field points at.
  const lastActiveRef = useRef<number | null>(null);
  useIsoLayoutEffect(() => {
    if (activeIndex !== null) {
      lastActiveRef.current = activeIndex;
    }
  }, [activeIndex]);

  const { onMouseEnter, onMouseMove, onMouseLeave } = handlers;
  const fill = useMemo<CommandFillValue>(
    () => ({
      onMouseEnter,
      onMouseLeave: () => {
        onMouseLeave();
        setActiveIndex(lastActiveRef.current);
      },
      onMouseMove,
      rect: isMeasured && activeIndex !== null ? (itemRects.at(activeIndex) ?? null) : null,
      session,
    }),
    [
      onMouseEnter,
      onMouseLeave,
      onMouseMove,
      setActiveIndex,
      isMeasured,
      activeIndex,
      itemRects,
      session,
    ],
  );

  return (
    <Dialog onOpenChange={onOpenChange} {...props}>
      <DialogContent
        showCloseButton={false}
        initialFocus={initialFocus}
        // Opens where a panel at its cap height sits centered, and keeps that top edge, so the
        // field stays put while the rows under it filter down. Below 580px of window height the
        // cap is 76dvh and the top lands on 12dvh.
        className={cn(
          "top-[max(12dvh,calc(50dvh-220px))] flex max-h-[min(440px,76dvh)] w-[calc(100%-2rem)] max-w-[560px] translate-y-0 flex-col overflow-hidden p-0",
          className,
        )}
      >
        {/* the sr-only header sits inside the content: Base UI puts Title and Description inside
            the Popup, and as a sibling it would render while the palette is closed */}
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <CommandContext.Provider value={ctx}>
          <CommandFillContext.Provider value={fill}>{children}</CommandFillContext.Provider>
        </CommandContext.Provider>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
// CommandInput — the field. Keeps focus; the arrows and Enter act on the list
// through aria-activedescendant.
// ---------------------------------------------------------------------------

interface CommandInputProps extends Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "size" | "type"
> {
  value: string;
  onValueChange: (value: string) => void;
}

const CommandInput = ({
  className,
  value,
  onValueChange,
  onKeyDown,
  ...props
}: CommandInputProps) => {
  const { listId, highlight, select, move, close } = useCommand();
  const sizeClasses = useSize();
  const activeEl = useSyncExternalStore(highlight.subscribe, highlight.get, () => NO_ROW);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }
    // Keys inside an IME composition belong to the composer: Enter commits a candidate and the
    // arrows pick one. Safari reports the commit as keyCode 229 after compositionend.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }
    // Home and End are the caret's own once anything is typed.
    const caretKeys = value === "" ? [] : ["Home", "End"];
    if (caretKeys.includes(event.key)) {
      return;
    }
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        move(1);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        move(-1);
        break;
      }
      case "Home": {
        event.preventDefault();
        move("first");
        break;
      }
      case "End": {
        event.preventDefault();
        move("last");
        break;
      }
      case "Enter": {
        event.preventDefault();
        if (activeEl !== null) {
          select(activeEl);
        }
        break;
      }
      case "Escape": {
        event.preventDefault();
        close();
        break;
      }
      default: {
        break;
      }
    }
  };

  return (
    <div
      data-slot="command-input"
      className="group/command-input flex h-10 shrink-0 items-center gap-2 px-3"
    >
      <SearchIcon
        size={sizeClasses.icon}
        strokeWidth={1.5}
        className="shrink-0 text-muted-foreground transition-[color,stroke-width] duration-80 group-focus-within/command-input:stroke-2 group-focus-within/command-input:text-foreground"
      />
      <input
        type="text"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeEl?.id}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        // rounded-none: the global :focus-visible rule hands a focused element the shape radius,
        // and a text input clips its caret to its corners
        className={cn(
          "min-w-0 flex-1 rounded-none bg-transparent font-[inherit] text-subtitle text-foreground outline-none placeholder:text-muted-foreground",
          className,
        )}
        {...props}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// CommandList — the scrolling rows under the field's divider, and the pill
// ---------------------------------------------------------------------------

const CommandList = ({ className, children, ...props }: ComponentProps<"div">) => {
  const { listId, rowCount, setListNode } = useCommand();
  const fill = useContext(CommandFillContext);

  return (
    <div
      ref={setListNode}
      id={listId}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <select> and <datalist> carry form semantics and UA styling, and neither draws the rows this list draws
      role="listbox"
      tabIndex={-1}
      data-slot="command-list"
      data-empty={rowCount === 0 ? "" : undefined}
      onMouseEnter={fill?.onMouseEnter}
      onMouseMove={fill?.onMouseMove}
      onMouseLeave={fill?.onMouseLeave}
      // a row click must not blur the field: the palette is driven from the keyboard, and the
      // click has already picked
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      className={cn(
        "relative flex max-h-72 min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto border-t border-border/60 p-1 outline-none data-[empty]:p-0",
        className,
      )}
      {...props}
    >
      <ProximityOverlays
        hoverRect={fill?.rect ?? null}
        focusRect={null}
        session={fill?.session ?? 0}
        radius={radius}
      />
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// CommandEmpty — stands in for the rows when nothing matches
// ---------------------------------------------------------------------------

const CommandEmpty = ({ className, ...props }: ComponentProps<"div">) => {
  const { rowCount } = useCommand();
  if (rowCount > 0) {
    return null;
  }
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <output> is a form control, and this sentence belongs to the listbox rather than to any field
      role="status"
      aria-live="polite"
      data-slot="command-empty"
      className={cn("px-3 py-6 text-center text-body text-muted-foreground", className)}
      {...props}
    />
  );
};

// ---------------------------------------------------------------------------
// CommandGroup — a heading over a contiguous run of rows
// ---------------------------------------------------------------------------

interface CommandGroupProps extends ComponentProps<"div"> {
  heading?: string;
}

const CommandGroup = ({ className, heading, children, ...props }: CommandGroupProps) => {
  const headingId = useId();
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <fieldset> and <optgroup> carry form semantics and UA styling this run of rows must not
      role="group"
      data-slot="command-group"
      aria-labelledby={heading === undefined ? undefined : headingId}
      className={cn("flex flex-col", className)}
      {...props}
    >
      {heading === undefined ? null : (
        <div
          id={headingId}
          role="presentation"
          className="flex h-6 shrink-0 items-center truncate px-1.5 text-caption text-muted-foreground"
        >
          {heading}
        </div>
      )}
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// CommandItem — one row
// ---------------------------------------------------------------------------

interface CommandItemProps extends Omit<ComponentProps<"div">, "onSelect"> {
  disabled?: boolean;
  // what the footer names Enter while this row is highlighted; without it Enter goes unnamed
  action?: string;
  onSelect?: () => void;
}

const CommandItem = ({
  className,
  children,
  disabled = false,
  action,
  onSelect,
  onClick,
  ...props
}: CommandItemProps) => {
  const { registerRow, highlight, select } = useCommand();
  const rowId = useId();
  const sizeClasses = useSize();
  // state, not a ref: `isActive` compares it while rendering, and a ref read there is not reactive
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);

  const metaRef = useRef<RowMeta>({ disabled, onSelect });
  useIsoLayoutEffect(() => {
    metaRef.current = { disabled, onSelect };
  }, [disabled, onSelect]);

  useIsoLayoutEffect(() => {
    if (rowEl === null) {
      return;
    }
    return registerRow(rowEl, metaRef);
  }, [registerRow, rowEl]);

  const isActive = useSyncExternalStore(
    highlight.subscribe,
    () => rowEl !== null && highlight.get() === rowEl,
    () => false,
  );

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the keyboard path is the field's: it holds focus and runs this row through aria-activedescendant
    <div
      ref={setRowEl}
      id={rowId}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <option> draws no icon, no description and no caps
      role="option"
      tabIndex={-1}
      aria-selected={isActive}
      aria-disabled={disabled ? true : undefined}
      data-command-item=""
      data-command-action={action}
      data-slot="command-item"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && rowEl !== null) {
          select(rowEl);
        }
      }}
      className={cn(
        // fixed height so a trimmed label cannot shrink the row; shrink-0 because the list is a
        // flex column
        "relative z-10 flex shrink-0 cursor-pointer items-center outline-none select-none",
        sizeClasses.control,
        sizeClasses.gap,
        sizeClasses.itemPx,
        sizeClasses.text,
        radius.item,
        "transition-colors duration-80",
        isActive ? "text-foreground" : "text-muted-foreground",
        disabled && "pointer-events-none opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// CommandShortcut — the caps at a row's trailing edge
// ---------------------------------------------------------------------------

// one box per key; a chord can repeat a cap, so the position is part of the key
const Caps = ({ caps }: { caps: readonly string[] }) => (
  <>
    {caps.map((cap, index) => (
      <span
        key={`${cap}-${String(index)}`}
        className="flex h-4 min-w-4 items-center justify-center rounded-[5px] bg-hover px-1 text-caption text-muted-foreground"
      >
        {cap}
      </span>
    ))}
  </>
);

interface CommandShortcutProps extends Omit<ComponentProps<"kbd">, "children"> {
  // the chord as it is spelled for this keyboard, e.g. "⌘⇧P" or "Ctrl+Shift+P"
  keys: string;
}

const CommandShortcut = ({ className, keys, ...props }: CommandShortcutProps) => (
  <kbd
    data-slot="command-shortcut"
    className={cn(
      "ml-auto inline-flex shrink-0 items-center gap-0.5 align-middle font-sans",
      className,
    )}
    {...props}
  >
    <Caps caps={shortcutCaps(keys)} />
  </kbd>
);

// ---------------------------------------------------------------------------
// CommandFooter — the hint strip under the list: what the keys do here. The
// Enter hint names the highlighted row, so it reads as the thing Enter does
// rather than a generic "Run", and it sits at the trailing edge so its
// changing width never moves the other hints.
// ---------------------------------------------------------------------------

const HINTS: readonly { label: string; caps: readonly string[] }[] = [
  { caps: ["↑", "↓"], label: "Select" },
  { caps: ["Esc"], label: "Close" },
];

const CommandFooter = ({ className, ...props }: ComponentProps<"div">) => {
  const { highlight } = useCommand();
  const activeEl = useSyncExternalStore(highlight.subscribe, highlight.get, () => NO_ROW);
  // the row's own words, read off the element the store points at, so nothing here keeps a second
  // copy of a label the page already drew
  const action = activeEl?.dataset.commandAction;

  return (
    <div
      data-slot="command-footer"
      className={cn(
        "flex h-8 shrink-0 items-center gap-3 px-3 text-caption text-muted-foreground",
        className,
      )}
      {...props}
    >
      {HINTS.map((hint) => (
        <span key={hint.label} className="flex shrink-0 items-center gap-1.5">
          <span>{hint.label}</span>
          <kbd className="inline-flex shrink-0 items-center gap-0.5 align-middle font-sans">
            <Caps caps={hint.caps} />
          </kbd>
        </span>
      ))}
      {action === undefined ? null : (
        <span className="ml-auto flex min-w-0 items-center gap-1.5 text-foreground">
          <span className="truncate">{action}</span>
          <kbd className="inline-flex shrink-0 items-center gap-0.5 align-middle font-sans">
            <Caps caps={["↵"]} />
          </kbd>
        </span>
      )}
    </div>
  );
};

export {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
};
