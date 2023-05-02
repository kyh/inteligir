import dynamic from "next/dynamic";

import { Squares2X2Icon } from "@heroicons/react/24/outline";

import AppHeader from "~/app/(dashboard)/components/AppHeader";
import AppContainer from "~/app/(dashboard)/components/AppContainer";

const DashboardDemo = dynamic(
  () => import("~/app/(dashboard)/dashboard/DashboardDemo"),
  {
    ssr: false,
  }
);

export const metadata = {
  title: "Dashboard",
};

function DashboardPage() {
  return (
    <>
      <AppHeader
        Icon={<Squares2X2Icon className="h-6 dark:text-primary-500" />}
      >
        Dashboard
      </AppHeader>

      <AppContainer>
        <DashboardDemo />
      </AppContainer>
    </>
  );
}

export default DashboardPage;
