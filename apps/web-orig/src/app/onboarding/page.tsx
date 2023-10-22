import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/features/auth/require-session";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { getUserById } from "@/features/users/queries";
import OnboardingContainer from "./components/onboarding-container";

export const metadata = {
  title: "Onboarding",
};

const OnboardingPage = async () => {
  const { csrfToken } = await loadData();

  return <OnboardingContainer csrfToken={csrfToken} />;
};

export default OnboardingPage;

const loadData = async () => {
  const csrfToken = headers().get("X-CSRF-Token");
  const client = getSupabaseServerClient();
  const { user } = await requireSession(client);

  const userData = await getUserById(client, user.id.toString());

  if (userData.data?.onboarded) {
    redirect("/dashboard");
  }

  return {
    csrfToken,
  };
};
