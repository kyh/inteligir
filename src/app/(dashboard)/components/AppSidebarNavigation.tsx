import Link from "next/link";
import { usePathname } from "next/navigation";
import { cva } from "cva";
import NAVIGATION_CONFIG from "~/navigation.config";
import isRouteActive from "~/core/generic/is-route-active";
import If from "~/components/If";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/Tooltip";

function AppSidebarNavigation({
  collapsed,
}: React.PropsWithChildren<{
  collapsed: boolean;
}>) {
  const iconClassName = getSidebarIconClassBuilder()({
    collapsed,
  });

  const path = usePathname() ?? "";

  return (
    <div className="flex flex-col space-y-1.5">
      {NAVIGATION_CONFIG.items.map((item) => {
        const Label = item.label;
        const active = isRouteActive(item.path, path, 3);

        const className = getSidebarItemClassBuilder()({
          collapsed,
          active,
        });

        return (
          <Link key={item.path} href={item.path} className={className}>
            <If
              condition={collapsed}
              fallback={<item.Icon className={iconClassName} />}
            >
              <Tooltip>
                <TooltipTrigger>
                  <item.Icon className={iconClassName} />
                </TooltipTrigger>

                <TooltipContent side="right" sideOffset={20}>
                  {Label}
                </TooltipContent>
              </Tooltip>
            </If>

            <span>{Label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default AppSidebarNavigation;

function getSidebarItemClassBuilder() {
  return cva(
    [
      `flex w-full items-center rounded-md border-transparent text-sm font-medium text-gray-600 transition-colors duration-300`,
    ],
    {
      variants: {
        collapsed: {
          true: `justify-center space-x-0 px-0.5 py-2 [&>span]:hidden`,
          false: `py-2 px-3 pr-12 space-x-2.5`,
        },
        active: {
          true: `bg-primary-50 font-medium text-current dark:bg-primary-300/10 dark:text-primary-contrast`,
          false: `text-gray-600 ring-transparent hover:bg-gray-50 active:bg-gray-200 dark:bg-black-600 dark:text-gray-300 dark:hover:bg-black-400 dark:hover:text-white dark:active:bg-black-300 dark:active:bg-black-300`,
        },
      },
      compoundVariants: [
        {
          collapsed: true,
          active: true,
          className: `bg-primary-500/5 dark:bg-primary-500/10 !text-primary-500`,
        },
        {
          collapsed: false,
          active: true,
          className: `bg-primary-50 font-medium text-current dark:bg-primary-300/10 dark:text-primary-contrast [&>svg]:text-primary-500`,
        },
        {
          collapsed: true,
          active: false,
          className: `text-gray-600 dark:text-primary-contrast`,
        },
      ],
    }
  );
}

function getSidebarIconClassBuilder() {
  return cva([""], {
    variants: {
      collapsed: {
        true: `h-7`,
        false: `h-6`,
      },
    },
  });
}
