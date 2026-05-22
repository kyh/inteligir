"use client";

import type { ComponentProps } from "react";
import { memo } from "react";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";

import { cn } from "@repo/ui/lib/utils";

const streamdownPlugins = { cjk, code, math, mermaid };

export type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  // Re-render only when the streamed content, className, or animation state
  // change. Hand-rolled because the hot path is markdown streaming where the
  // parent may re-render on every token while the props are otherwise stable.
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.className === nextProps.className &&
    prevProps.isAnimating === nextProps.isAnimating,
);

Response.displayName = "Response";
