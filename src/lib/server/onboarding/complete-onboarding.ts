import type { DatabaseClient } from "~/core/db";

type Params = {
  organizationName: string;
  userId: string;
  client: DatabaseClient;
};

async function completeOnboarding({
  userId,
  organizationName,
  client,
}: Params) {
  return client
    .rpc("create_new_organization", {
      user_id: userId,
      org_name: organizationName,
    })
    .single<string>();
}

export default completeOnboarding;
