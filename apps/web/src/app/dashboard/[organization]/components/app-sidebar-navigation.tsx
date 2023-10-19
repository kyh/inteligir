"use client";

import Trans from "ui/components/trans";
import { SidebarItem } from "ui/components/sidebar";
import NAVIGATION_CONFIG from "@/navigation.config";

const AppSidebarNavigation = ({
  organization,
}: React.PropsWithChildren<{
  organization: string;
}>) => {
  return (
    <div className="flex flex-col space-y-1.5">
      {NAVIGATION_CONFIG(organization).items.map((item) => {
        return (
          <SidebarItem
            Icon={item.Icon}
            end={item.end}
            key={item.path}
            path={item.path}
          >
            <Trans defaults={item.label} i18nKey={item.label} />
          </SidebarItem>
        );
      })}
    </div>
  );
};

export default AppSidebarNavigation;
