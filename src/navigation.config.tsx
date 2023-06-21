import { Cog8ToothIcon, Squares2X2Icon } from "@heroicons/react/24/outline";

const NAVIGATION_CONFIG = (organizationUuid: string) => ({
  items: [
    {
      label: "Dashboard",
      path: `${organizationUuid}/dashboard`,
      Icon: ({ className }: { className?: string }) => {
        return <Squares2X2Icon className={className} />;
      },
    },
    {
      label: "Settings",
      path: `${organizationUuid}/settings`,
      Icon: ({ className }: { className?: string }) => {
        return <Cog8ToothIcon className={className} />;
      },
    },
  ],
});

export default NAVIGATION_CONFIG;
