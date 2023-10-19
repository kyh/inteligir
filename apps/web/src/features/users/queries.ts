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
