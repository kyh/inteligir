"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import {
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  createContext,
  useContext,
} from "react";
import type { ComponentProps, ReactNode, RefAttributes, RefObject } from "react";
import { motion } from "framer-motion";
import { Menu } from "@base-ui/react/menu";

import { cn } from "@repo/ui/lib/cn";
import { spring, exitFallbackMs } from "@repo/ui/lib/springs";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { ProximityOverlays } from "@repo/ui/hooks/proximity-overlays";
import { useProximityHover } from "@repo/ui/hooks/use-proximity-hover";
import { radiusMap } from "@repo/ui/lib/radius-context";
import { SizeProvider, useSize } from "@repo/ui/lib/size-context";
import type { SizeVariant } from "@repo/ui/lib/size-context";
import { Elevated } from "@repo/ui/lib/elevated";

// popups ignore the global radius context: the pill radius distorts perceived padding at this
// scale and makes the corner shadow asymmetric.
const radius = radiusMap.rounded;

interface DropdownMenuActions {
  unmount: () => void;
  close: () => void;
}

interface DropdownMenuContextValue {
  open: boolean;
  actionsRef: RefObject<DropdownMenuActions | null>;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

const useDropdownMenuContext = () => {
  const ctx = useContext(DropdownMenuContext);
  if (!ctx) {
    throw new Error("DropdownMenu compound components must be inside <DropdownMenu>");
  }
  return ctx;
};

interface DropdownItemsContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
}

const DropdownItemsContext = createContext<DropdownItemsContextValue | null>(null);

const useDropdownItems = () => {
  const ctx = useContext(DropdownItemsContext);
  if (!ctx) {
    throw new Error("DropdownMenuItem must render inside <DropdownMenuContent>");
  }
  return ctx;
};

interface DropdownMenuProps {
  children: ReactNode;
  open?: boolean | undefined;
  defaultOpen?: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
  disabled?: boolean;
  // default non-modal: Base UI's modal scroll-lock/inert steals the editor selection every menu
  // opens over, and detaches the Positioner from its anchor.
  modal?: boolean;
  size?: SizeVariant | undefined;
}

const DropdownMenu = ({
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  modal = false,
  size,
}: DropdownMenuProps) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp ?? internalOpen;
  const actionsRef = useRef<DropdownMenuActions | null>(null);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (openProp === undefined) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  const ctx = useMemo(() => ({ actionsRef, open }), [open]);

  const root = (
    <DropdownMenuContext.Provider value={ctx}>
      <Menu.Root
        open={open}
        onOpenChange={handleOpenChange}
        actionsRef={actionsRef}
        disabled={disabled}
        modal={modal}
      >
        {children}
      </Menu.Root>
    </DropdownMenuContext.Provider>
  );

  return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
};

DropdownMenu.displayName = "DropdownMenu";

const DropdownMenuTrigger = Menu.Trigger;

type MenuPositionerProps = ComponentProps<typeof Menu.Positioner>;

interface DropdownMenuContentProps {
  children: ReactNode;
  className?: string | undefined;
  side?: MenuPositionerProps["side"];
  align?: MenuPositionerProps["align"];
  sideOffset?: number | undefined;
  alignOffset?: number | undefined;
  anchor?: MenuPositionerProps["anchor"];
}

const DropdownMenuContent = ({
  className,
  children,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  alignOffset = 0,
  anchor,
  ref,
}: DropdownMenuContentProps & RefAttributes<HTMLDivElement>) => {
  const { open, actionsRef } = useDropdownMenuContext();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { activeIndex, setActiveIndex, itemRects, session, handlers, registerItem, measureItems } =
    useProximityHover(containerRef);
  const {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onMouseMove: handleMouseMove,
  } = handlers;

  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Base UI defers unmount while actionsRef is set; the exit spring's onAnimationComplete releases
  // it, and this timer is the fallback for throttled/background tabs where that callback stalls.
  // Only a real open→close has anything to release, and whichever path runs first disarms the
  // other: a timer still armed once the popup is gone outlives the tree it would call into.
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasOpenRef = useRef(false);

  const disarmFallback = useCallback(() => {
    if (fallbackRef.current !== null) {
      clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
  }, []);

  const releaseUnmount = useCallback(() => {
    disarmFallback();
    actionsRef.current?.unmount();
  }, [disarmFallback, actionsRef]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) {
      return;
    }
    wasOpenRef.current = false;
    fallbackRef.current = setTimeout(releaseUnmount, exitFallbackMs(spring.fast));
    return disarmFallback;
  }, [open, releaseUnmount, disarmFallback]);

  useEffect(() => {
    if (!open) {
      return;
    }
    // double rAF: first waits for React commit, second for layout
    let inner: number;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        measureItems();
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open, measureItems]);

  const itemsCtx = useMemo(() => ({ activeIndex, registerItem }), [registerItem, activeIndex]);

  return (
    <Menu.Portal>
      <Menu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50 outline-none"
      >
        <motion.div
          initial={{ opacity: 0, scaleY: 0.96, y: side === "top" ? 4 : -4 }}
          animate={
            open
              ? { opacity: 1, scaleY: 1, y: 0 }
              : { opacity: 0, scaleY: 0.96, y: side === "top" ? 4 : -4 }
          }
          transition={open ? spring.fast : spring.fast.exit}
          style={{
            transformOrigin: side === "top" ? "bottom center" : "top center",
          }}
          onAnimationComplete={() => {
            if (!open) {
              releaseUnmount();
            }
          }}
        >
          <DropdownItemsContext.Provider value={itemsCtx}>
            <Menu.Popup
              render={
                <Elevated
                  offset={2}
                  shadowLevel={3}
                  ref={composeRefs<HTMLDivElement>(containerRef, ref)}
                />
              }
              onMouseEnter={() => {
                handleMouseEnter();
                setFocusedIndex(null);
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onFocus={(e) => {
                const indexAttr =
                  e.target.closest<HTMLElement>("[data-proximity-index]")?.dataset.proximityIndex;
                if (indexAttr !== undefined) {
                  const idx = Number(indexAttr);
                  setActiveIndex(idx);
                  setFocusedIndex(e.target.matches(":focus-visible") ? idx : null);
                }
              }}
              onBlur={(e) => {
                if (containerRef.current?.contains(e.relatedTarget) === true) {
                  return;
                }
                setFocusedIndex(null);
                setActiveIndex(null);
              }}
              className={cn(
                `relative flex flex-col gap-0.5 w-72 max-w-full min-w-[var(--anchor-width)] max-h-[min(480px,var(--available-height))] overflow-y-auto ${radius.container} p-1 select-none outline-none`,
                className,
              )}
            >
              <ProximityOverlays
                hoverRect={activeIndex === null ? null : (itemRects[activeIndex] ?? null)}
                focusRect={focusedIndex === null ? null : (itemRects[focusedIndex] ?? null)}
                session={session}
                radius={radius}
              />
              {children}
            </Menu.Popup>
          </DropdownItemsContext.Provider>
        </motion.div>
      </Menu.Positioner>
    </Menu.Portal>
  );
};

DropdownMenuContent.displayName = "DropdownMenuContent";

const DropdownMenuLabel = ({
  className,
  ref,
  ...props
}: ComponentProps<"div"> & RefAttributes<HTMLDivElement>) => {
  const compact = useSize().variant === "compact";
  return (
    <div
      ref={ref}
      className={cn(
        "px-2 py-1.5 shrink-0 text-muted-foreground",
        compact ? "text-caption" : "text-body",
        className,
      )}
      {...props}
    />
  );
};

DropdownMenuLabel.displayName = "DropdownMenuLabel";

const DropdownMenuSeparator = ({
  className,
  ref,
  ...props
}: ComponentProps<"div"> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <hr> cannot carry the div ref and props this slot exposes
    role="separator"
    className={cn("my-1 -mx-1 h-px shrink-0 bg-border/60", className)}
    {...props}
  />
);

DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

interface DropdownMenuItemProps extends ComponentProps<"div"> {
  disabled?: boolean | undefined;
  variant?: "default" | "destructive" | undefined;
  closeOnClick?: boolean | undefined;
}

const DropdownMenuItem = ({
  className,
  variant = "default",
  disabled = false,
  closeOnClick,
  children,
  ref,
  ...props
}: DropdownMenuItemProps) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const { registerItem, activeIndex } = useDropdownItems();
  const [index, setIndex] = useState<number | null>(null);
  const sizeClasses = useSize();

  // no deps: conditional rows change the DOM order without remounting their siblings, so every
  // commit re-derives; setIndex bails when unchanged, so this cannot loop.
  // oxlint-disable-next-line react/rule-suppression -- the next line is that deliberate suppression
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- see above
  useLayoutEffect(() => {
    const node = rowRef.current;
    const menu = node?.closest('[role="menu"]');
    if (!node || !menu) {
      return;
    }
    const rows = [...menu.querySelectorAll("[data-dropdown-menu-item]")];
    const idx = rows.indexOf(node);
    if (idx !== -1) {
      setIndex(idx);
    }
  });

  useEffect(() => {
    if (index === null) {
      return;
    }
    registerItem(index, rowRef.current);
    return () => {
      registerItem(index, null);
    };
  }, [index, registerItem]);

  const isActive = index !== null && activeIndex === index;
  const activeTone = isActive ? "text-foreground" : "text-muted-foreground";

  return (
    <Menu.Item
      disabled={disabled}
      closeOnClick={closeOnClick ?? true}
      render={
        <div
          ref={composeRefs(rowRef, ref)}
          data-dropdown-menu-item=""
          data-proximity-index={index ?? undefined}
          className={cn(
            `relative z-10 flex ${sizeClasses.control} shrink-0 items-center ${sizeClasses.gap} ${radius.item} ${sizeClasses.itemPx} cursor-pointer outline-none select-none`,
            sizeClasses.text,
            "transition-colors duration-80",
            variant === "destructive" ? "text-destructive" : activeTone,
            "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            disabled && "opacity-50 pointer-events-none",
            className,
          )}
          {...props}
        />
      }
    >
      {children}
    </Menu.Item>
  );
};

interface DropdownMenuGroupProps extends Omit<ComponentProps<typeof Menu.Group>, "className"> {
  className?: string | undefined;
}

// display: contents keeps grouped rows direct flex children of the popup, so the gap layout and
// the proximity measurement still see them.
const DropdownMenuGroup = ({ className, ...props }: DropdownMenuGroupProps) => (
  <Menu.Group className={cn("contents", className)} {...props} />
);

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
