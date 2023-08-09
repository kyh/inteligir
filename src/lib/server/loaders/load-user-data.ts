import "server-only";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { getUserDataById } from "~/lib/server/queries";

const loadUserData = async () => {
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
};

const emptyUserData = () => {
  return {
    accessToken: undefined,
    session: undefined,
  };
};

export default loadUserData;
