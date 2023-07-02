import { redirect } from "next/navigation";
import type { DatabaseClient } from "~/core/db";
import verifyRequiresMfa from "~/core/session/utils/check-requires-mfa";

async function requireSession(client: DatabaseClient) {
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
}

export default requireSession;
