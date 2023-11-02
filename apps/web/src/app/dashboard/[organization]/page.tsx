import { SquaresPlus } from "@inteligir/icons";
import AppHeader from "../components/app-header";
import AppContainer from "../components/app-container";

export const metadata = {
  title: "Dashboard",
};

const DashboardPage = () => {
  return (
    <>
      <AppHeader Icon={<SquaresPlus className="dark:text-primary h-6" />}>
        Dashboard
      </AppHeader>
      <AppContainer>Home</AppContainer>
    </>
  );
};

export default DashboardPage;
