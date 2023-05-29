import configuration from "~/configuration";
import useSWRMutation from "swr/mutation";
import useApiRequest from "~/core/hooks/use-api";
import useRefresh from "~/core/hooks/use-refresh";

interface Params {
  membershipId: number;
}

const path = configuration.paths.api.organizations.transferOwnership;

function useTransferOrganizationOwnership() {
  const fetcher = useApiRequest<void, Params>();
  const refresh = useRefresh();
  const key = ["organizations", "transfer-ownership"];

  return useSWRMutation(
    key,
    (_, { arg }: { arg: Params }) => {
      return fetcher({
        path,
        method: `PUT`,
        body: {
          membershipId: arg.membershipId,
        },
      });
    },
    {
      onSuccess: refresh,
    }
  );
}

export default useTransferOrganizationOwnership;
