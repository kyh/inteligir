import type { SupabaseClient } from "@/lib/supabase/client";
import type { UserData } from "@/features/users/user-data";

export const getUserById = (client: SupabaseClient, userId: string) => {
  return client
    .from("users")
    .select<string, UserData>(
      `
      id,
      displayName: display_name,
      photoUrl: photo_url,
      onboarded
    `,
    )
    .eq("id", userId)
    .maybeSingle();
};

export const getUserDataById = async (
  client: SupabaseClient,
  userId: string,
) => {
  const user = await getUserById(client, userId);
  return user.data;
};
