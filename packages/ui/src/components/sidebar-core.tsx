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
} from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  RefAttributes,
  RefObject,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { cssVars } from "@repo/ui/lib/css-vars";
import { cn } from "@repo/ui/lib/cn";
import { spring } from "@repo/ui/lib/springs";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { radius } from "@repo/ui/lib/radius";
import { useSize } from "@repo/ui/lib/size-context";
import { useRaisedSurface, SurfaceProvider } from "@repo/ui/lib/surface-context";
import type { SurfaceLevel } from "@repo/ui/lib/surface-context";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { splitLeadingText } from "@repo/ui/lib/text-children";
import { Tooltip } from "@repo/ui/components/tooltip";

const SIDEBAR_WIDTH = "16rem";
export const SIDEBAR_WIDTH_MOBILE = "18rem";
// exported: every persisted width preference clamps to these
export const SIDEBAR_MIN_WIDTH = 192;
export const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_COLLAPSE_SLOP = 56;
// Tailwind's md, so the shell is hidden by CSS before hydration and by the sheet branch after
const MOBILE = { below: 768, hidden: "max-md:hidden" } as const;

export type SidebarSide = "left" | "right";
export type SidebarVariant = "sidebar" | "floating";

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
  onWidthCommitted?: ((px: number) => void) | undefined;
  shortcut: string | null;
  peek: boolean;
  isPeeking: boolean;
  setIsPeeking: React.Dispatch<React.SetStateAction<boolean>>;
  isResizing: boolean;
  setIsResizing: React.Dispatch<React.SetStateAction<boolean>>;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export const useSidebar = (): SidebarContextValue => {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
};

// starts undefined so the server and first client render agree; the media query corrects it in an effect
const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState<boolean | undefined>();
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE.below - 1}px)`);
    const onChange = () => {
      setIsMobile(mql.matches);
    };
    onChange();
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, []);
  return isMobile === true;
};

// what an owner may ask of its sidebar: the toggle a click on the rail runs, which opens the
// sheet below the mobile breakpoint, where nothing else reaches it
export interface SidebarActions {
  toggle: () => void;
}

interface SidebarProviderProps extends HTMLAttributes<HTMLDivElement> {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // the chord that toggles this sidebar, spelled for the keyboard in use, for the rail's tooltip
  // alone: the app's own key table owns the binding, so no provider listens for a key
  shortcut?: string | null;
  // once per resize, when the drag ends or collapses the sidebar, never per frame
  onWidthCommitted?: (px: number) => void;
  actionsRef?: RefObject<SidebarActions | null>;
  // collapsed, a strip at the edge that a click opens as a card over the page
  peek?: boolean;
  width?: string;
}

const SidebarProvider = ({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  shortcut = null,
  onWidthCommitted,
  actionsRef,
  peek = false,
  width: widthProp = SIDEBAR_WIDTH,
  className,
  style,
  children,
  ref,
  ...props
}: SidebarProviderProps & RefAttributes<HTMLDivElement>) => {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = useState(false);

  const [width, setWidth] = useState(widthProp);
  const [prevWidthProp, setPrevWidthProp] = useState(widthProp);
  if (prevWidthProp !== widthProp) {
    setPrevWidthProp(widthProp);
    setWidth(widthProp);
  }
  const [isResizing, setIsResizing] = useState(false);

  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp ?? internalOpen;

  const setOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const next = value instanceof Function ? value(open) : value;
      if (onOpenChange) {
        onOpenChange(next);
      } else {
        setInternalOpen(next);
      }
    },
    [open, onOpenChange],
  );

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile((prev) => !prev);
    } else {
      setOpen((prev) => !prev);
    }
  }, [isMobile, setOpen]);

  useEffect(() => {
    if (actionsRef !== undefined) {
      actionsRef.current = { toggle: toggleSidebar };
    }
  }, [actionsRef, toggleSidebar]);

  const [isPeeking, setIsPeeking] = useState(false);
  if (isPeeking && (open || !peek)) {
    setIsPeeking(false);
  }

  const value = useMemo<SidebarContextValue>(
    () => ({
      isMobile,
      isPeeking,
      isResizing,
      onWidthCommitted,
      open,
      openMobile,
      peek,
      setIsPeeking,
      setIsResizing,
      setOpen,
      setOpenMobile,
      setWidth,
      shortcut,
      state: open ? "expanded" : "collapsed",
      toggleSidebar,
      width,
    }),
    [
      open,
      setOpen,
      openMobile,
      isMobile,
      toggleSidebar,
      width,
      onWidthCommitted,
      shortcut,
      peek,
      isPeeking,
      isResizing,
    ],
  );

  return (
    <SidebarContext value={value}>
      <div
        ref={ref}
        data-slot="sidebar-wrapper"
        className={cn("group/sidebar-wrapper relative flex min-h-svh w-full", className)}
        style={cssVars({
          "--sidebar-width": width,
          "--sidebar-width-mobile": SIDEBAR_WIDTH_MOBILE,
          ...style,
        })}
        {...props}
      >
        {children}
      </div>
    </SidebarContext>
  );
};

// framer's own prop type: a DOM-typed HTMLAttributes spread cannot satisfy motion.div
type MotionSafeDivProps = Omit<HTMLMotionProps<"div">, "ref" | "children"> & {
  children?: ReactNode;
};

const ShortcutKbd = ({ children }: { children: ReactNode }) => (
  <kbd className="-my-1 flex h-4 min-w-4 items-center justify-center rounded border border-background/30 px-1 font-sans text-caption text-background/80">
    {children}
  </kbd>
);

interface SidebarRailProps extends HTMLAttributes<HTMLButtonElement> {
  side: SidebarSide;
}

const SidebarRail = ({
  side,
  className,
  ref,
  ...props
}: SidebarRailProps & RefAttributes<HTMLButtonElement>) => {
  const { toggleSidebar, setOpen, setWidth, onWidthCommitted, setIsResizing, shortcut } =
    useSidebar();
  const railRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    width: number;
    moved: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const closest = railRef.current?.closest('[data-slot="sidebar"]');
    const panel = closest instanceof HTMLElement ? closest : null;
    if (!panel) {
      return;
    }
    dragRef.current = {
      moved: false,
      startWidth: panel.offsetWidth,
      startX: event.clientX,
      width: panel.offsetWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const dx = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 4) {
      return;
    }
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
      onWidthCommitted?.(SIDEBAR_MIN_WIDTH);
      setOpen(false);
      return;
    }
    const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, raw));
    drag.width = next;
    setWidth(`${next}px`);
  };

  // A cancelled drag, or one whose capture the browser took back, still lands the width it
  // reached; only a press let go where it began is a click.
  const endDrag = (toggleOnClick: boolean): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setIsResizing(false);
    if (drag?.moved === true) {
      onWidthCommitted?.(drag.width);
    } else if (toggleOnClick && drag !== null) {
      toggleSidebar();
    }
  };

  // ended before the release, which may report the lost capture before it returns
  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    endDrag(true);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onDragInterrupted = (): void => {
    endDrag(false);
  };

  const semibold = { fontVariationSettings: fontWeights.semibold };
  const railClasses = cn(
    "absolute inset-y-0 z-20 w-2 cursor-col-resize outline-none",
    // positioned from the prop, not group-data selectors, so a className offset can win the merge
    side === "left" ? "right-0" : "left-0",
    "after:absolute after:inset-y-0 after:w-px after:bg-transparent hover:after:bg-foreground/25 after:transition-colors after:duration-80",
    side === "left" ? "after:right-0" : "after:left-0",
    className,
  );

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
            {shortcut === null ? null : <ShortcutKbd>{shortcut}</ShortcutKbd>}
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
        onPointerCancel={onDragInterrupted}
        onLostPointerCapture={onDragInterrupted}
        className={railClasses}
        {...props}
      />
    </Tooltip>
  );
};

interface SidebarPeekProps {
  children: ReactNode;
  floatingLevel: SurfaceLevel;
  isPeeking: boolean;
  setIsPeeking: React.Dispatch<React.SetStateAction<boolean>>;
  side: SidebarSide;
  width: string;
}

const SidebarPeek = ({
  children,
  floatingLevel,
  isPeeking,
  setIsPeeking,
  side,
  width,
}: SidebarPeekProps) => (
  <>
    <button
      type="button"
      aria-label="Peek sidebar"
      aria-expanded={isPeeking}
      className={cn(
        "group/peek-strip absolute inset-y-0 z-40 w-3 cursor-pointer outline-none",
        side === "left" ? "left-0" : "right-0",
      )}
      onClick={() => {
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
            transition: spring.moderate.exit,
            x: side === "left" ? "-108%" : "108%",
          }}
          transition={spring.moderate}
        >
          <SurfaceProvider value={floatingLevel}>{children}</SurfaceProvider>
        </motion.div>
      )}
    </AnimatePresence>
  </>
);

interface SidebarPanelProps {
  children: ReactNode;
  floatingLevel: SurfaceLevel;
  open: boolean;
  side: SidebarSide;
  variant: SidebarVariant;
  width: string;
  widthTransition: NonNullable<HTMLMotionProps<"div">["transition"]>;
}

const SidebarPanel = ({
  children,
  floatingLevel,
  open,
  side,
  variant,
  width,
  widthTransition,
}: SidebarPanelProps) => {
  const closedX = side === "left" ? "-100%" : "100%";
  // closed, the panel is slid off-screen rather than unmounted, so inert is what takes its
  // controls out of the tab order and the accessibility tree
  return (
    <motion.div
      inert={!open}
      className={cn(
        "absolute inset-y-0 flex h-full flex-col",
        side === "left" ? "left-0" : "right-0",
        variant === "floating" && "p-2",
      )}
      style={{ width }}
      initial={false}
      animate={{ x: open ? "0%" : closedX }}
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
            side === "left" ? "border-r border-border" : "border-l border-border",
          )}
        >
          {children}
        </div>
      )}
      <SidebarRail
        side={side}
        className={cn(
          variant === "floating" &&
            (side === "left" ? "right-1 after:right-[3.5px]" : "left-1 after:left-[3.5px]"),
          variant === "floating" &&
            "after:inset-y-2 after:[mask-image:linear-gradient(to_bottom,transparent_var(--rail-fade-start),black_var(--rail-fade-end),black_calc(100%-var(--rail-fade-end)),transparent_calc(100%-var(--rail-fade-start)))]",
        )}
        style={
          variant === "floating"
            ? cssVars({ "--rail-fade-end": "36px", "--rail-fade-start": "12px" })
            : undefined
        }
      />
    </motion.div>
  );
};

interface SidebarShellProps extends MotionSafeDivProps {
  side: SidebarSide;
  variant: SidebarVariant;
}

const SidebarShell = ({
  side,
  variant,
  className,
  children,
  ref,
  ...props
}: SidebarShellProps & RefAttributes<HTMLDivElement>) => {
  const { open, width, isResizing, peek, isPeeking, setIsPeeking } = useSidebar();
  const shellRef = useRef<HTMLDivElement | null>(null);

  const peekEnabled = peek && !open;
  useEffect(() => {
    if (!(peekEnabled && isPeeking)) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPeeking(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && shellRef.current?.contains(event.target) === true) {
        return;
      }
      setIsPeeking(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [peekEnabled, isPeeking, setIsPeeking]);
  const floatingLevel = useRaisedSurface(1);
  const openTransition = open ? spring.moderate : spring.moderate.exit;
  const widthTransition = isResizing ? { duration: 0 } : openTransition;
  const shellClasses = cn(
    // no bare `group`: it would fire every descendant's group-hover on rail hover
    "peer shrink-0 sticky top-0 h-svh",
    // while peek is armed the 0-width shell must not clip the edge strip or the overlay card, and
    // must rise above the inset (a later sibling)
    peekEnabled ? "z-40" : "overflow-hidden",
    // flex order decides the side, so Sidebar can stay before SidebarInset in the DOM
    side === "right" && "order-last",
    MOBILE.hidden,
    className,
  );

  return (
    <motion.div
      ref={composeRefs(shellRef, ref)}
      data-slot="sidebar"
      data-state={open ? "expanded" : "collapsed"}
      data-collapsible={open ? "" : "offcanvas"}
      data-variant={variant}
      data-side={side}
      className={shellClasses}
      initial={false}
      animate={{ width: open ? width : "0rem" }}
      transition={widthTransition}
      {...props}
    >
      {peekEnabled ? (
        <SidebarPeek
          floatingLevel={floatingLevel}
          isPeeking={isPeeking}
          setIsPeeking={setIsPeeking}
          side={side}
          width={width}
        >
          {children}
        </SidebarPeek>
      ) : (
        <SidebarPanel
          floatingLevel={floatingLevel}
          open={open}
          side={side}
          variant={variant}
          width={width}
          widthTransition={widthTransition}
        >
          {children}
        </SidebarPanel>
      )}
    </motion.div>
  );
};

type SidebarInsetProps = HTMLAttributes<HTMLElement>;

const SidebarInset = ({
  className,
  ref,
  ...props
}: SidebarInsetProps & RefAttributes<HTMLElement>) => (
  <main
    ref={ref}
    data-slot="sidebar-inset"
    className={cn("relative flex min-h-0 w-full min-w-0 flex-1 flex-col bg-background", className)}
    {...props}
  />
);

type SidebarSectionProps = HTMLAttributes<HTMLDivElement>;

const SidebarHeader = ({
  className,
  ref,
  ...props
}: SidebarSectionProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-sidebar="header"
    className={cn("flex shrink-0 flex-col gap-2 p-2", className)}
    {...props}
  />
);

const SidebarFooter = ({
  className,
  ref,
  ...props
}: SidebarSectionProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-sidebar="footer"
    className={cn("mt-auto flex shrink-0 flex-col gap-2 p-2", className)}
    {...props}
  />
);

// A titled run of rows: the label, its actions overlaid at the label's trailing edge, then a
// menu or any list.
const SidebarGroup = ({
  className,
  ref,
  ...props
}: SidebarSectionProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-sidebar="group"
    className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
    {...props}
  />
);

// HTMLElement, not HTMLDivElement: with an onClick the label is a <button>
type SidebarGroupLabelProps = HTMLAttributes<HTMLElement>;

// The group's title on the rows' text axis. Given an onClick it is a button, for a group whose
// title is also its switch.
const SidebarGroupLabel = ({
  className,
  children,
  onClick,
  ref,
  ...props
}: SidebarGroupLabelProps & RefAttributes<HTMLElement>) => {
  const size = useSize();
  const { text, rest } = splitLeadingText(children);
  const labelContent = text ? (
    <>
      <span className="min-w-0 truncate">{text}</span>
      {rest}
    </>
  ) : (
    children
  );
  const textClass = size.variant === "compact" ? "text-caption" : "text-body";
  if (onClick !== undefined) {
    return (
      <button
        ref={composeRefs(ref)}
        type="button"
        data-sidebar="group-label"
        onClick={onClick}
        className={cn(
          "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 px-2 text-left text-muted-foreground/70 outline-none select-none",
          "transition-colors duration-80 hover:text-muted-foreground focus-visible:text-muted-foreground",
          "focus-visible:ring-1 focus-visible:ring-focus-ring",
          radius.item,
          textClass,
          className,
        )}
        {...props}
      >
        {labelContent}
      </button>
    );
  }
  return (
    <div
      ref={composeRefs(ref)}
      data-sidebar="group-label"
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 px-2 text-muted-foreground/70 outline-none",
        textClass,
        className,
      )}
      {...props}
    >
      {labelContent}
    </div>
  );
};

// the cluster over the label's trailing edge, inset to the rows' action axis
const SidebarGroupActions = ({
  className,
  ref,
  ...props
}: SidebarSectionProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-sidebar="group-actions"
    className={cn("absolute top-3 right-3 z-10 flex items-center gap-0.5", className)}
    {...props}
  />
);

type SidebarGroupActionProps = ButtonHTMLAttributes<HTMLButtonElement>;

// a 24px icon button: the one rhythm every action in the sidebar keeps
const SidebarGroupAction = ({
  className,
  ref,
  ...props
}: SidebarGroupActionProps & RefAttributes<HTMLButtonElement>) => (
  <button
    ref={ref}
    type="button"
    data-sidebar="group-action"
    className={cn(
      "flex size-6 shrink-0 cursor-pointer items-center justify-center text-muted-foreground outline-none",
      "transition-colors duration-80 hover:bg-muted/60 hover:text-foreground focus-visible:text-foreground",
      "focus-visible:ring-1 focus-visible:ring-focus-ring",
      "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      radius.item,
      className,
    )}
    {...props}
  />
);

// The scrolling region between the header and whatever sits under it: a plain column, so a
// consumer's list keeps its own height and the column scrolls.
const SidebarContent = ({
  className,
  ref,
  ...props
}: SidebarSectionProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-sidebar="content"
    className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}
    {...props}
  />
);

export {
  SidebarProvider,
  SidebarShell,
  SidebarInset,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupActions,
  SidebarGroupAction,
};
