import loadDynamic from "next/dynamic";
import { SquaresPlus } from "@inteligir/icons";
import Spinner from "ui/components/Spinner";
import AppHeader from "./components/AppHeader";
import AppContainer from "./components/AppContainer";

const DashboardDemo = loadDynamic(
  () => import("@/app/dashboard/[organization]/components/DashboardDemo"),
  {
    ssr: false,
    loading: () => (
      <div
        className={
          "flex min-h-full flex-1 flex-col items-center justify-center" +
          " space-y-4"
        }
      >
        <Spinner className="text-primary" />

        <div>Loading dashboard...</div>
      </div>
    ),
  },
);

export const metadata = {
  title: "Dashboard",
};

const DashboardPage = () => {
  return (
    <>
      <AppHeader Icon={<SquaresPlus className="dark:text-primary h-6" />}>
        <Trans i18nKey="common:dashboardTabLabel" />
      </AppHeader>

      <AppContainer>
        <DashboardDemo />
      </AppContainer>
    </>
  );
};

export default DashboardPage;
