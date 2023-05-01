import useSWRMutation from "swr/mutation";
import useApiRequest from "~/core/hooks/use-api";
import useRefresh from "~/core/hooks/use-refresh";

function useCreateOrganization(userId: Maybe<string>) {
  const fetcher = useApiRequest<void, { organization: string }>();
  const refresh = useRefresh();
  const key = ["organizations", userId];

  return useSWRMutation(
    key,
    (_, { arg: organization }: { arg: string }) => {
      const path = "/api/organizations";

      return fetcher({
        path,
        body: { organization },
        method: "POST",
      });
    },
    {
      onSuccess: refresh,
    }
  );
}

export default useCreateOrganization;
