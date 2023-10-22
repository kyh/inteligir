import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { verifyRequiresMfa } from "@/features/auth/check-requires-mfa";

/**
 * This function is responsible for loading the authentication layout's data.
 *
 * If the user is logged in and does not require multi-factor
 * authentication, redirect them to the app home page. Otherwise, continue
 * to the authentication pages.
 */
export const loadAuthPageData = async () => {
  const client = getSupabaseServerClient();

  const {
    data: { session },
  } = await client.auth.getSession();

  const requiresMultiFactorAuthentication = await verifyRequiresMfa(client);

  // If the user is logged in and does not require multi-factor authentication,
  // redirect them to the home page.
  if (session && !requiresMultiFactorAuthentication) {
    console.log(
      `User is logged in and does not require multi-factor authentication. Redirecting to home page.`,
    );

    redirect("/dashboard");
  }

  return {};
};
