import { canInviteUsers } from "~/lib/organizations/permissions";
import useCurrentUserRole from "./use-current-user-role";

const useUserCanInviteUsers = () => {
  const role = useCurrentUserRole();

  return role !== undefined && canInviteUsers(role);
};

export default useUserCanInviteUsers;
