import loadDynamic from "next/dynamic";
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
      <AppHeader>Dashboard</AppHeader>
      <AppContainer>
        <DashboardDemo />
      </AppContainer>
    </>
  );
}

export default DashboardPage;
