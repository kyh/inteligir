import useSWRMutation from "swr/mutation";
import useApiRequest from "~/core/hooks/use-api";

function useAcceptInvite() {
  const fetcher = useApiRequest<
    {
      verifyEmail: boolean;
    },
    {
      userId?: string;
    }
  >();

  const key = ["invite", "accept"];

  return useSWRMutation(
    key,
    async (_, { arg }: { arg: { userId?: string } }) => {
      const path = [window.location.pathname, "accept"].join("/");

      return fetcher({
        path,
        method: "POST",
        body: {
          userId: arg.userId,
        },
      });
    }
  );
}

export default useAcceptInvite;
