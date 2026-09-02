"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  forwardRef,
  type LiHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@repo/ui/lib/utils";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { useRadius } from "@repo/ui/lib/radius-context";
import { useSize, SizeProvider, type SizeVariant } from "@repo/ui/lib/size-context";
import { ProximityOverlays } from "@repo/ui/hooks/proximity-overlays";
import { useProximityHover, type ItemRect } from "@repo/ui/hooks/use-proximity-hover";
import type { IconComponent } from "@repo/ui/lib/icon";
import { useIsoLayoutEffect } from "@repo/ui/lib/use-iso-layout-effect";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { splitLeadingText } from "@repo/ui/components/sidebar-core";

// ─── Menu scope ──────────────────────────────────────────────────────────────
//
// One proximity-hover system per SidebarMenu, plus the traveling overlays —
// hover background, active background, focus ring — that glide between its
// rows.

interface MenuScopeValue {
  registerRow: (el: HTMLElement) => () => void;
  setRowButton: (row: HTMLElement, button: HTMLElement | null) => void;
  setRowActive: (row: HTMLElement, active: boolean) => void;
  hoveredRowEl: HTMLElement | null;
  activeRowEl: HTMLElement | null;
  firstRowEl: HTMLElement | null;
  hasActive: boolean;
}

const MenuScopeContext = createContext<MenuScopeValue | null>(null);

interface MenuItemContextValue {
  /**
   * The row element as STATE, not a ref: `isHovered` / `isActiveRow` compare it
   * during render, and a ref read there is not reactive — the row would keep
   * rendering the pre-attach value until something else re-rendered it.
   */
  rowEl: HTMLLIElement | null;
  /** Callback ref that publishes the row element into that state. */
  setRow: (el: HTMLLIElement | null) => void;
  isHovered: boolean;
  isActiveRow: boolean;
  setActive: (active: boolean) => void;
  setButtonEl: (el: HTMLElement | null) => void;
}

const MenuItemContext = createContext<MenuItemContextValue | null>(null);

function byDomOrder(a: HTMLElement, b: HTMLElement) {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function sameElements(a: HTMLElement[], b: HTMLElement[]) {
  return a.length === b.length && a.every((el, i) => el === b[i]);
}

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

function useMenuScope(containerRef: RefObject<HTMLElement | null>): MenuScope {
  const { activeIndex, setActiveIndex, itemRects, isMeasured, session, handlers, registerItem } =
    useProximityHover(containerRef);

  const rowsRef = useRef<Set<HTMLElement>>(new Set());
  // State, not a ref: `overlayRect` reads this during render to clamp the
  // highlight to the row's button box, so a button attaching must re-render
  // — a ref would leave the first paint measuring the whole <li>.
  const [rowButtons, setRowButtons] = useState<Map<HTMLElement, HTMLElement>>(new Map());
  const activeMapRef = useRef<Map<HTMLElement, boolean>>(new Map());
  const [orderedRows, setOrderedRows] = useState<HTMLElement[]>([]);
  const registeredCountRef = useRef(0);
  const [activeRowEl, setActiveRowEl] = useState<HTMLElement | null>(null);
  const [focusedRowEl, setFocusedRowEl] = useState<HTMLElement | null>(null);

  const recomputeActive = useCallback(() => {
    // Sorted here rather than read off a render-time mirror of `orderedRows`:
    // this only runs from callbacks, and the ref-mirror was a render-phase write.
    let first: HTMLElement | null = null;
    for (const el of [...rowsRef.current].toSorted(byDomOrder)) {
      if (activeMapRef.current.get(el)) {
        first = el;
        break;
      }
    }
    setActiveRowEl((prev) => (prev === first ? prev : first));
  }, []);

  // Rows register by element; indexes are derived from DOM order so consumers
  // never pass an index prop and conditional rows just work.
  const syncRows = useCallback(() => {
    const sorted = [...rowsRef.current].toSorted(byDomOrder);
    setOrderedRows((prev) => (sameElements(prev, sorted) ? prev : sorted));
    sorted.forEach((el, i) => registerItem(i, el));
    for (let i = sorted.length; i < registeredCountRef.current; i++) {
      registerItem(i, null);
    }
    registeredCountRef.current = sorted.length;
    recomputeActive();
  }, [registerItem, recomputeActive]);

  const registerRow = useCallback(
    (el: HTMLElement) => {
      rowsRef.current.add(el);
      syncRows();
      return () => {
        rowsRef.current.delete(el);
        setRowButtons((prev) => {
          if (!prev.has(el)) return prev;
          const next = new Map(prev);
          next.delete(el);
          return next;
        });
        activeMapRef.current.delete(el);
        syncRows();
      };
    },
    [syncRows],
  );

  const setRowButton = useCallback((row: HTMLElement, button: HTMLElement | null) => {
    setRowButtons((prev) => {
      if (prev.get(row) === (button ?? undefined)) return prev;
      const next = new Map(prev);
      if (button) next.set(row, button);
      else next.delete(row);
      return next;
    });
  }, []);

  const setRowActive = useCallback(
    (row: HTMLElement, active: boolean) => {
      activeMapRef.current.set(row, active);
      recomputeActive();
    },
    [recomputeActive],
  );

  // A row's rect spans the whole <li>, so overlay heights are clamped to the
  // row's button box. The 32px fallback (the tallest row) guarantees the
  // highlight can never balloon even if the button lookup misses.
  const overlayRect = useCallback(
    (row: HTMLElement | null): ItemRect | null => {
      if (!row) return null;
      const idx = orderedRows.indexOf(row);
      const rect = idx === -1 ? null : itemRects[idx];
      if (!rect) return null;
      const button =
        rowButtons.get(row) ??
        row.querySelector<HTMLElement>(':scope > [data-sidebar="menu-button"]');
      const height = Math.min(rect.height, button?.offsetHeight ?? 32);
      return { ...rect, height };
    },
    [itemRects, orderedRows, rowButtons],
  );

  // While a popup anchored in the sidebar is open (the header/footer rows'
  // dropdown), hover tracking freezes — otherwise a non-modal popup lets rows
  // underneath keep highlighting. Popup triggers are detected by Base UI's
  // data-popup-open; collapsible rows only set aria-expanded, so they never
  // match.
  const popupOpen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;
    const root = container.closest('[data-slot="sidebar-wrapper"]') ?? container;
    return !!root.querySelector('[data-sidebar="menu-button"][data-popup-open]');
  }, [containerRef]);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (popupOpen()) return;
      handlers.onMouseMove(e);
    },
    [popupOpen, handlers],
  );

  const onFocus = useCallback(
    (e: React.FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) {
        setFocusedRowEl(null);
        setActiveIndex(null);
        return;
      }
      // Only the row's main button drives the traveling highlight and ring.
      if (!target.closest('[data-sidebar="menu-button"]')) return;
      const rowEl = target.closest('[data-sidebar="menu-item"]');
      const row = rowEl instanceof HTMLElement ? rowEl : null;
      if (!row) return;
      const idx = orderedRows.indexOf(row);
      if (idx === -1) return;
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
      if (e.relatedTarget instanceof Node && containerRef.current?.contains(e.relatedTarget))
        return;
      setFocusedRowEl(null);
      setActiveIndex(null);
    },
    [containerRef, setActiveIndex],
  );

  // Arrow/Home/End over every button in DOM order.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key))
        return;
      const container = containerRef.current;
      if (!container) return;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]'),
      );
      if (!(e.target instanceof HTMLElement)) return;
      const currentIdx = items.indexOf(e.target);
      if (currentIdx === -1) return;
      e.preventDefault();
      // Keep handled arrows from reaching window-level listeners (the shell's
      // own key bindings).
      e.stopPropagation();
      if (e.key === "Home") items[0]?.focus();
      else if (e.key === "End") items[items.length - 1]?.focus();
      else {
        const next = ["ArrowDown", "ArrowRight"].includes(e.key)
          ? (currentIdx + 1) % items.length
          : (currentIdx - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    },
    [containerRef],
  );

  const hoveredRowEl = activeIndex !== null ? (orderedRows[activeIndex] ?? null) : null;

  const value = useMemo<MenuScopeValue>(
    () => ({
      registerRow,
      setRowButton,
      setRowActive,
      hoveredRowEl,
      activeRowEl,
      firstRowEl: orderedRows[0] ?? null,
      hasActive: activeRowEl !== null,
    }),
    [registerRow, setRowButton, setRowActive, hoveredRowEl, activeRowEl, orderedRows],
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
    value,
    containerProps: {
      onMouseEnter: handlers.onMouseEnter,
      onMouseMove,
      onMouseLeave: handlers.onMouseLeave,
      onFocus,
      onBlur,
      // Pointer interaction switches modality back to pointer. Clicking the
      // already-focused row never re-fires focus, so without this the
      // keyboard ring would stick until focus left the menu.
      onPointerDown,
      onKeyDown,
    },
    overlays,
  };
}

// ─── SidebarMenu ─────────────────────────────────────────────────────────────

interface SidebarMenuProps extends LiHTMLAttributes<HTMLUListElement> {
  /** Pins the menu's rows to one step of the size ladder. Omitted, they
   *  follow the surrounding SizeProvider. */
  size?: SizeVariant;
}

const SidebarMenu = forwardRef<HTMLUListElement, SidebarMenuProps>(
  ({ className, size, children, ...props }, ref) => {
    const containerRef = useRef<HTMLUListElement>(null);
    const { value, containerProps, overlays } = useMenuScope(containerRef);

    const content = (
      <MenuScopeContext.Provider value={value}>
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
      </MenuScopeContext.Provider>
    );

    return size ? <SizeProvider size={size}>{content}</SizeProvider> : content;
  },
);
SidebarMenu.displayName = "SidebarMenu";

// ─── SidebarMenuItem ─────────────────────────────────────────────────────────

type SidebarMenuItemProps = LiHTMLAttributes<HTMLLIElement>;

function useMenuRow(): MenuItemContextValue {
  const scope = useContext(MenuScopeContext);
  const registerRow = scope?.registerRow;
  const setRowButton = scope?.setRowButton;
  const setRowActive = scope?.setRowActive;

  const [rowEl, setRow] = useState<HTMLLIElement | null>(null);

  useIsoLayoutEffect(() => {
    if (!rowEl || !registerRow) return;
    return registerRow(rowEl);
  }, [registerRow, rowEl]);

  const setActive = useCallback(
    (active: boolean) => {
      if (rowEl && setRowActive) setRowActive(rowEl, active);
    },
    [setRowActive, rowEl],
  );

  const setButtonEl = useCallback(
    (el: HTMLElement | null) => {
      if (rowEl && setRowButton) setRowButton(rowEl, el);
    },
    [setRowButton, rowEl],
  );

  const isHovered = rowEl !== null && scope?.hoveredRowEl === rowEl;
  const isActiveRow = rowEl !== null && scope?.activeRowEl === rowEl;

  return useMemo(
    () => ({ rowEl, setRow, isHovered, isActiveRow, setActive, setButtonEl }),
    [rowEl, setRow, isHovered, isActiveRow, setActive, setButtonEl],
  );
}

const SidebarMenuItem = forwardRef<HTMLLIElement, SidebarMenuItemProps>(
  ({ className, children, ...props }, ref) => {
    const item = useMenuRow();
    return (
      <MenuItemContext.Provider value={item}>
        <li
          ref={composeRefs(item.setRow, ref)}
          data-sidebar="menu-item"
          className={cn("group/menu-item relative", className)}
          {...props}
        >
          {children}
        </li>
      </MenuItemContext.Provider>
    );
  },
);
SidebarMenuItem.displayName = "SidebarMenuItem";

// ─── Row label (ghost-span weight animation) ─────────────────────────────────

/** Splits leading string children out as the label so it can get the
 *  ghost-span weight treatment; remaining element children (dots, trailing
 *  icons) render as flex siblings after it — outside the text-box-trimmed
 *  span, which would clip an inline SVG, and where `ml-auto` can push a
 *  trailing control to the row's end. */
function MenuRowLabel({
  content,
  lit,
  emphasized,
  textClass,
}: {
  content: ReactNode;
  lit: boolean;
  emphasized: boolean;
  textClass: string;
}) {
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

  // Ghost: reserves width at the heaviest weight, hidden from AT. Both cells
  // truncate so a long label clips with an ellipsis instead of wrapping the
  // row. The trim box spans cap height to baseline, so the overflow clip
  // would shave ascenders and descenders — symmetric padding extends the clip
  // box past both and the negative margins cancel it out of the row's height.
  return (
    <>
      <span className={cn("inline-grid min-w-0 text-left", textClass)}>
        <span
          className="col-start-1 row-start-1 invisible truncate pt-[0.25em] -mt-[0.25em] pb-[0.25em] -mb-[0.25em] [text-box:trim-both_cap_alphabetic]"
          style={{ fontVariationSettings: fontWeights.semibold }}
          aria-hidden="true"
        >
          {text}
        </span>
        <span
          className={cn(
            "col-start-1 row-start-1 truncate pt-[0.25em] -mt-[0.25em] pb-[0.25em] -mb-[0.25em] transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
            lit ? "text-foreground" : "text-muted-foreground",
          )}
          style={{
            fontVariationSettings: emphasized ? fontWeights.semibold : fontWeights.normal,
          }}
        >
          {text}
        </span>
      </span>
      {rest}
    </>
  );
}

// ─── SidebarMenuButton ───────────────────────────────────────────────────────

interface SidebarMenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
  icon?: IconComponent;
}

const SidebarMenuButton = forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ isActive = false, icon: Icon, className, children, ...props }, ref) => {
    const scope = useContext(MenuScopeContext);
    const item = useContext(MenuItemContext);
    const radius = useRadius();
    const sizeClasses = useSize();
    const buttonRef = useRef<HTMLButtonElement | null>(null);

    const setActive = item?.setActive;
    useIsoLayoutEffect(() => {
      setActive?.(isActive);
      return () => setActive?.(false);
    }, [isActive, setActive]);

    const setButtonEl = item?.setButtonEl;
    useIsoLayoutEffect(() => {
      setButtonEl?.(buttonRef.current);
      return () => setButtonEl?.(null);
    }, [setButtonEl]);
    const lit = isActive || (item?.isHovered ?? false);
    const heightClass = sizeClasses.variant === "compact" ? "h-7" : "h-8";

    // Roving tabindex: the active row's button is the menu's tab stop; with no
    // active row, the first row keeps the menu keyboard-reachable.
    const row = item?.rowEl ?? null;
    const tabIdx = isActive
      ? 0
      : scope?.hasActive
        ? -1
        : scope !== null && row !== null && row === scope.firstRowEl
          ? 0
          : -1;

    return (
      <button
        ref={composeRefs(buttonRef, ref)}
        type="button"
        data-sidebar="menu-button"
        data-active={isActive ? "true" : undefined}
        aria-current={isActive ? "page" : undefined}
        tabIndex={tabIdx}
        className={cn(
          "peer/menu-button relative z-10 flex w-full cursor-pointer select-none items-center gap-2 px-2 text-left outline-none",
          heightClass,
          radius.item,
          className,
        )}
        {...props}
      >
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={lit ? 2 : 1.5}
            className={cn(
              "shrink-0 transition-[color,stroke-width] duration-80",
              lit ? "text-foreground" : "text-muted-foreground",
            )}
          />
        )}
        <MenuRowLabel
          content={children}
          lit={lit}
          emphasized={isActive}
          textClass={sizeClasses.text}
        />
      </button>
    );
  },
);
SidebarMenuButton.displayName = "SidebarMenuButton";

export { SidebarMenu, SidebarMenuItem, SidebarMenuButton };
