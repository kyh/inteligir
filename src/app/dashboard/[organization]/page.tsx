import AppContainer from "~/app/dashboard/components/AppContainer";
import AppHeader from "~/app/dashboard/components/AppHeader";

export const metadata = {
  title: "Dashboard",
};

function DashboardPage() {
  return (
    <>
      <AppHeader>Dashboard</AppHeader>
      <AppContainer>Hello World</AppContainer>
    </>
  );
}

export default DashboardPage;
