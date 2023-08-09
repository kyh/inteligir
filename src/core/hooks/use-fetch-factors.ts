import useQuery from "swr";
import useSupabase from "~/core/hooks/use-supabase";
import useFactorsMutationKey from "~/core/hooks/use-user-factors-mutation-key";

const useFetchAuthFactors = () => {
  const client = useSupabase();
  const key = useFactorsMutationKey();

  return useQuery(key, async () => {
    const { data, error } = await client.auth.mfa.listFactors();

    if (error) {
      throw error;
    }

    return data;
  });
};

export default useFetchAuthFactors;
