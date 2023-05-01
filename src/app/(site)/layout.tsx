import { use } from "react";

import Footer from "~/app/(site)/components/Footer";
import loadUserData from "~/lib/server/loaders/load-user-data";
import I18nProvider from "~/i18n/I18nProvider";
import AuthChangeListener from "~/app/(app)/components/AuthChangeListener";
import SiteHeaderSessionProvider from "~/app/(site)/components/SiteHeaderSessionProvider";

function SiteLayout(props: React.PropsWithChildren) {
  const data = use(loadUserData());

  return (
    <I18nProvider lang={data.language}>
      <AuthChangeListener accessToken={data.accessToken}>
        <SiteHeaderSessionProvider data={data} />

        {props.children}

        <Footer />
      </AuthChangeListener>
    </I18nProvider>
  );
}

export default SiteLayout;
