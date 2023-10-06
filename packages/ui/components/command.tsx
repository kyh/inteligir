"use client";

import React from "react";
import { cn } from "../lib/cn";
import { Copy } from "./copy";

const CommandComponent = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        "flex items-center rounded-lg border border-ui-code-border bg-ui-code-bg-header px-3 py-2",
        "[&>code]:mx-3 [&>code]:font-mono [&>code]:text-xs [&>code]:leading-6 [&>code]:text-ui-code-text-base",
        className,
      )}
      {...props}
    />
  );
};

const Command = Object.assign(CommandComponent, { Copy });

export { Command };
