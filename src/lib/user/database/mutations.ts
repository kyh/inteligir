import type UserData from "~/core/session/types/user-data";
import type { DatabaseClient } from "~/lib/db";

export function updateUserData(
  client: DatabaseClient,
  { id, ...data }: WithId<Partial<UserData>>
) {
  return client
    .from("users")
    .update({
      display_name: data.displayName,
      photo_url: data.photoUrl,
    })
    .match({ id })
    .throwOnError();
}

export async function createUser(client: DatabaseClient, data: UserData) {
  return client.from("users").insert(data).throwOnError();
}
