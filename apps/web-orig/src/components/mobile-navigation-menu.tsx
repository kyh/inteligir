import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import Trans from "@/lib/ui/Trans";
import {
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenu,
} from "@/lib/ui/Dropdown";

const MobileNavigationDropdown: React.FC<{
  links: {
    path: string;
    label: string;
  }[];
}> = ({ links }) => {
  const path = usePathname();

  const items = useMemo(
    () =>
      Object.values(links).map((link) => {
        return (
          <DropdownMenuItem key={link.path}>
            <Link className="flex h-full w-full items-center" href={link.path}>
              <Trans defaults={link.label} i18nKey={link.label} />
            </Link>
          </DropdownMenuItem>
        );
      }),
    [links],
  );

  const currentPathName = useMemo(() => {
    return Object.values(links).find((link) => link.path === path)?.label;
  }, [links, path]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full">
        <div className="Button dark:ring-dark-700 w-full justify-start ring-2 ring-gray-100">
          <span className="ButtonNormal flex w-full items-center justify-between space-x-2">
            <span>
              <Trans defaults={currentPathName} i18nKey={currentPathName} />
            </span>

            <ChevronDownIcon className="h-5" />
          </span>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent>{items}</DropdownMenuContent>
    </DropdownMenu>
  );
};

export default MobileNavigationDropdown;
