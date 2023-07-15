import { use } from "react";
import { redirect } from "next/navigation";
import verifyRequiresMfa from "~/core/session/utils/check-requires-mfa";
import getSupabaseServerClient from "~/core/supabase/server-client";
import VerifyFormContainer from "./components/VerifyFormContainer";

export const metadata = {
  title: "Verify Authentication",
};

const VerifyPage = () => {
  use(loadData());

  return <VerifyFormContainer />;
};

export default VerifyPage;

const loadData = async () => {
  const client = getSupabaseServerClient();
  const needsMfa = await verifyRequiresMfa(client);

  if (needsMfa) {
    return {};
  }

  return redirect("/auth/sign-in");
};
