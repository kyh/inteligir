import { useUserId } from "@/features/users/use-user-id";

export const useFactorsMutationKey = () => {
  const userId = useUserId();

  return ["mfa-factors", userId];
};
