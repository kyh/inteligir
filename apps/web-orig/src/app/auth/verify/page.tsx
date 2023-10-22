import { redirect } from "next/navigation";
import verifyRequiresMfa from "@/features/auth/check-requires-mfa";
import getSupabaseServerClient from "@/lib/supabase/server-client";
import VerifyFormContainer from "./components/verify-form-container";

export const metadata = {
  title: "Verify Authentication",
};

const VerifyPage = async () => {
  const client = getSupabaseServerClient();
  const needsMfa = await verifyRequiresMfa(client);

  if (!needsMfa) {
    redirect("/auth/sign-in");
  }

  return <VerifyFormContainer />;
};

export default VerifyPage;
