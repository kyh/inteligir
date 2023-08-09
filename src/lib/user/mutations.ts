import type { DatabaseClient } from "~/core/db";
import type UserData from "~/core/session/types/user-data";

export function updateUserData(
  client: DatabaseClient,
  { id, ...data }: WithId<Partial<UserData>>,
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
