import useSWRMutation from "swr/mutation";
import useSupabase from "~/core/hooks/use-supabase";
import useUserId from "~/core/hooks/use-user-id";
import { updateOrganization } from "~/lib/organizations/mutations";
import type Organization from "~/lib/organizations/types/organization";

function useUpdateOrganizationMutation() {
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
}

export default useUpdateOrganizationMutation;
