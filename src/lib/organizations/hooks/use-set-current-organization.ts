import configuration from "~/configuration";
import useSWRMutation from "swr/mutation";
import useApiRequest from "~/core/hooks/use-api";

function useSetCurrentOrganization() {
  const fetcher = useApiRequest();
  const key = ["organizations", "current"];

  return useSWRMutation(key, (_, { arg: organizationId }: { arg: string }) => {
    const path = configuration.paths.api.organizations.current.replace(
      "[organization]",
      organizationId
    );

    return fetcher({
      path,
      method: `PUT`,
    });
  });
}

export default useSetCurrentOrganization;
