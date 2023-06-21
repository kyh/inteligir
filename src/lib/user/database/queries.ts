import type UserData from "~/core/session/types/user-data";
import type { DatabaseClient } from "~/lib/db";

export function getUserById(client: DatabaseClient, userId: string) {
  return client
    .from("users")
    .select<string, UserData>(
      `
      id,
      displayName: display_name,
      photoUrl: photo_url,
      onboarded
    `
    )
    .eq("id", userId)
    .throwOnError()
    .maybeSingle();
}
