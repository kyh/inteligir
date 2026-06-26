"use client";

import { Toaster as Sonner, toast, type ToasterProps } from "sonner";

import { cssVars } from "@repo/ui/lib/css-vars";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const toasterIcons = {
  success: <CircleCheckIcon className="size-4" />,
  info: <InfoIcon className="size-4" />,
  warning: <TriangleAlertIcon className="size-4" />,
  error: <OctagonXIcon className="size-4" />,
  loading: <Loader2Icon className="size-4 animate-spin" />,
};

const Toaster = ({ glass = false, ...props }: ToasterProps & { glass?: boolean }) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={toasterIcons}
      style={cssVars(
        // Opt-in smoked-glass toasts (the desktop shell). Gated behind a prop
        // — not unconditional — because the marketing site shares this
        // component and keeps the opaque surface look.
        glass
          ? {
              "--normal-bg": "var(--glass-smoke-deep-bg)",
              "--normal-text": "var(--glass-smoke-fg)",
              "--normal-border": "transparent",
              "--border-radius": "var(--radius-menu)",
            }
          : {
              "--normal-bg": "var(--surface-3)",
              "--normal-text": "var(--popover-foreground)",
              "--normal-border": "var(--border)",
              "--border-radius": "1rem",
            },
      )}
      toastOptions={{
        classNames: {
          // glass-smoke-deep brings backdrop blur + the glass shadow recipe;
          // sonner's own --normal-bg/-text resolve to the same fill/ink.
          toast: glass ? "cn-toast glass-smoke-deep" : "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
