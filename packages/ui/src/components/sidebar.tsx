"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "framer-motion";
import { motionProps, motionStyle, type MotionConflictHandler } from "@repo/ui/lib/motion-style";
import { cn } from "@repo/ui/lib/utils";
import { spring, exitFallbackMs } from "@repo/ui/lib/springs";
import { useSurface, SurfaceProvider } from "@repo/ui/lib/surface-context";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import {
  useSidebar,
  SidebarShell,
  type SidebarSide,
  type SidebarVariant,
  type SidebarCollapsible,
} from "@repo/ui/components/sidebar-core";

// Base UI Dialog, not Drawer: Drawer's swipe-to-dismiss writes inline transform onto its Popup
// and expects CSS-transition choreography, which fights framer-motion on the same element.

interface SidebarSheetProps {
  side: SidebarSide;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

function SidebarSheet({ side, open, onClose, children }: SidebarSheetProps) {
  const { widthMobile } = useSidebar();
  // the panel takes initial focus itself: left to the primitive, the trap lands on the top nav
  // row, and Chrome grants :focus-visible to script-driven focus, so it shows the keyboard ring
  const panelRef = useRef<HTMLDivElement | null>(null);
  const substrate = useSurface();
  const level = Math.min(substrate + 2, 8);

  // the primitive tears its portal down the moment it closes, so the dialog is held open through
  // the exit and the real close propagates when the spring lands
  const [closing, setClosing] = useState(false);
  const visible = open && !closing;

  const finishClose = useCallback(() => {
    setClosing(false);
    onClose();
  }, [onClose]);

  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) setClosing(true);
    wasOpen.current = open;
  }, [open]);

  // fallback: rAF-driven animation callbacks stall in throttled tabs
  useEffect(() => {
    if (!closing) return;
    const id = setTimeout(finishClose, exitFallbackMs(spring.moderate));
    return () => clearTimeout(id);
  }, [closing, finishClose]);

  const offscreen = side === "left" ? "-100%" : "100%";

  // `dark:` only matches the explicit .dark class, so the base tint carries system-dark users
  return (
    <DialogPrimitive.Root
      open={open || closing}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setClosing(true);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          render={(backdropProps) => {
            const { style: _style, ...rest } = motionProps(backdropProps);
            return (
              <motion.div
                {...rest}
                className="fixed inset-0 bg-black/40 dark:bg-black/80 z-40"
                initial={{ opacity: 0 }}
                animate={{ opacity: visible ? 1 : 0 }}
                transition={visible ? { duration: 0.16 } : spring.moderate.exit}
              />
            );
          }}
        />

        <DialogPrimitive.Popup
          aria-label="Sidebar"
          initialFocus={panelRef}
          render={(popupProps) => {
            const { style: baseStyle, ref: baseRef, ...rest } = motionProps(popupProps);
            return (
              <motion.div
                {...rest}
                // merge, don't replace: the primitive needs its own handle on the panel
                ref={composeRefs(panelRef, baseRef)}
                tabIndex={-1}
                data-sidebar="sidebar"
                data-mobile="true"
                data-side={side}
                className={cn(
                  "fixed inset-y-0 z-50 flex flex-col overflow-hidden outline-none",
                  !visible && "pointer-events-none",
                  side === "left" ? "left-0" : "right-0",
                  surfaceClasses(level, 3),
                )}
                style={motionStyle(baseStyle, { width: widthMobile })}
                initial={{ x: offscreen }}
                animate={{ x: visible ? 0 : offscreen }}
                transition={visible ? spring.moderate : spring.moderate.exit}
                onAnimationComplete={() => {
                  if (closing) finishClose();
                }}
              >
                <SurfaceProvider value={level}>{children}</SurfaceProvider>
              </motion.div>
            );
          }}
        />
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface SidebarProps extends Omit<HTMLAttributes<HTMLDivElement>, MotionConflictHandler> {
  side?: SidebarSide;
  variant?: SidebarVariant;
  collapsible?: SidebarCollapsible;
  bordered?: boolean;
  rail?: boolean;
}

const Sidebar = forwardRef<HTMLDivElement, SidebarProps>(
  (
    {
      side = "left",
      variant = "sidebar",
      collapsible = "offcanvas",
      bordered = true,
      rail = true,
      className,
      style,
      children,
      ...props
    },
    ref,
  ) => {
    const { isMobile, openMobile, setOpenMobile, width, registerSide } = useSidebar();

    useEffect(() => registerSide(side), [side, registerSide]);

    if (collapsible === "none") {
      return (
        <div
          ref={ref}
          data-slot="sidebar"
          data-variant={variant}
          data-side={side}
          className={cn(
            "peer sticky top-0 flex h-svh shrink-0 flex-col",
            side === "right" && "order-last",
            className,
          )}
          style={{ width, ...style }}
          {...props}
        >
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
        </div>
      );
    }

    if (isMobile) {
      return (
        <SidebarSheet side={side} open={openMobile} onClose={() => setOpenMobile(false)}>
          {children}
        </SidebarSheet>
      );
    }

    return (
      <SidebarShell
        ref={ref}
        side={side}
        variant={variant}
        bordered={bordered}
        rail={rail}
        className={className}
        style={motionStyle(style)}
        {...props}
      >
        {children}
      </SidebarShell>
    );
  },
);
Sidebar.displayName = "Sidebar";

export { Sidebar };

export {
  SidebarProvider,
  useSidebar,
  SidebarInset,
  SidebarInput,
  SidebarHeader,
  SidebarFooter,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
} from "@repo/ui/components/sidebar-core";
