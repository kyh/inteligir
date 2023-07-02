import "server-only";
import { redirect } from "next/navigation";
import verifyRequiresMfa from "~/core/session/utils/check-requires-mfa";
import getSupabaseServerClient from "~/core/supabase/server-client";

/**
 * This function is responsible for loading the authentication layout's data.
 * If the user is logged in and does not require multi-factor
 * authentication, redirect them to the app home page. Otherwise, continue
 * to the authentication pages.
 */
const loadAuthPageData = async () => {
  const client = getSupabaseServerClient();

  const {
    data: { session },
  } = await client.auth.getSession();

  const requiresMultiFactorAuthentication = await verifyRequiresMfa(client);

  // If the user is logged in and does not require multi-factor authentication,
  // redirect them to the home page.
  if (session && !requiresMultiFactorAuthentication) {
    redirect("/dashboard");
  }

  return {};
};

export default loadAuthPageData;
