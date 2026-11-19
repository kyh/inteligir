"use client";
// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  RefAttributes,
  RefObject,
} from "react";
import { motion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { cssVars } from "@repo/ui/lib/css-vars";
import { cn } from "@repo/ui/lib/cn";
import { spring } from "@repo/ui/lib/springs";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { radius } from "@repo/ui/lib/radius";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@repo/ui/lib/sidebar-bounds";
import { useRaisedSurface, SurfaceProvider } from "@repo/ui/lib/surface-context";
import type { SurfaceLevel } from "@repo/ui/lib/surface-context";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { splitLeadingText } from "@repo/ui/lib/text-children";
import { Tooltip } from "@repo/ui/components/tooltip";

const SIDEBAR_WIDTH = "16rem";
export const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_COLLAPSE_SLOP = 56;
const MOBILE = { below: 768, hidden: "max-md:hidden" } as const;

export type SidebarSide = "left" | "right";

export type SidebarVariant = "sidebar" | "floating";

interface SidebarContextValue {
  open: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
  openMobile: boolean;
  setOpenMobile: React.Dispatch<React.SetStateAction<boolean>>;
  isMobile: boolean;
  toggleSidebar: () => void;
  width: string;
  setWidth: (width: string) => void;
  onWidthCommitted?: ((px: number) => void) | undefined;
  shortcut: string | null;
  isResizing: boolean;
  setIsResizing: React.Dispatch<React.SetStateAction<boolean>>;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export const useSidebar = () => {
  const ctx = useContext(SidebarContext);

  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }

  return ctx;
};

const useIsMobile = () => {
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

export interface SidebarActions {
  open: () => void;
  toggle: () => void;
}

interface SidebarProviderProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  shortcut?: string | null;
  onWidthCommitted?: (px: number) => void;
  actionsRef?: RefObject<SidebarActions | null>;
  defaultWidth?: string;
}

const SidebarProvider = ({
  open,
  onOpenChange,
  shortcut = null,
  onWidthCommitted,
  actionsRef,
  defaultWidth = SIDEBAR_WIDTH,
  className,
  style,
  children,
  ref,
  ...props
}: SidebarProviderProps & RefAttributes<HTMLDivElement>) => {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = useState(false);

  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile((prev) => !prev);
    } else {
      onOpenChange?.(!open);
    }
  }, [isMobile, open, onOpenChange]);

  const openSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(true);
    } else {
      onOpenChange?.(true);
    }
  }, [isMobile, onOpenChange]);

  useEffect(() => {
    if (actionsRef !== undefined) {
      actionsRef.current = { open: openSidebar, toggle: toggleSidebar };
    }
  }, [actionsRef, openSidebar, toggleSidebar]);

  const value: SidebarContextValue = {
    isMobile,
    isResizing,
    onOpenChange,
    onWidthCommitted,
    open,
    openMobile,
    setIsResizing,
    setOpenMobile,
    setWidth,
    shortcut,
    toggleSidebar,
    width,
  };

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
  const {
    toggleSidebar,
    onOpenChange,
    setWidth,
    onWidthCommitted,
    isResizing,
    setIsResizing,
    shortcut,
  } = useSidebar();

  const railRef = useRef<HTMLButtonElement | null>(null);

  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    width: number;
    moved: boolean;
  } | null>(null);

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
      setIsResizing(true);
    }

    const delta = side === "left" ? dx : -dx;
    const raw = drag.startWidth + delta;

    if (raw < SIDEBAR_MIN_WIDTH - SIDEBAR_COLLAPSE_SLOP) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setIsResizing(false);
      setWidth(`${SIDEBAR_MIN_WIDTH}px`);
      onWidthCommitted?.(SIDEBAR_MIN_WIDTH);
      onOpenChange?.(false);

      return;
    }

    const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, raw));
    drag.width = next;
    setWidth(`${next}px`);
  };

  const endDrag = (toggleOnClick: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsResizing(false);

    if (drag?.moved === true) {
      onWidthCommitted?.(drag.width);
    } else if (toggleOnClick && drag !== null) {
      toggleSidebar();
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    endDrag(true);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onDragInterrupted = () => {
    endDrag(false);
  };

  const semibold = { fontVariationSettings: fontWeights.semibold };

  const railClasses = cn(
    "absolute inset-y-0 z-20 w-2 cursor-col-resize outline-none",
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
      disabled={isResizing}
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
  const { open, width, isResizing } = useSidebar();
  const floatingLevel = useRaisedSurface(1);
  const openTransition = open ? spring.moderate : spring.moderate.exit;
  const widthTransition = isResizing ? { duration: 0 } : openTransition;

  const shellClasses = cn(
    "peer shrink-0 sticky top-0 h-svh overflow-hidden",
    side === "right" && "order-last",
    MOBILE.hidden,
    className,
  );

  return (
    <motion.div
      ref={ref}
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

type SidebarGroupLabelProps = HTMLAttributes<HTMLElement>;

const SidebarGroupLabel = ({
  className,
  children,
  onClick,
  ref,
  ...props
}: SidebarGroupLabelProps & RefAttributes<HTMLElement>) => {
  const { text, rest } = splitLeadingText(children);

  const labelContent = text ? (
    <>
      <span className="min-w-0 truncate">{text}</span>
      {rest}
    </>
  ) : (
    children
  );

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
          "text-caption",
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
        "text-caption",
        className,
      )}
      {...props}
    >
      {labelContent}
    </div>
  );
};

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
