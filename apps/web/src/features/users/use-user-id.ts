import { useUserSession } from "@/features/auth/session-context";

export const useUserId = () => {
  const session = useUserSession();

  return session?.auth?.user.id;
};
