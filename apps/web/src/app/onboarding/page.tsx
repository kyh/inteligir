import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect";
import { requireSession } from "@/features/auth/require-session";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { getUserDataById } from "@/features/users/queries";
import { getLogger } from "@/lib/utils/logger";
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
  const logger = getLogger();

  const client = getSupabaseServerClient();
  const session = await requireSession(client);
  const user = session.user;
  const csrfToken = headers().get("X-CSRF-Token");

  try {
    const userData = await getUserDataById(client, user.id);

    // if we cannot find the user's Database record
    // the user should go to the onboarding flow
    // so that the record wil be created after the end of the flow
    if (!userData) {
      return {
        csrfToken,
      };
    }

    const onboarded = userData.onboarded;

    // there are two cases when we redirect the user to the onboarding
    // 1. if they have not been onboarded yet
    // 2. if they end up with 0 organizations (for example, if they get removed)
    //
    // NB: you should remove this if you want to
    // allow organization-less users within the application
    if (onboarded) {
      return redirect("/");
    }

    return {
      csrfToken,
    };
  } catch (e) {
    if (!isRedirectError(e)) {
      logger.error(
        `
        Error while initializing onboarding route: ${e}`,
      );
    }

    redirect("auth/sign-in");
  }
};
