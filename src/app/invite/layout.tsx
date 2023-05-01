import { use } from "react";

import AuthPageShell from "~/app/auth/components/AuthPageShell";
import initializeServerI18n from "~/i18n/i18n.server";
import getLanguageCookie from "~/i18n/get-language-cookie";

function InvitePageLayout({ children }: React.PropsWithChildren) {
  const { language } = use(loadInvitePageData());

  return <AuthPageShell language={language}>{children}</AuthPageShell>;
}

export default InvitePageLayout;

async function loadInvitePageData() {
  const { language } = await initializeServerI18n(getLanguageCookie());

  return {
    language,
  };
}
