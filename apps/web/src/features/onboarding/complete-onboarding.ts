import type { SupabaseClient } from "@supabase/supabase-js";

type Params = {
  organizationName: string;
  userId: string;
  client: SupabaseClient;
};

export const completeOnboarding = async ({
  userId,
  organizationName,
  client,
}: Params) =>
  client
    .rpc("create_new_organization", {
      user_id: userId,
      org_name: organizationName,
    })
    .single<string>();
