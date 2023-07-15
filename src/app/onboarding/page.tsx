import { use } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { getUserDataById } from "~/lib/server/queries";
import requireSession from "~/lib/user/require-session";
import OnboardingContainer from "./components/OnboardingContainer";

export const metadata = {
  title: "Onboarding",
};

const OnboardingPage = () => {
  const { csrfToken } = use(loadData());

  return <OnboardingContainer csrfToken={csrfToken} />;
};

export default OnboardingPage;

const loadData = async () => {
  const csrfToken = headers().get("X-CSRF-Token");
  const client = getSupabaseServerClient();
  const { user } = await requireSession(client);

  const userData = await getUserDataById(client, user.id.toString()).catch(
    () => undefined
  );

  if (userData && userData.onboarded) {
    redirect("/dashboard");
  }

  return {
    csrfToken,
  };
};
