import { useUserSession } from "@/features/auth/session-context";

export const useCurrentUserRole = () => {
  const user = useUserSession();

  return user?.role;
};
