"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContext } from "react";
import { cva, clx } from "@inteligir/ui";
import { isRouteActive } from "@/lib/utils/is-route-active";
import { NavigationMenuContext } from "./navigation-menu-context";

type NavigationMenuItemProps = {
  link: {
    path: string;
    label?: string;
  };
  depth?: number;
  disabled?: boolean;
  shallow?: boolean;
  className?: string;
};

const NavigationMenuItem = ({
  link,
  disabled,
  shallow,
  depth,
  ...props
}: NavigationMenuItemProps) => {
  const pathName = usePathname();
  const active = isRouteActive(link.path, pathName, depth ?? 3);
  const menuProps = useContext(NavigationMenuContext);
  const label = link.label;

  const itemClassName = getNavigationMenuItemClassBuilder()({
    active,
    ...menuProps,
  });

  const className = clx(itemClassName, props.className ?? ``);

  if (disabled) {
    return (
      <span className={className} role="link">
        {label}
      </span>
    );
  }

  return (
    <Link className={className} href={link.path} shallow={shallow ?? active}>
      <span className="transition-transform duration-500">{label}</span>
    </Link>
  );
};

export default NavigationMenuItem;

const getNavigationMenuItemClassBuilder = () =>
  cva(
    [
      `colors flex transform items-center justify-center rounded-md p-1 text-sm font-medium transition active:translate-y-[2px] lg:justify-start lg:px-2.5`,
    ],
    {
      compoundVariants: [
        // not active - shared
        {
          active: false,
          className: `text-gray-600 hover:text-current active:text-current
        dark:text-gray-300 dark:hover:text-white`,
        },
        // active - shared
        {
          active: true,
          className: `text-gray-800 dark:text-white`,
        },
        // active - pill
        {
          active: true,
          pill: true,
          className: `dark:bg-primary-300/10 bg-gray-50 text-gray-600`,
        },
        // not active - pill
        {
          active: false,
          pill: true,
          className: `dark:hover:bg-background dark:active:bg-dark-900/90 text-gray-500 hover:bg-gray-50 active:bg-gray-100 dark:text-gray-300`,
        },
        // not active - bordered
        {
          active: false,
          bordered: true,
          className: `dark:active:bg-dark-800 dark:hover:bg-dark/90 rounded-lg border-transparent transition-colors hover:bg-gray-50 active:bg-gray-100`,
        },
        // active - bordered
        {
          active: true,
          bordered: true,
          className: `border-primary top-[0.4rem] rounded-none border-b-[0.25rem] bg-transparent pb-[0.8rem] text-current dark:text-white`,
        },
        // active - secondary
        {
          active: true,
          secondary: true,
          className: `bg-transparent font-semibold`,
        },
      ],
      variants: {
        active: {
          true: ``,
        },
        pill: {
          true: `py-2`,
        },
        bordered: {
          true: `relative h-10`,
        },
        secondary: {
          true: ``,
        },
      },
    },
  );
