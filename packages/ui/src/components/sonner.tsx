"use client";
// @license MIT, vendored from shadcn/ui (github.com/shadcn-ui/ui).

import { Toaster as Sonner } from "sonner";
import type { ToasterProps } from "sonner";
import {
  CheckCircle as CircleCheckIcon,
  InfoCircle as InfoIcon,
  AlertTriangle as TriangleAlertIcon,
  XCircle as OctagonXIcon,
  Loading02 as Loader2Icon,
} from "@untitledui/icons";

import { cssVars } from "@repo/ui/lib/css-vars";
import { useTheme } from "@repo/ui/lib/theme";

export const Toaster = (props: ToasterProps) => {
  const { resolved } = useTheme();

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      icons={{
        error: <OctagonXIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
        success: <CircleCheckIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
      }}
      style={cssVars({
        "--border-radius": "var(--radius)",
        "--normal-bg": "var(--popover)",
        "--normal-border": "var(--border)",
        "--normal-text": "var(--popover-foreground)",
      })}
      {...props}
    />
  );
};

export { toast } from "sonner";
