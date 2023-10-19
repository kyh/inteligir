import useSWR from "swr";
import { useSupabase } from "@/lib/supabase/use-supabase";
import { getOrganizationsByUserId } from "@/features/organizations/queries";

export const useUserOrganizationsQuery = (userId: string) => {
  const client = useSupabase();
  const key = ["organizations", userId];

  return useSWR(key, async () => {
    return getOrganizationsByUserId(client, userId).then(
      (result) => result.data,
    );
  });
};
