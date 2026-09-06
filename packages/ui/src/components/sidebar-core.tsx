"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useId,
  forwardRef,
  isValidElement,
  Children,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { motion, AnimatePresence, type HTMLMotionProps } from "framer-motion";
import { ChevronDownIcon } from "lucide-react";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { cssVars } from "@repo/ui/lib/css-vars";
import { cn } from "cn";
import { spring } from "@repo/ui/lib/springs";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { useRadius } from "@repo/ui/lib/radius-context";
import { useSize, useSizeVariant } from "@repo/ui/lib/size-context";
import { useSurface, SurfaceProvider } from "@repo/ui/lib/surface-context";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { Tooltip } from "@repo/ui/components/tooltip";
import { useIsoLayoutEffect } from "@repo/ui/lib/use-iso-layout-effect";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
// bare keys: ⌘[ / ⌘] are the browser's history shortcuts
const SIDEBAR_KEYBOARD_SHORTCUT = "[";
const SIDEBAR_KEYBOARD_SHORTCUT_RIGHT = "]";
// exported: every persisted width preference clamps to these
export const SIDEBAR_MIN_WIDTH = 192;
export const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_COLLAPSE_SLOP = 56;

export type SidebarSide = "left" | "right";
export type SidebarVariant = "sidebar" | "floating" | "inset";
export type SidebarCollapsible = "offcanvas" | "none";

interface SidebarContextValue {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  openMobile: boolean;
  setOpenMobile: React.Dispatch<React.SetStateAction<boolean>>;
  isMobile: boolean;
  toggleSidebar: () => void;
  width: string;
  setWidth: (width: string) => void;
  widthMobile: string;
  mobileBreakpoint: number;
  side: SidebarSide;
  registerSide: (side: SidebarSide) => void;
  shortcut: string | null;
  peek: "hover" | "click" | "none";
  isPeeking: boolean;
  setIsPeeking: React.Dispatch<React.SetStateAction<boolean>>;
  isResizing: boolean;
  setIsResizing: React.Dispatch<React.SetStateAction<boolean>>;
}

// the toggle listener is global (the key works without focus in the sidebar), so only one
// provider may answer: the innermost containing focus, else the outermost mounted one
const mountedProviders: HTMLElement[] = [];

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within a SidebarProvider");
  return ctx;
}

// starts undefined so the server and first client render agree; the media query corrects it in an effect
function useIsMobile(breakpoint: number): boolean {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);
  return !!isMobile;
}

type TextChild = string | number;

function isTextChild(node: ReactNode): node is TextChild {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ReactNode is React's own union and carries no discriminant, so `typeof` is the only way to tell a text child from an element; this predicate is the single place that asks.
  return typeof node === "string" || typeof node === "number";
}

interface LeadingText {
  text: string;
  rest: ReactNode[];
}

export function splitLeadingText(content: ReactNode): LeadingText {
  const nodes = Children.toArray(content);
  const leading: TextChild[] = [];
  for (const node of nodes) {
    if (!isTextChild(node)) break;
    leading.push(node);
  }
  return { text: leading.join(""), rest: nodes.slice(leading.length) };
}

interface SidebarProviderProps extends HTMLAttributes<HTMLDivElement> {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  shortcut?: string | null;
  mobileBreakpoint?: number;
  peek?: "hover" | "click" | "none";
  width?: string;
  widthMobile?: string;
}

const SidebarProvider = forwardRef<HTMLDivElement, SidebarProviderProps>(
  (
    {
      defaultOpen = true,
      open: openProp,
      onOpenChange,
      shortcut: shortcutProp,
      mobileBreakpoint = 768,
      peek = "none",
      width: widthProp = SIDEBAR_WIDTH,
      widthMobile = SIDEBAR_WIDTH_MOBILE,
      className,
      style,
      children,
      ...props
    },
    ref,
  ) => {
    const isMobile = useIsMobile(mobileBreakpoint);
    const [openMobile, setOpenMobile] = useState(false);
    const [side, setSide] = useState<SidebarSide>("left");
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const el = wrapperRef.current;
      if (!el) return;
      mountedProviders.push(el);
      return () => {
        const i = mountedProviders.indexOf(el);
        if (i !== -1) mountedProviders.splice(i, 1);
      };
    }, []);
    const registerSide = useCallback((next: SidebarSide) => setSide(next), []);

    const [width, setWidth] = useState(widthProp);
    const [prevWidthProp, setPrevWidthProp] = useState(widthProp);
    if (prevWidthProp !== widthProp) {
      setPrevWidthProp(widthProp);
      setWidth(widthProp);
    }
    const [isResizing, setIsResizing] = useState(false);

    const shortcut =
      shortcutProp === undefined
        ? side === "right"
          ? SIDEBAR_KEYBOARD_SHORTCUT_RIGHT
          : SIDEBAR_KEYBOARD_SHORTCUT
        : shortcutProp;

    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const open = openProp ?? internalOpen;

    const setOpen = useCallback(
      (value: boolean | ((prev: boolean) => boolean)) => {
        const next = value instanceof Function ? value(open) : value;
        if (onOpenChange) onOpenChange(next);
        else setInternalOpen(next);
      },
      [open, onOpenChange],
    );

    const toggleSidebar = useCallback(() => {
      if (isMobile) setOpenMobile((prev) => !prev);
      else setOpen((prev) => !prev);
    }, [isMobile, setOpen]);

    const [isPeeking, setIsPeeking] = useState(false);
    if (isPeeking && (open || peek === "none")) setIsPeeking(false);

    useEffect(() => {
      if (shortcut == null) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key.toLowerCase() !== shortcut.toLowerCase()) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable
        )
          return;
        // providers nest, so containment alone is not enough: the innermost containing focus wins
        const root = wrapperRef.current;
        if (!root) return;
        if (root.contains(target)) {
          if (
            mountedProviders.some((el) => el !== root && root.contains(el) && el.contains(target))
          )
            return;
        } else {
          if (mountedProviders.some((el) => el !== root && el.contains(target))) return;
          // focus outside every provider: the outermost answers; mount order is unreliable
          const outermost = mountedProviders.find(
            (el) => !mountedProviders.some((other) => other !== el && other.contains(el)),
          );
          if (outermost !== root) return;
        }
        event.preventDefault();
        toggleSidebar();
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [shortcut, toggleSidebar]);

    const value = useMemo<SidebarContextValue>(
      () => ({
        state: open ? "expanded" : "collapsed",
        open,
        setOpen,
        openMobile,
        setOpenMobile,
        isMobile,
        toggleSidebar,
        width,
        setWidth,
        widthMobile,
        mobileBreakpoint,
        side,
        registerSide,
        shortcut,
        peek,
        isPeeking,
        setIsPeeking,
        isResizing,
        setIsResizing,
      }),
      [
        open,
        setOpen,
        openMobile,
        isMobile,
        toggleSidebar,
        width,
        widthMobile,
        mobileBreakpoint,
        side,
        registerSide,
        shortcut,
        peek,
        isPeeking,
        isResizing,
      ],
    );

    return (
      <SidebarContext.Provider value={value}>
        <div
          ref={composeRefs(wrapperRef, ref)}
          data-slot="sidebar-wrapper"
          className={cn("group/sidebar-wrapper relative flex min-h-svh w-full", className)}
          style={cssVars({
            "--sidebar-width": width,
            "--sidebar-width-mobile": widthMobile,
            ...style,
          })}
          {...props}
        >
          {children}
        </div>
      </SidebarContext.Provider>
    );
  },
);
SidebarProvider.displayName = "SidebarProvider";

// literal map so Tailwind's scanner emits the utilities; standard breakpoints also hide the shell by
// CSS before hydration, non-standard ones rely on the JS isMobile branch alone
const BREAKPOINT_HIDDEN = new Map([
  [640, "max-sm:hidden"],
  [768, "max-md:hidden"],
  [1024, "max-lg:hidden"],
  [1280, "max-xl:hidden"],
]);

// framer's own prop type: a DOM-typed HTMLAttributes spread cannot satisfy motion.div under
// exactOptionalPropertyTypes
type MotionSafeDivProps = Omit<HTMLMotionProps<"div">, "ref" | "children"> & {
  children?: ReactNode;
};

interface SidebarShellProps extends MotionSafeDivProps {
  side: SidebarSide;
  variant: SidebarVariant;
  bordered?: boolean;
  rail?: boolean;
}

const SidebarShell = forwardRef<HTMLDivElement, SidebarShellProps>(
  ({ side, variant, bordered = true, rail = true, className, children, ...props }, ref) => {
    const { open, width, mobileBreakpoint, isResizing, peek, isPeeking, setIsPeeking } =
      useSidebar();
    const radius = useRadius();
    const shellRef = useRef<HTMLDivElement | null>(null);

    const peekEnabled = peek !== "none" && !open;
    const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearPeekTimer = useCallback(() => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }, []);
    const schedulePeek = useCallback(() => {
      clearPeekTimer();
      peekTimer.current = setTimeout(() => setIsPeeking(true), 150);
    }, [clearPeekTimer, setIsPeeking]);
    const scheduleDismiss = useCallback(() => {
      clearPeekTimer();
      peekTimer.current = setTimeout(() => setIsPeeking(false), 250);
    }, [clearPeekTimer, setIsPeeking]);
    useEffect(() => clearPeekTimer, [clearPeekTimer]);
    useEffect(() => {
      if (!(peekEnabled && isPeeking)) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setIsPeeking(false);
      };
      const onPointerDown = (event: PointerEvent) => {
        if (event.target instanceof Node && shellRef.current?.contains(event.target)) return;
        setIsPeeking(false);
      };
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("pointerdown", onPointerDown);
      return () => {
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("pointerdown", onPointerDown);
      };
    }, [peekEnabled, isPeeking, setIsPeeking]);
    const substrate = useSurface();
    const floatingLevel = Math.min(substrate + 1, 8);
    const widthTransition = isResizing
      ? { duration: 0 }
      : open
        ? spring.moderate
        : spring.moderate.exit;

    return (
      <motion.div
        ref={composeRefs(shellRef, ref)}
        data-slot="sidebar"
        data-state={open ? "expanded" : "collapsed"}
        data-collapsible={open ? "" : "offcanvas"}
        data-variant={variant}
        data-side={side}
        className={cn(
          // no bare `group`: it would fire every descendant's group-hover on rail hover
          "peer shrink-0 sticky top-0 h-svh",
          // while peek is armed the 0-width shell must not clip the edge strip or the overlay
          // card, and must rise above the inset (a later sibling)
          peekEnabled ? "z-40" : "overflow-hidden",
          // flex order decides the side, so Sidebar can stay before SidebarInset in the DOM
          side === "right" && "order-last",
          BREAKPOINT_HIDDEN.get(mobileBreakpoint),
          className,
        )}
        initial={false}
        animate={{ width: open ? width : "0rem" }}
        transition={widthTransition}
        // dismissal lives on the shell root: the card slides in under a stationary cursor, so
        // per-element leave events are unreliable
        onPointerEnter={peekEnabled && peek === "hover" ? clearPeekTimer : undefined}
        onPointerLeave={
          peekEnabled && peek === "hover"
            ? () => {
                if (isPeeking) scheduleDismiss();
                else clearPeekTimer();
              }
            : undefined
        }
        {...props}
      >
        {peekEnabled ? (
          <>
            <button
              type="button"
              aria-label="Peek sidebar"
              aria-expanded={isPeeking}
              className={cn(
                "group/peek-strip absolute inset-y-0 z-40 w-3 cursor-pointer outline-none",
                side === "left" ? "left-0" : "right-0",
              )}
              onPointerEnter={
                peek === "hover"
                  ? (event) => {
                      if (event.pointerType === "mouse") schedulePeek();
                    }
                  : undefined
              }
              onClick={() => {
                clearPeekTimer();
                setIsPeeking(true);
              }}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-y-0 w-px bg-border opacity-0 transition-opacity duration-80 group-hover/peek-strip:opacity-100 group-focus-visible/peek-strip:opacity-100",
                  side === "left" ? "left-0" : "right-0",
                )}
              />
            </button>
            <AnimatePresence>
              {isPeeking && (
                <motion.div
                  data-sidebar="peek"
                  className={cn(
                    "absolute inset-y-2 z-50 flex flex-col overflow-hidden",
                    side === "left" ? "left-2" : "right-2",
                    radius.container,
                    surfaceClasses(floatingLevel, 3),
                  )}
                  style={{ width: `calc(${width} - 1rem)` }}
                  initial={{ x: side === "left" ? "-108%" : "108%" }}
                  animate={{ x: 0 }}
                  exit={{
                    x: side === "left" ? "-108%" : "108%",
                    transition: spring.moderate.exit,
                  }}
                  transition={spring.moderate}
                >
                  <SurfaceProvider value={floatingLevel}>{children}</SurfaceProvider>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <motion.div
            className={cn(
              "absolute inset-y-0 flex h-full flex-col",
              side === "left" ? "left-0" : "right-0",
              variant === "floating" && "p-2",
              variant === "inset" && "py-2",
            )}
            style={{ width }}
            initial={false}
            animate={{ x: open ? "0%" : side === "left" ? "-100%" : "100%" }}
            transition={widthTransition}
          >
            {variant === "floating" ? (
              <div
                data-sidebar="sidebar"
                className={cn(
                  "flex h-full w-full min-h-0 flex-col",
                  radius.container,
                  surfaceClasses(floatingLevel, 3),
                )}
              >
                <SurfaceProvider value={floatingLevel}>{children}</SurfaceProvider>
              </div>
            ) : (
              <div
                data-sidebar="sidebar"
                className={cn(
                  "flex h-full w-full min-h-0 flex-col",
                  bordered &&
                    variant === "sidebar" &&
                    (side === "left" ? "border-r border-border" : "border-l border-border"),
                )}
              >
                {children}
              </div>
            )}
            {rail && (
              <SidebarRail
                className={cn(
                  variant === "floating" &&
                    (side === "left" ? "right-1 after:right-[3.5px]" : "left-1 after:left-[3.5px]"),
                  variant !== "sidebar" &&
                    "after:inset-y-2 after:[mask-image:linear-gradient(to_bottom,transparent_var(--rail-fade-start),black_var(--rail-fade-end),black_calc(100%-var(--rail-fade-end)),transparent_calc(100%-var(--rail-fade-start)))]",
                )}
                style={
                  variant !== "sidebar"
                    ? cssVars({
                        "--rail-fade-start": `${radius.bgRadius >= 20 ? 24 : 12}px`,
                        "--rail-fade-end": `${(radius.bgRadius >= 20 ? 24 : 12) + 24}px`,
                      })
                    : undefined
                }
              />
            )}
          </motion.div>
        )}
      </motion.div>
    );
  },
);
SidebarShell.displayName = "SidebarShell";

function ShortcutKbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="-my-1 flex h-4 min-w-4 items-center justify-center rounded border border-background/30 px-1 font-sans text-[10px] text-background/80">
      {children}
    </kbd>
  );
}

function useShortcutKey(): string {
  const { side, shortcut } = useSidebar();
  return (
    shortcut ?? (side === "right" ? SIDEBAR_KEYBOARD_SHORTCUT_RIGHT : SIDEBAR_KEYBOARD_SHORTCUT)
  );
}

type SidebarRailProps = HTMLAttributes<HTMLButtonElement>;

const SidebarRail = forwardRef<HTMLButtonElement, SidebarRailProps>(
  ({ className, ...props }, ref) => {
    const { toggleSidebar, setOpen, setWidth, side, setIsResizing } = useSidebar();
    const shortcutKey = useShortcutKey();
    const railRef = useRef<HTMLButtonElement | null>(null);
    const dragRef = useRef<{ startX: number; startWidth: number; moved: boolean } | null>(null);
    const [dragging, setDragging] = useState(false);

    const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
      const closest = railRef.current?.closest('[data-slot="sidebar"]');
      const panel = closest instanceof HTMLElement ? closest : null;
      if (!panel) return;
      dragRef.current = { startX: event.clientX, startWidth: panel.offsetWidth, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        setDragging(true);
        setIsResizing(true);
      }
      const delta = side === "left" ? dx : -dx;
      const raw = drag.startWidth + delta;
      if (raw < SIDEBAR_MIN_WIDTH - SIDEBAR_COLLAPSE_SLOP) {
        dragRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
        setIsResizing(false);
        setWidth(`${SIDEBAR_MIN_WIDTH}px`);
        setOpen(false);
        return;
      }
      const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, raw));
      setWidth(`${next}px`);
    };

    const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setDragging(false);
      setIsResizing(false);
      if (drag && !drag.moved) toggleSidebar();
    };

    const semibold = { fontVariationSettings: fontWeights.semibold };

    return (
      <Tooltip
        side={side === "left" ? "right" : "left"}
        sideOffset={8}
        followCursor="y"
        forceOpen={dragging ? false : undefined}
        content={
          <span className="flex flex-col items-start gap-1 py-0.5">
            <span>
              <span style={semibold}>Drag</span> to resize
            </span>
            <span className="flex items-center gap-1.5">
              <span className="[text-box:trim-both_cap_alphabetic]">
                <span style={semibold}>Click</span> to collapse
              </span>
              <ShortcutKbd>{shortcutKey}</ShortcutKbd>
            </span>
          </span>
        }
      >
        <button
          ref={composeRefs(railRef, ref)}
          type="button"
          data-sidebar="rail"
          aria-label="Resize or collapse sidebar"
          tabIndex={-1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={cn(
            "absolute inset-y-0 z-20 w-2 cursor-col-resize outline-none",
            // positioned from context, not group-data selectors, so a className offset can win the merge
            side === "left" ? "right-0" : "left-0",
            "after:absolute after:inset-y-0 after:w-px after:bg-transparent hover:after:bg-foreground/25 after:transition-colors after:duration-80",
            side === "left" ? "after:right-0" : "after:left-0",
            className,
          )}
          {...props}
        />
      </Tooltip>
    );
  },
);
SidebarRail.displayName = "SidebarRail";

type SidebarInsetProps = HTMLAttributes<HTMLElement>;

const SidebarInset = forwardRef<HTMLElement, SidebarInsetProps>(({ className, ...props }, ref) => {
  const radius = useRadius();
  return (
    <main
      ref={ref}
      data-slot="sidebar-inset"
      className={cn(
        "relative flex min-h-0 w-full min-w-0 flex-1 flex-col bg-background",
        "peer-data-[variant=inset]:m-2 peer-data-[variant=inset]:peer-data-[side=left]:ml-0 peer-data-[variant=inset]:peer-data-[side=right]:mr-0",
        "peer-data-[variant=inset]:peer-data-[state=collapsed]:peer-data-[side=left]:ml-2 peer-data-[variant=inset]:peer-data-[state=collapsed]:peer-data-[side=right]:mr-2",
        "transition-[margin] duration-80",
        // literal classes so Tailwind's scanner emits both
        radius.bgRadius >= 20
          ? "peer-data-[variant=inset]:rounded-3xl"
          : "peer-data-[variant=inset]:rounded-xl",
        "peer-data-[variant=inset]:bg-surface-2 peer-data-[variant=inset]:shadow-surface-2",
        className,
      )}
      {...props}
    />
  );
});
SidebarInset.displayName = "SidebarInset";

type SidebarInputProps = React.InputHTMLAttributes<HTMLInputElement>;

const SidebarInput = forwardRef<HTMLInputElement, SidebarInputProps>(
  ({ className, ...props }, ref) => {
    const radius = useRadius();
    const size = useSize();
    return (
      <input
        ref={ref}
        data-sidebar="input"
        className={cn(
          "w-full bg-transparent px-3 text-foreground placeholder:text-muted-foreground outline-none",
          "ring-1 ring-transparent transition-[background-color,box-shadow] duration-80",
          "hover:bg-muted/50 hover:ring-border",
          "focus:bg-card focus:ring-border",
          "focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
          size.variant === "compact" ? "h-7" : "h-8",
          size.text,
          radius.input,
          className,
        )}
        {...props}
      />
    );
  },
);
SidebarInput.displayName = "SidebarInput";

type SidebarSectionProps = HTMLAttributes<HTMLDivElement>;

const SidebarHeader = forwardRef<HTMLDivElement, SidebarSectionProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar="header"
      className={cn("flex shrink-0 flex-col gap-2 p-2", className)}
      {...props}
    />
  ),
);
SidebarHeader.displayName = "SidebarHeader";

const SidebarFooter = forwardRef<HTMLDivElement, SidebarSectionProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar="footer"
      className={cn("mt-auto flex shrink-0 flex-col gap-2 p-2", className)}
      {...props}
    />
  ),
);
SidebarFooter.displayName = "SidebarFooter";

interface SidebarGroupContextValue {
  open: boolean;
  toggle: () => void;
  contentId: string;
}

const SidebarGroupContext = createContext<SidebarGroupContextValue | null>(null);

interface SidebarGroupProps extends SidebarSectionProps {
  collapsible?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const SidebarGroup = forwardRef<HTMLDivElement, SidebarGroupProps>(
  (
    {
      className,
      collapsible = false,
      open: openProp,
      defaultOpen = true,
      onOpenChange,
      children,
      ...props
    },
    ref,
  ) => {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const open = openProp ?? uncontrolledOpen;
    const contentId = useId();
    const toggle = useCallback(() => {
      const next = !(openProp ?? uncontrolledOpen);
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    }, [openProp, uncontrolledOpen, onOpenChange]);
    // never animate to "auto": framer measures it wrong under a scaled ancestor
    const contentRef = useRef<HTMLDivElement>(null);
    const [contentHeight, setContentHeight] = useState<number | null>(null);
    useIsoLayoutEffect(() => {
      if (!collapsible) return;
      const el = contentRef.current;
      if (!el) return;
      const measure = () => setContentHeight(el.offsetHeight);
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, [collapsible]);
    const measured = contentHeight !== null;
    // clipping lifts once an open group settles: a permanently clipped box shaves the focus ring
    // off the first and last rows
    const [settled, setSettled] = useState(open);
    if (settled && !open) setSettled(false);

    const [prevOpen, setPrevOpen] = useState(open);
    const [toggling, setToggling] = useState(false);
    if (prevOpen !== open) {
      setPrevOpen(open);
      setToggling(true);
    }

    let inner: ReactNode = children;
    if (collapsible) {
      const kids = Children.toArray(children);
      const labelIdx = kids.findIndex((k) => isValidElement(k) && k.type === SidebarGroupLabel);
      if (labelIdx !== -1) {
        const rest = kids.slice(labelIdx + 1);
        inner = (
          <>
            {kids.slice(0, labelIdx + 1)}
            <motion.div
              id={contentId}
              inert={open ? undefined : true}
              className={cn(
                open && settled ? "overflow-visible" : "overflow-hidden",
                !measured && !open && "h-0",
              )}
              initial={false}
              animate={
                measured
                  ? { height: open ? contentHeight : 0, opacity: open ? 1 : 0 }
                  : { opacity: open ? 1 : 0 }
              }
              // not `open ? spring.moderate : …`: the toggling arm stops a re-measure under a settled
              // group from springing, which slides everything below the group late
              transition={
                toggling ? (open ? spring.moderate : spring.moderate.exit) : { duration: 0 }
              }
              onAnimationComplete={() => {
                setToggling(false);
                if (open) setSettled(true);
              }}
            >
              <div ref={contentRef} className="flex w-full min-w-0 flex-col">
                {rest}
              </div>
            </motion.div>
          </>
        );
      }
    }

    const ctx = useMemo(() => ({ open, toggle, contentId }), [open, toggle, contentId]);

    return (
      <div
        ref={ref}
        data-sidebar="group"
        data-state={collapsible ? (open ? "open" : "closed") : undefined}
        className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
        {...props}
      >
        <SidebarGroupContext.Provider value={collapsible ? ctx : null}>
          {inner}
        </SidebarGroupContext.Provider>
      </div>
    );
  },
);
SidebarGroup.displayName = "SidebarGroup";

// HTMLElement, not HTMLDivElement: inside a collapsible group the label renders a <button>
type SidebarGroupLabelProps = HTMLAttributes<HTMLElement>;

const SidebarGroupLabel = forwardRef<HTMLElement, SidebarGroupLabelProps>(
  ({ className, children, ...props }, ref) => {
    const sizeVariant = useSizeVariant();
    const sizeClasses = useSize();
    const group = useContext(SidebarGroupContext);
    const radius = useRadius();

    const { text, rest } = splitLeadingText(children);
    const labelContent = text ? (
      <>
        <span className="min-w-0 truncate">{text}</span>
        {rest}
      </>
    ) : (
      children
    );

    if (group) {
      return (
        <button
          ref={composeRefs(ref)}
          type="button"
          data-sidebar="group-label"
          aria-expanded={group.open}
          aria-controls={group.contentId}
          onClick={group.toggle}
          className={cn(
            "group/group-label flex h-8 w-full shrink-0 cursor-pointer select-none items-center gap-2 px-2 text-left text-muted-foreground/70 outline-none",
            "transition-colors duration-80 hover:text-muted-foreground",
            "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
            radius.item,
            sizeVariant === "compact" ? "text-[11px]" : "text-[12px]",
            className,
          )}
          {...props}
        >
          {labelContent}
          <span className="ml-auto flex size-6 shrink-0 items-center justify-center">
            <ChevronDownIcon
              size={sizeClasses.icon}
              strokeWidth={1.5}
              className={cn(
                "shrink-0 transition-[opacity,transform] duration-80",
                group.open
                  ? "opacity-0 group-hover/group-label:opacity-100 group-focus-visible/group-label:opacity-100"
                  : "-rotate-90 opacity-100",
              )}
            />
          </span>
        </button>
      );
    }

    return (
      <div
        ref={composeRefs(ref)}
        data-sidebar="group-label"
        className={cn(
          "flex h-8 shrink-0 items-center gap-2 px-2 text-muted-foreground/70 outline-none",
          sizeVariant === "compact" ? "text-[11px]" : "text-[12px]",
          className,
        )}
        {...props}
      >
        {labelContent}
      </div>
    );
  },
);
SidebarGroupLabel.displayName = "SidebarGroupLabel";

export {
  SidebarProvider,
  SidebarShell,
  SidebarInset,
  SidebarInput,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
};
