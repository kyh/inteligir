import type { DatabaseClient } from "~/core/db";
import type UserData from "~/core/session/types/user-data";

export async function getUserDataById(client: DatabaseClient, userId: string) {
  const result = await client
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
    .maybeSingle();

  return result.data;
}
