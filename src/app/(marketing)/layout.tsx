import { use } from "react";
import loadUserData from "~/lib/server/loaders/load-user-data";
import AuthChangeListener from "~/app/dashboard/components/AuthChangeListener";
import { FooterNavigation } from "./components/FooterNavigation";
import { TopNavigation } from "./components/TopNavigation";

export const dynamic = "force-dynamic";

function SiteLayout({ children }: React.PropsWithChildren) {
  const data = use(loadUserData());

  return (
    <>
      <AuthChangeListener accessToken={data.accessToken}>
        <TopNavigation userSession={data.session} />
      </AuthChangeListener>
      {children}
      <FooterNavigation />
    </>
  );
}

export default SiteLayout;
