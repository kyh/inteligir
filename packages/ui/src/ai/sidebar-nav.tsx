"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "cn";
import { GlideList } from "@repo/ui/ai/glide-list";

export interface SidebarRailProps extends HTMLAttributes<HTMLDivElement> {
  collapsed?: boolean;
}

const SidebarRail = forwardRef<HTMLDivElement, SidebarRailProps>(
  ({ className, collapsed = false, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-rail"
      data-collapsed={collapsed ? "" : undefined}
      className={cn(
        "flex h-full flex-col gap-1 overflow-hidden bg-surface-inset py-2",
        "transition-[width] duration-200 motion-reduce:transition-none",
        collapsed ? "w-13" : "w-60",
        className,
      )}
      {...props}
    />
  ),
);
SidebarRail.displayName = "SidebarRail";

export interface SidebarWorkspaceProps extends HTMLAttributes<HTMLButtonElement> {
  monogram?: ReactNode;
  collapsed?: boolean;
}

const SidebarWorkspace = forwardRef<HTMLButtonElement, SidebarWorkspaceProps>(
  ({ className, children, monogram, collapsed = false, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      data-slot="sidebar-workspace"
      className={cn(
        "mx-2 flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-left",
        "transition-colors duration-100 hover:bg-hover",
        className,
      )}
      {...props}
    >
      {monogram === undefined ? null : (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-line text-[11px] font-semibold text-ink">
          {monogram}
        </span>
      )}
      {collapsed ? null : (
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">
          {children}
        </span>
      )}
    </button>
  ),
);
SidebarWorkspace.displayName = "SidebarWorkspace";

export interface SidebarGroupProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
  collapsed?: boolean;
}

const SidebarGroup = forwardRef<HTMLDivElement, SidebarGroupProps>(
  ({ className, children, label, collapsed = false, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-nav-group"
      className={cn("flex flex-col", className)}
      {...props}
    >
      {label === undefined || collapsed ? null : (
        <span className="px-4 pt-2 pb-1 text-[11px] font-medium text-ink-3">{label}</span>
      )}
      <GlideList className="flex flex-col" highlightClassName="inset-x-2 rounded-lg">
        {children}
      </GlideList>
    </div>
  ),
);
SidebarGroup.displayName = "SidebarGroup";

export interface SidebarNavItemProps extends HTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  active?: boolean;
  count?: ReactNode;
  collapsed?: boolean;
}

const SidebarNavItem = forwardRef<HTMLButtonElement, SidebarNavItemProps>(
  ({ className, children, icon, active = false, count, collapsed = false, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      data-menu-row
      data-slot="sidebar-nav-item"
      data-active={active ? "" : undefined}
      className={cn(
        "relative z-10 mx-2 flex h-8 items-center rounded-lg px-2 text-left",
        "transition-[background-color,color,transform] duration-150 active:scale-[0.98]",
        "outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
        active && "bg-hover",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center [&_svg]:size-4",
          active ? "text-ink" : "text-ink-2",
        )}
      >
        {icon}
      </span>
      {collapsed ? null : (
        <>
          <span
            className={cn(
              "ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium",
              active ? "text-ink" : "text-ink-2",
            )}
          >
            {children}
          </span>
          {count === undefined ? null : (
            <span className="mr-1 shrink-0 text-[12px] font-medium text-ink-3 tabular-nums">
              {count}
            </span>
          )}
        </>
      )}
    </button>
  ),
);
SidebarNavItem.displayName = "SidebarNavItem";

const SidebarNavFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-nav-footer"
      className={cn("mt-auto flex flex-col gap-1 pt-2", className)}
      {...props}
    />
  ),
);
SidebarNavFooter.displayName = "SidebarNavFooter";

export { SidebarRail, SidebarWorkspace, SidebarGroup, SidebarNavItem, SidebarNavFooter };
