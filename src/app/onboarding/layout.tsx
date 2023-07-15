import { isRedirectError } from "next/dist/client/components/redirect";
import { redirect } from "next/navigation";
import getLogger from "~/core/logger";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { getUserDataById } from "~/lib/server/queries";
import requireSession from "~/lib/user/require-session";
import { Logo } from "~/components/Logo";
import OnboardingIllustration from "./components/OnboardingIllustration";

export const dynamic = "force-dynamic";

const OnboardingLayout = async ({ children }: React.PropsWithChildren) => {
  await initializeOnboardingRoute();

  return (
    <div className="flex flex-1 flex-col dark:bg-zinc-500">
      <div className="flex divide-x divide-zinc-100 dark:divide-zinc-300">
        <div className="flex h-screen w-full flex-1 flex-col items-center justify-center lg:w-6/12">
          <div className="absolute top-24 hidden lg:flex">
            <Logo />
          </div>
          {children}
        </div>
        <div className="hidden w-6/12 flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-400 lg:flex">
          <div>
            <OnboardingIllustration />
          </div>
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
    const userData = await getUserDataById(client, user.id);

    // if we cannot find the user's Database record
    // the user should go to the onboarding flow
    // so that the record wil be created after the end of the flow
    if (!userData) {
      return {
        auth: user || undefined,
        data: userData ?? undefined,
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
        Error while initializing onboarding route: ${e}`
      );

      redirect("/auth/sign-in");
    }
  }
};
