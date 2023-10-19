import type { SupabaseClient } from "@/lib/supabase/client";
import type { UserData } from "@/features/users/user-data";

export const updateUserData = (
  client: SupabaseClient,
  { id, ...data }: WithId<Partial<UserData>>,
) =>
  client
    .from("users")
    .update({
      display_name: data.displayName,
      photo_url: data.photoUrl,
    })
    .match({ id })
    .throwOnError();
