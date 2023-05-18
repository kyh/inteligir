import "server-only";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { getUserDataById } from "~/lib/server/queries";

/**
 * @name loadUserData
 * @description Loads the user's data from Supabase Auth and Database.
 * This is used in the (site) layout to display the user's name and avatar.
 */
async function loadUserData() {
  const client = getSupabaseServerClient();

  try {
    const { data, error } = await client.auth.getSession();

    if (!data.session || error) {
      return emptyUserData();
    }

    const userId = data.session.user.id;
    const userData = await getUserDataById(client, userId);
    const accessToken = data.session.access_token;

    return {
      accessToken,
      session: {
        auth: data.session,
        data: userData || undefined,
        role: undefined,
      },
    };
  } catch (e) {
    return emptyUserData();
  }
}

async function emptyUserData() {
  return {
    accessToken: undefined,
    session: undefined,
  };
}

export default loadUserData;
