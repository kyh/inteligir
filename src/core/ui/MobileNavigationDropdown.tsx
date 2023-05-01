"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

import { useMemo } from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";

import {
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenu,
} from "~/core/ui/Dropdown";

import Button from "~/core/ui/Button";

const MobileNavigationDropdown: React.FC<{
  links: Array<{
    path: string;
    label: string;
  }>;
}> = ({ links }) => {
  const path = usePathname();

  const currentPathName = useMemo(() => {
    return Object.values(links).find((link) => link.path === path)?.label;
  }, [links, path]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button color="secondary" block>
          <span className="flex w-full items-center justify-between space-x-2">
            <span>{currentPathName}</span>

            <ChevronDownIcon className="h-5" />
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        {Object.values(links).map((link) => {
          return (
            <DropdownMenuItem key={link.path}>
              <Link href={link.path}>{link.label}</Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default MobileNavigationDropdown;
