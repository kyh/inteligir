"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { Button } from "~/components/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/Dropdown";

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
        <Button>
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
