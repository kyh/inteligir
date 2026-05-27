"use client";

import { useRef, useEffect, forwardRef, type HTMLAttributes } from "react";
import Link from "next/link";
import { useNavMenu } from "@repo/ui/components/nav-menu";
import type { IconComponent } from "@repo/ui/lib/icon-context";
import { cn } from "@repo/ui/lib/utils";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { useShape } from "@repo/ui/lib/shape-context";

interface NavItemProps
  extends Omit<HTMLAttributes<HTMLAnchorElement>, "href"> {
  label: string;
  href: string;
  index: number;
  icon?: IconComponent;
  isNew?: boolean;
  isUpdated?: boolean;
}

const NavItem = forwardRef<HTMLAnchorElement, NavItemProps>(
  ({ label, href, index, icon: Icon, isNew, isUpdated, className, ...props }, ref) => {
    const internalRef = useRef<HTMLAnchorElement>(null);
    const { registerItem, registerSlug, activeIndex, activeSlug } =
      useNavMenu();

    useEffect(() => {
      registerItem(index, internalRef.current);
      registerSlug(index, href);
      return () => {
        registerItem(index, null);
        registerSlug(index, null);
      };
    }, [index, href, registerItem, registerSlug]);

    const isActive = activeIndex === index;
    const isActiveRoute = activeSlug === href;
    const shape = useShape();

    // Roving tabindex: active route gets 0, others get -1
    const activeRouteExists = activeSlug !== null;
    const tabIdx = isActiveRoute ? 0 : activeRouteExists ? -1 : index === 0 ? 0 : -1;

    return (
      <Link
        ref={(node) => {
          (
            internalRef as React.MutableRefObject<HTMLAnchorElement | null>
          ).current = node;
          if (typeof ref === "function") ref(node);
          else if (ref)
            (
              ref as React.MutableRefObject<HTMLAnchorElement | null>
            ).current = node;
        }}
        href={href}
        data-nav-index={index}
        tabIndex={tabIdx}
        aria-current={isActiveRoute ? "page" : undefined}
        className={cn(
          `relative z-10 flex items-center ${shape.item} px-3 py-1.5 cursor-pointer outline-none`,
          className
        )}
        {...props}
      >
        {Icon && (
          <Icon
            size={16}
            strokeWidth={isActiveRoute || isActive ? 2 : 1.5}
            className={cn(
              "shrink-0 mr-2 transition-[color,stroke-width] duration-80",
              isActiveRoute || isActive ? "text-foreground" : "text-muted-foreground"
            )}
          />
        )}
        <span className="inline-grid flex-1 text-[13px]">
          <span
            className="col-start-1 row-start-1 invisible"
            style={{ fontVariationSettings: fontWeights.semibold }}
            aria-hidden="true"
          >
            {label}
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80",
              isActiveRoute || isActive
                ? "text-foreground"
                : "text-muted-foreground"
            )}
            style={{
              fontVariationSettings: isActiveRoute
                ? fontWeights.semibold
                : fontWeights.normal,
            }}
          >
            {label}
            {isUpdated ? (
              <span className="inline-block ml-2 size-1.5 rounded-full bg-yellow-400 align-middle" />
            ) : isNew ? (
              <span className="inline-block ml-2 size-1.5 rounded-full bg-blue-500 align-middle" />
            ) : null}
          </span>
        </span>
      </Link>
    );
  }
);

NavItem.displayName = "NavItem";

export { NavItem };
export default NavItem;
