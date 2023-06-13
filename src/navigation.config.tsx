import { Cog8ToothIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import configuration from "~/configuration";

const NAVIGATION_CONFIG = {
  items: [
    {
      label: "Dashboard",
      path: configuration.paths.appHome,
      Icon: ({ className }: { className?: string }) => {
        return <Squares2X2Icon className={className} />;
      },
    },
    {
      label: "Settings",
      path: "/settings",
      Icon: ({ className }: { className?: string }) => {
        return <Cog8ToothIcon className={className} />;
      },
    },
  ],
};

export default NAVIGATION_CONFIG;
