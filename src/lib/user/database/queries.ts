import type { SupabaseClient } from "@supabase/supabase-js";
import type UserData from "~/core/session/types/user-data";

/**
 * @name getUserById
 * @param client
 * @param userId
 */
export function getUserById(client: SupabaseClient, userId: string) {
  return client
    .from("users")
    .select<string, UserData>(
      `
      id,
      displayName: display_name,
      photoUrl: photo_url
    `
    )
    .eq("id", userId)
    .throwOnError()
    .single();
}
