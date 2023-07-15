import Link from "next/link";
import { Logo } from "~/components/Logo";
import AppSidebarNavigation from "./AppSidebarNavigation";

type AppSidebarType = {
  organizationUuid: string;
};

const AppSidebar = ({ organizationUuid }: AppSidebarType) => {
  return (
    <div className="relative flex h-screen w-2/12 max-w-xs flex-row justify-center border-r border-border py-4 sm:min-w-[12rem] lg:flex lg:min-w-[17rem]">
      <div className="flex w-full flex-col space-y-7 px-4">
        <AppSidebarHeader />
        <AppSidebarNavigation organizationUuid={organizationUuid} />
      </div>
    </div>
  );
};

const AppSidebarHeader = () => {
  return (
    <div className="flex px-2.5 py-1">
      <Link href="/dashboard">
        <Logo />
      </Link>
    </div>
  );
};

export default AppSidebar;
