import { use } from "react";
import Footer from "~/app/(site)/components/Footer";
import loadUserData from "~/lib/server/loaders/load-user-data";
import AuthChangeListener from "~/app/(app)/components/AuthChangeListener";
import SiteHeaderSessionProvider from "~/app/(site)/components/SiteHeaderSessionProvider";

function SiteLayout(props: React.PropsWithChildren) {
  const data = use(loadUserData());

  return (
    <AuthChangeListener accessToken={data.accessToken}>
      <SiteHeaderSessionProvider data={data} />
      {props.children}
      <Footer />
    </AuthChangeListener>
  );
}

export default SiteLayout;
