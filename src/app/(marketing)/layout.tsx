import { use } from "react";
import loadUserData from "~/lib/server/loaders/load-user-data";
import AuthChangeListener from "~/app/(dashboard)/components/AuthChangeListener";
import { FooterNavigation } from "./components/FooterNavigation";
import SiteHeaderSessionProvider from "./components/SiteHeaderSessionProvider";

function SiteLayout({ children }: React.PropsWithChildren) {
  const data = use(loadUserData());

  return (
    <AuthChangeListener accessToken={data.accessToken}>
      <SiteHeaderSessionProvider data={data.session} />
      {children}
      <FooterNavigation />
    </AuthChangeListener>
  );
}

export default SiteLayout;
