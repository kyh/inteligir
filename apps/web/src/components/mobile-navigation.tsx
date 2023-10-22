"use client";

import Link from "next/link";
import { Bars3Icon } from "@heroicons/react/24/outline";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@inteligir/ui/dropdown";
import Trans from "@inteligir/ui/trans";
import NAVIGATION_CONFIG from "../navigation.config";

const MobileNavigation: React.FC<{
  organizationUid: string;
}> = ({ organizationUid }) => {
  const Links = NAVIGATION_CONFIG(organizationUid).items.map((item) => {
    return (
      <DropdownMenuItem key={item.path}>
        <Link
          className="flex h-full w-full items-center space-x-4"
          href={item.path}
        >
          <item.Icon className="h-6" />

          <span>
            <Trans defaults={item.label} i18nKey={item.label} />
          </span>
        </Link>
      </DropdownMenuItem>
    );
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Bars3Icon className="h-8" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>{Links}</DropdownMenuContent>
    </DropdownMenu>
  );
};

export default MobileNavigation;
