import React, { useContext } from "react";
import Link from "next/link";
import {
  ArrowLeftCircleIcon,
  ArrowRightCircleIcon,
} from "@heroicons/react/24/outline";
import SidebarContext from "~/lib/contexts/sidebar";
import { cn } from "~/lib/utils/cn";
import { Button } from "~/components/Button";
import { Logo } from "~/components/Logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/Tooltip";
import AppSidebarNavigation from "./AppSidebarNavigation";

type AppSidebarType = {
  organizationUuid: string;
};

const AppSidebar = ({ organizationUuid }: AppSidebarType) => {
  const { collapsed, setCollapsed } = useContext(SidebarContext);

  return (
    <div className="relative flex h-screen w-2/12 max-w-xs flex-row justify-center border-r border-border py-4 dark:bg-zinc-600 sm:min-w-[12rem] lg:flex lg:min-w-[17rem]">
      <div className="flex w-full flex-col space-y-7 px-4">
        <AppSidebarHeader collapsed={collapsed} />
        <AppSidebarNavigation
          collapsed={collapsed}
          organizationUuid={organizationUuid}
        />
      </div>
      <AppSidebarFooterMenu collapsed={collapsed} setCollapsed={setCollapsed} />
    </div>
  );
};

function AppSidebarHeader({
  collapsed,
}: React.PropsWithChildren<{ collapsed: boolean }>) {
  return (
    <div className="flex px-2.5 py-1">
      <Link href="/dashboard">
        <Logo />
      </Link>
    </div>
  );
}

function AppSidebarFooterMenu(
  props: React.PropsWithChildren<{
    collapsed: boolean;
    setCollapsed: (collapsed: boolean) => void;
  }>
) {
  return (
    <div
      className={cn(`absolute bottom-8 w-full`, {
        "px-6": !props.collapsed,
        "flex justify-center px-2": props.collapsed,
      })}
    >
      <div className="flex items-center space-x-2 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-300 dark:hover:text-white">
        <CollapsibleButton
          collapsed={props.collapsed}
          onClick={props.setCollapsed}
        />
      </div>
    </div>
  );
}

function CollapsibleButton(
  props: React.PropsWithChildren<{
    collapsed: boolean;
    onClick: (collapsed: boolean) => void;
  }>
) {
  if (props.collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <Button as="div" onClick={() => props.onClick(!props.collapsed)}>
            <ArrowRightCircleIcon className="h-6" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Expand Sidebar</TooltipContent>
      </Tooltip>
    );
  }

  const className = cn({
    "[&>span]:hidden justify-center": props.collapsed,
  });

  return (
    <div className={className}>
      <button
        className="flex items-center space-x-2 bg-transparent"
        onClick={() => props.onClick(!props.collapsed)}
      >
        <ArrowLeftCircleIcon className="h-6" />
        <span>Collapse Sidebar</span>
      </button>
    </div>
  );
}

export default AppSidebar;
