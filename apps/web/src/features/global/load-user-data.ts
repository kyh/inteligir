import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { getUserById } from "@/features/users/queries";

export const loadUserData = async () => {
  const client = getSupabaseServerClient();

  try {
    const { data, error } = await client.auth.getSession();

    if (!data.session || error) {
      return emptyUserData();
    }

    const session = data.session;
    const userId = session.user.id;

    const { data: currentUser } = await getUserById(client, userId);

    return {
      session: {
        auth: {
          accessToken: session.access_token,
          user: {
            id: session.user.id,
            email: session.user.email,
            phone: session.user.phone,
          },
        },
        data: currentUser,
        role: undefined,
      },
    };
  } catch (e) {
    return emptyUserData();
  }
};

const emptyUserData = () => ({
  accessToken: undefined,
  session: undefined,
});
