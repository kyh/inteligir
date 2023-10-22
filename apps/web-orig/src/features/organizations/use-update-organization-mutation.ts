import useSWRMutation from "swr/mutation";
import { useSupabase } from "@/lib/supabase/use-supabase";
import { useUserId } from "@/features/users/use-user-id";
import type { Organization } from "@/features/organizations/organization";
import { updateOrganization } from "@/features/organizations/mutations";

export const useUpdateOrganizationMutation = () => {
  const client = useSupabase();
  const userId = useUserId();
  const key = ["organizations", userId];

  return useSWRMutation(
    key,
    (_, { arg: organization }: { arg: WithId<Partial<Organization>> }) => {
      return updateOrganization(client, {
        data: organization,
        id: organization.id,
      });
    },
  );
};
