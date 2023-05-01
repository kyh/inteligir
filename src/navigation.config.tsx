import configuration from "~/configuration";
import { Cog8ToothIcon, Squares2X2Icon } from "@heroicons/react/24/outline";

const NAVIGATION_CONFIG = {
  items: [
    {
      label: "common:dashboardTabLabel",
      path: configuration.paths.appHome,
      Icon: ({ className }: { className: string }) => {
        return <Squares2X2Icon className={className} />;
      },
    },
    {
      label: "common:settingsTabLabel",
      path: "/settings",
      Icon: ({ className }: { className: string }) => {
        return <Cog8ToothIcon className={className} />;
      },
    },
  ],
};

export default NAVIGATION_CONFIG;
