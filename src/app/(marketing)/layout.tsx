import { use } from "react";
import loadUserData from "~/lib/server/loaders/load-user-data";
import { FooterNavigation } from "./components/FooterNavigation";
import { TopNavigation } from "./components/TopNavigation";

function SiteLayout({ children }: React.PropsWithChildren) {
  const data = use(loadUserData());

  return (
    <>
      <TopNavigation userSession={data.session} />
      {children}
      <FooterNavigation />
    </>
  );
}

export default SiteLayout;
