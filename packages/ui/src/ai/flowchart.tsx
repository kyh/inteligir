"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "cn";

const Flowchart = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="flowchart"
      className={cn("flex w-full flex-col items-center gap-0 py-4", className)}
      {...props}
    />
  ),
);
Flowchart.displayName = "Flowchart";

export interface FlowchartConnectorProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
  height?: number;
}

const FlowchartConnector = forwardRef<HTMLDivElement, FlowchartConnectorProps>(
  ({ className, label, height = 28, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden={label === undefined ? true : undefined}
      data-slot="flowchart-connector"
      className={cn("relative flex w-full items-center justify-center", className)}
      style={{ height }}
      {...props}
    >
      <span className="absolute inset-y-0 w-px bg-line-strong" />
      {label === undefined ? null : (
        <span className="relative z-10 rounded-full bg-surface-inset px-1.5 text-[10.5px] font-medium text-ink-3">
          {label}
        </span>
      )}
    </div>
  ),
);
FlowchartConnector.displayName = "FlowchartConnector";

export interface FlowchartNodeProps extends HTMLAttributes<HTMLDivElement> {
  kind?: ReactNode;
  width?: number;
}

const FlowchartNode = forwardRef<HTMLDivElement, FlowchartNodeProps>(
  ({ className, children, kind, width = 300, ...props }, ref) => (
    <div className="flex flex-col items-center" style={{ width, maxWidth: "100%" }}>
      {kind === undefined ? null : (
        <span
          data-slot="flowchart-node-kind"
          className="mb-1.5 inline-flex h-5 items-center rounded-full bg-line px-2 text-[11px] font-medium text-ink"
        >
          {kind}
        </span>
      )}
      <div
        ref={ref}
        data-slot="flowchart-node"
        className={cn(
          "w-full rounded-xl bg-surface-raised px-3 py-2.5 shadow-surface-2",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  ),
);
FlowchartNode.displayName = "FlowchartNode";

export interface FlowchartNodeTitleProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
}

const FlowchartNodeTitle = forwardRef<HTMLDivElement, FlowchartNodeTitleProps>(
  ({ className, children, icon, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="flowchart-node-title"
      className={cn(
        "flex items-center gap-1.5 text-[13.5px] font-medium text-ink [&_svg]:size-4 [&_svg]:text-ink-2",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </div>
  ),
);
FlowchartNodeTitle.displayName = "FlowchartNodeTitle";

const FlowchartNodeCaption = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      data-slot="flowchart-node-caption"
      className={cn("mt-0.5 text-[12px] leading-relaxed text-ink-3", className)}
      {...props}
    />
  ),
);
FlowchartNodeCaption.displayName = "FlowchartNodeCaption";

const FlowchartBranch = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="flowchart-branch"
      className={cn("mt-2 flex flex-col gap-1", className)}
      {...props}
    />
  ),
);
FlowchartBranch.displayName = "FlowchartBranch";

export interface FlowchartConditionProps extends HTMLAttributes<HTMLDivElement> {
  operator?: ReactNode;
  value?: ReactNode;
}

const FlowchartCondition = forwardRef<HTMLDivElement, FlowchartConditionProps>(
  ({ className, children, operator, value, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="flowchart-condition"
      className={cn(
        "flex items-center gap-1.5 rounded-lg bg-surface-inset px-2 py-1.5 text-[12px]",
        className,
      )}
      {...props}
    >
      {operator === undefined ? null : (
        <span className="shrink-0 font-medium text-ink-3">{operator}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-ink-2">{children}</span>
      {value === undefined ? null : (
        <span className="shrink-0 rounded-md bg-line px-1.5 py-px text-[11.5px] font-medium text-ink">
          {value}
        </span>
      )}
    </div>
  ),
);
FlowchartCondition.displayName = "FlowchartCondition";

export {
  Flowchart,
  FlowchartConnector,
  FlowchartNode,
  FlowchartNodeTitle,
  FlowchartNodeCaption,
  FlowchartBranch,
  FlowchartCondition,
};
