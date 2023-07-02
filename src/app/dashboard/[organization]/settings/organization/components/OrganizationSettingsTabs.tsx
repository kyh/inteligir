import MobileNavigationDropdown from "~/app/dashboard/components/MobileNavigationDropdown";
import NavigationItem from "~/app/dashboard/components/NavigationItem";
import NavigationMenu from "~/app/dashboard/components/NavigationMenu";

const links = {
  General: {
    path: "/settings/organization",
    label: "General Settings",
  },
  Members: {
    path: "/settings/organization/members",
    label: "Members",
  },
};

const OrganizationSettingsTabs = () => {
  const itemClassName = `flex justify-center lg:justify-start items-center w-full`;

  return (
    <>
      <div className="hidden h-full min-w-[12rem] lg:flex">
        <NavigationMenu vertical pill>
          <NavigationItem
            depth={0}
            className={itemClassName}
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
