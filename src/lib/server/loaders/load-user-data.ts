import { getUserDataById } from "~/lib/server/queries";
import getSupabaseServerClient from "~/core/supabase/server-client";

/**
 * @name loadUserData
 * @description Loads the user's data from Supabase Auth and Database
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
      auth: data.session,
      data: userData || undefined,
      role: undefined,
    };
  } catch (e) {
    return emptyUserData();
  }
}

async function emptyUserData() {
  return {
    accessToken: undefined,
    auth: undefined,
    data: undefined,
    role: undefined,
  };
}

export default loadUserData;
