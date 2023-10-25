import React from "react";
import { Cog8ToothIcon } from "@heroicons/react/24/outline";
import NavigationMenu from "@inteligir/ui/navigation/navigation-menu";
import NavigationItem from "@inteligir/ui/navigation/navigation-item";
import Trans from "@inteligir/ui/trans";
import AppContainer from "@/app/dashboard/[organization]/components/app-container";
import AppHeader from "@/app/dashboard/[organization]/components/app-header";
import { configuration } from "@/lib/configuration";
import { withI18n } from "@/i18n/with-i18n";

const getLinks = (organizationId: string) => [
  {
    path: getPath(organizationId, "settings/profile"),
    label: "common:profileSettingsTabLabel",
  },
  {
    path: getPath(organizationId, "settings/organization"),
    label: "common:organizationSettingsTabLabel",
  },
  {
    path: getPath(organizationId, "settings/subscription"),
    label: "common:subscriptionSettingsTabLabel",
  },
];

const SettingsLayout = async ({
  children,
  params,
}: React.PropsWithChildren<{
  params: {
    organization: string;
  };
}>) => {
  const links = getLinks(params.organization);

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
              key={link.path}
              link={link}
            />
          ))}
        </NavigationMenu>

        <div className="mt-4 flex h-full flex-col space-y-4 lg:mt-6 lg:flex-row lg:space-x-8 lg:space-y-0">
          {children}
        </div>
      </AppContainer>
    </>
  );
};

export default withI18n(SettingsLayout);

const getPath = (organizationId: string, path: string) => {
  const appPrefix = configuration.paths.appPrefix;

  return `${appPrefix}/${organizationId}/${path}`;
};
