import useQuery from "swr";
import { useSupabase } from "@/lib/supabase/use-supabase";
import { useFactorsMutationKey } from "@/features/auth/use-user-factors-mutation-key";

export const useFetchAuthFactors = () => {
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
