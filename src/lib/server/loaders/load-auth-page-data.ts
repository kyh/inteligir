import configuration from "~/configuration";
import getSupabaseServerClient from "~/core/supabase/server-client";
import verifyRequiresMfa from "~/core/session/utils/check-requires-mfa";

const loadAuthPageData = async () => {
  try {
    const client = getSupabaseServerClient();

    const {
      data: { session },
    } = await client.auth.getSession();

    const requiresMultiFactorAuthentication = await verifyRequiresMfa(client);

    // If the user is logged in and does not require multi-factor authentication,
    // redirect them to the home page.
    if (session && !requiresMultiFactorAuthentication) {
      return {
        redirect: true,
        destination: configuration.paths.appHome,
      };
    }

    return {};
  } catch (e) {
    return {};
  }
};

export default loadAuthPageData;
