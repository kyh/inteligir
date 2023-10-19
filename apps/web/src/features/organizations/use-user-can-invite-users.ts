import { canInviteUsers } from "@/features/organizations/permissions";
import { useCurrentUserRole } from "./use-current-user-role";

export const useUserCanInviteUsers = () => {
  const role = useCurrentUserRole();

  return role !== undefined && canInviteUsers(role);
};
