"use client";
// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).

import { useRef } from "react";
import type { HTMLAttributes, ReactNode, RefAttributes } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "motion/react";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";
import { PopupOpen, PopupPresence } from "@repo/ui/lib/popup-presence";
import type { MotionConflictHandler } from "@repo/ui/lib/motion-style";
import { cn } from "@repo/ui/lib/cn";
import { spring } from "@repo/ui/lib/springs";
import { Elevated } from "@repo/ui/lib/elevated";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { BACKDROP_CLASSES } from "@repo/ui/components/dialog";
import { useSidebar, SidebarShell, SIDEBAR_WIDTH_MOBILE } from "@repo/ui/components/sidebar-core";
import type { SidebarSide, SidebarVariant } from "@repo/ui/components/sidebar-core";

interface SidebarSheetProps {
  side: SidebarSide;
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

const SidebarSheet = ({ side, title, open, onClose, children }: SidebarSheetProps) => {
  const panelRef = useRef<HTMLDivElement | null>(null);

  const offscreen = side === "left" ? "-100%" : "100%";

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <PopupOpen open={open}>
        <PopupPresence>
          <DialogPrimitive.Portal keepMounted>
            <DialogPrimitive.Backdrop
              render={(backdropProps) => {
                const { style: _style, ...rest } = motionProps(backdropProps);

                return (
                  <motion.div
                    {...rest}
                    className={cn(BACKDROP_CLASSES, "z-40")}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { duration: 0.16 } }}
                    exit={{ opacity: 0, transition: spring.moderate.exit }}
                  />
                );
              }}
            />

            <DialogPrimitive.Popup
              initialFocus={panelRef}
              render={(popupProps, state) => {
                const { style: baseStyle, ref: baseRef, ...rest } = motionProps(popupProps);
                const panelRefs = composeRefs(panelRef, baseRef);

                return (
                  <Elevated
                    {...rest}
                    offset={2}
                    shadowLevel={3}
                    ref={panelRefs}
                    tabIndex={-1}
                    data-sidebar="sidebar"
                    data-mobile="true"
                    data-side={side}
                    className={cn(
                      "fixed inset-y-0 z-50 flex flex-col overflow-hidden outline-none",
                      !state.open && "pointer-events-none",
                      side === "left" ? "left-0" : "right-0",
                    )}
                    style={motionStyle(baseStyle, { width: SIDEBAR_WIDTH_MOBILE })}
                    initial={{ x: offscreen }}
                    animate={{ opacity: 1, transition: spring.moderate, x: 0 }}
                    exit={{ opacity: 0.9999, transition: spring.moderate.exit, x: offscreen }}
                  >
                    <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
                    {children}
                  </Elevated>
                );
              }}
            />
          </DialogPrimitive.Portal>
        </PopupPresence>
      </PopupOpen>
    </DialogPrimitive.Root>
  );
};

interface SidebarProps extends Omit<HTMLAttributes<HTMLDivElement>, MotionConflictHandler> {
  side?: SidebarSide;
  variant?: SidebarVariant;
  label: string;
}

const Sidebar = ({
  side = "left",
  variant = "sidebar",
  label,
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
        title={label}
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
