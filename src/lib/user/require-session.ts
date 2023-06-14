import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import configuration from "~/configuration";
import verifyRequiresMfa from "~/core/session/utils/check-requires-mfa";

/**
 * @name requireSession
 * @description Require a session to be present in the request
 * @param client
 */
async function requireSession(client: SupabaseClient) {
  const { data, error } = await client.auth.getSession();

  if (!data.session || error) {
    throw redirect("/auth/sign-in");
  }

  const requiresMfa = await verifyRequiresMfa(client);

  // If the user requires multi-factor authentication,
  // redirect them to the page where they can verify their identity.
  if (requiresMfa) {
    throw redirect("/auth/verify");
  }

  return data.session;
}

export default requireSession;
