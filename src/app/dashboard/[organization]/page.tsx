import loadDynamic from "next/dynamic";
import { Squares2X2Icon } from "@heroicons/react/24/outline";
import AppContainer from "~/app/dashboard/components/AppContainer";
import AppHeader from "~/app/dashboard/components/AppHeader";

const DashboardDemo = loadDynamic(
  () => import("~/app/dashboard/[organization]/DashboardDemo"),
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
        Icon={<Squares2X2Icon className="h-6 dark:text-emerald-500" />}
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
