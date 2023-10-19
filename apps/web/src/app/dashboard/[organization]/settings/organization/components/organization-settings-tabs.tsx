import NavigationItem from "ui/components/navigation/navigation-item";
import NavigationMenu from "ui/components/navigation/navigation-menu";
import MobileNavigationDropdown from "ui/components/mobile-navigation-dropdown";
import configuration from "@/configuration";

const getLinks = (organizationId: string) => ({
  General: {
    path: getPath(organizationId, "organization"),
    label: "organization:generalTabLabel",
  },
  Members: {
    path: getPath(organizationId, "organization/members"),
    label: "organization:membersTabLabel",
  },
});

const OrganizationSettingsTabs: React.FC<{
  organizationId: string;
}> = ({ organizationId }) => {
  const itemClassName = `flex justify-center lg:justify-start items-center w-full`;
  const links = getLinks(organizationId);

  return (
    <>
      <div className="hidden h-full min-w-[12rem] lg:flex">
        <NavigationMenu pill vertical>
          <NavigationItem
            className={itemClassName}
            depth={0}
            link={links.General}
          />

          <NavigationItem className={itemClassName} link={links.Members} />
        </NavigationMenu>
      </div>

      <div className="block w-full lg:hidden">
        <MobileNavigationDropdown links={Object.values(links)} />
      </div>
    </>
  );
};

export default OrganizationSettingsTabs;

const getPath = (organizationId: string, path: string) => {
  const appPrefix = configuration.paths.appPrefix;

  return `${appPrefix}/${organizationId}/settings/${path}`;
};
