import React from "react";
import { Cog8ToothIcon } from "@heroicons/react/24/outline";
import AppContainer from "~/app/dashboard/components/AppContainer";
import AppHeader from "~/app/dashboard/components/AppHeader";
import NavigationItem from "~/app/dashboard/components/NavigationItem";
import NavigationMenu from "~/app/dashboard/components/NavigationMenu";

const links = [
  {
    path: "/settings/profile",
    label: "Profile",
  },
  {
    path: "/settings/organization",
    label: "Organization",
  },
  {
    path: "/settings/subscription",
    label: "Subscription",
  },
];

async function SettingsLayout({ children }: React.PropsWithChildren) {
  return (
    <>
      <AppHeader>
        <span className="flex space-x-2">
          <Cog8ToothIcon className="w-6" />

          <span>Settings</span>
        </span>
      </AppHeader>

      <AppContainer>
        <NavigationMenu bordered>
          {links.map((link) => (
            <NavigationItem
              className="flex-1 lg:flex-none"
              link={link}
              key={link.path}
            />
          ))}
        </NavigationMenu>

        <div className="mt-4 flex h-full flex-col space-y-4 lg:mt-6 lg:flex-row lg:space-x-8 lg:space-y-0">
          {children}
        </div>
      </AppContainer>
    </>
  );
}

export default SettingsLayout;
