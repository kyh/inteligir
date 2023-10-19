import React from "react";
import { CogSixTooth } from "@inteligir/icons";
import NavigationMenu from "ui/components/navigation/navigation-menu";
import NavigationItem from "ui/components/navigation/navigation-item";
import Trans from "ui/components/trans";
import AppHeader from "@/app/dashboard/[organization]/components/app-header";
import AppContainer from "@/app/dashboard/[organization]/components/app-container";
import { withI18n } from "@/i18n/with-i18n";
import configuration from "@/configuration";

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
          <CogSixTooth className="w-6" />

          <span>
            <Trans i18nKey="common:settingsTabLabel" />
          </span>
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
