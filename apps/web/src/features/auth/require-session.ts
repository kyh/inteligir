import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@/lib/supabase/client";
import { verifyRequiresMfa } from "@/features/auth/check-requires-mfa";

/**
 * Require a session to be present in the request
 */
export const requireSession = cache(async (client: SupabaseClient) => {
  const { data, error } = await client.auth.getSession();

  if (!data.session || error) {
    return redirect("/auth/sign-in");
  }

  const requiresMfa = await verifyRequiresMfa(client);

  // If the user requires multi-factor authentication,
  // redirect them to the page where they can verify their identity.
  if (requiresMfa) {
    return redirect("/auth/verify");
  }

  return data.session;
});
