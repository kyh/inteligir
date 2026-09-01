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
  forwardRef,
  type ReactNode,
  type ComponentProps,
  type RefObject,
} from "react";
import { motion } from "framer-motion";
import { Menu } from "@base-ui/react/menu";

import { cn } from "@repo/ui/lib/utils";
import { spring, exitFallbackMs } from "@repo/ui/lib/springs";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { ProximityOverlays } from "@repo/ui/hooks/proximity-overlays";
import { useProximityHover } from "@repo/ui/hooks/use-proximity-hover";
import { radiusMap } from "@repo/ui/lib/radius-context";
import { SizeProvider, useSize, type SizeVariant } from "@repo/ui/lib/size-context";
import { Elevated } from "@repo/ui/lib/elevated";

// The menu opts out of the global pill/rounded radius context — popup
// surfaces look cleaner with the smaller "rounded" radii regardless of how the
// rest of the UI is rounded (the heavy pill bubbling distorts perceived padding
// at this scale and produces the corner-shadow asymmetry).
const radius = radiusMap.rounded;

// ---------------------------------------------------------------------------
// DropdownMenu (root)
//
// Built on Base UI's Menu primitive, which owns the trigger wiring,
// positioning (collision flipping, anchor tracking), dismissal (outside
// press, focus-out, Escape), roving highlight, typeahead, and close-on-select.
// This layer keeps the proximity-hover overlays and the
// spring open/close animation (via actionsRef deferred unmount) — the same
// verified pattern as select.tsx.
// ---------------------------------------------------------------------------

interface DropdownMenuActions {
  unmount: () => void;
  close: () => void;
}

interface DropdownMenuContextValue {
  open: boolean;
  actionsRef: RefObject<DropdownMenuActions | null>;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext() {
  const ctx = useContext(DropdownMenuContext);
  if (!ctx) throw new Error("DropdownMenu compound components must be inside <DropdownMenu>");
  return ctx;
}

/** What the popup hands its rows: proximity registration plus the shared
 *  active index the traveling hover overlay is drawn from. */
interface DropdownItemsContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
}

const DropdownItemsContext = createContext<DropdownItemsContextValue | null>(null);

function useDropdownItems() {
  const ctx = useContext(DropdownItemsContext);
  if (!ctx) throw new Error("DropdownMenuItem must render inside <DropdownMenuContent>");
  return ctx;
}

interface DropdownMenuProps {
  children: ReactNode;
  open?: boolean | undefined;
  defaultOpen?: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
  disabled?: boolean;
  /** Local default over fluid's hardcoded value, kept overridable: non-modal
   *  so Base UI's scroll-lock/inert never steals the editor selection — every
   *  menu in this app opens over live editor content (block menu, table menu,
   *  selection toolbar). Non-modal also keeps the Positioner tracking its
   *  anchor, so the popup follows the trigger instead of detaching. */
  modal?: boolean;
  /** Pins trigger-side content and the portalled popup rows to one step of
   *  the size ladder (default 36px, compact 28px). Omitted, they follow the
   *  surrounding SizeProvider. */
  size?: SizeVariant | undefined;
}

function DropdownMenu({
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  modal = false,
  size,
}: DropdownMenuProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp !== undefined ? openProp : internalOpen;
  const actionsRef = useRef<DropdownMenuActions | null>(null);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  const ctx = useMemo(() => ({ open, actionsRef }), [open]);

  // A size prop pins the whole compound (trigger content + portalled popup —
  // React context crosses portals) to one ladder step.
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
}

DropdownMenu.displayName = "DropdownMenu";

// ---------------------------------------------------------------------------
// DropdownMenuTrigger
//
// Base UI's Menu.Trigger. Composes via the `render` prop, so any element can
// be the trigger:
//
//   <DropdownMenuTrigger render={<Button variant="secondary">Open</Button>} />
// ---------------------------------------------------------------------------

const DropdownMenuTrigger = Menu.Trigger;

// ---------------------------------------------------------------------------
// DropdownMenuContent (popup panel)
//
// Portal > Positioner > Popup carrying the fluid panel visuals: Elevated
// surface and the proximity-hover overlays.
// ---------------------------------------------------------------------------

type MenuPositionerProps = ComponentProps<typeof Menu.Positioner>;

interface DropdownMenuContentProps {
  children: ReactNode;
  className?: string | undefined;
  side?: MenuPositionerProps["side"];
  align?: MenuPositionerProps["align"];
  sideOffset?: number | undefined;
  alignOffset?: number | undefined;
  /** Local extension over fluid: detached menus (a file-tree row's actions
   *  button, the table options button) position against an element or ref
   *  instead of a rendered Menu.Trigger. */
  anchor?: MenuPositionerProps["anchor"];
}

const DropdownMenuContent = forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  (
    {
      className,
      children,
      side = "bottom",
      align = "start",
      sideOffset = 6,
      alignOffset = 0,
      anchor,
    },
    ref,
  ) => {
    const { open, actionsRef } = useDropdownMenuContext();
    const containerRef = useRef<HTMLDivElement | null>(null);

    const {
      activeIndex,
      setActiveIndex,
      itemRects,
      session,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef);

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

    // Release Base UI's deferred unmount once the exit tween has played.
    // onAnimationComplete on the motion.div is the primary signal; this
    // timeout is a fallback for throttled/background tabs where rAF-driven
    // animation callbacks can stall. The popup exits with spring.fast, so the
    // fallback tracks that tier's exit duration plus a safety buffer.
    useEffect(() => {
      if (open) return;
      const id = setTimeout(() => actionsRef.current?.unmount(), exitFallbackMs(spring.fast));
      return () => clearTimeout(id);
    }, [open, actionsRef]);

    // Measure items once the popup has mounted.
    useEffect(() => {
      if (!open) return;
      // Double rAF: first waits for React commit, second for layout
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

    const itemsCtx = useMemo(() => ({ registerItem, activeIndex }), [registerItem, activeIndex]);

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
            // A popup opening upward grows from its bottom edge — the edge
            // anchored to the trigger — so the offset and origin flip with
            // `side`.
            initial={{ opacity: 0, y: side === "top" ? 4 : -4, scaleY: 0.96 }}
            animate={
              open
                ? { opacity: 1, y: 0, scaleY: 1 }
                : { opacity: 0, y: side === "top" ? 4 : -4, scaleY: 0.96 }
            }
            transition={open ? spring.fast : spring.fast.exit}
            style={{
              transformOrigin: side === "top" ? "bottom center" : "top center",
            }}
            // Base UI defers unmount while actionsRef is set; release it once
            // the exit spring has finished so the close animation fully plays.
            onAnimationComplete={() => {
              if (!open) actionsRef.current?.unmount();
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
                  handlers.onMouseEnter();
                  setFocusedIndex(null);
                }}
                onMouseMove={handlers.onMouseMove}
                onMouseLeave={handlers.onMouseLeave}
                onFocus={(e) => {
                  const indexAttr = e.target
                    .closest("[data-proximity-index]")
                    ?.getAttribute("data-proximity-index");
                  if (indexAttr != null) {
                    const idx = Number(indexAttr);
                    setActiveIndex(idx);
                    setFocusedIndex(e.target.matches(":focus-visible") ? idx : null);
                  }
                }}
                onBlur={(e) => {
                  if (containerRef.current?.contains(e.relatedTarget)) return;
                  setFocusedIndex(null);
                  setActiveIndex(null);
                }}
                className={cn(
                  // min-w tracks the trigger via the Positioner's
                  // --anchor-width var.
                  `relative flex flex-col gap-0.5 w-72 max-w-full min-w-[var(--anchor-width)] max-h-[min(480px,var(--available-height))] overflow-y-auto ${radius.container} p-1 select-none outline-none`,
                  className,
                )}
              >
                <ProximityOverlays
                  hoverRect={activeIndex !== null ? (itemRects[activeIndex] ?? null) : null}
                  focusRect={focusedIndex !== null ? (itemRects[focusedIndex] ?? null) : null}
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
  },
);

DropdownMenuContent.displayName = "DropdownMenuContent";

// ---------------------------------------------------------------------------
// DropdownMenuLabel
// ---------------------------------------------------------------------------

const DropdownMenuLabel = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ className, ...props }, ref) => {
    const compact = useSize().variant === "compact";
    return (
      <div
        ref={ref}
        className={cn(
          "px-2 py-1.5 shrink-0 text-muted-foreground",
          compact ? "text-[11px]" : "text-[12px]",
          className,
        )}
        {...props}
      />
    );
  },
);

DropdownMenuLabel.displayName = "DropdownMenuLabel";

// ---------------------------------------------------------------------------
// DropdownMenuSeparator
// ---------------------------------------------------------------------------

const DropdownMenuSeparator = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="separator"
      className={cn("my-1 -mx-1 h-px shrink-0 bg-border/60", className)}
      {...props}
    />
  ),
);

DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

// ---------------------------------------------------------------------------
// DropdownMenuItem — a free-form row (arbitrary children).
// ---------------------------------------------------------------------------

interface DropdownMenuItemProps extends ComponentProps<"div"> {
  disabled?: boolean | undefined;
  variant?: "default" | "destructive" | undefined;
  /** Whether activating the item closes the menu. @default true */
  closeOnClick?: boolean | undefined;
}

// Each row finds its own index by DOM order among its menu's rows and
// registers that with the proximity-hover system, so conditional rows need no
// index prop. Base UI's Menu.Item owns role, roving highlight, typeahead and
// activation (keyboard activation synthesizes a click, so the row's onClick
// fires for both).
function DropdownMenuItem({
  className,
  variant = "default",
  disabled,
  closeOnClick,
  children,
  ref,
  ...props
}: DropdownMenuItemProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const { registerItem, activeIndex } = useDropdownItems();
  const [index, setIndex] = useState<number | null>(null);
  const sizeClasses = useSize();

  // No deps: conditional rows (the file tree's dir-only entries) change the
  // DOM order without remounting their siblings, so every commit re-derives.
  // setIndex bails when the position is unchanged, so this cannot loop.
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- see above
  useLayoutEffect(() => {
    const node = rowRef.current;
    const menu = node?.closest('[role="menu"]');
    if (!node || !menu) return;
    const rows = Array.from(menu.querySelectorAll("[data-dropdown-menu-item]"));
    const idx = rows.indexOf(node);
    if (idx !== -1) setIndex(idx);
  });

  useEffect(() => {
    if (index === null) return;
    registerItem(index, rowRef.current);
    return () => registerItem(index, null);
  }, [index, registerItem]);

  const isActive = index !== null && activeIndex === index;

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
            variant === "destructive"
              ? "text-destructive"
              : isActive
                ? "text-foreground"
                : "text-muted-foreground",
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
}

interface DropdownMenuGroupProps extends Omit<ComponentProps<typeof Menu.Group>, "className"> {
  className?: string | undefined;
}

// display: contents keeps grouped rows direct flex children of the popup, so
// the panel's gap layout and the proximity measurement still see them.
function DropdownMenuGroup({ className, ...props }: DropdownMenuGroupProps) {
  return <Menu.Group className={cn("contents", className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
