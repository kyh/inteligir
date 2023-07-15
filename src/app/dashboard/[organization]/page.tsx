import AppContainer from "~/app/dashboard/[organization]/components/AppContainer";
import AppHeader from "~/app/dashboard/[organization]/components/AppHeader";

export const metadata = {
  title: "Dashboard",
};

const DashboardPage = () => {
  return (
    <>
      <AppHeader>Dashboard</AppHeader>
      <AppContainer>Hello World</AppContainer>
    </>
  );
};

export default DashboardPage;
