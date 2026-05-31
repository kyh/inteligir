"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "motion/react";
import { XIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";
import { Button } from "@repo/ui/components/button";
import { springs } from "@repo/ui/lib/springs";
import { getShape } from "@repo/ui/lib/shape";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@repo/ui/lib/surface-context";

// A dialog floats four elevation steps above whatever surface it opens over.
const DIALOG_OFFSET = 4;

// framer-motion needs these stripped from Base UI's render-prop props so its
// own (incompatible) drag/animation handler signatures win on the motion.div.
type StrippedProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
>;

function stripMotionConflicts(props: React.HTMLAttributes<HTMLDivElement>): {
  style?: React.CSSProperties;
  rest: StrippedProps;
} {
  const {
    style,
    onDrag: _onDrag,
    onDragStart: _onDragStart,
    onDragEnd: _onDragEnd,
    onAnimationStart: _onAnimationStart,
    onAnimationEnd: _onAnimationEnd,
    onAnimationIteration: _onAnimationIteration,
    ...rest
  } = props;
  return { style: style as React.CSSProperties | undefined, rest };
}

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

// Spring-animated scrim. Motion is information — the backdrop eases in on the
// slow spring and out on the moderate one, matching the popup's tempo.
function DialogOverlay({ className }: { className?: string }) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      render={(backdropProps, state) => {
        const exiting = state.transitionStatus === "ending";
        const { rest } = stripMotionConflicts(
          backdropProps as React.HTMLAttributes<HTMLDivElement>,
        );
        return (
          <motion.div
            {...rest}
            className={cn("fixed inset-0 z-50 bg-black/40 dark:bg-black/80", className)}
            initial={{ opacity: 0 }}
            animate={{ opacity: exiting ? 0 : 1 }}
            transition={exiting ? springs.moderate : springs.slow}
          />
        );
      }}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "sm",
  style,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  size?: "sm" | "lg";
}) {
  const shape = getShape();
  const substrate = useSurface();
  const dialogLevel = Math.min(substrate + DIALOG_OFFSET, 8);

  // No `if (!open) return null` here — Base UI's `<DialogPrimitive.Popup>`
  // handles mount/unmount itself, and waits for the motion opacity/scale tween
  // below to finish (via `element.getAnimations()`) before unmounting.
  // Returning null early would short-circuit the closing animation.
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        // Behavioral Popup props (focus management, etc.) and any HTML
        // attributes/handlers stay on the primitive, so Base UI applies the
        // behavioral ones and merges the forwardable ones into `popupProps` for
        // the rendered element. className/style are pulled out and handled in
        // the render callback to preserve tailwind-merge / motion semantics.
        {...props}
        render={(popupProps, state) => {
          const exiting = state.transitionStatus === "ending";
          const { style: baseStyle, rest } = stripMotionConflicts(
            popupProps as React.HTMLAttributes<HTMLDivElement>,
          );
          return (
            <motion.div
              // Base UI's resolved props (data attrs, refs, role, plus the
              // consumer's merged HTML attributes/handlers) land on the
              // visible motion.div.
              {...rest}
              // Centering lives in Tailwind's `translate` utilities (a
              // standalone CSS property in v4), not in the motion transform, so
              // consumers can still override placement via className — e.g. the
              // command palette's `top-1/3 translate-y-0`. Motion only animates
              // opacity + scale (the `transform` property), which composes with
              // `translate` rather than clobbering it.
              className={cn(
                "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
                surfaceClasses(dialogLevel),
                "p-6 text-sm text-popover-foreground outline-none",
                size === "sm" && "max-w-[400px]",
                size === "lg" && "max-w-[540px]",
                shape.container,
                className,
              )}
              style={{ ...baseStyle, ...(style as React.CSSProperties | undefined) }}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{
                opacity: exiting ? 0 : 1,
                scale: exiting ? 0.97 : 1,
              }}
              transition={exiting ? springs.moderate : springs.slow}
            >
              <SurfaceProvider value={dialogLevel}>
                {children}
                {showCloseButton && (
                  <DialogPrimitive.Close
                    data-slot="dialog-close"
                    render={
                      <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />
                    }
                  >
                    <XIcon />
                    <span className="sr-only">Close</span>
                  </DialogPrimitive.Close>
                )}
              </SurfaceProvider>
            </motion.div>
          );
        }}
      />
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 mb-4", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex justify-end gap-2 mt-6", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-[16px] text-foreground leading-tight", className)}
      style={{ fontVariationSettings: "'wght' 700" }}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-[13px] text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
