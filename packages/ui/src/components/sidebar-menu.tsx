"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import { Fragment, createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  LiHTMLAttributes,
  ReactNode,
  RefAttributes,
  RefObject,
} from "react";
import { cn } from "@repo/ui/lib/cn";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { useRadius } from "@repo/ui/lib/radius-context";
import { SizeProvider, useSize } from "@repo/ui/lib/size-context";
import type { SizeVariant } from "@repo/ui/lib/size-context";
import { ProximityOverlays } from "@repo/ui/hooks/proximity-overlays";
import { useProximityHover } from "@repo/ui/hooks/use-proximity-hover";
import type { ItemRect } from "@repo/ui/hooks/use-proximity-hover";
import { useHighlighted, useHighlightStore, useRowOrder } from "@repo/ui/hooks/use-row-order";
import type { HighlightStore } from "@repo/ui/hooks/use-row-order";
import type { IconComponent } from "@repo/ui/lib/icon";
import { useIsoLayoutEffect } from "@repo/ui/lib/use-iso-layout-effect";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { splitLeadingText } from "@repo/ui/lib/text-children";

interface MenuHighlight {
  hovered: HTMLElement | null;
  active: HTMLElement | null;
  first: HTMLElement | null;
}

// Stable for the list's lifetime: what moves travels through the store, so the traveling pill
// re-renders the two rows it left and reached rather than every row.
interface MenuScopeValue {
  registerRow: (el: HTMLElement) => () => void;
  setRowActive: (row: HTMLElement, active: boolean) => void;
  highlight: HighlightStore<MenuHighlight>;
}

const MenuScopeContext = createContext<MenuScopeValue | null>(null);

interface MenuItemContextValue {
  // state, not a ref: the row's highlight reading compares it, and a ref read there is not reactive
  rowEl: HTMLLIElement | null;
  setRow: (el: HTMLLIElement | null) => void;
  isHovered: boolean;
  setActive: (active: boolean) => void;
}

const MenuItemContext = createContext<MenuItemContextValue | null>(null);

const MENU_ITEM = '[data-sidebar="menu-item"]';

// the rail's own panel, or its peek card while collapsed: a popup anchored anywhere in it
const RAIL = '[data-sidebar="sidebar"], [data-sidebar="peek"]';

// A row's box spans the whole <li>, so it is clamped to the button's; 32px is the tallest row,
// for a row whose button is not its direct child.
const measureRow = (row: HTMLElement): ItemRect => {
  const button = row.querySelector<HTMLElement>(':scope > [data-sidebar="menu-button"]');
  return {
    height: Math.min(row.offsetHeight, button?.offsetHeight ?? 32),
    left: row.offsetLeft,
    top: row.offsetTop,
    width: row.offsetWidth,
  };
};

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"]);

interface MenuScope {
  value: MenuScopeValue;
  containerProps: {
    onMouseEnter: () => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseLeave: () => void;
    onFocus: (e: React.FocusEvent) => void;
    onBlur: (e: React.FocusEvent) => void;
    onPointerDown: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
  };
  overlays: ReactNode;
}

const useMenuScope = (containerRef: RefObject<HTMLElement | null>): MenuScope => {
  const { activeIndex, setActiveIndex, itemRects, isMeasured, session, handlers, setItems } =
    useProximityHover(containerRef, { measure: measureRow });

  // the rows whose button is current; the first of them in document order carries the active pill
  const activeRowsRef = useRef<Set<HTMLElement>>(new Set());
  const [activeRowEl, setActiveRowEl] = useState<HTMLElement | null>(null);
  const [focusedRowEl, setFocusedRowEl] = useState<HTMLElement | null>(null);

  const onRows = useCallback(
    (rows: readonly HTMLElement[]) => {
      setItems(rows);
      setActiveRowEl(rows.find((el) => activeRowsRef.current.has(el)) ?? null);
    },
    [setItems],
  );
  const {
    rows: orderedRows,
    registerRow,
    requestSync,
  } = useRowOrder(containerRef, MENU_ITEM, onRows);

  const setRowActive = useCallback(
    (row: HTMLElement, active: boolean) => {
      const activeRows = activeRowsRef.current;
      if (activeRows.has(row) === active) {
        return;
      }
      if (active) {
        activeRows.add(row);
      } else {
        activeRows.delete(row);
      }
      requestSync();
    },
    [requestSync],
  );

  const overlayRect = useCallback(
    (row: HTMLElement | null): ItemRect | null => {
      const idx = row === null ? -1 : orderedRows.indexOf(row);
      return idx === -1 ? null : (itemRects[idx] ?? null);
    },
    [itemRects, orderedRows],
  );

  // hover tracking freezes while a popup anchored in the rail is open, or a non-modal popup lets
  // rows underneath keep highlighting; the rail, not the whole window, since this runs per move
  const popupOpen = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return false;
    }
    const root = container.closest(RAIL) ?? container;
    return root.querySelector('[data-sidebar^="menu-"][data-popup-open]') !== null;
  }, [containerRef]);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (popupOpen()) {
        return;
      }
      handlers.onMouseMove(e);
    },
    [popupOpen, handlers],
  );

  const onFocus = useCallback(
    (e: React.FocusEvent) => {
      const { target } = e;
      if (!(target instanceof HTMLElement)) {
        setFocusedRowEl(null);
        setActiveIndex(null);
        return;
      }
      if (!target.closest('[data-sidebar="menu-button"]')) {
        return;
      }
      const rowEl = target.closest('[data-sidebar="menu-item"]');
      const row = rowEl instanceof HTMLElement ? rowEl : null;
      if (!row) {
        return;
      }
      const idx = orderedRows.indexOf(row);
      if (idx === -1) {
        return;
      }
      setActiveIndex(idx);
      setFocusedRowEl(target.matches(":focus-visible") ? row : null);
    },
    [setActiveIndex, orderedRows],
  );

  const onPointerDown = useCallback(() => {
    setFocusedRowEl(null);
  }, []);

  const onBlur = useCallback(
    (e: React.FocusEvent) => {
      if (e.relatedTarget instanceof Node && containerRef.current?.contains(e.relatedTarget)) {
        return;
      }
      setFocusedRowEl(null);
      setActiveIndex(null);
    },
    [containerRef, setActiveIndex],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // a row that walked the key itself (a tree's expand on ArrowRight) is left alone
      if (!NAV_KEYS.has(e.key) || e.defaultPrevented) {
        return;
      }
      const container = containerRef.current;
      if (!container || !(e.target instanceof HTMLElement)) {
        return;
      }
      const items = [...container.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]')];
      const currentIdx = items.indexOf(e.target);
      if (currentIdx === -1) {
        return;
      }
      e.preventDefault();
      // keep handled arrows from the shell's window-level key bindings
      e.stopPropagation();
      if (e.key === "Home") {
        items[0]?.focus();
      } else if (e.key === "End") {
        items.at(-1)?.focus();
      } else {
        const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
        const next = forward
          ? (currentIdx + 1) % items.length
          : (currentIdx - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    },
    [containerRef],
  );

  const hoveredRowEl = activeIndex === null ? null : (orderedRows[activeIndex] ?? null);
  const firstRowEl = orderedRows[0] ?? null;
  const highlightValue = useMemo<MenuHighlight>(
    () => ({ active: activeRowEl, first: firstRowEl, hovered: hoveredRowEl }),
    [activeRowEl, firstRowEl, hoveredRowEl],
  );
  const highlight = useHighlightStore(highlightValue);

  const value = useMemo<MenuScopeValue>(
    () => ({ highlight, registerRow, setRowActive }),
    [highlight, registerRow, setRowActive],
  );

  const overlays = isMeasured ? (
    <ProximityOverlays
      activeRect={overlayRect(activeRowEl)}
      hoverRect={overlayRect(hoveredRowEl)}
      focusRect={overlayRect(focusedRowEl)}
      session={session}
    />
  ) : null;

  return {
    containerProps: {
      onBlur,
      onFocus,
      onKeyDown,
      onMouseEnter: handlers.onMouseEnter,
      onMouseLeave: handlers.onMouseLeave,
      onMouseMove,
      // clicking the already-focused row never re-fires focus, so without this the keyboard ring
      // would stick until focus left the menu
      onPointerDown,
    },
    overlays,
    value,
  };
};

interface SidebarMenuProps extends LiHTMLAttributes<HTMLUListElement> {
  size?: SizeVariant;
}

// One scope per list: a single traveling hover, active and focus overlay over every row.
const SidebarMenu = ({
  className,
  size,
  children,
  ref,
  ...props
}: SidebarMenuProps & RefAttributes<HTMLUListElement>) => {
  const containerRef = useRef<HTMLUListElement>(null);
  const { value, containerProps, overlays } = useMenuScope(containerRef);

  const content = (
    <MenuScopeContext value={value}>
      <ul
        ref={composeRefs(containerRef, ref)}
        data-sidebar="menu"
        className={cn("relative flex w-full min-w-0 flex-col gap-0.5 select-none", className)}
        {...containerProps}
        {...props}
      >
        {overlays}
        {children}
      </ul>
    </MenuScopeContext>
  );

  return size ? <SizeProvider size={size}>{content}</SizeProvider> : content;
};
SidebarMenu.displayName = "SidebarMenu";

type SidebarMenuItemProps = LiHTMLAttributes<HTMLLIElement>;

const useMenuRow = (): MenuItemContextValue => {
  const scope = useContext(MenuScopeContext);
  const registerRow = scope?.registerRow;
  const setRowActive = scope?.setRowActive;

  const [rowEl, setRowEl] = useState<HTMLLIElement | null>(null);

  useIsoLayoutEffect(() => {
    if (!rowEl || !registerRow) {
      return;
    }
    return registerRow(rowEl);
  }, [registerRow, rowEl]);

  const setActive = useCallback(
    (active: boolean) => {
      if (rowEl && setRowActive) {
        setRowActive(rowEl, active);
      }
    },
    [setRowActive, rowEl],
  );

  const isHovered = useHighlighted(
    scope?.highlight ?? null,
    (highlight) => rowEl !== null && highlight.hovered === rowEl,
  );

  return useMemo(
    () => ({ isHovered, rowEl, setActive, setRow: setRowEl }),
    [rowEl, isHovered, setActive],
  );
};

const SidebarMenuItem = ({
  className,
  children,
  ref,
  ...props
}: SidebarMenuItemProps & RefAttributes<HTMLLIElement>) => {
  const item = useMenuRow();
  return (
    <MenuItemContext value={item}>
      <li
        ref={composeRefs(item.setRow, ref)}
        data-sidebar="menu-item"
        className={cn("group/menu-item relative", className)}
        {...props}
      >
        {children}
      </li>
    </MenuItemContext>
  );
};
SidebarMenuItem.displayName = "SidebarMenuItem";

// element children render outside the text-box-trimmed span, which would clip an inline SVG
const MenuRowLabel = ({
  content,
  lit,
  emphasized,
  textClass,
}: {
  content: ReactNode;
  lit: boolean;
  emphasized: boolean;
  textClass: string;
}) => {
  const { text, rest } = splitLeadingText(content);

  if (!text) {
    return (
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 transition-colors duration-80",
          lit ? "text-foreground" : "text-muted-foreground",
          textClass,
        )}
      >
        {content}
      </span>
    );
  }

  // the trim box spans cap height to baseline, so the overflow clip would shave ascenders and
  // descenders; symmetric padding extends the clip box and the negative margins cancel it out of
  // the row's height
  return (
    <>
      <span className={cn("inline-grid min-w-0 text-left", textClass)}>
        <span
          className="invisible col-start-1 row-start-1 -mt-[0.25em] -mb-[0.25em] truncate pt-[0.25em] pb-[0.25em] [text-box:trim-both_cap_alphabetic]"
          style={{ fontVariationSettings: fontWeights.semibold }}
          aria-hidden="true"
        >
          {text}
        </span>
        <span
          className={cn(
            "col-start-1 row-start-1 -mt-[0.25em] -mb-[0.25em] truncate pt-[0.25em] pb-[0.25em] transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
            lit ? "text-foreground" : "text-muted-foreground",
          )}
          style={{
            fontVariationSettings: emphasized ? fontWeights.semibold : fontWeights.normal,
          }}
        >
          {text}
        </span>
      </span>
      {rest.map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </>
  );
};

interface SidebarMenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
  icon?: IconComponent;
}

// The row: leading text is the label, drawn semibold while active without the row widening;
// anything after it lands at the trailing edge as given.
const SidebarMenuButton = ({
  isActive = false,
  icon: Icon,
  className,
  children,
  ref,
  ...props
}: SidebarMenuButtonProps & RefAttributes<HTMLButtonElement>) => {
  const scope = useContext(MenuScopeContext);
  const item = useContext(MenuItemContext);
  const radius = useRadius();
  const sizeClasses = useSize();

  const setActive = item?.setActive;
  useIsoLayoutEffect(() => {
    setActive?.(isActive);
    return () => setActive?.(false);
  }, [isActive, setActive]);

  const lit = isActive || (item?.isHovered ?? false);
  const heightClass = sizeClasses.variant === "compact" ? "h-7" : "h-8";

  // roving tabindex: the active row is the list's tab stop, else its first row
  const row = item?.rowEl ?? null;
  const isFirstStop = useHighlighted(
    scope?.highlight ?? null,
    (highlight) => highlight.active === null && row !== null && highlight.first === row,
  );

  return (
    <button
      ref={ref}
      type="button"
      data-sidebar="menu-button"
      data-active={isActive ? "true" : undefined}
      aria-current={isActive ? "page" : undefined}
      tabIndex={isActive || isFirstStop ? 0 : -1}
      className={cn(
        "peer/menu-button relative z-10 flex w-full cursor-pointer items-center gap-2 px-2 text-left outline-none select-none",
        heightClass,
        radius.item,
        className,
      )}
      {...props}
    >
      {Icon ? (
        <Icon
          size={sizeClasses.icon}
          strokeWidth={lit ? 2 : 1.5}
          className={cn(
            "shrink-0 transition-[color,stroke-width] duration-80",
            lit ? "text-foreground" : "text-muted-foreground",
          )}
        />
      ) : null}
      <MenuRowLabel
        content={children}
        lit={lit}
        emphasized={isActive}
        textClass={sizeClasses.text}
      />
    </button>
  );
};
SidebarMenuButton.displayName = "SidebarMenuButton";

interface SidebarMenuActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  // hidden until the row is hovered or holds focus, or its popup is open
  showOnHover?: boolean;
}

// A 24px button over the row's trailing edge, a sibling of the row button rather than a child,
// since a button cannot nest a button. The row reserves the width with its own trailing padding.
const SidebarMenuAction = ({
  showOnHover = false,
  className,
  ref,
  ...props
}: SidebarMenuActionProps & RefAttributes<HTMLButtonElement>) => {
  const radius = useRadius();
  return (
    <button
      ref={ref}
      type="button"
      data-sidebar="menu-action"
      className={cn(
        "absolute top-1/2 right-1 z-20 flex size-6 shrink-0 -translate-y-1/2 items-center justify-center text-muted-foreground outline-none",
        "transition-[color,opacity] duration-80 hover:text-foreground focus-visible:text-foreground",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        showOnHover &&
          "opacity-0 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100",
        radius.item,
        className,
      )}
      {...props}
    />
  );
};
SidebarMenuAction.displayName = "SidebarMenuAction";

export { SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuAction };
