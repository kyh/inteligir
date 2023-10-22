import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect";
import { Logo } from "@inteligir/ui";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { requireSession } from "@/features/auth/require-session";
import { getUserById } from "@/features/users/queries";
import { getLogger } from "@/lib/utils/logger";

const OnboardingLayout = async ({ children }: React.PropsWithChildren) => {
  await initializeOnboardingRoute();

  return (
    <div className="dark:bg-background flex flex-1 flex-col">
      <div className="dark:divide-dark-700 flex divide-x divide-gray-100">
        <div
          className={
            "flex h-screen w-full flex-1 flex-col items-center" +
            " mx-auto justify-center lg:w-6/12 xl:max-w-3xl"
          }
        >
          <div className="absolute top-12 xl:top-24">
            <Logo href="/onboarding" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
};

export default OnboardingLayout;

const initializeOnboardingRoute = async () => {
  const logger = getLogger();

  try {
    const client = getSupabaseServerClient();
    const session = await requireSession(client);

    const user = session.user;
    const userRecord = await getUserById(client, user.id);
    const userData = userRecord.data;

    // if we cannot find the user's Database record
    // the user should go to the onboarding flow
    // so that the record wil be created after the end of the flow
    if (!userData) {
      return {
        auth: undefined,
        data: undefined,
        role: undefined,
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
      auth: user,
      data: userData,
      role: undefined,
    };
  } catch (e) {
    if (!isRedirectError(e)) {
      logger.error(
        `
        Error while initializing onboarding route: ${e}`,
      );

      redirect("/auth/sign-in");
    }
  }
};
