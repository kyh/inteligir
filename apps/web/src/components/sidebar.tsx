"use client";

import React, { useContext } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { clx, cva } from "@inteligir/ui";
import {
  ArrowRightCircleIcon,
  ArrowLeftCircleIcon,
} from "@heroicons/react/24/outline";
import Trans from "@inteligir/ui/trans";
import { Logo } from "@inteligir/ui/logo";
import LogoMini from "@inteligir/ui/logo/logo-mini";
import IconButton from "@inteligir/ui/icon-button";
import { TooltipContent, Tooltip, TooltipTrigger } from "@inteligir/ui/tooltip";
import { If } from "@/components/if";
import SidebarContext from "@/lib/contexts/sidebar";
import isRouteActive from "@/lib/generic/is-route-active";

export const Sidebar = ({ children }: React.PropsWithChildren) => {
  const { collapsed, setCollapsed } = useContext(SidebarContext);

  const className = getClassNameBuilder()({
    collapsed,
  });

  return (
    <div className={className}>
      <div className="flex w-full flex-col space-y-7 px-4">
        <AppSidebarHeader collapsed={collapsed} />

        <div className="flex flex-col space-y-1">{children}</div>
      </div>

      <AppSidebarFooterMenu collapsed={collapsed} setCollapsed={setCollapsed} />
    </div>
  );
};

export const SidebarItem = ({
  end,
  path,
  children,
  Icon,
}: React.PropsWithChildren<{
  path: string;
  Icon: React.ElementType;
  end?: boolean;
}>) => {
  const { collapsed } = useContext(SidebarContext);

  const currentPath = usePathname() ?? "";
  const active = isRouteActive(path, currentPath, end ? 1 : 3);

  const className = getSidebarItemClassBuilder()({
    collapsed,
    active,
  });

  return (
    <Link className={className} href={path} key={path}>
      <If condition={collapsed} fallback={<Icon className="h-6" />}>
        <Tooltip>
          <TooltipTrigger>
            <Icon className="h-6" />
          </TooltipTrigger>

          <TooltipContent side="right" sideOffset={20}>
            {children}
          </TooltipContent>
        </Tooltip>
      </If>

      <span>{children}</span>
    </Link>
  );
};

const AppSidebarHeader = ({
  collapsed,
}: React.PropsWithChildren<{ collapsed: boolean }>) => {
  const logoHref = "/dashboard";

  return (
    <div className="flex px-2.5 py-1">
      <Link href={logoHref}>
        <Logo />
      </Link>
    </div>
  );
};

const AppSidebarFooterMenu = (
  props: React.PropsWithChildren<{
    collapsed: boolean;
    setCollapsed: (collapsed: boolean) => void;
  }>,
) => (
  <div
    className={clx(`absolute bottom-8 w-full`, {
      "px-6": !props.collapsed,
      "flex justify-center px-2": props.collapsed,
    })}
  >
    <div className="flex items-center space-x-2 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white">
      <CollapsibleButton
        collapsed={props.collapsed}
        onClick={props.setCollapsed}
      />
    </div>
  </div>
);

const CollapsibleButton = (
  props: React.PropsWithChildren<{
    collapsed: boolean;
    onClick: (collapsed: boolean) => void;
  }>,
) => {
  if (props.collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <IconButton
            as="div"
            onClick={() => {
              props.onClick(!props.collapsed);
            }}
          >
            <ArrowRightCircleIcon className="h-6" />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent>Expand Sidebar</TooltipContent>
      </Tooltip>
    );
  }

  const className = clx({
    "[&>span]:hidden justify-center": props.collapsed,
  });

  return (
    <div className={className}>
      <button
        className="flex items-center space-x-2 bg-transparent"
        onClick={() => {
          props.onClick(!props.collapsed);
        }}
      >
        <ArrowLeftCircleIcon className="h-6" />

        <span>Collapse Sidebar</span>
      </button>
    </div>
  );
};

export default Sidebar;

const getClassNameBuilder = () =>
  cva(
    [
      "dark:border-dark-800 relative flex hidden h-screen flex-row justify-center border-r border-gray-100 py-4 lg:flex",
    ],
    {
      variants: {
        collapsed: {
          true: `w-[5rem]`,
          false: `w-2/12 max-w-xs sm:min-w-[12rem] lg:min-w-[17rem]`,
        },
      },
    },
  );

const getSidebarItemClassBuilder = () =>
  cva(
    [
      `flex w-full items-center rounded-md border-transparent text-sm font-semibold transition-colors duration-300`,
    ],
    {
      variants: {
        collapsed: {
          true: `justify-center space-x-0 px-0.5 py-2 [&>span]:hidden`,
          false: `space-x-2.5 px-3 py-2 pr-12`,
        },
        active: {
          true: `bg-primary/5 dark:bg-primary-300/10 dark:text-white`,
          false: `dark:hover:bg-primary-300/10 dark:active:bg-dark-700 ring-transparent hover:bg-gray-50 active:bg-gray-100 dark:text-gray-300 dark:hover:text-white`,
        },
      },
      compoundVariants: [
        {
          collapsed: true,
          active: true,
          className: `bg-primary/5 dark:bg-dark-800 text-primary`,
        },
        {
          collapsed: false,
          active: true,
          className: `dark:bg-dark-800 text-primary dark:text-primary-foreground`,
        },
        {
          collapsed: true,
          active: false,
          className: `dark:text-gray-300`,
        },
      ],
    },
  );
