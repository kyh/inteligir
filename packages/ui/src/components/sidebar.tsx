"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import { useRef } from "react";
import type { HTMLAttributes, ReactNode, RefAttributes } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "framer-motion";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";
import { PopupExit } from "@repo/ui/lib/popup-exit";
import type { MotionConflictHandler } from "@repo/ui/lib/motion-style";
import { cn } from "@repo/ui/lib/cn";
import { spring } from "@repo/ui/lib/springs";
import { Elevated } from "@repo/ui/lib/elevated";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { useSidebar, SidebarShell, SIDEBAR_WIDTH_MOBILE } from "@repo/ui/components/sidebar-core";
import type { SidebarSide, SidebarVariant } from "@repo/ui/components/sidebar-core";

// Base UI Dialog, not Drawer: Drawer's swipe-to-dismiss writes inline transform onto its Popup
// and expects CSS-transition choreography, which fights framer-motion on the same element.

interface SidebarSheetProps {
  side: SidebarSide;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

const SidebarSheet = ({ side, open, onClose, children }: SidebarSheetProps) => {
  // the panel takes initial focus itself: left to the primitive, the trap lands on the top nav
  // row, and Chrome grants :focus-visible to script-driven focus, so it shows the keyboard ring
  const panelRef = useRef<HTMLDivElement | null>(null);

  const offscreen = side === "left" ? "-100%" : "100%";

  // `dark:` only matches the explicit .dark class, so the base tint carries system-dark users.
  // Base UI keeps the closing sheet mounted while the Popup's own animations run, and framer drives
  // `x` on the main thread, where Base UI cannot see it; the near-1 opacity is a compositor
  // animation of the same length that it can
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          render={(backdropProps, state) => {
            const exiting = state.transitionStatus === "ending";
            const { style: _style, ...rest } = motionProps(backdropProps);
            return (
              <motion.div
                {...rest}
                className="fixed inset-0 bg-black/40 dark:bg-black/80 z-40"
                initial={{ opacity: 0 }}
                animate={{ opacity: exiting ? 0 : 1 }}
                transition={exiting ? spring.moderate.exit : { duration: 0.16 }}
              />
            );
          }}
        />

        <DialogPrimitive.Popup
          aria-label="Sidebar"
          initialFocus={panelRef}
          render={(popupProps, state) => {
            const exiting = state.transitionStatus === "ending";
            const { style: baseStyle, ref: baseRef, ...rest } = motionProps(popupProps);
            return (
              <PopupExit exiting={exiting}>
                <Elevated
                  {...rest}
                  offset={2}
                  shadowLevel={3}
                  // merge, don't replace: the primitive needs its own handle on the panel
                  ref={composeRefs(panelRef, baseRef)}
                  tabIndex={-1}
                  data-sidebar="sidebar"
                  data-mobile="true"
                  data-side={side}
                  className={cn(
                    "fixed inset-y-0 z-50 flex flex-col overflow-hidden outline-none",
                    exiting && "pointer-events-none",
                    side === "left" ? "left-0" : "right-0",
                  )}
                  style={motionStyle(baseStyle, { width: SIDEBAR_WIDTH_MOBILE })}
                  initial={{ x: offscreen }}
                  animate={{ opacity: exiting ? 0.9999 : 1, x: exiting ? offscreen : 0 }}
                  transition={exiting ? spring.moderate.exit : spring.moderate}
                >
                  {children}
                </Elevated>
              </PopupExit>
            );
          }}
        />
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

interface SidebarProps extends Omit<HTMLAttributes<HTMLDivElement>, MotionConflictHandler> {
  side?: SidebarSide;
  variant?: SidebarVariant;
}

const Sidebar = ({
  side = "left",
  variant = "sidebar",
  className,
  style,
  children,
  ref,
  ...props
}: SidebarProps & RefAttributes<HTMLDivElement>) => {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <SidebarSheet
        side={side}
        open={openMobile}
        onClose={() => {
          setOpenMobile(false);
        }}
      >
        {children}
      </SidebarSheet>
    );
  }

  return (
    <SidebarShell
      ref={ref}
      side={side}
      variant={variant}
      className={className}
      style={motionStyle(style)}
      {...props}
    >
      {children}
    </SidebarShell>
  );
};

export { Sidebar };
