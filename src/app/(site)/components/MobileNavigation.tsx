import Link from "next/link";
import Trans from "~/core/ui/Trans";
import Bars3Icon from "@heroicons/react/24/outline/Bars3Icon";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/core/ui/Dropdown";

import NAVIGATION_CONFIG from "~/navigation.config";

const MobileNavigation: React.FC = () => {
  const Links = NAVIGATION_CONFIG.items.map((item) => {
    return (
      <DropdownMenuItem key={item.path}>
        <Link
          href={item.path}
          className="flex h-full w-full items-center space-x-4"
        >
          <item.Icon className="h-6" />

          <span>
            <Trans i18nKey={item.label} defaults={item.label} />
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
