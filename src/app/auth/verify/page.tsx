import { redirect } from "next/navigation";
import { use } from "react";

import verifyRequiresMfa from "~/core/session/utils/check-requires-mfa";
import getSupabaseServerClient from "~/core/supabase/server-client";
import VerifyFormContainer from "./components/VerifyFormContainer";

import getLanguageCookie from "~/i18n/get-language-cookie";
import initializeServerI18n from "~/i18n/i18n.server";
import I18nProvider from "~/i18n/I18nProvider";

import configuration from "~/configuration";

export const metadata = {
  title: "Verify Authentication",
};

function VerifyPage() {
  const data = use(loadData());

  if ("redirect" in data && data.destination) {
    return redirect(data.destination);
  }

  return (
    <I18nProvider lang={data.language}>
      <VerifyFormContainer />
    </I18nProvider>
  );
}

export default VerifyPage;

export async function loadData() {
  const client = getSupabaseServerClient();
  const needsMfa = await verifyRequiresMfa(client);

  if (needsMfa) {
    const { language } = await initializeServerI18n(getLanguageCookie());

    return {
      language,
    };
  }

  return {
    redirect: true,
    destination: configuration.paths.signIn,
  };
}
