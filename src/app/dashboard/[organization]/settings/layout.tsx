import React from "react";
import { CogIcon } from "lucide-react";
import AppContainer from "~/app/dashboard/[organization]/components/AppContainer";
import AppHeader from "~/app/dashboard/[organization]/components/AppHeader";
import NavigationItem from "~/app/dashboard/[organization]/components/NavigationItem";
import NavigationMenu from "~/app/dashboard/[organization]/components/NavigationMenu";

const getLinks = (organizationUuid: string) => [
  {
    path: getPath(organizationUuid, "settings/profile"),
    label: "Profile",
  },
  {
    path: getPath(organizationUuid, "settings/organization"),
    label: "Organization",
  },
  {
    path: getPath(organizationUuid, "settings/subscription"),
    label: "Subscription",
  },
];

const SettingsLayout = ({
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
          <CogIcon className="w-6" />
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
};

export default SettingsLayout;

const getPath = (uuid: string, path: string) => {
  const appPrefix = "/dashboard";
  const organizationPath = `${appPrefix}/${uuid}`;

  return `${organizationPath}/${path}`;
};
