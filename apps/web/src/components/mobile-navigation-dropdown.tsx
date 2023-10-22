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
  Button,
} from "@inteligir/ui";

const MobileNavigationDropdown: React.FC<{
  links: {
    path: string;
    label: string;
  }[];
}> = ({ links }) => {
  const path = usePathname();

  const currentPathName = useMemo(() => {
    return Object.values(links).find((link) => link.path === path)?.label;
  }, [links, path]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <span className="flex w-full items-center justify-between space-x-2">
            <span>{currentPathName}</span>
            <ChevronDownIcon className="h-5" />
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="dark:divide-dark-700 divide-y divide-gray-100">
        {Object.values(links).map((link) => {
          return (
            <DropdownMenuItem asChild key={link.path}>
              <Link className="flex h-12 w-full items-center" href={link.path}>
                {link.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default MobileNavigationDropdown;
