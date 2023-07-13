import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { CogIcon, LayoutDashboardIcon } from "lucide-react";
import isRouteActive from "~/core/generic/is-route-active";
import { classed } from "~/lib/utils";

const NAVIGATION_CONFIG = (organizationUuid: string) => ({
  items: [
    {
      label: "Dashboard",
      path: `/dashboard/${organizationUuid}`,
      Icon: ({ className }: { className?: string }) => {
        return <LayoutDashboardIcon className={className} />;
      },
    },
    {
      label: "Settings",
      path: `/dashboard/${organizationUuid}/settings`,
      Icon: ({ className }: { className?: string }) => {
        return <CogIcon className={className} />;
      },
    },
  ],
});

function AppSidebarNavigation({
  organizationUuid,
}: React.PropsWithChildren<{
  organizationUuid: string;
}>) {
  const path = usePathname() ?? "";

  return (
    <div className="flex flex-col space-y-1.5">
      {NAVIGATION_CONFIG(organizationUuid).items.map((item) => {
        const Label = item.label;
        const active = isRouteActive(item.path, path, 3);

        return (
          <SidebarItem
            key={item.path}
            href={item.path}
            active={active}
          >
            <item.Icon /> {Label}
          </SidebarItem>
        );
      })}
    </div>
  );
}

export default AppSidebarNavigation;

const SidebarItem = classed(NextLink, {
  base: `flex w-full items-center rounded-md border-transparent text-sm font-medium text-zinc-600 transition-colors duration-300`,
  variants: {
    active: {
      true: `bg-emerald-50 font-medium text-current dark:bg-emerald-300/10 dark:text-emerald-contrast`,
      false: `text-zinc-600 ring-transparent hover:bg-zinc-50 active:bg-zinc-200 dark:bg-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-400 dark:hover:text-white dark:active:bg-zinc-300 dark:active:bg-zinc-300`,
    },
  },
  compoundVariants: [
    {
      active: true,
      className: `bg-emerald-500/5 dark:bg-emerald-500/10 !text-emerald-500`,
    },
    {
      active: true,
      className: `bg-emerald-50 font-medium text-current dark:bg-emerald-300/10 dark:text-emerald-contrast [&>svg]:text-emerald-500`,
    },
    {
      active: false,
      className: `text-zinc-600 dark:text-emerald-contrast`,
    },
  ],
});
