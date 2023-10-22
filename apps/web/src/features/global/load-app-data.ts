import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  isRedirectError,
  getURLFromRedirectError,
} from "next/dist/client/components/redirect";
import { getCurrentOrganization } from "@/features/organizations/get-current-organization";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { requireSession } from "@/features/auth/require-session";
import { parseSidebarStateCookie } from "@/lib/contexts/sidebar-state-cookie";
import { getUserById } from "@/features/users/queries";
import { getLogger } from "@/lib/utils/logger";

const getUIStateCookies = () => ({
  sidebarState: parseSidebarStateCookie(),
});

/**
 * This function is responsible for loading the application data
 * from the server-side, used in the (app) layout. The data is cached for
 * the request lifetime, which allows you to call the same across layouts.
 */
export const loadAppData = cache(async (organizationUid: string) => {
  try {
    const client = getSupabaseServerClient();
    const session = await requireSession(client);

    const user = session.user;
    const userId = user.id;

    // we fetch the user record from the Database
    // which is a separate object from the auth metadata
    const [{ data: userRecord }, organizationData] = await Promise.all([
      getUserById(client, userId),
      getCurrentOrganization({ organizationUid, userId }),
    ]);

    const isOnboarded = Boolean(userRecord?.onboarded);

    // when the user is not yet onboarded,
    // we simply redirect them back to the onboarding flow
    if (!isOnboarded || !userRecord) {
      return redirectToOnboarding();
    }

    if (!organizationData.organization) {
      return redirect("/dashboard");
    }

    const csrfToken = getCsrfToken();

    return {
      csrfToken,
      auth: {
        accessToken: session.access_token,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
        },
      },
      user: userRecord,
      organization: organizationData.organization,
      role: organizationData.role,
      ui: getUIStateCookies(),
    };
  } catch (error) {
    const logger = getLogger();

    // if the error is a redirect error, we simply redirect the user
    // to the destination URL extracted from the error
    if (isRedirectError(error)) {
      const url = getURLFromRedirectError(error);

      return redirect(url);
    }

    logger.warn(
      {
        error: JSON.stringify(error),
      },
      `Could not load application data`,
    );

    // in case of any error, we redirect the user to the home page
    // to avoid any potential infinite loop
    return redirectToHomePage();
  }
});

const redirectToOnboarding = () => redirect("/onboarding");

const redirectToHomePage = () => redirect("/");

const getCsrfToken = () => headers().get("X-CSRF-Token");
