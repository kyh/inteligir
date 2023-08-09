import useUserId from "~/core/hooks/use-user-id";

const useFactorsMutationKey = () => {
  const userId = useUserId();

  return ["mfa-factors", userId];
};

export default useFactorsMutationKey;
