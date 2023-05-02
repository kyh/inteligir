import { use } from "react";
import { redirect } from "next/navigation";
import getSupabaseServerClient from "~/core/supabase/server-client";
import requireSession from "~/lib/user/require-session";
import { getUserDataById } from "~/lib/server/queries";
import getCurrentOrganization from "~/lib/server/organizations/get-current-organization";
import OnboardingIllustration from "~/app/onboarding/components/OnboardingIllustration";
import { Logo } from "~/components/Logo";
import Link from "next/link";

function OnboardingLayout({ children }: React.PropsWithChildren) {
  const data = use(loadData());

  if ("redirect" in data) {
    return redirect(data.destination);
  }

  return (
    <div className="flex flex-1 flex-col dark:bg-black-500">
      <div className="flex divide-x divide-gray-100 dark:divide-black-300">
        <div className="flex h-screen w-full flex-1 flex-col items-center justify-center lg:w-6/12">
          <div className="absolute top-24 hidden lg:flex">
            <Link href="/onboarding">
              <Logo />
            </Link>
          </div>

          {children}
        </div>

        <div className="hidden w-6/12 flex-1 items-center justify-center bg-gray-50 dark:bg-black-400 lg:flex">
          <div>
            <OnboardingIllustration />
          </div>
        </div>
      </div>
    </div>
  );
}

export default OnboardingLayout;

async function loadData() {
  try {
    const client = getSupabaseServerClient();
    const sessionResult = await requireSession(client);

    if ("redirect" in sessionResult) {
      return sessionResult;
    }

    const user = sessionResult.user;
    const userData = await getUserDataById(client, user.id);

    // if we cannot find the user's Database record
    // the user should go to the onboarding flow
    // so that the record wil be created after the end of the flow
    if (!userData) {
      const response = {
        auth: user || undefined,
        data: userData ?? undefined,
        role: undefined,
      };

      return response;
    }

    const userId = userData.id;

    const organization = await getCurrentOrganization(client, {
      userId,
    });

    const onboarded = userData.onboarded;

    // there are two cases when we redirect the user to the onboarding
    // 1. if they have not been onboarded yet
    // 2. if they end up with 0 organizations (for example, if they get removed)
    //
    // NB: you should remove this if you want to
    // allow organization-less users within the application
    if (onboarded && organization) {
      return redirectTo("/");
    }

    return {
      auth: user,
      data: userData,
      role: undefined,
    };
  } catch (e) {
    console.error(e);

    return redirectTo("/auth/sign-in");
  }
}

function redirectTo(destination: string): {
  redirect: true;
  destination: string;
} {
  return {
    redirect: true,
    destination,
  };
}
