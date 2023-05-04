import useSWRMutation from "swr/mutation";
import configuration from "~/configuration";
import useApiRequest from "~/core/hooks/use-api";
import useRefresh from "~/core/hooks/use-refresh";

/*
 * @name useRemoveMember
 * @description Mutation to remove a member from an organization.
 * @param membershipId
 */
function useRemoveMember() {
  const refresh = useRefresh();
  const fetcher = useApiRequest();
  const key = ["organizations", "members", "remove"];

  return useSWRMutation(
    key,
    (_, { arg: membershipId }: { arg: number }) => {
      const path = configuration.paths.api.organizations.member.replace(
        "[member]",
        membershipId.toString()
      );

      return fetcher({
        method: `DELETE`,
        path,
      });
    },
    {
      onSuccess: refresh,
    }
  );
}

export default useRemoveMember;
