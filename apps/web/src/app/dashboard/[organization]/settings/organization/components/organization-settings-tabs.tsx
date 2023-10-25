import NavigationItem from "@inteligir/ui/navigation/navigation-item";
import NavigationMenu from "@inteligir/ui/navigation/navigation-menu";
import MobileNavigationDropdown from "@inteligir/ui/mobile-navigation-dropdown";
import { configuration } from "@/lib/configuration";

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
      <div className={"hidden h-full min-w-[12rem] lg:flex"}>
        <NavigationMenu vertical pill>
          <NavigationItem
            depth={0}
            className={itemClassName}
            link={links.General}
          />

          <NavigationItem className={itemClassName} link={links.Members} />
        </NavigationMenu>
      </div>

      <div className={"block w-full lg:hidden"}>
        <MobileNavigationDropdown links={Object.values(links)} />
      </div>
    </>
  );
};

export default OrganizationSettingsTabs;

function getPath(organizationId: string, path: string) {
  const appPrefix = configuration.paths.appPrefix;

  return `${appPrefix}/${organizationId}/settings/${path}`;
}
