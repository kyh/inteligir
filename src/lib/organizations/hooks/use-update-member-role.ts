import configuration from "~/configuration";
import useSWRMutation from "swr/mutation";
import useApiRequest from "~/core/hooks/use-api";
import useRefresh from "~/core/hooks/use-refresh";
import type MembershipRole from "../types/membership-role";

interface Params {
  role: MembershipRole;
}

/**
 * @name useUpdateMemberRequest
 * @description Mutation to update the role of a member within an organization.
 * @param membershipId
 */
function useUpdateMemberRequest(membershipId: number) {
  const fetcher = useApiRequest<unknown, Params>();
  const refresh = useRefresh();

  const path = configuration.paths.api.organizations.member.replace(
    "[member]",
    membershipId.toString()
  );

  const key = ["organizations", "members", membershipId];

  return useSWRMutation(
    key,
    (_, { arg: params }: { arg: Params }) => {
      const body = {
        role: params.role,
      };

      return fetcher({
        path,
        method: `PUT`,
        body,
      });
    },
    {
      onSuccess: refresh,
    }
  );
}

export default useUpdateMemberRequest;
