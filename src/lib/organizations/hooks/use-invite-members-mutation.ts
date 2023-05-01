import useSWRMutation from "swr/mutation";
import { useRouter } from "next/navigation";

import useApiRequest from "~/core/hooks/use-api";

import type MembershipRole from "../types/membership-role";

interface Invite {
  email: string;
  role: MembershipRole;
}

const path = `/api/organizations/members/invite`;

function useInviteMembers() {
  const fetcher = useApiRequest<unknown, Invite[]>();
  const router = useRouter();
  const key = ["organizations", "members", "invite"];

  return useSWRMutation(
    key,
    (_, { arg: body }: { arg: Invite[] }) => {
      return fetcher({
        path,
        body,
      });
    },
    {
      onSuccess: () => {
        router.push("/settings/organization/members");
      },
    }
  );
}

export default useInviteMembers;
